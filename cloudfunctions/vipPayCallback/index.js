const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const RECONCILE_MAX_AGE = 3 * 24 * 60 * 60 * 1000
const RECONCILE_LIMIT = 10
const RECONCILE_BASE_DELAY = 5 * 60 * 1000
const RECONCILE_MAX_DELAY = 6 * 60 * 60 * 1000

function parseSimpleXml(xml = '') {
  const data = {}
  const keys = ['Event', 'OutTradeNo', 'outTradeNo', 'order_id', 'MchOrderId', 'WxOrderId']
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
    if (body.startsWith('<')) return parseSimpleXml(body)
  }
  return event
}

function toTimestamp(value) {
  if (!value) return 0
  const date = value instanceof Date
    ? value
    : (typeof value.toDate === 'function' ? value.toDate() : new Date(value))
  const timestamp = date.getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function getReconcileDelay(attempts) {
  const exponent = Math.max(0, Math.min(Number(attempts || 0), 5))
  return Math.min(RECONCILE_BASE_DELAY * (2 ** exponent), RECONCILE_MAX_DELAY)
}

async function recordReconcileAttempt(order, result = {}, error) {
  if (!order || !order._id) return
  const attempts = Math.max(0, Number(order.reconcileAttempts || 0)) + 1
  const errCode = Number(result.ErrCode)
  const errMsg = String(
    (error && (error.message || error))
    || result.ErrMsg
    || result.errmsg
    || ''
  ).slice(0, 300)
  await db.collection('orders').doc(order._id).update({
    data: {
      reconcileAttempts: attempts,
      reconcileLastTriedAt: db.serverDate(),
      reconcileNextAt: new Date(Date.now() + getReconcileDelay(attempts - 1)),
      reconcileLastResult: {
        errCode: Number.isFinite(errCode) ? errCode : -1,
        errMsg
      },
      updatedAt: db.serverDate()
    }
  })
}

async function reconcilePendingOrders() {
  const result = await db.collection('orders')
    .where({ status: 'pending' })
    .limit(100)
    .get()
  const now = Date.now()
  const candidates = (result.data || [])
    .filter((order) => (
      order.payChannel === 'wechat_virtual'
      && order.outTradeNo
      && toTimestamp(order.createdAt) >= now - RECONCILE_MAX_AGE
      && (!toTimestamp(order.reconcileNextAt) || toTimestamp(order.reconcileNextAt) <= now)
    ))
    .sort((left, right) => {
      const triedDiff = toTimestamp(left.reconcileLastTriedAt) - toTimestamp(right.reconcileLastTriedAt)
      return triedDiff || (toTimestamp(right.createdAt) - toTimestamp(left.createdAt))
    })
    .slice(0, RECONCILE_LIMIT)

  let reconciled = 0
  let paid = 0
  for (const order of candidates) {
    try {
      const response = await cloud.callFunction({
        name: 'createVipOrder',
        data: {
          action: 'notify',
          Event: 'xpay_goods_deliver_notify',
          OutTradeNo: order.outTradeNo
        }
      })
      reconciled += 1
      const reconcileResult = response.result || {}
      if (Number(reconcileResult.ErrCode) === 0) {
        paid += 1
      } else {
        await recordReconcileAttempt(order, reconcileResult)
      }
    } catch (err) {
      console.warn('[vipPayCallback] scheduled reconcile failed', order.outTradeNo, err.message || err)
      try {
        await recordReconcileAttempt(order, {}, err)
      } catch (recordErr) {
        console.warn('[vipPayCallback] failed to record reconcile backoff', order.outTradeNo, recordErr.message || recordErr)
      }
    }
  }
  return { code: 0, checked: candidates.length, reconciled, paid }
}

exports.main = async (rawEvent = {}) => {
  const event = normalizeEvent(rawEvent)
  const eventType = event.Event === 'xpay_refund_notify' ? 'xpay_refund_notify' : 'xpay_goods_deliver_notify'
  const outTradeNo = event.MchOrderId || event.OutTradeNo || event.outTradeNo || event.out_trade_no || event.order_id || ''
  if (!outTradeNo && !event.WxOrderId) {
    const wxContext = cloud.getWXContext()
    if (wxContext.OPENID) return { ErrCode: -1, ErrMsg: 'missing order id' }
    return reconcilePendingOrders()
  }

  try {
    const res = await cloud.callFunction({
      name: 'createVipOrder',
      data: {
        action: 'notify',
        Event: eventType,
        OutTradeNo: outTradeNo,
        MchOrderId: event.MchOrderId || '',
        WxOrderId: event.WxOrderId || ''
      }
    })
    return res.result || { ErrCode: -1, ErrMsg: 'empty reconcile result' }
  } catch (err) {
    console.error('[vipPayCallback] reconcile failed', err)
    return { ErrCode: -1, ErrMsg: err.message || 'callback error' }
  }
}
