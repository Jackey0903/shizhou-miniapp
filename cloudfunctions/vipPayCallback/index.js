const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const RECONCILE_MAX_AGE = 3 * 24 * 60 * 60 * 1000
const RECONCILE_LIMIT = 10

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
    ))
    .sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt))
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
      if (response.result && Number(response.result.ErrCode) === 0) paid += 1
    } catch (err) {
      console.warn('[vipPayCallback] scheduled reconcile failed', order.outTradeNo, err.message || err)
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
