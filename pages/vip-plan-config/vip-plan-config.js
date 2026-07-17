const cloudApi = require('../../utils/cloudApi')

Page({
  data: {
    list: [],
    name: '',
    tag: '',
    code: '',
    price: '',
    days: '',
    supervisionDays: '',
    virtualProductId: '',
    benefits: '',
    loading: false
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    const res = await cloudApi.listAdminConfigs('vip_plans')
    const list = ((res.result && res.result.data) || []).map((item) => ({
      ...item,
      benefitText: item.benefits && item.benefits.length ? item.benefits.join(' / ') : '未设置'
    }))
    this.setData({ list })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  async submit() {
    const { name, tag, code, price } = this.data
    if (!name || !tag || !code || !price) {
      wx.showToast({ title: '请填写套餐名称/标识/code/价格', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await cloudApi.saveAdminConfig('vip_plans', {
        name,
        tag,
        code,
        price: Number(price),
        days: Number(this.data.days || 0),
        supervisionDays: Number(this.data.supervisionDays || 0),
        virtualProductId: this.data.virtualProductId || code,
        benefits: this.data.benefits.split('\n').map((i) => i.trim()).filter(Boolean),
        enabled: true,
        sort: Date.now()
      })
      if (res.result && res.result.code === 0) {
        this.setData({ name: '', tag: '', code: '', price: '', days: '', supervisionDays: '', virtualProductId: '', benefits: '' })
        await this.loadList()
        wx.showToast({ title: '套餐已保存', icon: 'success' })
      }
    } finally {
      this.setData({ loading: false })
    }
  },

  async toggle(e) {
    const { id, enabled } = e.currentTarget.dataset
    const res = await cloudApi.toggleAdminConfig('vip_plans', id, !enabled)
    if (res.result && res.result.code === 0) await this.loadList()
  }
})
