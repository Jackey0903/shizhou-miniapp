const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function parseSimpleXml(xml = '') {
  const data = {}
  const keys = [
    'ToUserName', 'FromUserName', 'CreateTime', 'MsgType', 'Event',
    'OpenId', 'OutTradeNo', 'Env', 'ProductId', 'Quantity',
    'OrigPrice', 'ActualPrice', 'Attach', 'MchOrderNo',
    'TransactionId', 'PaidTime', 'WxOrderId', 'MchOrderId'
  ]
  keys.forEach((key) => {
    const match = new RegExp(`<${key}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${key}>`).exec(String(xml))
    if (match) data[key] = match[1]
  })
  return data
}

function normalizeEvent(event = {}) {
  if (event.body && typeof event.body === 'string') {
    const body = event.body.trim()
    if (body.startsWith('{')) {
      try {
        return JSON.parse(body)
      } catch (err) {}
    }
    if (body.startsWith('<')) {
      return parseSimpleXml(body)
    }
  }
  return event
}

function isVirtualDeliver(event = {}) {
  return event.Event === 'xpay_goods_deliver_notify'
}

function successResponse(event = {}) {
  if (isVirtualDeliver(event)) {
    return { ErrCode: 0, ErrMsg: 'success', errcode: 0, errmsg: 'success' }
  }
  return { errcode: 0, errmsg: 'success' }
}

function failResponse(event = {}, message = 'callback error') {
  if (isVirtualDeliver(event)) {
    return { ErrCode: -1, ErrMsg: message }
  }
  return { errcode: -1, errmsg: message }
}

function isPaySuccess(event = {}) {
  if (isVirtualDeliver(event)) return true
  return [
    event.resultCode,
    event.result_code,
    event.returnCode,
    event.return_code,
    event.tradeState,
    event.trade_state
  ].includes('SUCCESS')
}

function getOrderNo(event = {}) {
  return event.OutTradeNo || event.outTradeNo || event.out_trade_no || ''
}

function getTransactionId(event = {}) {
  const payInfo = event.WeChatPayInfo || event.weChatPayInfo || {}
  return payInfo.TransactionId || payInfo.transactionId || event.transactionId || event.transaction_id || ''
}

async function getUserByOpenid(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || null
}

exports.main = async (rawEvent) => {
  const event = normalizeEvent(rawEvent || {})
  const outTradeNo = getOrderNo(event)
  if (!outTradeNo) {
    return failResponse(event, 'missing outTradeNo')
  }

  try {
    const orderRes = await db.collection('orders').where({ outTradeNo }).limit(1).get()
    const order = orderRes.data[0]
    if (!order) {
      return failResponse(event, 'order not found')
    }

    if (isVirtualDeliver(event)) {
      const goodsInfo = event.GoodsInfo || event.goodsInfo || {}
      const productId = goodsInfo.ProductId || goodsInfo.productId || event.ProductId || event.productId
      const actualPrice = goodsInfo.ActualPrice || goodsInfo.actualPrice || event.ActualPrice || event.actualPrice
      if (event.OpenId && event.OpenId !== order._openid) {
        return failResponse(event, 'openid mismatch')
      }
      if (productId && order.virtualProductId && productId !== order.virtualProductId) {
        return failResponse(event, 'product mismatch')
      }
      if (actualPrice && Number(actualPrice) !== Number(order.price || 0)) {
        return failResponse(event, 'price mismatch')
      }
    }

    if (!isPaySuccess(event)) {
      await db.collection('orders').doc(order._id).update({
        data: {
          callbackData: event,
          updatedAt: db.serverDate()
        }
      })
      return { errcode: 0, errmsg: 'ignored' }
    }

    if (order.status === 'paid' && order.benefitsGranted) {
      return successResponse(event)
    }

    const user = await getUserByOpenid(order._openid)
    if (!user) {
      return failResponse(event, 'user not found')
    }

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
      transactionId: getTransactionId(event),
      callbackData: event,
      vipExpireDate: newExpire,
      updatedAt: db.serverDate()
    }

    if (isVirtualDeliver(event)) {
      updateData.deliveryStatus = 'confirmed'
      updateData.deliveryNotifiedAt = db.serverDate()
    }

    await db.collection('orders').doc(order._id).update({ data: updateData })

    return successResponse(event)
  } catch (err) {
    console.error('[vipPayCallback] error', err)
    return failResponse(event, err.message || 'callback error')
  }
}
