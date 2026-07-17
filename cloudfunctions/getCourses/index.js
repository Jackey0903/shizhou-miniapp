/**
 * 云函数：getCourses - 获取题库列表
 * 通过云函数获取题库，绕过客户端安全规则限制
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function readAll(collectionName, maxItems = 1000) {
    const list = []
    while (list.length < maxItems) {
        const res = await db.collection(collectionName)
            .orderBy('sort', 'asc')
            .skip(list.length)
            .limit(Math.min(100, maxItems - list.length))
            .get()
        const page = res.data || []
        list.push(...page)
        if (page.length < 100) break
    }
    return list
}

async function enrichBanks(banks) {
    let subjects = []
    try {
        subjects = await readAll('subjects')
    } catch (err) {}
    const subjectMap = {}
    subjects.forEach((subject) => { subjectMap[subject._id] = subject })
    return banks.map((bank) => {
        const subject = subjectMap[bank.subjectId] || {}
        return {
            ...bank,
            category: bank.category || subject.name || '综合题库',
            subjectName: bank.subjectName || subject.name || bank.category || '综合题库',
            color: bank.color || subject.color || ''
        }
    })
}

exports.main = async (event, context) => {
    try {
        let courses = []
        
        // 先尝试 question_banks 集合
        try {
            const banks = await readAll('question_banks')
            if (banks.length > 0) {
                courses = await enrichBanks(banks.filter((item) => !['disabled', 'offline'].includes(item.status)))
                return { code: 0, data: courses, source: 'question_banks' }
            }
        } catch (err) {}

        // 降级到 courses 集合
        courses = (await readAll('courses')).filter((item) => !['disabled', 'offline'].includes(item.status))
        
        return { code: 0, data: courses, source: 'courses' }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
