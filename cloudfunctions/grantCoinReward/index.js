const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const REWARD_MAP = {
  shareTimeline: {
    type: 'share_reward',
    amount: 10,
    dailyLimit: 20,
    title: '分享朋友圈奖励',
    remark: '分享图片到朋友圈获得舟币'
  },
  watchAd: {
    type: 'ad_reward',
    amount: 1,
    dailyLimit: 0,
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

async function ensureCollection(name) {
  try {
    await db.collection(name).limit(1).get()
  } catch (err) {
    const message = String((err && (err.message || err.errMsg)) || '')
    if (!message.includes('Db or Table not exist') && !message.includes('database collection not') && !message.includes('-502005')) {
      throw err
    }
    try {
      await db.createCollection(name)
    } catch (createErr) {
      const createMessage = String((createErr && (createErr.message || createErr.errMsg)) || '')
      if (!createMessage.includes('Table exist') && !createMessage.includes('ResourceExist') && !createMessage.includes('already exists')) {
        throw createErr
      }
    }
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || ''
  const config = REWARD_MAP[action]

  if (!OPENID) return { code: -1, msg: '未获取到用户身份' }
  if (!config) return { code: -1, msg: '未知奖励类型' }

  try {
    await ensureCollection('coin_logs')
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const user = (userRes.data || [])[0]
    if (!user) return { code: -1, msg: '请先登录' }

    const dateStr = formatShanghaiDate(new Date())
    let dailyEarned = 0
    if (config.dailyLimit > 0) {
      const todayLogs = await db.collection('coin_logs')
        .where({ _openid: OPENID, action, dateStr })
        .get()
        .catch(() => ({ data: [] }))
      dailyEarned = (todayLogs.data || []).reduce((sum, item) => sum + Number(item.amount || 0), 0)
      if (dailyEarned >= config.dailyLimit) {
        return { code: 2, msg: '今日分享奖励已达上限' }
      }
    }

    const amount = config.dailyLimit > 0
      ? Math.min(config.amount, config.dailyLimit - dailyEarned)
      : config.amount

    await db.collection('users').doc(user._id).update({
      data: { coins: _.inc(amount) }
    })

    await db.collection('coin_logs').add({
      data: {
        _openid: OPENID,
        type: config.type,
        action,
        title: config.title,
        remark: config.remark,
        amount,
        dateStr,
        createdAt: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: `已获得${amount}舟币`,
      data: {
        amount,
        dailyEarned: dailyEarned + amount,
        coins: Number(user.coins || 0) + amount
      }
    }
  } catch (err) {
    console.error('[grantCoinReward] failed', err)
    return { code: -1, msg: '奖励发放失败，请稍后重试' }
  }
}
