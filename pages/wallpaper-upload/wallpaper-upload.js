const cloudApi = require('../../utils/cloudApi')
const { nextEnabled } = require('../../utils/dataset')

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
    list: [],
    keyword: '',
    listTotal: 0,
    listTruncated: false,
    orderingByName: false
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

  moveFile(e) {
    const index = Number(e.currentTarget.dataset.index)
    const direction = Number(e.currentTarget.dataset.direction)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= this.data.files.length) return
    const files = this.data.files.slice()
    const current = files[index]
    files[index] = files[targetIndex]
    files[targetIndex] = current
    this.setData({ files })
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
      const baseSort = Date.now()
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
          sort: baseSort + index
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
    // 小程序新版本可能先于云函数上线，旧响应没有 total/ordering 字段，这里必须兜底。
    const detail = (await cloudApi.listAdminContentDetail('wallpapers', this.data.keyword, 500)) || {}
    const items = Array.isArray(detail.items) ? detail.items : []
    const ordering = detail.ordering || {}
    this.setData({
      list: items,
      listTotal: Number(detail.total) || items.length,
      listTruncated: detail.truncated === true,
      orderingByName: ordering.mode === 'name'
    })
  },

  async toggle(e) {
    const { id, enabled } = e.currentTarget.dataset
    const willEnable = nextEnabled(this.data.list, id, enabled)
    try {
      await cloudApi.toggleAdminContent('wallpapers', id, willEnable)
      await this.loadList()
      wx.showToast({ title: willEnable ? '已上线' : '已下线', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || '' })
  },

  async searchList() {
    await this.loadList()
  },

  edit(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/content-editor/content-editor?target=wallpapers&id=${encodeURIComponent(id)}` })
  },

  async toggleOrdering() {
    const backToManual = this.data.orderingByName
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: backToManual ? '改回手动顺序' : '按名称排序',
        content: backToManual
          ? '之后按每条壁纸的“展示顺序”数字排列，可在编辑页逐条调整。'
          : '会按壁纸名称升序重新排列，并记住这个规则；之后新上传的壁纸也会自动排到正确位置。',
        success: (res) => resolve(res.confirm === true),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return
    try {
      if (backToManual) {
        await cloudApi.useManualContentOrdering('wallpapers')
      } else {
        await cloudApi.reorderAdminContentByName('wallpapers')
      }
      await this.loadList()
      wx.showToast({ title: backToManual ? '已改回手动顺序' : '已按名称排序', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '排序失败', icon: 'none' })
    }
  }
})
