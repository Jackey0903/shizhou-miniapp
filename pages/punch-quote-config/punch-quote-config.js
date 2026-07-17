const cloudApi = require('../../utils/cloudApi')

Page({
  data: {
    content: '',
    activeDate: '',
    list: [],
    loading: false
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    const res = await cloudApi.listAdminConfigs('punch_quotes')
    this.setData({ list: (res.result && res.result.data) || [] })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  async submit() {
    if (!this.data.content.trim()) {
      wx.showToast({ title: '请填写打卡文案', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await cloudApi.saveAdminConfig('punch_quotes', {
        content: this.data.content.trim(),
        activeDate: this.data.activeDate || 'default',
        enabled: true,
        sort: Date.now()
      })
      if (res.result && res.result.code === 0) {
        this.setData({ content: '', activeDate: '' })
        await this.loadList()
        wx.showToast({ title: '文案已保存', icon: 'success' })
      } else {
        throw new Error((res.result && res.result.msg) || '保存失败')
      }
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async toggle(e) {
    const { id, enabled } = e.currentTarget.dataset
    const res = await cloudApi.toggleAdminConfig('punch_quotes', id, !enabled)
    if (res.result && res.result.code === 0) {
      await this.loadList()
    }
  }
})
