const cloudApi = require('../../utils/cloudApi')
const imageSharing = require('../../utils/imageSharing')

Page({
  data: {
    fileId: '',
    imageUrl: '',
    generated: false,
    generating: false,
    saving: false,
    showPrivacyDialog: false,
    privacyContractName: '《仕舟小程序隐私保护指引》'
  },

  async onLoad() {
    try {
      await cloudApi.assertAdmin()
      await this.loadCode()
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  async resolveUrl(fileId) {
    if (!fileId) return ''
    const result = await wx.cloud.getTempFileURL({ fileList: [fileId] })
    return (result.fileList && result.fileList[0] && result.fileList[0].tempFileURL) || fileId
  },

  async loadCode() {
    const record = await cloudApi.getAdminMiniProgramCode()
    if (!record || !record.fileId) return
    const imageUrl = await this.resolveUrl(record.fileId)
    this.setData({ fileId: record.fileId, imageUrl, generated: true })
  },

  async generate() {
    if (this.data.generating) return
    this.setData({ generating: true })
    wx.showLoading({ title: '生成中', mask: true })
    try {
      const record = await cloudApi.generateAdminMiniProgramCode({
        page: 'pages/home/home',
        scene: 'share'
      })
      const imageUrl = await this.resolveUrl(record.fileId)
      this.setData({ fileId: record.fileId, imageUrl, generated: true })
      wx.showToast({ title: '已生成', icon: 'success' })
    } catch (err) {
      wx.showModal({
        title: '生成失败',
        content: err.message || '请确认小程序已有线上版本，并重新部署 adminOperations 云函数。',
        showCancel: false
      })
    } finally {
      wx.hideLoading()
      this.setData({ generating: false })
    }
  },

  preview() {
    if (!this.data.generated || !this.data.imageUrl) return
    wx.previewImage({ urls: [this.data.imageUrl], current: this.data.imageUrl })
  },

  requestPrivacyConsent(filePath, privacyContractName) {
    this._pendingSaveFilePath = filePath
    this.setData({
      showPrivacyDialog: true,
      privacyContractName: privacyContractName || '《仕舟小程序隐私保护指引》'
    })
  },

  recoverAlbumPermission() {
    return imageSharing.recoverAlbumPermission(wx, {
      albumPermissionMessage: '保存小程序码需要“添加到相册”权限。请在设置中开启，返回后将自动继续保存。'
    })
  },

  runSave(filePath) {
    return imageSharing.saveImageWithPermission(filePath, {
      wxApi: wx,
      onPrivacyRequired: (pendingPath, contractName) => this.requestPrivacyConsent(pendingPath, contractName),
      recoverAlbumPermission: () => this.recoverAlbumPermission()
    })
  },

  handleSaveResult(result) {
    if (!result || result.status === 'privacy-required' || result.status === 'cancelled') return
    if (result.status === 'saved') {
      wx.showToast({ title: '已保存到相册', icon: 'success' })
      return
    }
    if (result.status === 'permission-denied') {
      wx.showToast({ title: '未开启相册权限，暂未保存', icon: 'none' })
    }
  },

  async save() {
    if (this.data.saving) return
    if (!this.data.generated || !this.data.imageUrl) {
      wx.showToast({ title: '请先生成正式小程序码', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      let filePath = ''
      if (this.data.fileId) {
        const result = await wx.cloud.downloadFile({ fileID: this.data.fileId })
        filePath = result.tempFilePath
      } else {
        const result = await wx.getImageInfo({ src: this.data.imageUrl })
        filePath = result.path
      }
      const result = await this.runSave(filePath)
      this.handleSaveResult(result)
    } catch (err) {
      const message = err && err.code === 'PRIVACY_SCOPE_NOT_DECLARED'
        ? '相册权限配置尚未生效，请稍后重试'
        : (imageSharing.getErrorMessage(err) || '保存失败')
      if (!imageSharing.isCancelError(err)) wx.showToast({ title: message, icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async handleAgreePrivacyAuthorization() {
    const filePath = this._pendingSaveFilePath
    this._pendingSaveFilePath = ''
    this.setData({ showPrivacyDialog: false, saving: true })
    if (!filePath) {
      this.setData({ saving: false })
      return
    }
    try {
      const result = await this.runSave(filePath)
      this.handleSaveResult(result)
    } catch (error) {
      wx.showToast({ title: imageSharing.getErrorMessage(error) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  handleRejectPrivacyAuthorization() {
    this._pendingSaveFilePath = ''
    this.setData({ showPrivacyDialog: false, saving: false })
  },

  openPrivacyContract() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.navigateTo({ url: '/pages/privacy/privacy' })
      return
    }
    wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: '/pages/privacy/privacy' }) })
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: '仕舟公考',
      path: '/pages/home/home',
      imageUrl: '/assets/images/logo.webp'
    }
  }
})
