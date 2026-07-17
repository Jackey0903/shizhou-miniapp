const cloudApi = require('../../utils/cloudApi')

Page({
  data: {
    title: '',
    activeDate: '',
    fileId: '',
    imageUrl: '',
    list: [],
    uploading: false,
    loading: false
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    const res = await cloudApi.listAdminConfigs('punch_backgrounds')
    this.setData({ list: (res.result && res.result.data) || [] })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  async chooseImage() {
    if (this.data.uploading) return
    this.setData({ uploading: true })
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album']
      })
      const file = res.tempFiles && res.tempFiles[0]
      if (!file || !file.tempFilePath) throw new Error('未选择图片')
      wx.showLoading({ title: '上传中', mask: true })
      const ext = file.tempFilePath.split('.').pop() || 'jpg'
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `punch-backgrounds/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
        filePath: file.tempFilePath
      })
      const temp = await wx.cloud.getTempFileURL({ fileList: [uploadRes.fileID] })
      const imageUrl = (temp.fileList && temp.fileList[0] && temp.fileList[0].tempFileURL) || ''
      this.setData({ fileId: uploadRes.fileID, imageUrl })
    } catch (err) {
      if (!(err && err.errMsg && err.errMsg.includes('cancel'))) {
        wx.showToast({ title: err.message || '上传失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ uploading: false })
    }
  },

  async submit() {
    if (!this.data.fileId) {
      wx.showToast({ title: '请先上传背景图片', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await cloudApi.saveAdminConfig('punch_backgrounds', {
        title: this.data.title || '今日打卡海报',
        fileId: this.data.fileId,
        imageUrl: this.data.imageUrl,
        activeDate: this.data.activeDate || 'default',
        enabled: true,
        sort: Date.now()
      })
      if (res.result && res.result.code === 0) {
        this.setData({ title: '', activeDate: '', fileId: '', imageUrl: '' })
        await this.loadList()
        wx.showToast({ title: '背景已保存', icon: 'success' })
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
    const res = await cloudApi.toggleAdminConfig('punch_backgrounds', id, !enabled)
    if (res.result && res.result.code === 0) {
      await this.loadList()
    }
  }
})
