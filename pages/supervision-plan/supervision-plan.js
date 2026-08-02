const cloudApi = require('../../utils/cloudApi')

function normalizeReminderList(list = []) {
  return list.map((item) => ({ ...item, type: '微信推送提醒', timeText: item.time || '--:--' }))
}

function formatChineseDate(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function requestSubscribeMessage(templateId) {
  return new Promise((resolve, reject) => {
    if (!wx.requestSubscribeMessage) {
      reject(new Error('当前微信版本不支持订阅消息'))
      return
    }
    wx.requestSubscribeMessage({ tmplIds: [templateId], success: resolve, fail: reject })
  })
}

Page({
  data: {
    mode: 'full',
    supervisorQrCode: '/QRcode.png',
    showSupervisorQrGuide: false,
    reminderTime: '20:00',
    reminderContent: '',
    reminders: [],
    hasReminders: false,
    reminderTemplateId: '',
    reminderTemplateEnabled: false,
    hasSupervision: false,
    supervisionExpireText: '',
  },

  async onLoad(options = {}) {
    const mode = options.mode === 'part' ? 'part' : 'full'
    this.setData({
      mode,
      showSupervisorQrGuide: options.showSupervisorQr === '1'
    })
    const hasAccess = await this.ensureAccess()
    if (!hasAccess) return
    await this.loadData()
    if (this.data.showSupervisorQrGuide) {
      setTimeout(() => {
        wx.showToast({ title: '长按识别二维码添加督学', icon: 'none' })
        this.previewSupervisorQr()
      }, 300)
    }
  },

  async onShow() {
    await this.ensureAccess()
  },

  async ensureAccess() {
    const user = await cloudApi.getCurrentUser().catch(() => null)
    const now = new Date()
    const supervisionExpire = user && user.supervisionExpireDate ? new Date(user.supervisionExpireDate) : null
    const hasSupervision = !!(supervisionExpire && supervisionExpire > now)
    if (!hasSupervision) {
      wx.showToast({ title: '请先开通督学', icon: 'none' })
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/supervision-pay/supervision-pay' })
      }, 300)
      return false
    }
    this.setData({
      hasSupervision,
      supervisionExpireText: hasSupervision ? formatChineseDate(supervisionExpire) : ''
    })
    return true
  },

  async loadData() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      const [remindersRes, reminderConfigRes] = await Promise.all([
        cloudApi.getStudyReminders(this.data.mode),
        cloudApi.getReminderConfig()
      ])
      const reminderList = normalizeReminderList((remindersRes.result && remindersRes.result.data) || [])
      const reminderConfig = (reminderConfigRes.result && reminderConfigRes.result.data) || null
      this.setData({
        reminders: reminderList,
        hasReminders: reminderList.length > 0,
        reminderTemplateId: reminderConfig && reminderConfig.templateId ? reminderConfig.templateId : '',
        reminderTemplateEnabled: !!(reminderConfig && reminderConfig.enabled)
      })
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onReminderInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  async addReminder() {
    if (!this.data.reminderContent) {
      wx.showToast({ title: '请填写提醒内容', icon: 'none' })
      return
    }
    const templateId = this.data.reminderTemplateId
    if (!this.data.reminderTemplateEnabled || !templateId) {
      wx.showToast({ title: '暂未配置提醒模板', icon: 'none' })
      return
    }
    try {
      const subscribeRes = await requestSubscribeMessage(templateId)
      const result = subscribeRes[templateId]
      if (result !== 'accept') {
        const message = result === 'reject' ? '你已拒绝订阅提醒，请重新允许' : `订阅结果：${result || '未接受'}`
        wx.showToast({ title: message, icon: 'none' })
        return
      }
    } catch (err) {
      const message = (err && (err.errMsg || err.message)) || '订阅提醒失败'
      wx.showToast({ title: String(message).slice(0, 30), icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存提醒', mask: true })
    try {
      const res = await cloudApi.saveStudyReminder(this.data.mode, this.data.reminderContent, this.data.reminderTime)
      if (res.result && res.result.code === 0) {
        const reminders = normalizeReminderList(res.result.data || [])
        this.setData({ reminders, hasReminders: reminders.length > 0, reminderContent: '' })
        wx.showToast({ title: '提醒已开启', icon: 'success' })
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '保存提醒失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
    }
  },

  async removeReminder(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showLoading({ title: '删除中', mask: true })
    try {
      const res = await cloudApi.removeStudyReminder(id)
      if (res.result && res.result.code === 0) {
        const reminders = normalizeReminderList(res.result.data || [])
        this.setData({ reminders, hasReminders: reminders.length > 0 })
        wx.showToast({ title: '提醒已删除', icon: 'success' })
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '删除失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
    }
  },

  previewSupervisorQr() {
    wx.previewImage({
      current: this.data.supervisorQrCode,
      urls: [this.data.supervisorQrCode]
    })
  }
})
