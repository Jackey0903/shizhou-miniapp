const cloudApi = require('../../utils/cloudApi')

const PLANS = [
  { code: 'basic_vip_year', label: '基础VIP包年', detail: 'VIP 365天' },
  { code: 'supervision_trial_day', label: '督学试用', detail: 'VIP 365天 + 督学1天' },
  { code: 'supervision_month', label: '督学包月', detail: 'VIP 365天 + 督学30天' },
  { code: 'premium_vip_year', label: '高级VIP/督学包年', detail: 'VIP 365天 + 督学365天' }
]

function formatDate(value) {
  if (!value) return '未开通'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '未开通'
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatUser(user) {
  return {
    ...user,
    vipExpireText: formatDate(user.vipExpireDate),
    supervisionExpireText: formatDate(user.supervisionExpireDate)
  }
}

Page({
  data: {
    plans: PLANS,
    planIndex: 0,
    keyword: '',
    users: [],
    selectedUser: null,
    reason: '',
    searching: false,
    granting: false,
    logs: []
  },

  async onLoad() {
    try {
      await cloudApi.assertAdmin()
      await this.loadLogs()
    } catch (err) {
      wx.showToast({ title: err.message || '无管理员权限', icon: 'none' })
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value })
  },

  onPlanChange(e) {
    this.setData({ planIndex: Number(e.detail.value) })
  },

  async search() {
    const keyword = this.data.keyword.trim()
    if (!keyword) {
      wx.showToast({ title: '请输入手机号或昵称', icon: 'none' })
      return
    }
    this.setData({ searching: true, selectedUser: null })
    try {
      const users = (await cloudApi.searchAdminUsers(keyword)).map(formatUser)
      this.setData({ users })
      if (!users.length) wx.showToast({ title: '未找到用户', icon: 'none' })
    } catch (err) {
      wx.showToast({ title: err.message || '搜索失败', icon: 'none' })
    } finally {
      this.setData({ searching: false })
    }
  },

  selectUser(e) {
    const id = e.currentTarget.dataset.id
    const selectedUser = this.data.users.find((item) => item._id === id) || null
    this.setData({ selectedUser })
  },

  async grant() {
    const user = this.data.selectedUser
    const plan = this.data.plans[this.data.planIndex]
    const reason = this.data.reason.trim()
    if (!user) {
      wx.showToast({ title: '请先选择用户', icon: 'none' })
      return
    }
    if (!reason) {
      wx.showToast({ title: '请填写赠送原因', icon: 'none' })
      return
    }

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认开通权限',
        content: `给“${user.nickName}”开通${plan.label}？有效期会在现有期限后继续累计。`,
        confirmText: '确认开通',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return

    this.setData({ granting: true })
    try {
      const result = await cloudApi.grantAdminUserAccess({
        userId: user._id,
        planCode: plan.code,
        reason
      })
      const updated = formatUser(result.data || user)
      this.setData({
        selectedUser: updated,
        users: this.data.users.map((item) => item._id === updated._id ? updated : item),
        reason: ''
      })
      await this.loadLogs()
      wx.showToast({ title: '权限已开通', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '开通失败', icon: 'none' })
    } finally {
      this.setData({ granting: false })
    }
  },

  async loadLogs() {
    try {
      const logs = (await cloudApi.getAdminGrantLogs()).map((item) => ({
        ...item,
        createdText: formatDate(item.createdAt)
      }))
      this.setData({ logs })
    } catch (err) {
      this.setData({ logs: [] })
    }
  }
})
