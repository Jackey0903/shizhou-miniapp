const cloudApi = require('../../utils/cloudApi')

Page({
  data: {
    id: '',
    templateId: 'Jtg_v3OpDQxTi1hInK9LkHNpTnbMd4joPGJgDtuMkpw',
    pagePath: 'pages/supervision-plan/supervision-plan',
    thingKey: 'thing2',
    timeKey: 'time3',
    remarkKey: 'thing4',
    titlePrefix: '学习提醒',
    miniprogramState: 'formal',
    enabled: true,
    remark: '默认使用自习完成通知模板作为学习提醒',
    loading: false,
    dispatching: false,
    current: null
  },

  onShow() {
    this.loadConfig()
  },

  async loadConfig() {
    const res = await cloudApi.listAdminConfigs('notification_settings')
    const list = (res.result && res.result.data) || []
    const current = list.find((item) => item.key === 'study_reminder') || list[0] || null
    if (!current) return
    this.setData({
      current,
      id: current._id || '',
      templateId: current.templateId || 'Jtg_v3OpDQxTi1hInK9LkHNpTnbMd4joPGJgDtuMkpw',
      pagePath: current.page || 'pages/supervision-plan/supervision-plan',
      thingKey: current.thingKey || 'thing2',
      timeKey: current.timeKey || 'time3',
      remarkKey: current.remarkKey || 'thing4',
      titlePrefix: current.titlePrefix || '学习提醒',
      miniprogramState: current.miniprogramState || 'formal',
      enabled: !!current.enabled,
      remark: current.remark || '默认使用自习完成通知模板作为学习提醒'
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onSwitch(e) {
    this.setData({ enabled: e.detail.value })
  },

  async submit() {
    if (!this.data.templateId) {
      wx.showToast({ title: '请填写模板ID', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await cloudApi.saveAdminConfig('notification_settings', {
        id: this.data.id,
        key: 'study_reminder',
        name: '学习提醒模板',
        templateId: this.data.templateId,
        page: this.data.pagePath,
        thingKey: this.data.thingKey,
        timeKey: this.data.timeKey,
        remarkKey: this.data.remarkKey,
        titlePrefix: this.data.titlePrefix,
        miniprogramState: this.data.miniprogramState,
        enabled: this.data.enabled,
        sort: 1,
        remark: this.data.remark
      })
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '提醒配置已保存', icon: 'success' })
        await this.loadConfig()
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
      }
    } finally {
      this.setData({ loading: false })
    }
  },

  async dispatchNow() {
    this.setData({ dispatching: true })
    try {
      const res = await cloudApi.dispatchStudyReminders(20)
      const result = res.result || {}
      if (result.code !== 0) {
        throw new Error(result.msg || '派发失败')
      }
      wx.showModal({
        title: '派发完成',
        content: `已发送 ${result.sent || 0} 条，失败 ${result.failed || 0} 条。`,
        showCancel: false
      })
    } catch (err) {
      wx.showToast({ title: err.message || '派发失败', icon: 'none' })
    } finally {
      this.setData({ dispatching: false })
    }
  }
})
