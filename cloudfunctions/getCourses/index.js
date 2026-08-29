/**
 * 云函数：getCourses - 获取题库列表
 * 通过云函数获取题库，绕过客户端安全规则限制
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function isPublished(item = {}) {
    return item.enabled !== false && !['disabled', 'offline'].includes(item.status)
}

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
            color: bank.color || subject.color || '',
            subjectEnabled: !subject._id || isPublished(subject)
        }
    })
}

exports.main = async (event, context) => {
    try {
        let courses = []
        
        // 新旧题库会在迁移期并存。此前只要新集合有一条记录就完全忽略 courses，
        // 会导致旧模块（例如常识判断）后台已上线但用户端无法进入。
        try {
            const [banks, legacyCourses] = await Promise.all([
                readAll('question_banks').catch(() => []),
                readAll('courses').catch(() => [])
            ])
            const merged = []
            const seen = new Set()
            banks.concat(legacyCourses).filter(isPublished).forEach((item) => {
                if (item && item._id && !seen.has(item._id)) {
                    seen.add(item._id)
                    merged.push(item)
                }
            })
            courses = (await enrichBanks(merged)).filter((item) => item.subjectEnabled)
            return { code: 0, data: courses, source: 'merged' }
        } catch (err) {}

        // 极端情况下再降级到旧集合。
        courses = (await readAll('courses')).filter(isPublished)
        
        return { code: 0, data: courses, source: 'courses' }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
