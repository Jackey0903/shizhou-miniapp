const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PUBLISHED_PLANS = Object.freeze({
  basic_vip_year: { price: 19800, days: 365, supervisionDays: 0, virtualProductId: 'sz_basic_vip_year' },
  supervision_trial_day: { price: 800, days: 365, supervisionDays: 1, virtualProductId: 'sz_supervision_1d' },
  supervision_month: { price: 19800, days: 365, supervisionDays: 30, virtualProductId: 'sz_supervision_mon' },
  premium_vip_year: { price: 98800, days: 365, supervisionDays: 365, virtualProductId: 'sz_premium_vip_year' }
})

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

function validateVipPlan(data = {}) {
  const code = String(data.code || '').trim()
  const virtualProductId = String(data.virtualProductId || '').trim()
  const price = Number(data.price)
  const days = Number(data.days || 0)
  const supervisionDays = Number(data.supervisionDays || 0)
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(code)) return '套餐 code 格式无效'
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(virtualProductId)) return '虚拟支付道具ID格式无效'
  if (!Number.isInteger(price) || price <= 0 || price > 100000000) return '套餐价格必须是有效的正整数（分）'
  if (!Number.isInteger(days) || days < 0 || days > 3650) return '会员天数无效'
  if (!Number.isInteger(supervisionDays) || supervisionDays < 0 || supervisionDays > 3650) return '督学天数无效'
  if (days === 0 && supervisionDays === 0) return '套餐至少需要配置一项有效权益'
  const published = PUBLISHED_PLANS[code]
  if (!published) return '仅支持系统内置的四个正式套餐'
  if (
    published.price !== price
    || published.days !== days
    || published.supervisionDays !== supervisionDays
    || published.virtualProductId !== virtualProductId
  ) {
    return '套餐金额、有效期或微信道具ID与正式发布配置不一致'
  }
  return ''
}

function validateConfig(target, data = {}) {
  if (target === 'ad_slots') {
    const position = String(data.position || '').trim()
    const unitId = String(data.unitId || data.adUnitId || '').trim()
    if (!['study-plan-banner', 'question-banner', 'coin-reward-video'].includes(position)) {
      return '广告位类型无效'
    }
    if (unitId && !/^adunit-[A-Za-z0-9_-]{6,100}$/.test(unitId)) {
      return '广告 unitId 格式无效，应以 adunit- 开头'
    }
  }
  if (target === 'messages') {
    if (!String(data.title || '').trim()) return '请填写消息标题'
    if (!String(data.content || '').trim()) return '请填写消息内容'
    if (!['all', 'vip', 'new', 'supervision'].includes(String(data.scope || 'all'))) {
      return '消息接收范围无效'
    }
  }
  if (['punch_backgrounds', 'punch_quotes'].includes(target)) {
    const activeDate = String(data.activeDate || 'default')
    if (activeDate !== 'default' && !/^\d{4}-\d{2}-\d{2}$/.test(activeDate)) {
      return '生效日期格式应为 YYYY-MM-DD 或 default'
    }
  }
  return ''
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

  if (action === 'publicHelp' && target === 'help_config') {
    await ensureCollection(target)
    const res = await db.collection(target).where({ enabled: true }).orderBy('sort', 'asc').limit(1).get()
    return { code: 0, data: (res.data || [])[0] || null }
  }
  if (action === 'publicList' && ['ad_slots', 'punch_backgrounds', 'punch_quotes'].includes(target)) {
    await ensureCollection(target)
    const list = []
    while (list.length < 500) {
      const res = await db.collection(target).where({ enabled: true })
        .skip(list.length).limit(Math.min(100, 500 - list.length)).get()
      const page = res.data || []
      list.push(...page)
      if (page.length < 100) break
    }
    list.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
    return { code: 0, data: list }
  }

  const user = await getAdmin(OPENID)
  if (!user || (!user.isAdmin && user.role !== 'admin')) {
    return { code: -1, msg: '仅管理员可操作' }
  }
  if (action === 'assertAdmin') return { code: 0, data: { isAdmin: true } }
  if (!ALLOWED[target]) return { code: -1, msg: '不支持的配置类型' }

  try {
    await ensureCollection(target)

    if (action === 'list') {
      const res = await db.collection(target).orderBy('sort', 'asc').get()
      return { code: 0, data: res.data || [] }
    }

    if (action === 'save') {
      const data = sanitize(target, payload)
      let targetId = payload.id || ''
      const configValidationError = validateConfig(target, { ...payload, ...data })
      if (configValidationError) return { code: -1, msg: configValidationError }
      if (target === 'vip_plans') {
        let current = {}
        if (targetId) {
          const currentRes = await db.collection(target).doc(targetId).get()
          current = currentRes.data || {}
        }
        const merged = { ...current, ...data }
        const validationError = validateVipPlan(merged)
        if (validationError) return { code: -1, msg: validationError }
        const duplicateRes = await db.collection(target).where({ code: merged.code }).limit(2).get()
        const duplicate = (duplicateRes.data || []).find((item) => item._id !== targetId)
        if (duplicate) {
          if (targetId) return { code: -1, msg: '该套餐 code 已存在' }
          targetId = duplicate._id
        }
      }
      if (target === 'ad_slots' && !targetId) {
        const existed = await db.collection(target).where({ position: data.position }).limit(1).get()
        targetId = ((existed.data || [])[0] || {})._id || ''
      }
      if (target === 'help_config' && !targetId) {
        const existed = await db.collection(target).limit(1).get()
        targetId = ((existed.data || [])[0] || {})._id || ''
      }
      data.updatedAt = db.serverDate()
      if (targetId) {
        await db.collection(target).doc(targetId).update({ data })
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
