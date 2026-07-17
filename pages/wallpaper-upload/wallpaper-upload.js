const cloudApi = require('../../utils/cloudApi')

Page({
  data: {
    title: '',
    selectedFile: null,
    uploading: false
  },

  onInput(e) {
    this.setData({ title: e.detail.value })
  },

  async chooseImage() {
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album']
      })
      const file = res.tempFiles && res.tempFiles[0]
      if (file) {
        this.setData({
          selectedFile: {
            path: file.tempFilePath,
            name: file.tempFilePath.split('/').pop(),
            preview: file.tempFilePath
          }
        })
      }
    } catch (err) {
      if (!(err && err.errMsg && err.errMsg.includes('cancel'))) {
        wx.showToast({ title: '选择图片失败', icon: 'none' })
      }
    }
  },

  async submit() {
    if (this.data.uploading) return
    if (!this.data.selectedFile || !this.data.selectedFile.path) {
      wx.showToast({ title: '请先选择壁纸图片', icon: 'none' })
      return
    }
    this.setData({ uploading: true })
    wx.showLoading({ title: '上传中', mask: true })
    try {
      const ext = (this.data.selectedFile.path || '').split('.').pop() || 'jpg'
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `wallpapers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
        filePath: this.data.selectedFile.path
      })
      const temp = await wx.cloud.getTempFileURL({ fileList: [uploadRes.fileID] })
      const imageUrl = (temp.fileList && temp.fileList[0] && temp.fileList[0].tempFileURL) || ''
      const res = await cloudApi.uploadWallpapers([{
        title: this.data.title.trim() || '平台壁纸',
        fileId: uploadRes.fileID,
        imageUrl,
        sort: Date.now()
      }])
      if (res.result && res.result.code === 0) {
        this.setData({ title: '', selectedFile: null })
        wx.showToast({ title: '壁纸已上传', icon: 'success' })
      } else {
        throw new Error((res.result && res.result.msg) || '上传失败')
      }
    } catch (err) {
      wx.showToast({ title: err.message || '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ uploading: false })
    }
  }
})
