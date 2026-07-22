const cloudApi = require('../../utils/cloudApi')
const virtualPayment = require('../../utils/virtualPayment')
const auth = require('../../utils/auth')

const VIP_PLAN_CODES = ['basic_vip_year', 'premium_vip_year']

function normalizeBenefits(benefits) {
  return (Array.isArray(benefits) ? benefits : []).filter((item) => !String(item).includes('免费领取学习资料'))
}

function normalizeVipPlan(item) {
  return {
    ...item,
    title: item.name || item.tag || 'VIP套餐',
    priceLabel: `¥${((item.price || 0) / 100).toFixed(item.price % 100 === 0 ? 0 : 2)}`,
    benefits: normalizeBenefits(item.benefits)
  }
}

Page({
  data: {
    sel: 0,
    plans: [],
    currentPlan: null,
    entryMode: 'full',
    fromSupervision: false
  },

  async onLoad(options = {}) {
    this.setData({
      entryMode: options.mode === 'part' ? 'part' : 'full',
      fromSupervision: options.from === 'supervision'
    })
    await this.loadPlans()
  },

  async onShow() {
    await this.loadPlans()
  },

  async loadPlans() {
    try {
      const plans = await cloudApi.getVipPlans()
      const sourcePlans = plans.filter((item) => VIP_PLAN_CODES.includes(item.code))
      const normalized = sourcePlans.map(normalizeVipPlan)
      const currentIndex = Math.max(0, Math.min(this.data.sel, normalized.length - 1))
      this.setData({
        plans: normalized,
        sel: currentIndex,
        currentPlan: normalized[currentIndex] || normalized[0] || null
      })
    } catch (err) {
      console.error('加载VIP套餐失败', err)
      this.setData({ plans: [], currentPlan: null, sel: 0 })
      wx.showToast({ title: '套餐加载失败，请稍后重试', icon: 'none' })
    }
  },

  select(e) {
    const sel = Number(e.currentTarget.dataset.i) || 0
    this.setData({
      sel,
      currentPlan: this.data.plans[sel] || this.data.currentPlan
    })
  },

  async buyVip() {
    const plan = this.data.currentPlan
    let outTradeNo = ''
    if (!plan) {
      wx.showToast({ title: '暂无可购买套餐', icon: 'none' })
      return
    }
    const canContinue = await auth.requireLogin('开通会员前请先登录账号，登录后会自动回到当前购买页。')
    if (!canContinue) return

    wx.showLoading({ title: '创建订单...', mask: true })
    try {
      const res = await virtualPayment.createOrder(plan.code)
      const result = res && res.result
      if (!result || result.code !== 0) {
        throw new Error((result && result.msg) || '创建订单失败，请稍后重试')
      }

      const orderData = result.data || {}
      const payment = orderData.payment
      outTradeNo = orderData.outTradeNo || ''
      if (!payment) {
        throw new Error('未获取到支付参数')
      }
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
          content: '支付已发起，系统正在同步结果。请稍后到“我的订单”查看状态；如已扣款，权益会自动发放。',
          showCancel: false,
          success: () => {
            wx.navigateTo({ url: '/pages/order-center/order-center' })
          }
        })
        return
      }

      const latestUser = await cloudApi.getCurrentUser().catch(() => null)
      const expire = latestUser && latestUser.vipExpireDate ? latestUser.vipExpireDate : order.vipExpireDate
      const dateStr = expire ? new Date(expire).toLocaleDateString('zh-CN') : ''
      const app = getApp()
      if (app.globalData.userInfo) {
        app.globalData.userInfo.isVip = true
        app.globalData.userInfo.vipExpireDate = expire
        if (latestUser && latestUser.supervisionExpireDate) {
          app.globalData.userInfo.supervisionExpireDate = latestUser.supervisionExpireDate
        }
        app.globalData.isVip = true
        wx.setStorageSync('userInfo', app.globalData.userInfo)
      }
      wx.showModal({
        title: '支付成功',
        content: `权益已开通，过期时间：${dateStr}`,
        showCancel: false,
        success: () => {
          if (Number(plan.supervisionDays || 0) > 0) {
            wx.navigateTo({ url: `/pages/supervision-plan/supervision-plan?mode=${this.data.entryMode}&showSupervisorQr=1` })
          }
        }
      })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      await virtualPayment.reportPaymentError(outTradeNo, err).catch(() => null)
      const msg = virtualPayment.getPaymentErrorMessage(err)
      wx.showToast({ title: msg, icon: 'none' })
    }
  }
})
