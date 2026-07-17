const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

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

exports.main = async (rawEvent = {}) => {
  const event = normalizeEvent(rawEvent)
  const eventType = event.Event === 'xpay_refund_notify' ? 'xpay_refund_notify' : 'xpay_goods_deliver_notify'
  const outTradeNo = event.MchOrderId || event.OutTradeNo || event.outTradeNo || event.out_trade_no || event.order_id || ''
  if (!outTradeNo && !event.WxOrderId) return { ErrCode: -1, ErrMsg: 'missing order id' }

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
