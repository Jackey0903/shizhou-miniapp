/**
 * 云函数：getQuestions - 获取题目列表
 * 通过云函数获取题目，绕过客户端安全规则限制
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
    const { courseId, bankId, skip = 0, limit = 50 } = event || {}

    const targetId = bankId || courseId
    if (!targetId) {
        return { code: -1, msg: '缺少题库ID' }
    }

    try {
        // 先尝试 bankId 查询
        let questions = []
        try {
            const bankRes = await db.collection('questions')
                .where({ bankId: targetId })
                .orderBy('sort', 'asc')
                .skip(skip)
                .limit(limit)
                .get()
            questions = bankRes.data || []
        } catch (err) {}

        // 如果没数据，尝试 courseId 查询
        if (questions.length === 0) {
            const courseRes = await db.collection('questions')
                .where({ courseId: targetId })
                .orderBy('sort', 'asc')
                .skip(skip)
                .limit(limit)
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
