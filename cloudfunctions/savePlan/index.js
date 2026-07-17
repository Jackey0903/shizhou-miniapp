// 云函数：savePlan — 保存/更新学习计划
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function getCourse(courseId) {
    try {
        const bank = await db.collection('question_banks').doc(courseId).get()
        if (bank.data) return bank.data
    } catch (err) {}
    try {
        const course = await db.collection('courses').doc(courseId).get()
        return course.data || null
    } catch (err) {
        return null
    }
}

async function canAccessCourse(openid, course) {
    if (!course || ['disabled', 'offline'].includes(course.status)) return false
    if (!course.isLocked) return true
    const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const user = (userRes.data || [])[0]
    const expireTime = user && user.vipExpireDate ? new Date(user.vipExpireDate).getTime() : 0
    return !!(user && user.isVip && (!expireTime || expireTime > Date.now()))
}

exports.main = async (event = {}, context) => {
    const { OPENID } = cloud.getWXContext()
    const { action = 'save', planId, courseId, dailyCount, mode, deadline } = event

    try {
        if (!OPENID) return { code: 401, error: '请先登录' }
        if (action === 'list') {
            const plans = []
            while (plans.length < 1000) {
                const res = await db.collection('plans')
                    .where({ _openid: OPENID })
                    .skip(plans.length)
                    .limit(Math.min(100, 1000 - plans.length))
                    .get()
                const page = res.data || []
                plans.push(...page)
                if (page.length < 100) break
            }
            plans.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
            return { code: 0, data: plans }
        }
        if (action === 'delete') {
            if (!planId) return { code: -1, error: '缺少计划ID' }
            const owned = await db.collection('plans').where({ _id: planId, _openid: OPENID }).limit(1).get()
            if (!owned.data.length) return { code: 403, error: '无权删除该学习计划' }
            await db.collection('plans').doc(planId).remove()
            return { code: 0, data: { planId } }
        }

        const safeDailyCount = Math.max(1, Math.min(100, Number(dailyCount) || 10))
        const safeMode = mode === 'random' ? 'random' : 'sequential'
        const parsedDeadline = deadline ? new Date(deadline) : null
        if (parsedDeadline && Number.isNaN(parsedDeadline.getTime())) {
            return { code: -1, error: '截止日期无效' }
        }

        if (planId) {
            const owned = await db.collection('plans').where({ _id: planId, _openid: OPENID }).limit(1).get()
            if (!owned.data.length) return { code: 403, error: '无权修改该学习计划' }
            await db.collection('plans').doc(planId).update({
                data: {
                    dailyCount: safeDailyCount,
                    mode: safeMode,
                    deadline: parsedDeadline,
                    updatedAt: db.serverDate()
                }
            })
            return { code: 0, data: { planId } }
        } else {
            if (!courseId) return { code: -1, error: '缺少题库ID' }
            const course = await getCourse(courseId)
            if (!course || ['disabled', 'offline'].includes(course.status)) {
                return { code: 404, error: '题库不存在或已下架' }
            }
            if (!(await canAccessCourse(OPENID, course))) {
                return { code: 403, error: '该题库为VIP专享，请先开通VIP' }
            }
            const existed = await db.collection('plans').where({ _openid: OPENID, courseId }).limit(1).get()
            if (existed.data.length) {
                const existingPlanId = existed.data[0]._id
                await db.collection('plans').doc(existingPlanId).update({
                    data: {
                        dailyCount: safeDailyCount,
                        mode: safeMode,
                        deadline: parsedDeadline,
                        updatedAt: db.serverDate()
                    }
                })
                return { code: 0, data: { planId: existingPlanId } }
            }
            const res = await db.collection('plans').add({
                data: {
                    _openid: OPENID,
                    courseId,
                    dailyCount: safeDailyCount,
                    mode: safeMode,
                    startDate: db.serverDate(),
                    deadline: parsedDeadline,
                    newCount: 0,
                    reviewCount: 0,
                    createdAt: db.serverDate(),
                    updatedAt: db.serverDate()
                }
            })
            return { code: 0, data: { planId: res._id } }
        }
    } catch (err) {
        return { code: -1, error: err.message }
    }
}
