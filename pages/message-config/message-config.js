const cloudApi = require('../../utils/cloudApi')

const SCOPE_OPTIONS = [
  { key: 'all', label: '全部用户' },
  { key: 'vip', label: 'VIP用户' },
  { key: 'supervision', label: '督学用户' },
  { key: 'new', label: '新用户' }
]

Page({
  data: {
    scopeOptions: SCOPE_OPTIONS,
    scopeIndex: 0,
    list: [],
    title: '',
    content: '',
    scope: 'all',
    icon: '📢',
    loading: false
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    const res = await cloudApi.listAdminConfigs('messages')
    this.setData({ list: (res.result && res.result.data) || [] })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onScopeChange(e) {
    const scopeIndex = Number(e.detail.value)
    this.setData({
      scopeIndex,
      scope: SCOPE_OPTIONS[scopeIndex].key
    })
  },

  async submit() {
    if (!this.data.title || !this.data.content) {
      wx.showToast({ title: '请填写标题和内容', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await cloudApi.saveAdminConfig('messages', {
        title: this.data.title,
        content: this.data.content,
        scope: this.data.scope,
        icon: this.data.icon,
        enabled: true,
        sort: Date.now()
      })
      if (res.result && res.result.code === 0) {
        this.setData({ title: '', content: '', scope: 'all', scopeIndex: 0, icon: '📢' })
        await this.loadList()
        wx.showToast({ title: '消息已发布', icon: 'success' })
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
      }
    } catch (err) {
      wx.showToast({ title: err.message || '发布失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async toggle(e) {
    try {
      const { id, enabled } = e.currentTarget.dataset
      const res = await cloudApi.toggleAdminConfig('messages', id, !enabled)
      if (res.result && res.result.code === 0) await this.loadList()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  }
})
