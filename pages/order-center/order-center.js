const cloudApi = require('../../utils/cloudApi')

const STATUS_LABELS = {
  pending: '待支付',
  paid: '已支付',
  create_failed: '下单失败',
  closed: '已关闭',
  refunded: '已退款'
}

const DELIVERY_LABELS = {
  confirmed: '权益已发放',
  notified: '权益已发放',
  notify_failed: '发放确认待重试'
}

function formatMoney(value) {
  const amount = Number(value || 0) / 100
  return `¥${amount.toFixed(value % 100 === 0 ? 0 : 2)}`
}

function formatTime(value) {
  if (!value) return ''
  const date = value instanceof Date
    ? value
    : (value && typeof value.toDate === 'function' ? value.toDate() : new Date(value))
  if (!date || Number.isNaN(date.getTime())) return ''
  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

Page({
  data: {
    orders: [],
    loading: false
  },

  onLoad() {
    this.loadOrders()
  },

  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh())
  },

  async loadOrders() {
    this.setData({ loading: true })
    try {
      let res = await cloudApi.getMyOrders(100)
      let result = res.result || {}
      if (result.code !== 0) throw new Error(result.msg || '订单加载失败')
      const candidates = (result.data || [])
        .filter((order) => ['pending', 'paid'].includes(order.status) && order.outTradeNo)
        .slice(0, 20)
      if (candidates.length) {
        await Promise.all(candidates.map((order) => (
          wx.cloud.callFunction({
            name: 'createVipOrder',
            data: { action: 'sync', outTradeNo: order.outTradeNo }
          }).catch(() => null)
        )))
        res = await cloudApi.getMyOrders(100)
        result = res.result || {}
        if (result.code !== 0) throw new Error(result.msg || '订单加载失败')
      }
      const orders = (result.data || []).map((order) => ({
        ...order,
        statusLabel: STATUS_LABELS[order.status] || order.status || '未知状态',
        deliveryLabel: DELIVERY_LABELS[order.deliveryStatus] || (order.status === 'paid' ? '权益确认中' : ''),
        priceText: formatMoney(order.price),
        createdAtText: formatTime(order.createdAt),
        payTimeText: formatTime(order.payTime),
        vipExpireText: formatTime(order.vipExpireDate)
      }))
      this.setData({ orders })
    } catch (err) {
      wx.showToast({ title: err.message || '订单加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
