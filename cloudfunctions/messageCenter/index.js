const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function readAll(collectionName, where, maxItems = 1000) {
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

function canView(message, user) {
  const scope = message.scope || 'all'
  if (scope === 'all') return true
  if (!user) return false
  if (scope === 'new' || scope === '新用户') return !!user.isFreeTrial
  if (scope === 'vip') {
    const expiresAt = user.vipExpireDate ? new Date(user.vipExpireDate).getTime() : 0
    return !!(user.isVip && (!expiresAt || expiresAt > Date.now()))
  }
  if (scope === 'supervision') {
    return !!(user.supervisionExpireDate && new Date(user.supervisionExpireDate).getTime() > Date.now())
  }
  return false
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { code: 401, msg: '请先登录' }

  try {
    if (event.action === 'read') {
      if (!event.messageId) return { code: -1, msg: '缺少消息ID' }
      const found = await db.collection('user_messages')
        .where({ _id: event.messageId, _openid: OPENID }).limit(1).get()
      const message = (found.data || [])[0]
      if (!message) return { code: 404, msg: '消息不存在' }
      await db.collection('user_messages').doc(message._id).update({ data: { readAt: db.serverDate() } })
      return { code: 0 }
    }

    const [globalMessages, userMessages, userRes] = await Promise.all([
      readAll('messages', { enabled: true }, 500).catch(() => []),
      readAll('user_messages', { _openid: OPENID, enabled: true }, 1000).catch(() => []),
      db.collection('users').where({ _openid: OPENID }).limit(1).get()
    ])
    const user = (userRes.data || [])[0] || null
    const globals = globalMessages
      .filter((item) => canView(item, user))
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
      .map((item) => ({ ...item, source: 'global' }))
    const personal = userMessages
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .map((item) => ({ ...item, source: 'user', unread: !item.readAt }))
    return { code: 0, data: personal.concat(globals) }
  } catch (err) {
    return { code: -1, msg: err.message || '消息加载失败' }
  }
}
