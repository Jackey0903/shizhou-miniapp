const cloudApi = require('../../utils/cloudApi')

const DEFAULT_FORM = {
  category: '',
  name: '',
  series: '基础题库',
  description: '',
  isLocked: false
}

Page({
  data: {
    loading: true,
    hasAccess: false,
    saving: false,
    form: { ...DEFAULT_FORM }
  },

  async onLoad() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      const user = await cloudApi.getCurrentUser()
      const hasAccess = !!(user && (user.isAdmin === true || user.role === 'admin'))
      this.setData({ loading: false, hasAccess })
    } catch (err) {
      console.error('初始化题库页失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset
    this.setData({
      form: {
        ...this.data.form,
        [field]: e.detail.value
      }
    })
  },

  onLockChange(e) {
    this.setData({
      form: {
        ...this.data.form,
        isLocked: !!e.detail.value.length
      }
    })
  },

  async submitCourse() {
    if (this.data.saving || !this.data.hasAccess) return
    const payload = {
      category: (this.data.form.category || '').trim(),
      name: (this.data.form.name || '').trim(),
      series: (this.data.form.series || '').trim(),
      description: (this.data.form.description || '').trim(),
      isLocked: this.data.form.isLocked
    }

    if (!payload.category) {
      wx.showToast({ title: '请填写科目名称', icon: 'none' })
      return
    }
    if (!payload.name) {
      wx.showToast({ title: '请填写题库名称', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      const res = await cloudApi.createCourse(payload)
      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.msg) || '创建失败')
      }
      wx.showToast({ title: '题库创建成功', icon: 'success' })
      this.setData({ form: { ...DEFAULT_FORM } })
    } catch (err) {
      console.error('创建题库失败', err)
      wx.showToast({ title: err.message || '创建失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ saving: false })
    }
  }
})
