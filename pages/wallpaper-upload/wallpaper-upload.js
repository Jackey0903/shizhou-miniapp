const cloudApi = require('../../utils/cloudApi')

function normalizeImage(file, index) {
  const path = file.tempFilePath || file.path || ''
  const name = path.split('/').pop() || `壁纸${index + 1}.jpg`
  return {
    path,
    name,
    title: name.replace(/\.[^.]+$/, '') || `壁纸${index + 1}`
  }
}

Page({
  data: {
    files: [],
    uploading: false,
    progressText: '',
    list: []
  },

  async onShow() {
    await this.loadList()
  },

  async chooseImages() {
    try {
      const res = await wx.chooseMedia({
        count: 9,
        mediaType: ['image'],
        sourceType: ['album']
      })
      this.setData({ files: (res.tempFiles || []).map(normalizeImage) })
    } catch (err) {
      if (!String(err && err.errMsg || '').includes('cancel')) {
        wx.showToast({ title: '选择图片失败', icon: 'none' })
      }
    }
  },

  onTitleInput(e) {
    this.setData({ [`files[${e.currentTarget.dataset.index}].title`]: e.detail.value })
  },

  removeFile(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ files: this.data.files.filter((_, itemIndex) => itemIndex !== index) })
  },

  async submit() {
    if (this.data.uploading) return
    if (!this.data.files.length) {
      wx.showToast({ title: '请先选择壁纸图片', icon: 'none' })
      return
    }
    this.setData({ uploading: true, progressText: '准备上传' })
    try {
      await cloudApi.assertAdmin()
      const wallpapers = []
      for (let index = 0; index < this.data.files.length; index += 1) {
        const file = this.data.files[index]
        this.setData({ progressText: `正在上传 ${index + 1}/${this.data.files.length}` })
        const ext = file.path.split('.').pop() || 'jpg'
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `wallpapers/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
          filePath: file.path
        })
        wallpapers.push({
          title: file.title.trim() || `平台壁纸${index + 1}`,
          fileId: uploadRes.fileID,
          imageUrl: '',
          sort: Date.now() + index
        })
      }
      const res = await cloudApi.uploadWallpapers(wallpapers)
      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.msg) || '上传失败')
      }
      this.setData({ files: [], progressText: '' })
      await this.loadList()
      wx.showToast({ title: `已上传${wallpapers.length}张壁纸`, icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '上传失败', icon: 'none' })
    } finally {
      this.setData({ uploading: false, progressText: '' })
    }
  },

  async loadList() {
    try {
      this.setData({ list: await cloudApi.listAdminContent('wallpapers', '', 100) })
    } catch (err) {
      this.setData({ list: [] })
    }
  },

  async toggle(e) {
    const { id, enabled } = e.currentTarget.dataset
    try {
      await cloudApi.toggleAdminContent('wallpapers', id, !enabled)
      await this.loadList()
      wx.showToast({ title: enabled ? '已下线' : '已上线', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  }
})
