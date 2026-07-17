const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

function formatShanghaiDate(date) {
  return shanghaiFormatter.format(date)
}

function sameDay(date, start, end) {
  return _.gte(start).and(_.lte(end))
}

async function canCheckinToday(openid) {
  const now = new Date()
  const todayStr = formatShanghaiDate(now)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  const plansPromise = db.collection('plans').where({ _openid: openid }).get()
  const recordsPromise = db.collection('study_records')
    .where({ _openid: openid, studyDateStr: todayStr })
    .get()
    .then((res) => {
      if ((res.data || []).length > 0) return res
      return db.collection('study_records')
        .where({ _openid: openid, updatedAt: sameDay(start, start, end) })
        .get()
        .catch(async () => {
          return db.collection('study_records').where({ _openid: openid, createdAt: sameDay(start, start, end) }).get()
        })
    })

  const [plansRes, recordsRes] = await Promise.all([plansPromise, recordsPromise])

  const plans = plansRes.data || []
  const records = recordsRes.data || []
  if (!plans.length || !records.length) return false

  const doneMap = {}
  records.forEach((item) => {
    const key = item.courseId || item.bankId
    if (!key) return
    doneMap[key] = (doneMap[key] || 0) + 1
  })

  return plans.some((plan) => {
    const key = plan.courseId
    const target = Number(plan.dailyCount || 0)
    return key && target > 0 && (doneMap[key] || 0) >= target
  })
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = formatShanghaiDate(new Date())

    const existing = await db.collection('checkins').where({ _openid: OPENID, dateStr: todayStr }).get()
    if (existing.data.length > 0) {
      return { code: 1, msg: '今日已打卡' }
    }

    const allowed = await canCheckinToday(OPENID)
    if (!allowed) {
      return { code: 2, msg: '请先完成任一题库今日学习任务后再打卡' }
    }

    const yesterday = new Date(today - 86400000)
    const yesterdayStr = formatShanghaiDate(yesterday)
    const yesterdayCheckin = await db.collection('checkins').where({ _openid: OPENID, dateStr: yesterdayStr }).get()

    const userRes = await db.collection('users').where({ _openid: OPENID }).get()
    const user = userRes.data[0]
    if (!user) {
      return { code: -1, msg: '用户不存在' }
    }

    const isConsecutive = yesterdayCheckin.data.length > 0
    const newStreak = isConsecutive ? (user.streak || 0) + 1 : 1
    const newTotal = (user.totalCheckins || 0) + 1

    await db.collection('checkins').add({
      data: {
        _openid: OPENID,
        date: today,
        dateStr: todayStr,
        streak: newStreak,
        coinsEarned: 0,
        createdAt: db.serverDate()
      }
    })

    await db.collection('users').doc(user._id).update({
      data: {
        streak: newStreak,
        totalCheckins: newTotal
      }
    })

    return {
      code: 0,
      data: {
        streak: newStreak,
        totalCheckins: newTotal,
        coinsEarned: 0
      }
    }
  } catch (err) {
    return { code: -1, error: err.message }
  }
}
