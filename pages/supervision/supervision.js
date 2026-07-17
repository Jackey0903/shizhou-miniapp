const cloudApi = require('../../utils/cloudApi')

const DEFAULT_PROFILES = {
  full: {
    displayName: '',
    contact: '',
    examType: '省考',
    targetCity: '',
    examDate: '',
    avgHours: '3-5h',
    dailyPeriods: ['上午'],
    modules: ['常识'],
    detailPlan: ''
  },
  part: {
    displayName: '',
    contact: '',
    examType: '事业单位',
    targetCity: '',
    examDate: '',
    avgHours: '2h以下',
    dailyPeriods: ['晚上'],
    modules: ['言语'],
    detailPlan: ''
  }
}

function mergeProfile(defaultProfile, remoteProfile = {}) {
  return {
    ...defaultProfile,
    ...remoteProfile,
    dailyPeriods: Array.isArray(remoteProfile.dailyPeriods) && remoteProfile.dailyPeriods.length
      ? remoteProfile.dailyPeriods
      : defaultProfile.dailyPeriods,
    modules: Array.isArray(remoteProfile.modules) && remoteProfile.modules.length
      ? remoteProfile.modules
      : defaultProfile.modules,
    targetProvince: remoteProfile.targetProvince || '',
    targetCity: remoteProfile.targetCity || remoteProfile.city || '',
    targetDistrict: remoteProfile.targetDistrict || '',
    targetCityLabel: remoteProfile.targetCityLabel || remoteProfile.targetCity || remoteProfile.city || '',
    avgHours: remoteProfile.avgHours || remoteProfile.studyHours || defaultProfile.avgHours
  }
}

function mergeProfiles(remoteProfiles = {}) {
  return {
    full: mergeProfile(DEFAULT_PROFILES.full, remoteProfiles.full),
    part: mergeProfile(DEFAULT_PROFILES.part, remoteProfiles.part)
  }
}

function buildProfileSummary(profile = {}) {
  const lines = []
  if (profile.examType) lines.push(`考试类型：${profile.examType}`)
  if (profile.targetCityLabel || profile.targetCity) lines.push(`目标省市：${profile.targetCityLabel || profile.targetCity}`)
  if (profile.examDate) lines.push(`计划考试时间：${profile.examDate}`)
  if (profile.avgHours) lines.push(`日均备考时长：${profile.avgHours}`)
  if (profile.dailyPeriods && profile.dailyPeriods.length) lines.push(`学习时段：${profile.dailyPeriods.join(' / ')}`)
  if (profile.modules && profile.modules.length) lines.push(`重点模块：${profile.modules.join(' / ')}`)
  return lines
}

