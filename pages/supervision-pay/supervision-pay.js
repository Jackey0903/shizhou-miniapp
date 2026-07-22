const cloudApi = require('../../utils/cloudApi')
const virtualPayment = require('../../utils/virtualPayment')
const auth = require('../../utils/auth')

const SUPERVISION_PLAN_CODES = ['supervision_trial_day', 'supervision_month', 'premium_vip_year']

function normalizeBenefits(benefits) {
  return (Array.isArray(benefits) ? benefits : []).filter((item) => !String(item).includes('免费领取学习资料'))
}

function normalizeSupervisionPlan(item) {
  const isAnnual = item.code === 'premium_vip_year'
  return {
    ...item,
    tag: isAnnual ? '督学包年' : item.tag,
    title: isAnnual ? '督学包年' : (item.name || item.tag || '督学套餐'),
    priceLabel: `¥${((item.price || 0) / 100).toFixed(item.price % 100 === 0 ? 0 : 2)}`,
    benefits: normalizeBenefits(item.benefits)
  }
}

Page({
  data: {
    mode: 'full',
    sel: 0,
    plans: [],
    currentPlan: null,
    hasAccess: false,
    supervisionExpireText: ''
  },

  async onLoad(options) {
    const mode = options.mode === 'part' ? 'part' : 'full'
    this.setData({ mode })
    await Promise.all([this.loadPlans(), this.loadAccess()])
  },

  async onShow() {
    await this.loadAccess()
  },

  async loadPlans() {
    try {
      const plans = await cloudApi.getVipPlans()
      const sourcePlans = plans.filter((item) => SUPERVISION_PLAN_CODES.includes(item.code))
      const normalized = sourcePlans.map(normalizeSupervisionPlan)
      const currentIndex = Math.max(0, Math.min(this.data.sel, normalized.length - 1))
      this.setData({
        plans: normalized,
        sel: currentIndex,
        currentPlan: normalized[currentIndex] || normalized[0] || null
      })
    } catch (err) {
      this.setData({ plans: [], currentPlan: null, sel: 0 })
      wx.showToast({ title: '套餐加载失败，请稍后重试', icon: 'none' })
    }
  },

  async loadAccess() {
    try {
      const user = await cloudApi.getCurrentUser()
      const expire = user && user.supervisionExpireDate ? new Date(user.supervisionExpireDate) : null
      const hasAccess = !!(expire && expire > new Date())
      this.setData({
        hasAccess,
        supervisionExpireText: hasAccess ? expire.toLocaleDateString() : ''
      })
    } catch (err) {}
  },

  select(e) {
    const sel = Number(e.currentTarget.dataset.i) || 0
    this.setData({ sel, currentPlan: this.data.plans[sel] || this.data.currentPlan })
  },

  goPlan() {
    wx.navigateTo({ url: `/pages/supervision-plan/supervision-plan?mode=${this.data.mode}` })
  },

  async buyPlan() {
    const plan = this.data.currentPlan
    let outTradeNo = ''
    if (!plan) {
      wx.showToast({ title: '暂无可购买套餐', icon: 'none' })
      return
    }
    const canContinue = await auth.requireLogin('开通督学前请先登录账号，登录后会自动回到当前购买页。')
    if (!canContinue) return

    wx.showLoading({ title: '创建订单...', mask: true })
    try {
      const res = await virtualPayment.createOrder(plan.code)
      const result = res && res.result
      if (!result || result.code !== 0) throw new Error((result && result.msg) || '创建订单失败，请稍后重试')
      const orderData = result.data || {}
      const payment = orderData.payment
      outTradeNo = orderData.outTradeNo || ''
      if (!payment) throw new Error('未获取到支付参数')
      const serverPlan = result.data && result.data.plan
      if (!serverPlan || Number(serverPlan.price) !== Number(plan.price)) {
        await this.loadPlans()
        throw new Error('套餐价格已更新，请重新确认后购买')
      }
      wx.hideLoading()
      await virtualPayment.requestVirtualPayment(payment)
      wx.showLoading({ title: '确认支付结果...', mask: true })
      const order = await virtualPayment.waitForPaidOrder(outTradeNo)
      wx.hideLoading()
      if (!order) {
        wx.showModal({
          title: '订单确认中',
          content: '支付已发起，系统正在同步结果。请稍后到“我的订单”查看状态；如已扣款，督学权益会自动发放。',
          showCancel: false,
          success: () => {
            wx.navigateTo({ url: '/pages/order-center/order-center' })
          }
        })
        return
      }
      const latestUser = await cloudApi.getCurrentUser().catch(() => null)
      const app = getApp()
      if (app.globalData.userInfo && latestUser) {
        const vipExpiryTime = latestUser.vipExpireDate ? new Date(latestUser.vipExpireDate).getTime() : 0
        app.globalData.userInfo.isVip = !!latestUser.isVip
        app.globalData.userInfo.vipExpireDate = latestUser.vipExpireDate || ''
        app.globalData.userInfo.supervisionExpireDate = latestUser.supervisionExpireDate || ''
        app.globalData.isVip = !!(latestUser.isVip && (!vipExpiryTime || vipExpiryTime > Date.now()))
        app.globalData.vipExpireDate = latestUser.vipExpireDate || null
        wx.setStorageSync('userInfo', app.globalData.userInfo)
      }
      await this.loadAccess()
      wx.showModal({
        title: '支付成功',
        content: `督学已开通，有效期至：${this.data.supervisionExpireText || '已开通'}`,
        showCancel: false,
        success: () => {
          wx.navigateTo({ url: `/pages/supervision-plan/supervision-plan?mode=${this.data.mode}&showSupervisorQr=1` })
        }
      })
    } catch (err) {
      wx.hideLoading()
      await virtualPayment.reportPaymentError(outTradeNo, err).catch(() => null)
      const msg = virtualPayment.getPaymentErrorMessage(err)
      wx.showToast({ title: msg, icon: 'none' })
    }
  }
})
