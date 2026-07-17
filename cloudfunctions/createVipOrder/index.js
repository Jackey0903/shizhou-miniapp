const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PAID_REMOTE_STATUS = [2, 3, 4]
const REFUNDED_REMOTE_STATUS = [5, 8]
const CLOSED_REMOTE_STATUS = [6]
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
  const userId = `user_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`
  await db.collection('users').doc(userId).set({
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
    _id: userId,
    _openid: openid,
    appid: appid || '',
    coins: 0,
    isVip: true,
    vipExpireDate,
    isFreeTrial: true
  }
}

async function getPlan(planCode) {
  const safeCode = String(planCode || '').trim()
  if (!safeCode) return null
  try {
    const planRes = await db.collection('vip_plans').where({ code: safeCode }).limit(2).get()
    if ((planRes.data || []).length !== 1) return null
    const plan = planRes.data[0]
    if (!plan || plan.enabled !== true || !isValidPlan(plan)) return null
    return plan
  } catch (err) {
    const message = String((err && (err.message || err.errMsg)) || '')
    if (!message.includes('Db or Table not exist') && !message.includes('database collection not') && !message.includes('-502005')) {
      throw err
    }
    return null
  }
}

async function listEnabledPlans() {
  try {
    const res = await db.collection('vip_plans')
      .where({ enabled: true })
      .orderBy('sort', 'asc')
      .get()
    const seen = new Set()
    return (res.data || []).filter((plan) => {
      if (!isValidPlan(plan) || seen.has(plan.code)) return false
      seen.add(plan.code)
      return true
    })
  } catch (err) {
    const message = String((err && (err.message || err.errMsg)) || '')
    if (!message.includes('Db or Table not exist') && !message.includes('database collection not') && !message.includes('-502005')) {
      throw err
    }
    throw new Error('套餐配置暂不可用，请联系管理员')
  }
}

function getVirtualProductId(plan) {
  return String(plan.virtualProductId || plan.productId || plan.code || '').trim()
}

function isValidPlan(plan = {}) {
  const code = String(plan.code || '').trim()
  const productId = getVirtualProductId(plan)
  const price = Number(plan.price)
  const days = Number(plan.days || 0)
  const supervisionDays = Number(plan.supervisionDays || 0)
  return /^[A-Za-z0-9._:-]{1,128}$/.test(code)
    && /^[A-Za-z0-9._:-]{1,128}$/.test(productId)
    && Number.isInteger(price) && price > 0 && price <= 100000000
    && Number.isInteger(days) && days >= 0 && days <= 3650
    && Number.isInteger(supervisionDays) && supervisionDays >= 0 && supervisionDays <= 3650
    && (days > 0 || supervisionDays > 0)
}

function toClientOrder(order) {
  return {
    orderId: order._id,
    outTradeNo: order.outTradeNo || '',
    status: order.status || '',
    planCode: order.planCode || order.planId || '',
    vipExpireDate: order.vipExpireDate || '',
    planLabel: order.planLabel || '',
    price: Number(order.price || 0),
    payChannel: order.payChannel || 'wechat_virtual',
    deliveryStatus: order.deliveryStatus || '',
    createdAt: order.createdAt || '',
    payTime: order.payTime || '',
    benefits: Array.isArray(order.benefits) ? order.benefits : []
  }
}

async function activatePendingSupervisionProfiles(openid) {
  const res = await db.collection('supervision_profiles')
    .where({ _openid: openid, status: 'pending_payment' })
    .limit(20)
    .get()
    .catch(() => ({ data: [] }))
  for (const profile of (res.data || [])) {
    await db.collection('supervision_profiles').doc(profile._id).update({
      data: { status: 'active', updatedAt: db.serverDate() }
    })
  }
}

