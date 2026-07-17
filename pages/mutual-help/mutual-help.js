const cloudApi = require('../../utils/cloudApi')

const EMPTY_FORM = {
  title: '',
  category: '',
  content: '',
  answer: ''
}

Page({
  data: {
    tabs: [
      { key: 'approved', title: '互助题库' },
      { key: 'mine', title: '我的投稿' },
      { key: 'review', title: '审核台' }
    ],
    activeTab: 'approved',
    approvedQuestions: [],
    myQuestions: [],
    pendingQuestions: [],
    isAdmin: false,
    loading: true,
    showComposer: false,
    submitting: false,
    form: { ...EMPTY_FORM }
  },

  async onLoad() {
    await this.loadDashboard()
  },

  async onPullDownRefresh() {
    await this.loadDashboard()
    wx.stopPullDownRefresh()
  },

  async loadDashboard() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      const res = await cloudApi.getMutualHelpDashboard()
      if (res.result.code !== 0) {
        throw new Error(res.result.msg || '加载失败')
      }
      const data = res.result.data || {}
      this.setData({
        approvedQuestions: data.approved || [],
        myQuestions: data.mine || [],
        pendingQuestions: data.pending || [],
        isAdmin: !!data.isAdmin,
        loading: false
      })
      if (!data.isAdmin && this.data.activeTab === 'review') {
        this.setData({ activeTab: 'approved' })
      }
    } catch (err) {
      console.error('加载互助板块失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  switchTab(e) {
    const { key } = e.currentTarget.dataset
    if (key === 'review' && !this.data.isAdmin) {
      return
    }
    this.setData({ activeTab: key })
  },

  openComposer() {
    this.setData({ showComposer: true })
  },

  closeComposer() {
    if (this.data.submitting) return
    this.setData({ showComposer: false, form: { ...EMPTY_FORM } })
  },

  onFormInput(e) {
    const { field } = e.currentTarget.dataset
    const value = e.detail.value
    this.setData({
      form: {
        ...this.data.form,
        [field]: value
      }
    })
  },

  async submitQuestion() {
    if (this.data.submitting) return
    const payload = {
      title: (this.data.form.title || '').trim(),
      category: (this.data.form.category || '').trim(),
      content: (this.data.form.content || '').trim(),
      answer: (this.data.form.answer || '').trim()
    }

    if (!payload.title || !payload.content || !payload.answer) {
      wx.showToast({ title: '标题、题干、答案必填', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      const res = await cloudApi.uploadMutualQuestion(payload)
      if (res.result.code !== 0) {
        throw new Error(res.result.msg || '提交失败')
      }
      const data = res.result.data || {}
      this.setData({
        approvedQuestions: data.approved || this.data.approvedQuestions,
        myQuestions: data.mine || this.data.myQuestions,
        pendingQuestions: data.pending || this.data.pendingQuestions,
        isAdmin: !!data.isAdmin,
        showComposer: false,
        form: { ...EMPTY_FORM },
        activeTab: 'mine'
      })
      wx.showToast({ title: '投稿已提交审核', icon: 'success' })
    } catch (err) {
      console.error('提交互助题失败', err)
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  },

  async reviewQuestion(e) {
    const { id, status } = e.currentTarget.dataset
    wx.showLoading({ title: status === 'approved' ? '通过中' : '驳回中', mask: true })
    try {
      const res = await cloudApi.reviewMutualQuestion(id, status)
      if (res.result.code !== 0) {
        throw new Error(res.result.msg || '审核失败')
      }
      const data = res.result.data || {}
      this.setData({
        approvedQuestions: data.approved || [],
        myQuestions: data.mine || [],
        pendingQuestions: data.pending || [],
        isAdmin: !!data.isAdmin
      })
      wx.showToast({ title: status === 'approved' ? '已通过' : '已驳回', icon: 'success' })
    } catch (err) {
      console.error('审核互助题失败', err)
      wx.showToast({ title: err.message || '审核失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  getStatusText(status) {
    return {
      pending: '待审核',
      approved: '已通过',
      rejected: '未通过'
    }[status] || '未知状态'
  }
})
