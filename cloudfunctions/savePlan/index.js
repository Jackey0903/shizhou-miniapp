// 云函数：savePlan — 保存/更新学习计划
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
    const { OPENID } = cloud.getWXContext()
    const { planId, courseId, dailyCount, mode, deadline } = event

    try {
        if (planId) {
            // 更新已有计划
            await db.collection('plans').doc(planId).update({
                data: {
                    dailyCount,
                    mode: mode || 'sequential',
                    deadline: deadline ? new Date(deadline) : null,
                    updatedAt: db.serverDate()
                }
            })
            return { code: 0, data: { planId } }
        } else {
            // 新建计划
            const res = await db.collection('plans').add({
                data: {
                    _openid: OPENID,
                    courseId,
                    dailyCount: dailyCount || 10,
                    mode: mode || 'sequential',
                    startDate: db.serverDate(),
                    deadline: deadline ? new Date(deadline) : null,
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
