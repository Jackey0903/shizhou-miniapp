/**
 * 云函数：getQuestions - 获取题目列表
 * 通过云函数获取题目，绕过客户端安全规则限制
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isQuestionEnabled(question = {}) {
    return question.enabled !== false && !['disabled', 'offline'].includes(question.status)
}

async function hasQuestions(field, targetId) {
    const result = await db.collection('questions').where({ [field]: targetId }).limit(1).get()
    return (result.data || []).length > 0
}

async function resolveQuestionField(targetId) {
    return (await hasQuestions('bankId', targetId)) ? 'bankId' : 'courseId'
}

async function countVisibleQuestions(field, targetId) {
    const questions = []
    while (questions.length < 5000) {
        const result = await db.collection('questions')
            .where({ [field]: targetId })
            .skip(questions.length)
            .limit(Math.min(100, 5000 - questions.length))
            .get()
        const page = result.data || []
        questions.push(...page)
        if (page.length < 100) break
    }
    return questions.filter(isQuestionEnabled).length
}

exports.main = async (event, context) => {
    const { OPENID } = cloud.getWXContext()
    const { action = 'list', courseId, bankId, skip = 0, limit = 50 } = event || {}

    const targetId = bankId || courseId
    if (!targetId) {
        return { code: -1, msg: '缺少题库ID' }
    }

    try {
        let bank = null
        try {
            const bankRes = await db.collection('question_banks').doc(targetId).get()
            bank = bankRes.data || null
        } catch (err) {
            try {
                const courseRes = await db.collection('courses').doc(targetId).get()
                bank = courseRes.data || null
            } catch (courseErr) {}
        }
        if (!bank) {
            return { code: 404, msg: '题库不存在或已下架' }
        }
        if (['disabled', 'offline'].includes(bank.status)) {
            return { code: 404, msg: '该题库已下架' }
        }
        if (bank.isLocked) {
            const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
            const user = userRes.data[0]
            const expireTime = user && user.vipExpireDate ? new Date(user.vipExpireDate).getTime() : 0
            const vipActive = !!(user && user.isVip && (!expireTime || expireTime > Date.now()))
            if (!vipActive) return { code: 403, msg: '该题库为VIP专享，请先开通VIP' }
        }

        const safeSkip = Math.max(0, Number(skip) || 0)
        const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50))
        const questionField = await resolveQuestionField(targetId)
        if (action === 'count') {
            return { code: 0, data: { total: await countVisibleQuestions(questionField, targetId) } }
        }
        const result = await db.collection('questions')
            .where({ [questionField]: targetId })
            .orderBy('sort', 'asc')
            .skip(safeSkip)
            .limit(safeLimit)
            .get()
        const rawQuestions = result.data || []
        const questions = rawQuestions.filter(isQuestionEnabled)

        return {
            code: 0,
            data: questions,
            total: questions.length,
            nextSkip: safeSkip + rawQuestions.length,
            sourceExhausted: rawQuestions.length < safeLimit
        }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
