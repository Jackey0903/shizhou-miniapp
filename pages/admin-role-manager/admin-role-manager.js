const cloudApi = require('../../utils/cloudApi')

const PAGE_SIZE = 20

function formatDate(value) {
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return '暂无登录记录'
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatUser(user = {}) {
  return {
    ...user,
    nickName: user.nickName || '未设置昵称',
    roleLabel: user.isSuperAdmin ? '最高管理员' : (user.isAdmin ? '管理员' : '普通用户'),
    identityHint: user.phone ? `手机号：${user.phone}` : `用户ID：${user._id || ''}`,
    lastActiveLabel: `最近登录：${formatDate(user.lastLoginAt || user.createdAt)}`
  }
}

Page({
  data: {
    authorized: false,
    loading: true,
    loadingUsers: false,
    searching: false,
    operating: false,
    activeTab: 'users',
    keyword: '',
    searchMode: false,
    searchResultCount: 0,
    administrators: [],
    users: [],
    userPage: 0,
    userTotal: 0,
    hasMore: false,
    selectedUser: null
  },

  async onLoad() {
    try {
      const identity = await cloudApi.getAdminIdentity()
      if (!identity.current || !identity.current.isSuperAdmin) throw new Error('仅最高管理员可管理用户和管理员')
      this.setData({ authorized: true })
      await Promise.all([this.loadAdministrators(), this.loadUsers(true)])
    } catch (err) {
      wx.showModal({
        title: '无操作权限',
        content: err.message || '仅最高管理员可管理用户和管理员',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  async onPullDownRefresh() {
    try {
      if (!this.data.authorized) return
      this.setData({ keyword: '', searchMode: false, selectedUser: null })
      await Promise.all([this.loadAdministrators(), this.loadUsers(true)])
    } catch (err) {
      wx.showToast({ title: err.message || '刷新失败', icon: 'none' })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab, selectedUser: null })
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  async loadAdministrators() {
    const administrators = (await cloudApi.getAdministrators()).map(formatUser)
    this.setData({ administrators })
  },

  async loadUsers(reset = false) {
    if (this.data.loadingUsers) return
    const page = reset ? 1 : this.data.userPage + 1
    this.setData({ loadingUsers: true })
    try {
      const result = await cloudApi.getAdminUsers(page, PAGE_SIZE)
      const incoming = (result.items || []).map(formatUser)
      this.setData({
        users: reset ? incoming : this.data.users.concat(incoming),
        userPage: result.page || page,
        userTotal: result.total || 0,
        hasMore: !!result.hasMore,
        searchMode: false,
        searchResultCount: 0,
        selectedUser: null
      })
    } finally {
      this.setData({ loadingUsers: false })
    }
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingUsers || this.data.searchMode) return
    try {
      await this.loadUsers(false)
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  async search() {
    const keyword = this.data.keyword.trim()
    if (!keyword) {
      await this.clearSearch()
      return
    }
    this.setData({ searching: true, selectedUser: null, activeTab: 'users' })
    try {
      const users = (await cloudApi.searchAdminUsers(keyword)).map(formatUser)
      this.setData({
        users,
        searchMode: true,
        searchResultCount: users.length,
        hasMore: false
      })
      if (!users.length) wx.showToast({ title: '未找到用户，请让对方先登录并绑定手机号', icon: 'none' })
    } catch (err) {
      wx.showToast({ title: err.message || '搜索失败', icon: 'none' })
    } finally {
      this.setData({ searching: false })
    }
  },

  async clearSearch() {
    this.setData({ keyword: '', searchMode: false, selectedUser: null })
    try {
      await this.loadUsers(true)
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  selectUser(e) {
    const id = e.currentTarget.dataset.id
    const source = e.currentTarget.dataset.source === 'administrators'
      ? this.data.administrators
      : this.data.users
    const selectedUser = source.find((item) => item._id === id) || null
    this.setData({ selectedUser })
  },

  async setAdmin(e) {
    const user = this.data.selectedUser
    const enabled = e.currentTarget.dataset.enabled === 'true'
    if (!user || user.isSuperAdmin) return
    const confirmed = await this.confirm(
      enabled ? '设为管理员' : '取消管理员',
      enabled
        ? `确认授予“${user.nickName}”全部日常运营权限？`
        : `确认取消“${user.nickName}”的管理员权限？`
    )
    if (!confirmed) return

    this.setData({ operating: true })
    try {
      const result = await cloudApi.setAdministrator(user._id, enabled)
      const updated = formatUser(result.data || { ...user, isAdmin: enabled })
      this.setData({
        selectedUser: updated,
        users: this.data.users.map((item) => item._id === updated._id ? updated : item)
      })
      await this.loadAdministrators()
      wx.showToast({ title: result.msg || '设置成功', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '设置失败', icon: 'none' })
    } finally {
      this.setData({ operating: false })
    }
  },

  async transferSuperAdmin() {
    const user = this.data.selectedUser
    if (!user || user.isSuperAdmin) return
    const confirmed = await this.confirm(
      '移交最高管理员',
      `确认把全部最高权限移交给“${user.nickName}”？移交后你将变为普通管理员。`,
      '确认移交'
    )
    if (!confirmed) return

    this.setData({ operating: true })
    try {
      await cloudApi.transferSuperAdministrator(user._id)
      wx.showModal({
        title: '移交成功',
        content: '你已变为普通管理员，新的最高管理员可继续管理管理员。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    } catch (err) {
      wx.showToast({ title: err.message || '移交失败', icon: 'none' })
    } finally {
      this.setData({ operating: false })
    }
  },

  confirm(title, content, confirmText = '确认') {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        content,
        confirmText,
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
  }
})
