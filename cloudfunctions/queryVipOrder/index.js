const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, outTradeNo, orderId, limit = 50 } = event || {}

  if (!OPENID) {
    return { code: -1, msg: '未获取到用户身份' }
  }

  try {
    if (action === 'list') {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100))
      const res = await db.collection('orders')
        .where({ _openid: OPENID })
        .orderBy('createdAt', 'desc')
        .limit(safeLimit)
        .get()
      return {
        code: 0,
        data: (res.data || []).map((order) => ({
          orderId: order._id,
          outTradeNo: order.outTradeNo || '',
          status: order.status || '',
          planCode: order.planCode || order.planId || '',
          planLabel: order.planLabel || order.planTag || '',
          price: order.price || 0,
          payChannel: order.payChannel || 'wechat',
          deliveryStatus: order.deliveryStatus || '',
          createdAt: order.createdAt || '',
          payTime: order.payTime || '',
          vipExpireDate: order.vipExpireDate || '',
          benefits: order.benefits || []
        }))
      }
    }

    if (orderId) {
      const doc = await db.collection('orders').doc(orderId).get()
      const order = doc.data
      if (!order || order._openid !== OPENID) {
        return { code: -1, msg: '订单不存在' }
      }
      return {
        code: 0,
        data: {
          orderId: order._id,
          outTradeNo: order.outTradeNo,
          status: order.status,
          deliveryStatus: order.deliveryStatus || '',
          vipExpireDate: order.vipExpireDate || '',
          planLabel: order.planLabel || ''
        }
      }
    }

    const query = outTradeNo ? { _openid: OPENID, outTradeNo } : { _openid: OPENID }
    const res = await db.collection('orders').where(query).limit(1).get()
    const order = res.data[0]
    if (!order) {
      return { code: -1, msg: '订单不存在' }
    }

    return {
      code: 0,
      data: {
        orderId: order._id,
        outTradeNo: order.outTradeNo,
        status: order.status,
        deliveryStatus: order.deliveryStatus || '',
        vipExpireDate: order.vipExpireDate || '',
        planLabel: order.planLabel || ''
      }
    }
  } catch (err) {
    console.error('[queryVipOrder] error', err)
    return { code: -1, msg: err.message || '查询失败' }
  }
}
