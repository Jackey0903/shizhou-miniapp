const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ALLOWED = {
  messages: ['title', 'content', 'icon', 'scope', 'enabled', 'sort'],
  ad_slots: ['name', 'position', 'unitId', 'adUnitId', 'enabled', 'sort', 'remark'],
  vip_plans: ['code', 'tag', 'name', 'price', 'days', 'supervisionDays', 'virtualProductId', 'benefits', 'enabled', 'sort'],
  notification_settings: ['key', 'name', 'templateId', 'page', 'thingKey', 'timeKey', 'remarkKey', 'titlePrefix', 'miniprogramState', 'enabled', 'sort', 'remark'],
  punch_backgrounds: ['title', 'imageUrl', 'fileId', 'activeDate', 'enabled', 'sort'],
  punch_quotes: ['content', 'activeDate', 'enabled', 'sort'],
  help_config: ['title', 'desc', 'qrCodePath', 'copyGuide', 'faqList', 'enabled', 'sort']
}

async function getAdmin(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return (res.data || [])[0] || null
}

function sanitize(target, payload = {}) {
  const allow = ALLOWED[target] || []
  const data = {}
  allow.forEach((key) => {
    if (payload[key] !== undefined) data[key] = payload[key]
  })
  return data
}

async function ensureCollection(name) {
  try {
    await db.collection(name).limit(1).get()
    return true
  } catch (err) {
    const msg = String((err && err.message) || err || '')
    if (!msg.includes('Db or Table not exist') && !msg.includes('COLLECTION_NOT_EXIST')) {
      throw err
    }
  }

  try {
    await db.createCollection(name)
  } catch (err) {
    const msg = String((err && err.message) || err || '')
    if (!msg.includes('Table exist') && !msg.includes('ResourceExist')) {
      throw err
    }
  }
  return true
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, target, payload = {} } = event || {}

  if (!ALLOWED[target]) return { code: -1, msg: '不支持的配置类型' }

  if (action === 'publicHelp' && target === 'help_config') {
    await ensureCollection(target)
    const res = await db.collection(target).where({ enabled: true }).orderBy('sort', 'asc').limit(1).get()
    return { code: 0, data: (res.data || [])[0] || null }
  }

  const user = await getAdmin(OPENID)
  if (!user || (!user.isAdmin && user.role !== 'admin')) {
    return { code: -1, msg: '仅管理员可操作' }
  }

  try {
    await ensureCollection(target)

    if (action === 'list') {
      const res = await db.collection(target).orderBy('sort', 'asc').get()
      return { code: 0, data: res.data || [] }
    }

    if (action === 'save') {
      const data = sanitize(target, payload)
      data.updatedAt = db.serverDate()
      if (payload.id) {
        await db.collection(target).doc(payload.id).update({ data })
        return { code: 0, msg: '更新成功' }
      }
      data.createdAt = db.serverDate()
      await db.collection(target).add({ data })
      return { code: 0, msg: '新增成功' }
    }

    if (action === 'toggle') {
      if (!payload.id) return { code: -1, msg: '缺少配置ID' }
      await db.collection(target).doc(payload.id).update({
        data: {
          enabled: !!payload.enabled,
          updatedAt: db.serverDate()
        }
      })
      return { code: 0, msg: '状态已更新' }
    }

    return { code: -1, msg: '不支持的操作' }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
