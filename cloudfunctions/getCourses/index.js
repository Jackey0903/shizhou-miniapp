/**
 * 云函数：getCourses - 获取题库列表
 * 通过云函数获取题库，绕过客户端安全规则限制
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
    try {
        let courses = []
        
        // 先尝试 question_banks 集合
        try {
            const banksRes = await db.collection('question_banks')
                .orderBy('sort', 'asc')
                .get()
            if (banksRes.data && banksRes.data.length > 0) {
                courses = banksRes.data
                return { code: 0, data: courses, source: 'question_banks' }
            }
        } catch (err) {}

        // 降级到 courses 集合
        const coursesRes = await db.collection('courses')
            .orderBy('sort', 'asc')
            .get()
        courses = coursesRes.data || []
        
        return { code: 0, data: courses, source: 'courses' }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
