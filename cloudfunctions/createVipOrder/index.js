const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const LEGACY_PLANS = [
  { code: 'basic_vip_year', name: '基础VIP包年', tag: '基础VIP', price: 19800, days: 365, supervisionDays: 0, virtualProductId: 'basic_vip_year', benefits: ['免广告学习', '免费领取学习资料'] },
  { code: 'supervision_trial_day', name: '督学试用1日', tag: '督学试用', price: 800, days: 365, supervisionDays: 1, virtualProductId: 'supervision_trial_day', benefits: ['督学试用1天', '赠送1年免广告学习', '免费领取学习资料'] },
  { code: 'supervision_month', name: '督学包月', tag: '督学包月', price: 19800, days: 365, supervisionDays: 30, virtualProductId: 'supervision_month', benefits: ['督学包月服务', '赠送1年免广告学习', '免费领取学习资料'] },
  { code: 'premium_vip_year', name: '高级VIP包年', tag: '高级VIP', price: 98800, days: 365, supervisionDays: 365, virtualProductId: 'premium_vip_year', benefits: ['免广告学习', '免费领取学习资料', '督学包年服务'] }
]

const PAID_REMOTE_STATUS = [2, 3, 4]
const ACCESS_TOKEN_CACHE = {
  token: '',
  expiresAt: 0
}

function buildOutTradeNo() {
  return `VIP${Date.now()}${Math.random().toString().slice(2, 8)}`
}

function hmacSha256Hex(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('hex')
}

function requestJson(url, options = {}, body = '') {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {})
        } catch (err) {
          reject(new Error(`微信接口返回非JSON：${data.slice(0, 120)}`))
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function normalizePayEnv(value) {
  const env = Number(value)
  return env === 1 ? 1 : 0
}

function getAppId(wxContext) {
  return process.env.WECHAT_APPID || wxContext.APPID || 'wxca6ebd21699eca53'
}

function getVirtualPayConfig(wxContext) {
  const payEnv = normalizePayEnv(process.env.VIRTUAL_PAY_ENV)
  const appKey = payEnv === 1
    ? (process.env.VIRTUAL_PAY_SANDBOX_APP_KEY || process.env.VIRTUAL_PAY_APP_KEY || '')
    : (process.env.VIRTUAL_PAY_PROD_APP_KEY || process.env.VIRTUAL_PAY_APP_KEY || '')

  return {
    appId: getAppId(wxContext),
    appSecret: process.env.WECHAT_APP_SECRET || process.env.APP_SECRET || '',
    offerId: process.env.VIRTUAL_PAY_OFFER_ID || '',
    appKey,
    env: payEnv
  }
}

function assertVirtualPayConfig(config, needsSession = false) {
  const missing = []
  if (!config.offerId) missing.push('VIRTUAL_PAY_OFFER_ID')
  if (!config.appKey) missing.push(config.env === 1 ? 'VIRTUAL_PAY_SANDBOX_APP_KEY' : 'VIRTUAL_PAY_PROD_APP_KEY')
  if (needsSession && !config.appSecret) missing.push('WECHAT_APP_SECRET')
  if (missing.length) {
    throw new Error(`虚拟支付未配置：请在云函数环境变量配置 ${missing.join(' / ')}`)
  }
}

async function fetchSessionKey(config, jsCode, openid) {
  if (!jsCode) {
    const err = new Error('支付登录状态已失效，请重新发起支付')
    err.errorCode = 'PAY_LOGIN_REQUIRED'
    throw err
  }
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(config.appId)}&secret=${encodeURIComponent(config.appSecret)}&js_code=${encodeURIComponent(jsCode)}&grant_type=authorization_code`
  const res = await requestJson(url)
  if (res.errcode) {
    if ([40029, 40163].includes(Number(res.errcode))) {
      const err = new Error('支付登录状态已失效，请重新发起支付')
      err.errorCode = 'PAY_LOGIN_REQUIRED'
      throw err
    }
    throw new Error(res.errmsg || `jscode2session失败：${res.errcode}`)
  }
  if (!res.session_key) {
    const err = new Error('支付登录状态已失效，请重新发起支付')
    err.errorCode = 'PAY_LOGIN_REQUIRED'
    throw err
  }
  if (openid && res.openid && res.openid !== openid) throw new Error('登录态与当前用户不一致')
  return res.session_key
}

async function fetchAccessToken(config) {
  const now = Date.now()
  if (ACCESS_TOKEN_CACHE.token && ACCESS_TOKEN_CACHE.expiresAt > now + 120000) {
    return ACCESS_TOKEN_CACHE.token
  }

  if (!config.appSecret) throw new Error('缺少 WECHAT_APP_SECRET，无法获取 access_token')
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(config.appId)}&secret=${encodeURIComponent(config.appSecret)}`
  const res = await requestJson(url)
  if (res.errcode) throw new Error(res.errmsg || `获取access_token失败：${res.errcode}`)
  if (!res.access_token) throw new Error('获取access_token失败：微信接口未返回access_token')
  ACCESS_TOKEN_CACHE.token = res.access_token
  ACCESS_TOKEN_CACHE.expiresAt = now + Math.max(300, Number(res.expires_in || 7200) - 300) * 1000
  return ACCESS_TOKEN_CACHE.token
}

