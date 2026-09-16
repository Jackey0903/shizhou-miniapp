const cloudApi = require('../../utils/cloudApi')
const { toggledBoolean } = require('../../utils/dataset')

const PLAN_TEMPLATES = [
  {
    code: 'basic_vip_year',
    tag: '基础VIP',
    name: '基础VIP包年',
    price: 19800,
    days: 365,
    supervisionDays: 30,
    virtualProductId: 'sz_basic_vip_year',
    benefits: ['免广告学习', '督学包月服务（30天）']
  },
  {
    code: 'supervision_trial_day',
    tag: '督学试用',
    name: '督学试用1日',
    price: 800,
    days: 365,
    supervisionDays: 1,
    virtualProductId: 'sz_supervision_1d',
    benefits: ['督学试用1天', '赠送1年免广告学习']
  },
  {
    code: 'supervision_month',
    tag: '督学包月',
    name: '督学包月',
    price: 19800,
    days: 365,
    supervisionDays: 30,
    virtualProductId: 'sz_supervision_mon',
    benefits: ['督学包月服务', '赠送1年免广告学习']
  },
  {
    code: 'premium_vip_year',
    tag: '高级VIP',
    name: '高级VIP/督学包年',
    price: 98800,
    days: 365,
    supervisionDays: 365,
    virtualProductId: 'sz_premium_vip_year',
    benefits: ['免广告学习', '免费领取学习资料', '督学包年服务']
  }
]

Page({
  data: {
    templates: PLAN_TEMPLATES,
    templateIndex: 0,
    list: [],
    benefits: PLAN_TEMPLATES[0].benefits.join('\n'),
    loading: false
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    try {
      const [res, diagnostics] = await Promise.all([
        cloudApi.listAdminConfigs('vip_plans'),
        cloudApi.getVipPlanDiagnostics().catch(() => [])
      ])
      const diagnosticMap = {}
      ;(diagnostics || []).forEach((item) => { diagnosticMap[item.code] = item })
      const list = ((res.result && res.result.data) || []).map((item) => {
        const diagnostic = diagnosticMap[item.code] || null
        return {
          ...item,
          benefitText: Array.isArray(item.benefits) && item.benefits.length ? item.benefits.join(' / ') : '未设置',
          frontendVisible: diagnostic ? diagnostic.visible : true,
          frontendProblem: diagnostic ? diagnostic.problem : ''
        }
      })
      // 后台有、前台没有的套餐（例如还没保存过）也要显示出来，否则客户无从下手。
      const missing = (diagnostics || [])
        .filter((item) => !item.exists)
        .map((item) => {
          const template = PLAN_TEMPLATES.find((plan) => plan.code === item.code) || {}
          return {
            _id: `missing:${item.code}`,
            code: item.code,
            tag: template.tag || item.code,
            name: template.name || item.code,
            price: item.expectedPrice,
            days: template.days || 0,
            supervisionDays: template.supervisionDays || 0,
            enabled: false,
            missing: true,
            benefitText: '未设置',
            frontendVisible: false,
            frontendProblem: item.problem
          }
        })
      const merged = list.concat(missing)
      this.setData({ list: merged })
      this.syncBenefits(this.data.templateIndex, merged)
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  /**
   * 一键把某个套餐重写为锁定的正式配置并上线，用于修复金额/道具ID对不上导致前台不显示。
   */
  async repairPlan(e) {
    const code = e.currentTarget.dataset.code
    const template = PLAN_TEMPLATES.find((item) => item.code === code)
    if (!template) return
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '修正并上线',
        content: `会把「${template.name}」的金额、有效期和微信道具ID重写为正式发布配置，并立即上线。权益文案保持不变。`,
        success: (res) => resolve(res.confirm === true),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return

    const current = this.data.list.find((item) => item.code === code && !item.missing)
    this.setData({ loading: true })
    try {
      const res = await cloudApi.saveAdminConfig('vip_plans', {
        id: current ? current._id : '',
        ...template,
        benefits: (current && Array.isArray(current.benefits) && current.benefits.length)
          ? current.benefits
          : template.benefits,
        enabled: true,
        sort: PLAN_TEMPLATES.findIndex((item) => item.code === code) + 1
      })
      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.msg) || '修正失败')
      }
      await this.loadList()
      wx.showToast({ title: '已修正并上线', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '修正失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  syncBenefits(templateIndex, list = this.data.list) {
    const template = PLAN_TEMPLATES[templateIndex]
    const current = list.find((item) => item.code === template.code)
    this.setData({
      templateIndex,
      benefits: (current && current.benefits && current.benefits.length
        ? current.benefits
        : template.benefits).join('\n')
    })
  },

  onTemplateChange(e) {
    this.syncBenefits(Number(e.detail.value))
  },

  onBenefitsInput(e) {
    this.setData({ benefits: e.detail.value })
  },

  async submit() {
    const template = PLAN_TEMPLATES[this.data.templateIndex]
    const current = this.data.list.find((item) => item.code === template.code)
    this.setData({ loading: true })
    try {
      const res = await cloudApi.saveAdminConfig('vip_plans', {
        id: current ? current._id : '',
        ...template,
        benefits: this.data.benefits.split('\n').map((item) => item.trim()).filter(Boolean),
        enabled: current ? current.enabled !== false : true,
        sort: this.data.templateIndex + 1
      })
      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.msg) || '保存失败')
      }
      await this.loadList()
      wx.showToast({ title: '套餐展示已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async toggle(e) {
    try {
      const { id, enabled } = e.currentTarget.dataset
      const res = await cloudApi.toggleAdminConfig('vip_plans', id, toggledBoolean(enabled))
      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.msg) || '操作失败')
      }
      await this.loadList()
      wx.showToast({ title: enabled ? '套餐已下线' : '套餐已上线', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  }
})
