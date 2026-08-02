const cloudApi = require('../../utils/cloudApi')

Page({
  data: {
    fileId: '',
    imageUrl: '',
    generated: false,
    generating: false,
    saving: false
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
      await wx.saveImageToPhotosAlbum({ filePath })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (err) {
      const message = String((err && err.errMsg) || err || '')
      if (message.includes('auth deny') || message.includes('authorize')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许“保存到相册”，再重新保存。',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) wx.openSetting()
          }
        })
      } else if (!message.includes('cancel')) {
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    } finally {
      this.setData({ saving: false })
    }
  },

  onShareAppMessage() {
    return {
      title: '仕舟公考',
      path: '/pages/home/home',
      imageUrl: '/assets/images/logo.webp'
    }
  }
})