async function getCurrentUser(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || null
}

async function ensureCollection(name) {
  try {
    await db.collection(name).limit(1).get()
    return
  } catch (err) {
    const msg = String((err && (err.message || err.errMsg)) || '')
    if (!msg.includes('Db or Table not exist') && !msg.includes('database collection not') && !msg.includes('-502005')) {
      throw err
    }
  }

  try {
    await db.createCollection(name)
  } catch (err) {
    const msg = String((err && (err.message || err.errMsg)) || '')
    if (!msg.includes('Table exist') && !msg.includes('ResourceExist') && !msg.includes('already exists')) {
      throw err
    }
  }
}

async function ensureCurrentUser(openid, appid) {
  await ensureCollection('users')
  const existed = await getCurrentUser(openid)
  if (existed) return existed

  const vipExpireDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const addRes = await db.collection('users').add({
    data: {
      _openid: openid,
      appid: appid || '',
      nickName: `学员${Math.floor(Math.random() * 9000 + 1000)}`,
      avatarUrl: '',
      phone: '',
      coins: 0,
      isVip: true,
      vipExpireDate,
      isFreeTrial: true,
      streak: 0,
      totalCheckins: 0,
      createdAt: db.serverDate(),
      lastLoginAt: db.serverDate()
    }
  })

  return {
    _id: addRes._id,
    _openid: openid,
    appid: appid || '',
    coins: 0,
    isVip: true,
    vipExpireDate,
    isFreeTrial: true
  }
}

async function getPlan(planCode) {
  try {
    const planRes = await db.collection('vip_plans').where({ code: planCode, enabled: true }).limit(1).get()
    if (planRes.data.length) return planRes.data[0]
  } catch (err) {}
  return LEGACY_PLANS.find((item) => item.code === planCode) || null
}

function getVirtualProductId(plan) {
  return String(plan.virtualProductId || plan.productId || plan.code || '').trim()
}

function toClientOrder(order) {
  return {
    orderId: order._id,
    outTradeNo: order.outTradeNo,
    status: order.status,
    vipExpireDate: order.vipExpireDate || '',
    planLabel: order.planLabel || '',
    payChannel: order.payChannel || 'wechat_virtual'
  }
}

