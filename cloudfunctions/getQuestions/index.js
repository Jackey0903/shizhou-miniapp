/**
 * 云函数：getQuestions - 获取题目列表
 * 通过云函数获取题目，绕过客户端安全规则限制
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
        if (action === 'count') {
            const bankCount = await db.collection('questions').where({ bankId: targetId }).count()
            if (bankCount.total > 0) return { code: 0, data: { total: bankCount.total } }
            const courseCount = await db.collection('questions').where({ courseId: targetId }).count()
            return { code: 0, data: { total: courseCount.total } }
        }
        // 先尝试 bankId 查询
        let questions = []
        try {
            const bankRes = await db.collection('questions')
                .where({ bankId: targetId })
                .orderBy('sort', 'asc')
                .skip(safeSkip)
                .limit(safeLimit)
                .get()
            questions = bankRes.data || []
        } catch (err) {}

        // 如果没数据，尝试 courseId 查询
        if (questions.length === 0) {
            const courseRes = await db.collection('questions')
                .where({ courseId: targetId })
                .orderBy('sort', 'asc')
                .skip(safeSkip)
                .limit(safeLimit)
                .get()
            questions = courseRes.data || []
        }

        return {
            code: 0,
            data: questions,
            total: questions.length
        }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
