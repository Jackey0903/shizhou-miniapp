const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const REWARD_MAP = {
  shareTimeline: {
    type: 'share_reward',
    amount: 10,
    dailyLimit: 20,
    minIntervalMs: 5000,
    title: '分享朋友圈奖励',
    remark: '分享图片到朋友圈获得舟币'
  },
  watchAd: {
    type: 'ad_reward',
    amount: 1,
    dailyLimit: 20,
    minIntervalMs: 20000,
    title: '广告奖励',
    remark: '完整观看激励广告获得舟币'
  }
}

const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

function formatShanghaiDate(date) {
  return shanghaiFormatter.format(date)
}

function stableLogId(openid, claimId) {
  const hash = crypto.createHash('sha256').update(`${openid}:${claimId}`).digest('hex')
  return `reward_${hash.slice(0, 32)}`
}

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value.toDate === 'function') return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || ''
  const claimId = String(event.claimId || '').trim()
  const config = REWARD_MAP[action]

  if (!OPENID) return { code: -1, msg: '未获取到用户身份' }
  if (action === 'list') {
    try {
      const logs = []
      while (logs.length < 1000) {
        const res = await db.collection('coin_logs').where({ _openid: OPENID })
          .skip(logs.length).limit(Math.min(100, 1000 - logs.length)).get()
        const page = res.data || []
        logs.push(...page)
        if (page.length < 100) break
      }
      logs.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      return { code: 0, data: logs }
    } catch (err) {
      return { code: -1, msg: '舟币记录加载失败' }
    }
  }
  if (!config) return { code: -1, msg: '未知奖励类型' }
  if (!/^[A-Za-z0-9:_-]{12,160}$/.test(claimId)) {
    return { code: -1, msg: '奖励凭证无效，请重新完成任务' }
  }

  try {
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const user = userRes.data[0]
    if (!user) return { code: -1, msg: '请先登录' }

    const dateStr = formatShanghaiDate(new Date())
    const logId = stableLogId(OPENID, claimId)
    const result = await db.runTransaction(async (transaction) => {
      const latestUserRes = await transaction.collection('users').doc(user._id).get()
      const latestUser = latestUserRes.data
      if (!latestUser) throw new Error('用户不存在')

      let existing = null
      try {
        const existingRes = await transaction.collection('coin_logs').doc(logId).get()
        existing = existingRes.data || null
      } catch (err) {}
      if (existing) {
        return {
          duplicate: true,
          amount: Number(existing.amount || 0),
          dailyEarned: Number(existing.dailyEarned || 0),
          coins: Number(latestUser.coins || 0)
        }
      }

      const logsRes = await transaction.collection('coin_logs')
        .where({ _openid: OPENID, action, dateStr })
        .get()
      const logs = logsRes.data || []
      const dailyEarned = logs.reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0)), 0)
      if (dailyEarned >= config.dailyLimit) {
        const err = new Error(action === 'watchAd' ? '今日广告奖励已达上限' : '今日分享奖励已达上限')
        err.businessCode = 2
        throw err
      }
      const latestLogTime = logs.reduce((latest, item) => {
        const date = toDate(item.createdAt)
        return date ? Math.max(latest, date.getTime()) : latest
      }, 0)
      if (latestLogTime && Date.now() - latestLogTime < config.minIntervalMs) {
        const err = new Error('操作过快，请稍后再试')
        err.businessCode = 3
        throw err
      }

      const amount = Math.min(config.amount, config.dailyLimit - dailyEarned)
      const coins = Number(latestUser.coins || 0) + amount
      await transaction.collection('users').doc(latestUser._id).update({ data: { coins } })
      await transaction.collection('coin_logs').doc(logId).set({
        data: {
          _openid: OPENID,
          type: config.type,
          action,
          claimId,
          title: config.title,
          remark: config.remark,
          amount,
          dailyEarned: dailyEarned + amount,
          dateStr,
          createdAt: db.serverDate()
        }
      })
      return { duplicate: false, amount, dailyEarned: dailyEarned + amount, coins }
    })

    return {
      code: 0,
      msg: result.duplicate ? '奖励已发放' : `已获得${result.amount}舟币`,
      data: result
    }
  } catch (err) {
    if (err && err.businessCode) return { code: err.businessCode, msg: err.message }
    console.error('[grantCoinReward] failed', err)
    return { code: -1, msg: '奖励发放失败，请稍后重试' }
  }
}