async function grantOrderBenefits(order, callbackData = {}) {
  if (order.status === 'paid' && order.benefitsGranted) return order

  const user = await ensureCurrentUser(order._openid, '')

  const now = new Date()
  let currentExpire = user.vipExpireDate ? new Date(user.vipExpireDate) : now
  if (currentExpire < now) currentExpire = now
  const newExpire = new Date(currentExpire.getTime() + (order.days || 0) * 24 * 60 * 60 * 1000)

  let supervisionExpireDate = user.supervisionExpireDate ? new Date(user.supervisionExpireDate) : null
  if (order.supervisionDays) {
    const supervisionBase = supervisionExpireDate && supervisionExpireDate > now ? supervisionExpireDate : now
    supervisionExpireDate = new Date(supervisionBase.getTime() + order.supervisionDays * 24 * 60 * 60 * 1000)
  }

  await db.collection('users').doc(user._id).update({
    data: {
      isVip: true,
      vipExpireDate: newExpire,
      isFreeTrial: false,
      lastVipPlanCode: order.planCode || '',
      lastVipPlanLabel: order.planLabel || order.planTag || '',
      supervisionExpireDate: supervisionExpireDate || null
    }
  })

  const existsLog = await db.collection('coin_logs')
    .where({ _openid: order._openid, type: 'vip_pay', orderId: order._id })
    .limit(1)
    .get()

  if (!existsLog.data.length) {
    await db.collection('coin_logs').add({
      data: {
        _openid: order._openid,
        type: 'vip_pay',
        orderId: order._id,
        planId: order.planId,
        planLabel: order.planLabel,
        planTag: order.planTag || '',
        amount: order.price,
        daysAdded: order.days,
        benefits: order.benefits || [],
        createdAt: db.serverDate()
      }
    })
  }

  const updateData = {
    status: 'paid',
    benefitsGranted: true,
    payTime: db.serverDate(),
    transactionId: callbackData.transactionId || callbackData.wxpay_order_id || '',
    callbackData,
    vipExpireDate: newExpire,
    updatedAt: db.serverDate()
  }

  if (callbackData.source === 'xpay_goods_deliver_notify') {
    updateData.deliveryStatus = 'confirmed'
    updateData.deliveryNotifiedAt = db.serverDate()
  }

  await db.collection('orders').doc(order._id).update({ data: updateData })

  return {
    ...order,
    status: 'paid',
    benefitsGranted: true,
    vipExpireDate: newExpire
  }
}

async function queryVirtualOrder(config, openid, outTradeNo) {
  assertVirtualPayConfig(config)
  const body = JSON.stringify({
    openid,
    env: config.env,
    order_id: outTradeNo
  })
  const paySig = hmacSha256Hex(config.appKey, `/xpay/query_order&${body}`)
  const accessToken = await fetchAccessToken(config)
  const url = `https://api.weixin.qq.com/xpay/query_order?access_token=${encodeURIComponent(accessToken)}&pay_sig=${encodeURIComponent(paySig)}`
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, body)
}

async function notifyProvideGoods(config, outTradeNo, wxOrderId) {
  const bodyData = {
    order_id: outTradeNo,
    env: config.env
  }
  if (wxOrderId) bodyData.wx_order_id = wxOrderId
  const body = JSON.stringify(bodyData)
  const accessToken = await fetchAccessToken(config)
  const url = `https://api.weixin.qq.com/xpay/notify_provide_goods?access_token=${encodeURIComponent(accessToken)}`
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, body)
}

function isDeliveryDone(order = {}) {
  return ['confirmed', 'notified'].includes(order.deliveryStatus)
}

function getWxOrderIdFromRemote(remoteOrder = {}) {
  return remoteOrder.wx_order_id || remoteOrder.wxOrderId || ''
}

function getStoredWxOrderId(order = {}) {
  const remoteOrder = order.virtualQueryResult && order.virtualQueryResult.order
    ? order.virtualQueryResult.order
    : {}
  return getWxOrderIdFromRemote(remoteOrder) || order.wxOrderId || ''
}