Page({
  data: {
    tabs: [
      { key: 'full', title: '全职备考' },
      { key: 'part', title: '在职备考' }
    ],
    examTypes: ['国考', '省考', '事业单位', '选调生', '其他'],
    hourOptions: ['2h以下', '3-5h', '6-8h', '8h+'],
    periodOptions: ['上午', '下午', '晚上', '碎片化'],
    moduleOptions: ['常识', '数量', '言语', '逻辑', '资料', '申论', '综应', '面试'],
    activeTab: 'full',
    profiles: DEFAULT_PROFILES,
    currentProfile: DEFAULT_PROFILES.full,
    periodChips: [],
    moduleChips: [],
    examTypeIndex: 0,
    hourIndex: 0,
    examDateLabel: '计划考试时间（年月日）',
    regionValue: ['', '', ''],
    profileSummary: [],
    joinedText: '',
    saving: false,
    joining: false,
    leaving: false,
    currentJoinedProfile: null,
    remoteMeta: {
      reminders: {},
      topics: {}
    }
  },

  async onLoad() {
    await this.loadData()
  },

  async onShow() {
    await this.loadMatchState()
  },

  async loadData() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      const remote = await cloudApi.getSupervisionData()
      const profiles = mergeProfiles(remote && remote.profiles ? remote.profiles : {})
      this.setData({
        profiles,
        remoteMeta: {
          reminders: remote && remote.reminders ? remote.reminders : {},
          topics: remote && remote.topics ? remote.topics : {}
        }
      }, () => this.syncView())
      await this.loadMatchState()
    } catch (err) {
      this.syncView()
      wx.showToast({ title: '督学数据加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async loadMatchState() {
    try {
      const res = await cloudApi.getSupervisionMatches(this.data.activeTab)
      const mine = (res.result && res.result.data && res.result.data.mine) || null
      this.setData({
        currentJoinedProfile: mine,
        joinedText: mine ? '已加入匹配池，下一步进入督学开通。' : '填写信息后加入匹配池，再进入督学开通。'
      })
    } catch (err) {
      this.setData({ currentJoinedProfile: null, joinedText: '填写信息后加入匹配池，再进入督学开通。' })
    }
  },

  syncView() {
    const mode = this.data.activeTab
    const currentProfile = mergeProfile(DEFAULT_PROFILES[mode], this.data.profiles[mode] || {})
    const selectedPeriods = new Set(currentProfile.dailyPeriods || [])
    const selectedModules = new Set(currentProfile.modules || [])
    const regionValue = [
      currentProfile.targetProvince || '',
      currentProfile.targetCity || '',
      currentProfile.targetDistrict || ''
    ]
    this.setData({
      currentProfile,
      periodChips: this.data.periodOptions.map((item) => ({ label: item, active: selectedPeriods.has(item) })),
      moduleChips: this.data.moduleOptions.map((item) => ({ label: item, active: selectedModules.has(item) })),
      examTypeIndex: Math.max(0, this.data.examTypes.indexOf(currentProfile.examType || this.data.examTypes[0])),
      hourIndex: Math.max(0, this.data.hourOptions.indexOf(currentProfile.avgHours || this.data.hourOptions[0])),
      examDateLabel: currentProfile.examDate || '计划考试时间（年月日）',
      regionValue,
      profileSummary: buildProfileSummary(currentProfile)
    })
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.key }, async () => {
      this.syncView()
      await this.loadMatchState()
    })
  },

  onProfileInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    const mode = this.data.activeTab
    const profiles = { ...this.data.profiles }
    profiles[mode] = { ...profiles[mode], [field]: value }
    this.setData({ profiles }, () => this.syncView())
  },

  onPickerChange(e) {
    const field = e.currentTarget.dataset.field
    const optionsMap = { examType: this.data.examTypes, avgHours: this.data.hourOptions }
    const options = optionsMap[field] || []
    const value = options[Number(e.detail.value)] || ''
    const mode = this.data.activeTab
    const profiles = { ...this.data.profiles }
    profiles[mode] = { ...profiles[mode], [field]: value }
    this.setData({ profiles }, () => this.syncView())
  },

  onDateChange(e) {
    const value = e.detail.value
    const mode = this.data.activeTab
    const profiles = { ...this.data.profiles }
    profiles[mode] = { ...profiles[mode], examDate: value }
    this.setData({ profiles }, () => this.syncView())
  },

  onRegionChange(e) {
    const values = e.detail.value || []
    const province = values[0] || ''
    const city = values[1] || ''
    const district = values[2] || ''
    const mode = this.data.activeTab
    const profiles = { ...this.data.profiles }
    profiles[mode] = {
      ...profiles[mode],
      targetProvince: province,
      targetCity: city,
      targetDistrict: district,
      targetCityLabel: [province, city].filter(Boolean).join(' ')
    }
    this.setData({ profiles }, () => this.syncView())
  },

  toggleMulti(e) {
    const field = e.currentTarget.dataset.field
    const value = e.currentTarget.dataset.value
    const mode = this.data.activeTab
    const profiles = { ...this.data.profiles }
    const current = new Set(profiles[mode][field] || [])
    if (current.has(value)) current.delete(value)
    else current.add(value)
    profiles[mode] = { ...profiles[mode], [field]: [...current] }
    this.setData({ profiles }, () => this.syncView())
  },

  async saveProfile(showToast = true) {
    const currentProfile = this.data.currentProfile || {}
    if (!currentProfile.displayName) {
      wx.showToast({ title: '请填写对外昵称', icon: 'none' })
      return false
    }
    if (!currentProfile.contact) {
      wx.showToast({ title: '请填写联系方式', icon: 'none' })
      return false
    }
    if (!currentProfile.examType) {
      wx.showToast({ title: '请选择考试类型', icon: 'none' })
      return false
    }
    if (!(currentProfile.targetCityLabel || currentProfile.targetCity)) {
      wx.showToast({ title: '请选择目标省市', icon: 'none' })
      return false
    }
    if (!currentProfile.examDate) {
      wx.showToast({ title: '请选择计划考试时间', icon: 'none' })
      return false
    }
    const profiles = {
      ...this.data.profiles,
      [this.data.activeTab]: currentProfile
    }
    this.setData({ saving: true })
    try {
      const res = await cloudApi.saveSupervisionData({
        profiles,
        reminders: this.data.remoteMeta.reminders || {},
        topics: this.data.remoteMeta.topics || {}
      })
      const success = !!(res && (res.result?.code === undefined || res.result?.code === 0 || !res.errMsg))
      if (success) {
        this.setData({ profiles })
        if (showToast) wx.showToast({ title: '个人信息已保存', icon: 'success' })
        return true
      }
      wx.showToast({ title: '保存失败', icon: 'none' })
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
    return false
  },

  async goSave() {
    await this.saveProfile(true)
  },

  async joinMatch() {
    const saved = await this.saveProfile(false)
    if (!saved) return
    const profile = this.data.currentProfile || {}
    this.setData({ joining: true })
    wx.showLoading({ title: '加入中', mask: true })
    try {
      const res = await cloudApi.joinSupervisionMatch(this.data.activeTab, {
        ...profile,
        city: profile.targetCityLabel || profile.targetCity || '',
        studyHours: profile.avgHours || '',
        candidateType: this.data.activeTab === 'full' ? '全职备考' : '在职备考'
      })
      if (res.result && res.result.code === 0) {
        this.setData({
          currentJoinedProfile: (res.result.data && res.result.data.mine) || null,
          joinedText: '已加入匹配池，正在进入督学开通。'
        })
        wx.showToast({ title: '已加入匹配池', icon: 'success' })
        setTimeout(() => {
          wx.navigateTo({ url: `/pages/supervision-pay/supervision-pay?mode=${this.data.activeTab}` })
        }, 350)
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '加入失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ joining: false })
    }
  },

  async leaveMatch() {
    this.setData({ leaving: true })
    wx.showLoading({ title: '退出中', mask: true })
    try {
      const res = await cloudApi.leaveSupervisionMatch(this.data.activeTab)
      if (res.result && res.result.code === 0) {
        this.setData({
          currentJoinedProfile: null,
          joinedText: '已退出匹配池，可重新填写资料后加入。'
        })
        wx.showToast({ title: '已退出匹配', icon: 'success' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ leaving: false })
    }
  }
})
