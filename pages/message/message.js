const cloudApi = require('../../utils/cloudApi')

function formatTime(value) {
  if (!value) return '刚刚'
  const date = typeof value === 'object' && value.toDate ? value.toDate() : new Date(value)
  const diff = Date.now() - date.getTime()
  const hour = 3600 * 1000
  const day = 24 * hour
  if (diff < hour) return '刚刚'
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function canViewMessage(item, user, app) {
  const scope = item.scope || 'all'
  if (scope === 'all') return true
  if (scope === 'vip') return !!app.globalData.isVip
  if (scope === 'new' || scope === '新用户') return !!user && !!user.isFreeTrial
  if (scope === 'supervision') {
    if (!user || !user.supervisionExpireDate) return false
    return new Date(user.supervisionExpireDate) > new Date()
  }
  return true
}

Page({
  data: {
    messages: [],
    activeMessage: null
  },

  async onShow() {
    try {
      const [list, user] = await Promise.all([
        cloudApi.getMessages(),
        cloudApi.getCurrentUser().catch(() => null)
      ])
      const app = getApp()
      this.setData({
        messages: (list || [])
          .filter((item) => canViewMessage(item, user, app))
          .map((item) => ({
            ...item,
            timeText: formatTime(item.updatedAt || item.createdAt),
            icon: item.icon || '🔔'
          }))
      })
      this._syncMessageBadge(this.data.messages.filter((item) => item.unread).length)
    } catch (e) {
      this.setData({ messages: [] })
      this._syncMessageBadge(0)
    }
  },

  async openMessage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const message = this.data.messages[index]
    if (!message) return

    this.setData({
      activeMessage: { ...message, unread: false },
      messages: this.data.messages.map((item, idx) => (
        idx === index ? { ...item, unread: false } : item
      ))
    })
    await cloudApi.markMessageRead(message)
    this._syncMessageBadge(this.data.messages.filter((item) => item.unread).length)
  },

  closeMessage() {
    this.setData({ activeMessage: null })
  },

  noop() {
  },

  _syncMessageBadge(count) {
    if (count > 0) {
      wx.setTabBarBadge({ index: 3, text: String(count > 99 ? '99+' : count), fail: () => null })
    } else {
      wx.removeTabBarBadge({ index: 3, fail: () => null })
    }
  }
})
