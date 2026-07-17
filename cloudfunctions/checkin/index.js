const cloud = require('wx-server-sdk')
const crypto = require('crypto')

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

function getShanghaiRange(dateStr) {
  const start = new Date(`${dateStr}T00:00:00+08:00`)
  return { start, end: new Date(start.getTime() + 86400000 - 1) }
}

function buildCheckinId(openid, dateStr) {
  const hash = crypto.createHash('sha256').update(`${openid}:${dateStr}`).digest('hex')
  return `checkin_${hash.slice(0, 32)}`
}

async function canCheckinToday(openid, todayStr) {
  const { start, end } = getShanghaiRange(todayStr)
  const readAll = async (collectionName, where, maxItems = 2000) => {
    const list = []
    while (list.length < maxItems) {
      const res = await db.collection(collectionName).where(where)
        .skip(list.length).limit(Math.min(100, maxItems - list.length)).get()
      const page = res.data || []
      list.push(...page)
      if (page.length < 100) break
    }
    return list
  }
  const plansPromise = readAll('plans', { _openid: openid }, 1000)
  const recordsPromise = readAll('study_records', { _openid: openid, firstStudyDateStr: todayStr })
    .then((records) => {
      if (records.length) return records
      return readAll('study_records', { _openid: openid, createdAt: _.gte(start).and(_.lte(end)) })
    })
  const [plans, records] = await Promise.all([plansPromise, recordsPromise])
  const doneMap = {}
  ;records.forEach((item) => {
    const key = item.courseId || item.bankId
    if (!key || !item.questionId) return
    if (!doneMap[key]) doneMap[key] = new Set()
    doneMap[key].add(item.questionId)
  })
  return plans.some((plan) => {
    const target = Number(plan.dailyCount || 0)
    return plan.courseId && target > 0 && (doneMap[plan.courseId] || new Set()).size >= target
  })
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { code: -1, msg: '请先登录' }

  try {
    if (event.action === 'list') {
      const year = Math.max(2000, Math.min(2100, Number(event.year) || new Date().getFullYear()))
      const month = Math.max(1, Math.min(12, Number(event.month) || new Date().getMonth() + 1))
      const prefix = `${year}-${String(month).padStart(2, '0')}-`
      const all = []
      while (all.length < 1000) {
        const res = await db.collection('checkins').where({ _openid: OPENID })
          .skip(all.length).limit(Math.min(100, 1000 - all.length)).get()
        const page = res.data || []
        all.push(...page)
        if (page.length < 100) break
      }
      const data = all
        .filter((item) => String(item.dateStr || '').startsWith(prefix))
        .sort((a, b) => String(a.dateStr || '').localeCompare(String(b.dateStr || '')))
      return { code: 0, data }
    }

    const now = new Date()
    const todayStr = formatShanghaiDate(now)
    const legacyExisting = await db.collection('checkins')
      .where({ _openid: OPENID, dateStr: todayStr })
      .limit(1)
      .get()
    if (legacyExisting.data.length) return { code: 1, msg: '今日已打卡' }

    const [allowed, userRes] = await Promise.all([
      canCheckinToday(OPENID, todayStr),
      db.collection('users').where({ _openid: OPENID }).limit(1).get()
    ])
    if (!allowed) return { code: 2, msg: '请先完成任一题库今日学习任务后再打卡' }
    const user = userRes.data[0]
    if (!user) return { code: -1, msg: '用户不存在' }

    const yesterdayStr = formatShanghaiDate(new Date(now.getTime() - 86400000))
    const checkinId = buildCheckinId(OPENID, todayStr)
    const result = await db.runTransaction(async (transaction) => {
      try {
        const existingRes = await transaction.collection('checkins').doc(checkinId).get()
        if (existingRes.data) return { duplicate: true }
      } catch (err) {}

      const latestUserRes = await transaction.collection('users').doc(user._id).get()
      const latestUser = latestUserRes.data
      if (!latestUser) throw new Error('用户不存在')
      const yesterdayRes = await transaction.collection('checkins')
        .where({ _openid: OPENID, dateStr: yesterdayStr })
        .limit(1)
        .get()
      const isConsecutive = yesterdayRes.data.length > 0
      const newStreak = isConsecutive ? Number(latestUser.streak || 0) + 1 : 1
      const newTotal = Number(latestUser.totalCheckins || 0) + 1

      await transaction.collection('checkins').doc(checkinId).set({
        data: {
          _openid: OPENID,
          date: getShanghaiRange(todayStr).start,
          dateStr: todayStr,
          streak: newStreak,
          coinsEarned: 0,
          createdAt: db.serverDate()
        }
      })
      await transaction.collection('users').doc(latestUser._id).update({
        data: { streak: newStreak, totalCheckins: newTotal }
      })
      return { duplicate: false, streak: newStreak, totalCheckins: newTotal }
    })

    if (result.duplicate) return { code: 1, msg: '今日已打卡' }
    return {
      code: 0,
      data: {
        streak: result.streak,
        totalCheckins: result.totalCheckins,
        coinsEarned: 0
      }
    }
  } catch (err) {
    console.error('[checkin] failed', err)
    return { code: -1, msg: err.message || '打卡失败' }
  }
}