async function grantOrderBenefits(order, callbackData = {}) {
  const user = await ensureCurrentUser(order._openid, '')
  const grantedOrder = await db.runTransaction(async (transaction) => {
    const latestOrderRes = await transaction.collection('orders').doc(order._id).get()
    const latestOrder = latestOrderRes.data
    if (!latestOrder) throw new Error('订单不存在')
    if (latestOrder.status === 'paid' && latestOrder.benefitsGranted) return latestOrder

    const latestUserRes = await transaction.collection('users').doc(user._id).get()
    const latestUser = latestUserRes.data
    if (!latestUser) throw new Error('用户不存在')

    const now = new Date()
    let currentExpire = latestUser.vipExpireDate ? new Date(latestUser.vipExpireDate) : now
    if (currentExpire < now) currentExpire = now
    const newExpire = new Date(currentExpire.getTime() + Number(latestOrder.days || 0) * 86400000)

    let supervisionExpireDate = latestUser.supervisionExpireDate
      ? new Date(latestUser.supervisionExpireDate)
      : null
    if (latestOrder.supervisionDays) {
      const supervisionBase = supervisionExpireDate && supervisionExpireDate > now ? supervisionExpireDate : now
      supervisionExpireDate = new Date(supervisionBase.getTime() + Number(latestOrder.supervisionDays) * 86400000)
    }

    await transaction.collection('users').doc(latestUser._id).update({
      data: {
        isVip: true,
        vipExpireDate: newExpire,
        isFreeTrial: false,
        lastVipPlanCode: latestOrder.planCode || '',
        lastVipPlanLabel: latestOrder.planLabel || latestOrder.planTag || '',
        supervisionExpireDate: supervisionExpireDate || null
      }
    })

    const updateData = {
      status: 'paid',
      benefitsGranted: true,
      payTime: db.serverDate(),
      transactionId: callbackData.transactionId || callbackData.wxpay_order_id || '',
      callbackData,
      vipExpireDate: newExpire,
      supervisionExpireDate: supervisionExpireDate || null,
      updatedAt: db.serverDate()
    }
    if (callbackData.source === 'xpay_goods_deliver_notify') {
      updateData.deliveryStatus = 'confirmed'
      updateData.deliveryNotifiedAt = db.serverDate()
    }
    await transaction.collection('orders').doc(latestOrder._id).update({ data: updateData })
    return {
      ...latestOrder,
      ...updateData,
      status: 'paid',
      benefitsGranted: true,
      vipExpireDate: newExpire
    }
  })

  const existsLog = await db.collection('coin_logs')
    .where({ _openid: order._openid, type: 'vip_pay', orderId: order._id })
    .limit(1)
    .get()
  if (!existsLog.data.length) {
    await db.collection('coin_logs').doc(`vip_pay_${order._id}`).set({
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
  if (Number(grantedOrder.supervisionDays || order.supervisionDays || 0) > 0) {
    await activatePendingSupervisionProfiles(order._openid)
  }
  return grantedOrder
}

async function revokeOrderBenefits(order, remoteOrder = {}) {
  const userRes = await db.collection('users').where({ _openid: order._openid }).limit(1).get()
  const user = userRes.data[0]
  if (!user) throw new Error('用户不存在')

  const revokedOrder = await db.runTransaction(async (transaction) => {
    const latestOrderRes = await transaction.collection('orders').doc(order._id).get()
    const latestOrder = latestOrderRes.data
    if (!latestOrder) throw new Error('订单不存在')
    if (latestOrder.status === 'refunded' && latestOrder.benefitsRevoked) return latestOrder

    if (!latestOrder.benefitsGranted) {
      const updateData = {
        status: 'refunded',
        benefitsRevoked: true,
        refundTime: db.serverDate(),
        refundRemoteOrder: remoteOrder,
        updatedAt: db.serverDate()
      }
      await transaction.collection('orders').doc(latestOrder._id).update({ data: updateData })
      return { ...latestOrder, ...updateData, status: 'refunded' }
    }

    const latestUserRes = await transaction.collection('users').doc(user._id).get()
    const latestUser = latestUserRes.data
    const now = new Date()
    const currentVipExpire = latestUser.vipExpireDate ? new Date(latestUser.vipExpireDate) : now
    const vipExpireDate = new Date(currentVipExpire.getTime() - Number(latestOrder.days || 0) * 86400000)
    let supervisionExpireDate = latestUser.supervisionExpireDate
      ? new Date(latestUser.supervisionExpireDate)
      : null
    if (supervisionExpireDate && latestOrder.supervisionDays) {
      supervisionExpireDate = new Date(
        supervisionExpireDate.getTime() - Number(latestOrder.supervisionDays || 0) * 86400000
      )
    }

    await transaction.collection('users').doc(latestUser._id).update({
      data: {
        isVip: vipExpireDate > now,
        vipExpireDate,
        supervisionExpireDate,
        lastRefundedOrderId: latestOrder._id
      }
    })
    const updateData = {
      status: 'refunded',
      benefitsRevoked: true,
      refundTime: db.serverDate(),
      refundRemoteOrder: remoteOrder,
      updatedAt: db.serverDate()
    }
    await transaction.collection('orders').doc(latestOrder._id).update({ data: updateData })
    return { ...latestOrder, ...updateData, status: 'refunded' }
  })

  const logId = `vip_refund_${order._id}`
  await db.collection('coin_logs').doc(logId).set({
    data: {
      _openid: order._openid,
      type: 'order_refund',
      orderId: order._id,
      planId: order.planId,
      planLabel: order.planLabel,
      amount: 0,
      daysAdded: order.benefitsGranted ? -Number(order.days || 0) : 0,
      createdAt: db.serverDate()
    }
  })
  return revokedOrder
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

function validateRemoteOrder(order, remoteOrder = {}) {
  if (remoteOrder.order_id && remoteOrder.order_id !== order.outTradeNo) {
    throw new Error('微信订单号与本地订单不一致')
  }
  const orderFee = Number(remoteOrder.order_fee)
  if (!Number.isFinite(orderFee) || orderFee !== Number(order.price || 0)) {
    throw new Error('支付订单金额与套餐金额不一致')
  }
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

    if (REFUNDED_REMOTE_STATUS.includes(remoteStatus)) {
      const revoked = await revokeOrderBenefits(order, remoteOrder)
      return { code: 0, data: { order: toClientOrder(revoked) } }
    }
    if (CLOSED_REMOTE_STATUS.includes(remoteStatus)) {
      await db.collection('orders').doc(order._id).update({
        data: { status: 'closed', updatedAt: db.serverDate() }
      })
      return { code: 0, data: { order: toClientOrder({ ...order, status: 'closed' }) } }
    }

    if (!PAID_REMOTE_STATUS.includes(remoteStatus)) {
      return { code: 1, msg: '支付尚未完成', data: { remoteStatus } }
    }

    validateRemoteOrder(order, remoteOrder)

    const granted = await grantOrderBenefits(order, {
      source: 'virtual_query_order',
      remoteOrder,
      transactionId: remoteOrder.wxpay_order_id || remoteOrder.wx_order_id || ''
    })

    if (!isDeliveryDone(granted)) {
      await notifyAndRecordDelivery(config, granted, getWxOrderIdFromRemote(remoteOrder), 'virtual_query_order')
    }

    return { code: 0, data: { order: toClientOrder(granted) } }
  } catch (err) {
    console.error('[createVipOrder:syncVirtualOrder] error', err)
    return { code: -1, msg: err.message || '同步支付结果失败' }
  }
}

async function listMyOrders(event, wxContext) {
  const { OPENID } = wxContext
  if (!OPENID) return { code: -1, msg: '未获取到用户身份' }

  try {
    const safeLimit = Math.max(1, Math.min(Number(event && event.limit) || 50, 100))
    const result = await db.collection('orders')
      .where({ _openid: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(safeLimit)
      .get()
    return {
      code: 0,
      data: (result.data || []).map(toClientOrder)
    }
  } catch (err) {
    console.error('[createVipOrder:listMyOrders] error', err)
    return { code: -1, msg: err.message || '订单加载失败' }
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
        'TransactionId', 'PaidTime', 'WxOrderId', 'MchOrderId',
        'WxRefundId', 'MchRefundId', 'RefundFee', 'RetCode', 'RetMsg'
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
    if (order.status === 'paid' && order.benefitsGranted) {
      if (order.deliveryStatus !== 'confirmed') {
        await db.collection('orders').doc(order._id).update({
          data: {
            deliveryStatus: 'confirmed',
            deliveryNotifiedAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
      }
      return { ErrCode: 0, ErrMsg: 'success', errcode: 0, errmsg: 'success' }
    }

    const config = getVirtualPayConfig({})
    const queryRes = await queryVirtualOrder(config, order._openid, outTradeNo)
    if (queryRes.errcode) return { ErrCode: -1, ErrMsg: queryRes.errmsg || 'query order failed' }
    const remoteOrder = queryRes.order || {}
    const remoteStatus = Number(remoteOrder.status)
    if (!PAID_REMOTE_STATUS.includes(remoteStatus)) {
      return { ErrCode: -1, ErrMsg: 'order is not paid' }
    }
    validateRemoteOrder(order, remoteOrder)

    await grantOrderBenefits(order, {
      source: 'xpay_goods_deliver_notify',
      remoteOrder,
      transactionId: getWxOrderIdFromRemote(remoteOrder)
    })
    return { ErrCode: 0, ErrMsg: 'success', errcode: 0, errmsg: 'success' }
  } catch (err) {
    console.error('[createVipOrder:handleVirtualDeliverNotify] error', err)
    return { ErrCode: -1, ErrMsg: err.message || 'callback error' }
  }
}

async function handleVirtualRefundNotify(rawEvent) {
  const event = normalizeNotifyEvent(rawEvent)
  const outTradeNo = event.MchOrderId || event.OutTradeNo || event.outTradeNo || event.order_id || ''
  const wxOrderId = event.WxOrderId || event.wx_order_id || ''
  if (!outTradeNo && !wxOrderId) return { ErrCode: -1, ErrMsg: 'missing order id' }

  try {
    let order = null
    if (outTradeNo) {
      const res = await db.collection('orders').where({ outTradeNo }).limit(1).get()
      order = (res.data || [])[0] || null
    }
    if (!order && wxOrderId) {
      const res = await db.collection('orders').where({ wxOrderId }).limit(1).get()
      order = (res.data || [])[0] || null
    }
    if (!order) return { ErrCode: -1, ErrMsg: 'order not found' }
    if (order.status === 'refunded' && order.benefitsRevoked) {
      return { ErrCode: 0, ErrMsg: 'success' }
    }

    const config = getVirtualPayConfig({})
    const queryRes = await queryVirtualOrder(config, order._openid, order.outTradeNo)
    if (queryRes.errcode) return { ErrCode: -1, ErrMsg: queryRes.errmsg || 'query order failed' }
    const remoteOrder = queryRes.order || {}
    const remoteStatus = Number(remoteOrder.status)
    if (!REFUNDED_REMOTE_STATUS.includes(remoteStatus)) {
      return { ErrCode: -1, ErrMsg: 'refund is not completed' }
    }
    validateRemoteOrder(order, remoteOrder)
    await revokeOrderBenefits(order, remoteOrder)
    return { ErrCode: 0, ErrMsg: 'success' }
  } catch (err) {
    console.error('[createVipOrder:handleVirtualRefundNotify] error', err)
    return { ErrCode: -1, ErrMsg: err.message || 'refund callback error' }
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const action = (event && event.action) || 'create'
  const normalized = normalizeNotifyEvent(event || {})

  if (normalized.Event === 'xpay_goods_deliver_notify') {
    return handleVirtualDeliverNotify(normalized)
  }
  if (normalized.Event === 'xpay_refund_notify') {
    return handleVirtualRefundNotify(normalized)
  }

  if (action === 'plans') {
    try {
      const plans = await listEnabledPlans()
      return {
        code: 0,
        data: plans.map((plan) => ({
          code: plan.code,
          name: plan.name || plan.tag || plan.code,
          tag: plan.tag || '',
          price: Number(plan.price || 0),
          days: Number(plan.days || 0),
          supervisionDays: Number(plan.supervisionDays || 0),
          benefits: Array.isArray(plan.benefits) ? plan.benefits : [],
          sort: Number(plan.sort || 0)
        }))
      }
    } catch (err) {
      return { code: -1, msg: err.message || '套餐加载失败' }
    }
  }
  if (action === 'list') return listMyOrders(event, wxContext)
  if (action === 'sync') return syncVirtualOrder(event, wxContext)
  return createVirtualOrder(event, wxContext)
}
