// 云函数：submitAnswer — 提交答题结果，更新复习计划
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 艾宾浩斯复习间隔（毫秒）
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

function calcNextReview(result, currentLevel) {
    let nextLevel = currentLevel
    if (result === 'know') {
        nextLevel = Math.min(currentLevel + 1, INTERVALS.length - 1)
    } else if (result === 'none') {
        nextLevel = 0
    }
    const nextReviewAt = new Date(Date.now() + INTERVALS[nextLevel])
    return { nextReviewAt, nextLevel }
}

exports.main = async (event, context) => {
    const { OPENID } = cloud.getWXContext()
    const { questionId, courseId, result, planId, userAnswer = '', isCorrect = false } = event

    try {
        if (!questionId) {
            return { code: -1, error: '缺少题目ID' }
        }

        // 获取题目信息用于缓存
        let questionData = {}
        try {
            const questionRes = await db.collection('questions').doc(questionId).get()
            questionData = questionRes.data || {}
        } catch (err) {
            console.warn('[submitAnswer] question not found', questionId, err)
        }
        const questionSnapshot = {
            questionContent: questionData.content || '',
            questionOptions: questionData.options || [],
            questionType: questionData.type || '',
            questionAnswer: questionData.answer || '',
            questionExplanation: questionData.explanation || '',
            userAnswer: typeof userAnswer === 'string' ? userAnswer.trim() : '',
            isCorrect: !!isCorrect
        }
        const studyDateStr = formatShanghaiDate(new Date())

        // 查找是否已有学习记录
        const existing = await db.collection('study_records')
            .where({ _openid: OPENID, questionId })
            .get()

        const { nextReviewAt, nextLevel } = calcNextReview(
            result,
            existing.data[0]?.reviewLevel || 0
        )

        if (existing.data.length > 0) {
            // 更新记录
            await db.collection('study_records').doc(existing.data[0]._id).update({
                data: {
                    result,
                    reviewLevel: nextLevel,
                    nextReviewAt,
                    reviewTimes: db.command.inc(1),
                    updatedAt: db.serverDate(),
                    studyDateStr,
                    ...questionSnapshot
                }
            })
        } else {
            // 新建记录
            await db.collection('study_records').add({
                data: {
                    _openid: OPENID,
                    questionId,
                    courseId,
                    planId: planId || '',
                    result,
                    reviewLevel: nextLevel,
                    nextReviewAt,
                    reviewTimes: 1,
                    createdAt: db.serverDate(),
                    updatedAt: db.serverDate(),
                    studyDateStr,
                    ...questionSnapshot
                }
            })
        }

        return { code: 0, data: { nextReviewAt, nextLevel } }
    } catch (err) {
        return { code: -1, error: err.message }
    }
}
