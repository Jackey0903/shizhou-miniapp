const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ALLOWED_RESULTS = new Set(['none', 'maybe', 'know'])
const INTERVALS = [
    5 * 60 * 1000,
    30 * 60 * 1000,
    12 * 60 * 60 * 1000,
    1 * 24 * 60 * 60 * 1000,
    2 * 24 * 60 * 60 * 1000,
    4 * 24 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
    15 * 24 * 60 * 60 * 1000
]

const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
})

function formatShanghaiDate(date) {
    return shanghaiFormatter.format(date)
}

function normalizeText(value = '') {
    return String(value)
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[。．.,，!！?？;；:："'“”‘’()（）【】\[\]{}]/g, '')
}

function getCorrectIndex(question = {}) {
    const explicit = Number(question.correctIndex)
    if (Number.isInteger(explicit) && explicit >= 0) return explicit
    const match = String(question.answer || '').trim().match(/^([A-E])(?:[.、\s]|$)/i)
    return match ? match[1].toUpperCase().charCodeAt(0) - 65 : -1
}

function calcNextReview(result, currentLevel) {
    let nextLevel = Math.max(0, Number(currentLevel) || 0)
    if (result === 'know') {
        nextLevel = Math.min(nextLevel + 1, INTERVALS.length - 1)
    } else if (result === 'none') {
        nextLevel = 0
    }
    return {
        nextReviewAt: new Date(Date.now() + INTERVALS[nextLevel]),
        nextLevel
    }
}

function buildRecordId(openid, questionId) {
    const hash = crypto.createHash('sha256').update(`${openid}:${questionId}`).digest('hex')
    return `study_${hash.slice(0, 32)}`
}

async function assertQuestionAccess(openid, question, existing) {
    const bankId = question.bankId || question.courseId || (existing && existing.courseId) || ''
    if (!bankId) return
    let bank = null
    try {
        const res = await db.collection('question_banks').doc(bankId).get()
        bank = res.data || null
    } catch (err) {
        try {
            const res = await db.collection('courses').doc(bankId).get()
            bank = res.data || null
        } catch (courseErr) {}
    }
    if (!bank) {
        if (existing && existing.questionContent) return
        const err = new Error('题库不存在或已下架')
        err.businessCode = 404
        throw err
    }
    if (['disabled', 'offline'].includes(bank.status)) {
        const err = new Error('该题库已下架')
        err.businessCode = 404
        throw err
    }
    if (!bank.isLocked) return

    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const user = (userRes.data || [])[0]
    const expireTime = user && user.vipExpireDate ? new Date(user.vipExpireDate).getTime() : 0
    const vipActive = !!(user && user.isVip && (!expireTime || expireTime > Date.now()))
    if (!vipActive) {
        const err = new Error('该题库为VIP专享，请先开通VIP')
        err.businessCode = 403
        throw err
    }
}

exports.main = async (event = {}) => {
    const { OPENID } = cloud.getWXContext()
    const {
        action = 'submit',
        questionId,
        courseId,
        result,
        planId,
        userAnswer = '',
        userOptionIndex = -1,
        submissionId = ''
    } = event

    try {
        if (!OPENID) return { code: -1, error: '未获取到用户身份' }
        if (action === 'list') {
            const records = []
            while (records.length < 5000) {
                const res = await db.collection('study_records')
                    .where({ _openid: OPENID })
                    .skip(records.length)
                    .limit(Math.min(100, 5000 - records.length))
                    .get()
                const page = res.data || []
                records.push(...page)
                if (page.length < 100) break
            }
            const courseFilter = String(event.courseId || '')
            const resultFilter = String(event.result || '')
            const dueBefore = event.dueBefore ? new Date(event.dueBefore).getTime() : 0
            const filtered = records.filter((item) => {
                if (courseFilter && item.courseId !== courseFilter) return false
                if (resultFilter && item.result !== resultFilter) return false
                if (dueBefore) {
                    const due = new Date(item.nextReviewAt || 0).getTime()
                    if (!due || due > dueBefore) return false
                }
                return true
            })
            const accessCache = new Map()
            const canAccessCourse = async (bankId) => {
                if (!bankId) return true
                if (!accessCache.has(bankId)) {
                    accessCache.set(bankId, assertQuestionAccess(OPENID, { bankId }, null)
                        .then(() => true)
                        .catch(() => false))
                }
                return accessCache.get(bankId)
            }
            if (courseFilter && !(await canAccessCourse(courseFilter))) {
                return { code: 403, error: '该题库当前不可访问' }
            }

            const accessible = []
            for (const item of filtered) {
                let question = null
                const bankId = item.courseId || ''
                if (bankId && !(await canAccessCourse(bankId))) continue
                if (!item.questionContent && item.questionId) {
                    try {
                        const res = await db.collection('questions').doc(item.questionId).get()
                        question = res.data || null
                        await assertQuestionAccess(OPENID, question || {}, item)
                    } catch (err) {
                        continue
                    }
                }
                const correctIndex = question ? getCorrectIndex(question) : item.questionCorrectIndex
                accessible.push(question ? {
                    ...item,
                    courseId: question.bankId || question.courseId || item.courseId || '',
                    questionContent: question.content || '',
                    questionOptions: question.options || [],
                    questionType: question.type || '',
                    questionAnswer: question.answer || '',
                    questionExplanation: question.explanation || '',
                    questionCorrectIndex: correctIndex,
                    questionImageUrl: question.imageUrl || ''
                } : item)
            }
            accessible.sort((a, b) => {
                const left = dueBefore ? a.nextReviewAt : a.updatedAt
                const right = dueBefore ? b.nextReviewAt : b.updatedAt
                const delta = new Date(left || 0).getTime() - new Date(right || 0).getTime()
                return dueBefore ? delta : -delta
            })
            return { code: 0, data: accessible }
        }
        if (!questionId) return { code: -1, error: '缺少题目ID' }
        if (!ALLOWED_RESULTS.has(result)) return { code: -1, error: '答题结果无效' }

        const existingRes = await db.collection('study_records')
            .where({ _openid: OPENID, questionId })
            .limit(2)
            .get()
        const existing = existingRes.data[0] || null
        const safeSubmissionId = String(submissionId || '').slice(0, 160)
        if (existing && safeSubmissionId && existing.lastSubmissionId === safeSubmissionId) {
            return {
                code: 0,
                data: {
                    nextReviewAt: existing.nextReviewAt,
                    nextLevel: existing.reviewLevel || 0,
                    isCorrect: existing.isCorrect,
                    duplicate: true
                }
            }
        }

        let questionData = {}
        try {
            const questionRes = await db.collection('questions').doc(questionId).get()
            questionData = questionRes.data || {}
        } catch (err) {
            if (!existing || !existing.questionContent) {
                return { code: -1, error: '题目不存在或已下架' }
            }
        }
        await assertQuestionAccess(OPENID, questionData, existing)

        const questionType = questionData.type || (existing && existing.questionType) || ''
        const correctIndex = getCorrectIndex({
            correctIndex: questionData.correctIndex !== undefined
                ? questionData.correctIndex
                : existing && existing.questionCorrectIndex,
            answer: questionData.answer || (existing && existing.questionAnswer) || ''
        })
        const selectedIndex = Number(userOptionIndex)
        const trimmedAnswer = typeof userAnswer === 'string' ? userAnswer.trim() : ''
        let isCorrect = result === 'know'
        if (questionType === 'choice') {
            isCorrect = Number.isInteger(selectedIndex) && selectedIndex >= 0 && correctIndex >= 0
                && selectedIndex === correctIndex
        } else if (questionType === 'fill') {
            const expected = questionData.answer || (existing && existing.questionAnswer) || ''
            isCorrect = !!trimmedAnswer && normalizeText(trimmedAnswer) === normalizeText(expected)
        }

        const questionSnapshot = {
            questionContent: questionData.content || (existing && existing.questionContent) || '',
            questionOptions: questionData.options || (existing && existing.questionOptions) || [],
            questionType,
            questionAnswer: questionData.answer || (existing && existing.questionAnswer) || '',
            questionExplanation: questionData.explanation || (existing && existing.questionExplanation) || '',
            questionCorrectIndex: correctIndex,
            questionImageUrl: questionData.imageUrl || (existing && existing.questionImageUrl) || '',
            userAnswer: trimmedAnswer,
            userOptionIndex: Number.isInteger(selectedIndex) ? selectedIndex : -1,
            isCorrect,
            selfAssessment: result
        }
        const studyDateStr = formatShanghaiDate(new Date())
        const { nextReviewAt, nextLevel } = calcNextReview(
            result,
            existing ? existing.reviewLevel : 0
        )

        if (existing) {
            await db.collection('study_records').doc(existing._id).update({
                data: {
                    courseId: questionData.bankId || questionData.courseId || existing.courseId || courseId || '',
                    planId: planId || existing.planId || '',
                    result,
                    reviewLevel: nextLevel,
                    nextReviewAt,
                    reviewTimes: db.command.inc(1),
                    updatedAt: db.serverDate(),
                    studyDateStr,
                    lastSubmissionId: safeSubmissionId,
                    ...questionSnapshot
                }
            })
        } else {
            await db.collection('study_records').doc(buildRecordId(OPENID, questionId)).set({
                data: {
                    _openid: OPENID,
                    questionId,
                    courseId: questionData.bankId || questionData.courseId || courseId || '',
                    planId: planId || '',
                    result,
                    reviewLevel: nextLevel,
                    nextReviewAt,
                    reviewTimes: 1,
                    createdAt: db.serverDate(),
                    updatedAt: db.serverDate(),
                    studyDateStr,
                    firstStudyDateStr: studyDateStr,
                    lastSubmissionId: safeSubmissionId,
                    ...questionSnapshot
                }
            })
        }

        return { code: 0, data: { nextReviewAt, nextLevel, isCorrect } }
    } catch (err) {
        if (err && err.businessCode) return { code: err.businessCode, error: err.message }
        console.error('[submitAnswer] failed', err)
        return { code: -1, error: err.message || '答题结果保存失败' }
    }
}
