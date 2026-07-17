const cloudApi = require('../../utils/cloudApi')
const virtualPayment = require('../../utils/virtualPayment')
const auth = require('../../utils/auth')

const FALLBACK_PLANS = [
{ code: 'basic_vip_year', tag: '基础VIP', name: '基础VIP包年', price: 19800, days: 365, supervisionDays: 0, virtualProductId: 'basic_vip_year', sort: 1, benefits: ['免广告学习', '免费领取学习资料'] },
{ code: 'supervision_trial_day', tag: '督学试用', name: '督学试用1日', price: 800, days: 365, supervisionDays: 1, virtualProductId: 'supervision_trial_day', sort: 2, benefits: ['督学试用1天', '赠送1年免广告学习', '免费领取学习资料'] },
{ code: 'supervision_month', tag: '督学包月', name: '督学包月', price: 19800, days: 365, supervisionDays: 30, virtualProductId: 'supervision_month', sort: 3, benefits: ['督学包月服务', '赠送1年免广告学习', '免费领取学习资料'] },
{ code: 'premium_vip_year', tag: '高级VIP', name: '高级VIP包年', price: 98800, days: 365, supervisionDays: 365, virtualProductId: 'premium_vip_year', sort: 4, benefits: ['免广告学习', '免费领取学习资料', '督学包年服务'] }
]

const ALL_PLAN_CODES = FALLBACK_PLANS.map((item) => item.code)
const SUPERVISION_PLAN_CODES = ['supervision_trial_day', 'supervision_month', 'premium_vip_year']

function normalizeSupervisionPlan(item) {
  const isAnnual = item.code === 'premium_vip_year'
  return {
    ...item,
    tag: isAnnual ? '督学包年' : item.tag,
    title: isAnnual ? '督学包年' : (item.name || item.tag || '督学套餐'),
    priceLabel: `¥${((item.price || 0) / 100).toFixed(item.price % 100 === 0 ? 0 : 2)}`,
    benefits: item.benefits || []
  }
}

const SUPERVISION_PLANS = FALLBACK_PLANS
  .filter((item) => SUPERVISION_PLAN_CODES.includes(item.code))
  .map(normalizeSupervisionPlan)

Page({
  data: {
    mode: 'full',
    sel: 0,
    plans: SUPERVISION_PLANS,
    currentPlan: SUPERVISION_PLANS[0],
    hasAccess: false,
    supervisionExpireText: '',
    isTestEnv: false,
    grantingTestAccess: false
  },

  async onLoad(options) {
    const mode = options.mode === 'part' ? 'part' : 'full'
    let envVersion = 'release'
    try {
      const info = wx.getAccountInfoSync && wx.getAccountInfoSync()
      envVersion = (info && info.miniProgram && info.miniProgram.envVersion) || 'release'
    } catch (err) {}
    this.setData({
      mode,
      isTestEnv: envVersion !== 'release'
    })
    await Promise.all([this.loadPlans(), this.loadAccess()])
  },

  async onShow() {
    await this.loadAccess()
  },

  async loadPlans() {
    try {
      const plans = await cloudApi.getVipPlans()
      const hasUnifiedPlans = ALL_PLAN_CODES.every((code) => plans.some((item) => item.code === code))
      const sourcePlans = hasUnifiedPlans
        ? plans.filter((item) => SUPERVISION_PLAN_CODES.includes(item.code))
        : FALLBACK_PLANS.filter((item) => SUPERVISION_PLAN_CODES.includes(item.code))
      const normalized = sourcePlans.map(normalizeSupervisionPlan)
      const currentIndex = Math.min(this.data.sel, normalized.length - 1)
      this.setData({
        plans: normalized,
        sel: currentIndex,
        currentPlan: normalized[currentIndex] || normalized[0] || null
      })
    } catch (err) {}
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

  async _pollOrderResult(outTradeNo) {
    for (let i = 0; i < 20; i += 1) {
      const syncRes = await wx.cloud.callFunction({
        name: 'createVipOrder',
        data: { action: 'sync', outTradeNo }
      })
      if (syncRes.result && syncRes.result.code === 0 && syncRes.result.data && syncRes.result.data.order) {
        return syncRes.result.data.order
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    return null
  },

  goPlan() {
    wx.navigateTo({ url: `/pages/supervision-plan/supervision-plan?mode=${this.data.mode}` })
  },

  async buyPlan() {
    const plan = this.data.currentPlan
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
      const { payment, outTradeNo } = result.data || {}
      if (!payment) throw new Error('未获取到支付参数')
      wx.hideLoading()
      await virtualPayment.requestVirtualPayment(payment)
      wx.showLoading({ title: '确认支付结果...', mask: true })
      const order = await this._pollOrderResult(outTradeNo)
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
        app.globalData.userInfo.isVip = !!latestUser.isVip
        app.globalData.userInfo.vipExpireDate = latestUser.vipExpireDate || ''
        app.globalData.userInfo.supervisionExpireDate = latestUser.supervisionExpireDate || ''
        app.globalData.isVip = !!latestUser.isVip
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
      const isCancel = err && ((err.errMsg && err.errMsg.includes('cancel')) || err.errCode === -2)
      const msg = isCancel ? '已取消支付' : (err.message || err.errMsg || '支付失败')
      wx.showToast({ title: msg, icon: 'none' })
    }
  },

  async grantTestAccess() {
    if (this.data.grantingTestAccess || !this.data.isTestEnv) return
    this.setData({ grantingTestAccess: true })
    wx.showLoading({ title: '开通测试权限', mask: true })
    try {
      const now = new Date()
      const vipExpireDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
      const supervisionExpireDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      await cloudApi.updateUser({
        isVip: true,
        isFreeTrial: false,
        vipExpireDate,
        supervisionExpireDate
      })
      const app = getApp()
      if (app.globalData.userInfo) {
        app.globalData.userInfo.isVip = true
        app.globalData.userInfo.isFreeTrial = false
        app.globalData.userInfo.vipExpireDate = vipExpireDate
        app.globalData.userInfo.supervisionExpireDate = supervisionExpireDate
        app.globalData.isVip = true
      }
      await this.loadAccess()
      wx.showToast({ title: '测试督学已开通', icon: 'success' })
      setTimeout(() => {
        this.goPlan()
      }, 300)
    } catch (err) {
      wx.showToast({ title: err.message || '开通失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ grantingTestAccess: false })
    }
  }
})
