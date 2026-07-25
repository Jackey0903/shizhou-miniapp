const cloudApi = require('../../utils/cloudApi')

const PLAN_TEMPLATES = [
  {
    code: 'basic_vip_year',
    tag: '基础VIP',
    name: '基础VIP包年',
    price: 19800,
    days: 365,
    supervisionDays: 0,
    virtualProductId: 'sz_basic_vip_year',
    benefits: ['免广告学习', '免费领取学习资料']
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
      const res = await cloudApi.listAdminConfigs('vip_plans')
      const list = ((res.result && res.result.data) || []).map((item) => ({
        ...item,
        benefitText: Array.isArray(item.benefits) && item.benefits.length ? item.benefits.join(' / ') : '未设置'
      }))
      this.setData({ list })
      this.syncBenefits(this.data.templateIndex, list)
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
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
      const res = await cloudApi.toggleAdminConfig('vip_plans', id, !enabled)
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