async function notifyAndRecordDelivery(config, order, wxOrderId, source = 'sync') {
  try {
    const result = await notifyProvideGoods(config, order.outTradeNo, wxOrderId)
    const ok = !Number(result.errcode || 0)
    const data = {
      deliveryStatus: ok ? 'notified' : 'notify_failed',
      deliveryNotifyResult: result,
      deliveryNotifySource: source,
      deliveryLastTriedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    if (ok) data.deliveryNotifiedAt = db.serverDate()
    await db.collection('orders').doc(order._id).update({ data })
    return result
  } catch (err) {
    const result = { errcode: -1, errmsg: err.message || 'notify_provide_goods failed' }
    await db.collection('orders').doc(order._id).update({
      data: {
        deliveryStatus: 'notify_failed',
        deliveryNotifyResult: result,
        deliveryNotifySource: source,
        deliveryLastTriedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    console.warn('[createVipOrder] notifyProvideGoods failed', err)
    return result
  }
}

async function createVirtualOrder(event, wxContext) {
  const { OPENID } = wxContext
  const { planCode, planId } = event || {}
  const jsCode = (event && (event.jsCode || event.loginCode || event.code)) || ''
  const selectedCode = planCode || planId
  const plan = await getPlan(selectedCode)

  if (!OPENID) return { code: -1, msg: '未获取到用户身份' }
  if (!plan) return { code: -1, msg: '套餐不存在' }

  try {
    const config = getVirtualPayConfig(wxContext)
    assertVirtualPayConfig(config, true)

    const productId = getVirtualProductId(plan)
    if (!productId) return { code: -1, msg: '套餐未配置虚拟支付道具ID' }

    await ensureCurrentUser(OPENID, config.appId)

    const sessionKey = await fetchSessionKey(config, jsCode, OPENID)
    const outTradeNo = buildOutTradeNo()
    const orderRes = await db.collection('orders').add({
      data: {
        _openid: OPENID,
        outTradeNo,
        planCode: plan.code,
        planId: plan.code,
        planLabel: plan.name || plan.tag || plan.code,
        planTag: plan.tag || '',
        price: Number(plan.price || 0),
        days: plan.days || 0,
        supervisionDays: plan.supervisionDays || 0,
        benefits: plan.benefits || [],
        status: 'pending',
        payChannel: 'wechat_virtual',
        virtualProductId: productId,
        virtualPayEnv: config.env,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    const signData = JSON.stringify({
      offerId: config.offerId,
      buyQuantity: 1,
      env: config.env,
      currencyType: 'CNY',
      productId,
      goodsPrice: Number(plan.price || 0),
      outTradeNo,
      attach: `order:${orderRes._id};plan:${plan.code}`
    })

    const payment = {
      signData,
      paySig: hmacSha256Hex(config.appKey, `requestVirtualPayment&${signData}`),
      signature: hmacSha256Hex(sessionKey, signData),
      mode: 'short_series_goods'
    }

    await db.collection('orders').doc(orderRes._id).update({
      data: {
        payParams: payment,
        virtualPayParams: {
          offerId: config.offerId,
          env: config.env,
          productId,
          goodsPrice: Number(plan.price || 0),
          mode: 'short_series_goods'
        },
        updatedAt: db.serverDate()
      }
    })

    return {
      code: 0,
      data: {
        orderId: orderRes._id,
        outTradeNo,
        plan: {
          code: plan.code,
          name: plan.name || plan.tag || plan.code,
          tag: plan.tag || '',
          price: Number(plan.price || 0),
          days: plan.days || 0,
          supervisionDays: plan.supervisionDays || 0,
          benefits: plan.benefits || []
        },
        payment
      }
    }
  } catch (err) {
    console.error('[createVipOrder:createVirtualOrder] error', err)
    if (err && err.errorCode === 'PAY_LOGIN_REQUIRED') {
      return {
        code: -1002,
        errorCode: 'PAY_LOGIN_REQUIRED',
        msg: err.message || '支付登录状态已失效，请重新发起支付'
      }
    }
    return { code: -1, msg: err.message || '虚拟支付下单失败' }
  }
}

async function syncVirtualOrder(event, wxContext) {
  const { OPENID } = wxContext
  const { outTradeNo } = event || {}
  if (!OPENID) return { code: -1, msg: '未获取到用户身份' }
  if (!outTradeNo) return { code: -1, msg: '缺少订单号' }

  try {
    const orderRes = await db.collection('orders').where({ _openid: OPENID, outTradeNo }).limit(1).get()
    const order = orderRes.data[0]
    if (!order) return { code: -1, msg: '订单不存在' }
    if (order.status === 'paid' && order.benefitsGranted) {
      if (!isDeliveryDone(order)) {
        const config = getVirtualPayConfig(wxContext)
        await notifyAndRecordDelivery(config, order, getStoredWxOrderId(order), 'sync_paid_order')
      }
      return { code: 0, data: { order: toClientOrder(order) } }
    }
    if (order.payChannel !== 'wechat_virtual') {
      return { code: -1, msg: '非虚拟支付订单' }
    }

    const config = getVirtualPayConfig(wxContext)
    const queryRes = await queryVirtualOrder(config, OPENID, outTradeNo)
    if (queryRes.errcode) {
      await db.collection('orders').doc(order._id).update({
        data: {
          virtualQueryResult: queryRes,
          updatedAt: db.serverDate()
        }
      })
      return { code: 1, msg: queryRes.errmsg || '支付结果生成中', data: { remote: queryRes } }
    }

    const remoteOrder = queryRes.order || {}
    const remoteStatus = Number(remoteOrder.status)
    await db.collection('orders').doc(order._id).update({
      data: {
        virtualQueryResult: queryRes,
        remoteStatus,
        updatedAt: db.serverDate()
      }
    })

    if (!PAID_REMOTE_STATUS.includes(remoteStatus)) {
      return { code: 1, msg: '支付尚未完成', data: { remoteStatus } }
    }

    const paidFee = Number(remoteOrder.paid_fee || remoteOrder.order_fee || 0)
    if (paidFee && paidFee !== Number(order.price || 0)) {
      throw new Error('支付金额与订单金额不一致')
    }

    const granted = await grantOrderBenefits(order, {
      source: 'virtual_query_order',
      remoteOrder,
      transactionId: remoteOrder.wxpay_order_id || remoteOrder.wx_order_id || ''
    })

    await notifyAndRecordDelivery(config, granted, getWxOrderIdFromRemote(remoteOrder), 'virtual_query_order')

    return { code: 0, data: { order: toClientOrder(granted) } }
  } catch (err) {
    console.error('[createVipOrder:syncVirtualOrder] error', err)
    return { code: -1, msg: err.message || '同步支付结果失败' }
  }
}

function normalizeNotifyEvent(event = {}) {
  if (event.body && typeof event.body === 'string') {
    const body = event.body.trim()
    if (body.startsWith('{')) {
      try {
        return JSON.parse(body)
      } catch (err) {}
    }
    if (body.startsWith('<')) {
      const data = {}
      const keys = [
        'ToUserName', 'FromUserName', 'CreateTime', 'MsgType', 'Event',
        'OpenId', 'OutTradeNo', 'Env', 'ProductId', 'Quantity',
        'OrigPrice', 'ActualPrice', 'Attach', 'MchOrderNo',
        'TransactionId', 'PaidTime', 'WxOrderId', 'MchOrderId'
      ]
      keys.forEach((key) => {
        const match = new RegExp(`<${key}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${key}>`).exec(body)
        if (match) data[key] = match[1]
      })
      return data
    }
  }
  return event
}

async function handleVirtualDeliverNotify(rawEvent) {
  const event = normalizeNotifyEvent(rawEvent)
  const outTradeNo = event.OutTradeNo || event.outTradeNo || event.order_id || ''
  if (!outTradeNo) return { ErrCode: -1, ErrMsg: 'missing OutTradeNo' }

  try {
    const orderRes = await db.collection('orders').where({ outTradeNo }).limit(1).get()
    const order = orderRes.data[0]
    if (!order) return { ErrCode: -1, ErrMsg: 'order not found' }
    if (event.OpenId && event.OpenId !== order._openid) return { ErrCode: -1, ErrMsg: 'openid mismatch' }

    const goodsInfo = event.GoodsInfo || event.goodsInfo || {}
    const productId = goodsInfo.ProductId || goodsInfo.productId || event.ProductId || event.productId
    const actualPrice = goodsInfo.ActualPrice || goodsInfo.actualPrice || event.ActualPrice || event.actualPrice
    if (productId && order.virtualProductId && productId !== order.virtualProductId) {
      return { ErrCode: -1, ErrMsg: 'product mismatch' }
    }
    if (actualPrice && Number(actualPrice) !== Number(order.price || 0)) {
      return { ErrCode: -1, ErrMsg: 'price mismatch' }
    }

    const payInfo = event.WeChatPayInfo || event.weChatPayInfo || {}
    await grantOrderBenefits(order, {
      source: 'xpay_goods_deliver_notify',
      rawEvent: event,
      transactionId: payInfo.TransactionId || payInfo.transactionId || ''
    })
    return { ErrCode: 0, ErrMsg: 'success', errcode: 0, errmsg: 'success' }
  } catch (err) {
    console.error('[createVipOrder:handleVirtualDeliverNotify] error', err)
    return { ErrCode: -1, ErrMsg: err.message || 'callback error' }
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const action = (event && event.action) || 'create'
  const normalized = normalizeNotifyEvent(event || {})

  if (normalized.Event === 'xpay_goods_deliver_notify') {
    return handleVirtualDeliverNotify(normalized)
  }

  if (action === 'sync') return syncVirtualOrder(event, wxContext)
  return createVirtualOrder(event, wxContext)
}
