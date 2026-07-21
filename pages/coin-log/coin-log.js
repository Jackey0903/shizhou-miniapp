// pages/coin-log/coin-log.js
const cloudApi = require('../../utils/cloudApi')

const ACTION_LABELS = {
  checkin: '每日打卡',
  ad_reward: '广告奖励',
  share_reward: '分享奖励',
  checkin_share_cost: '打卡分享',
  material_exchange: '资料领取',
  vip_pay: 'VIP虚拟支付',
  order_pay: '课程权益记录',
  order_refund: '退款返还'
}

Page({
  data: {
    logs: [],
    loading: false,
    adUnitId: '',
    adReady: false,
    rewarding: false,
    shareRewarding: false
  },

  onLoad() {
    this.loadAdSlot()
    this.loadLogs()
  },

  onUnload() {
    if (this._rewardedAd) {
      if (this._adCloseHandler && this._rewardedAd.offClose) this._rewardedAd.offClose(this._adCloseHandler)
      if (this._adErrorHandler && this._rewardedAd.offError) this._rewardedAd.offError(this._adErrorHandler)
      this._rewardedAd = null
    }
  },

  onPullDownRefresh() {
    this.loadLogs().finally(() => wx.stopPullDownRefresh())
  },

  async loadLogs() {
    this.setData({ loading: true })
    try {
      const logs = await cloudApi.getCoinLogs()
      const formatted = logs.filter((log) => typeof log.amount === 'number' && !log.daysAdded).map(log => ({
        _id: log._id,
        title: ACTION_LABELS[log.type] || '舟币变化',
        desc: this._buildDesc(log),
        amount: log.amount || 0,
        amountText: `${log.amount > 0 ? '+' : ''}${log.amount}舟币`,
        createdAt: this._formatTime(log.createdAt)
      }))
      this.setData({ logs: formatted })
    } catch (err) {
      console.error('加载舟币明细失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  _buildDesc(log) {
    if (log.type === 'share_reward') return '分享朋友圈奖励'
    if (log.type === 'checkin_share_cost') return '分享打卡海报消耗舟币'
    if (log.type === 'ad_reward') return '观看完整广告奖励'
    if (log.type === 'material_exchange') return log.title || '领取学习资料'
    if (typeof log.coinsEarned === 'number') return `获得舟币 ${log.coinsEarned}`
    return log.remark || ''
  },

  async loadAdSlot() {
    const slot = await cloudApi.getAdSlot('coin-reward-video').catch(() => null)
    const adUnitId = slot && (slot.adUnitId || slot.unitId)
    this.setData({ adUnitId: adUnitId || '', adReady: !!adUnitId && !!wx.createRewardedVideoAd })
    if (adUnitId && wx.createRewardedVideoAd) {
      this._rewardedAd = wx.createRewardedVideoAd({ adUnitId })
      this._adErrorHandler = () => {
        wx.showToast({ title: '广告暂不可用', icon: 'none' })
      }
      this._adCloseHandler = async (res) => {
        if (res && res.isEnded) {
          await this.grantAdReward()
        } else {
          wx.showToast({ title: '完整看完广告才可获得舟币', icon: 'none' })
        }
      }
      this._rewardedAd.onError(this._adErrorHandler)
      this._rewardedAd.onClose(this._adCloseHandler)
      this._rewardedAd.load().catch(() => {})
    }
  },

  async watchAd() {
    if (!this.data.adUnitId || !this._rewardedAd) {
      wx.showToast({ title: '管理员暂未配置激励广告', icon: 'none' })
      return
    }
    try {
      await this._rewardedAd.show()
    } catch (err) {
      try {
        await this._rewardedAd.load()
        await this._rewardedAd.show()
      } catch (showErr) {
        wx.showToast({ title: '广告暂不可用', icon: 'none' })
      }
    }
  },

  async grantAdReward() {
    if (this.data.rewarding) return
    this.setData({ rewarding: true })
    try {
      const res = await cloudApi.grantCoinReward('watchAd')
      const result = res.result || {}
      if (result.code === 0) {
        const app = getApp()
        if (app.globalData.userInfo && result.data && typeof result.data.coins === 'number') {
          app.globalData.userInfo.coins = result.data.coins
        }
        wx.showToast({ title: '已获得1舟币', icon: 'success' })
        await this.loadLogs()
      } else {
        wx.showToast({ title: result.msg || '奖励发放失败', icon: 'none' })
      }
    } finally {
      this.setData({ rewarding: false })
    }
  },

  claimShareReward() {
    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareTimeline', 'shareAppMessage']
      })
    }
    wx.showModal({
      title: '分享朋友圈赚舟币',
      content: '请点击右上角“…”选择分享到朋友圈。分享后系统会自动发放 10 舟币，每天最多 20 舟币。',
      confirmText: '知道了',
      showCancel: false
    })
  },

  async grantShareReward() {
    if (this.data.shareRewarding) return
    this.setData({ shareRewarding: true })
    try {
      const res = await cloudApi.grantCoinReward('shareTimeline')
      const result = res.result || {}
      if (result.code === 0) {
        const amount = result.data && result.data.amount ? result.data.amount : 10
        const app = getApp()
        if (app.globalData.userInfo && result.data && typeof result.data.coins === 'number') {
          app.globalData.userInfo.coins = result.data.coins
        }
        wx.showToast({ title: `已获得${amount}舟币`, icon: 'success' })
        await this.loadLogs()
      } else {
        wx.showToast({ title: result.msg || '今日分享奖励已达上限', icon: 'none' })
      }
    } catch (err) {
      wx.showToast({ title: '奖励发放失败', icon: 'none' })
    } finally {
      this.setData({ shareRewarding: false })
    }
  },

  onShareTimeline() {
    this.grantShareReward()
    return {
      title: '仕舟学习资料，分享朋友圈赚舟币',
      query: ''
    }
  },

  _formatTime(value) {
    if (!value) return ''
    const date = value instanceof Date ? value : new Date(value)
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    return `${date.getFullYear()}-${m}-${d} ${hh}:${mm}`
  }
})
