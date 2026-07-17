/**
 * 云函数：getCourse - 获取单个题库详情
 * 通过云函数获取题库详情，绕过客户端安全规则限制
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
    const { courseId } = event || {}
    
    if (!courseId) {
        return { code: -1, msg: '缺少题库ID' }
    }

    try {
        // 先尝试 question_banks 集合
        try {
            const bankRes = await db.collection('question_banks').doc(courseId).get()
            if (bankRes.data) {
                const bank = bankRes.data
                let subject = {}
                if (bank.subjectId) {
                    try {
                        const subjectRes = await db.collection('subjects').doc(bank.subjectId).get()
                        subject = subjectRes.data || {}
                    } catch (e) {}
                }
                return {
                    code: 0,
                    data: {
                        ...bank,
                        category: bank.category || subject.name || '综合题库',
                        subjectId: bank.subjectId || subject._id || '',
                        subjectName: subject.name || bank.category || '综合题库',
                        color: bank.color || subject.color || ''
                    }
                }
            }
        } catch (err) {}

        // 降级到 courses 集合
        const courseRes = await db.collection('courses').doc(courseId).get()
        return { code: 0, data: courseRes.data }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
