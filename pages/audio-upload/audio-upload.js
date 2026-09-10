const cloudApi = require('../../utils/cloudApi')
const { nextEnabled } = require('../../utils/dataset')

const CATEGORIES = ['常识', '数量', '言语', '逻辑', '资料', '申论', '综应', '面试']
const TYPES = ['晨听', '单词', '技巧', '素材']

Page({
  data: {
    categories: CATEGORIES,
    types: TYPES,
    categoryIndex: 0,
    typeIndex: 0,
    duration: '',
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
    try {
      await cloudApi.assertAdmin()
      const [tree] = await Promise.all([
        cloudApi.getAdminCourseTree(),
        this.loadList()
      ])
      const categories = tree.filter((item) => item.enabled !== false).map((item) => item.name)
      this.setData({
        categories: categories.length ? categories : CATEGORIES,
        categoryIndex: 0
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  chooseFiles() {
    wx.chooseMessageFile({
      count: 9,
      type: 'file',
      extension: ['mp3', 'wav', 'm4a'],
      success: (res) => {
        this.setData({ files: res.tempFiles || [] })
      }
    })
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

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) })
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) })
  },

  onDurationInput(e) {
    this.setData({ duration: e.detail.value })
  },

  async submit() {
    if (this.data.uploading) return
    if (!this.data.files.length) {
      wx.showToast({ title: '请先选择音频文件', icon: 'none' })
      return
    }

    this.setData({ uploading: true })
    wx.showLoading({ title: '上传中', mask: true })
    try {
      await cloudApi.assertAdmin()
      const category = this.data.categories[this.data.categoryIndex]
      const type = this.data.types[this.data.typeIndex]
      const uploaded = []
      const baseSort = Date.now()
      for (const [index, file] of this.data.files.entries()) {
        this.setData({ progressText: `正在上传 ${index + 1}/${this.data.files.length}` })
        const ext = (file.path || file.name || '').split('.').pop() || 'mp3'
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `audios/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
          filePath: file.path
        })
        uploaded.push({
          title: (file.name || `音频${index + 1}`).replace(/\.[^.]+$/, ''),
          fileId: uploadRes.fileID,
          category,
          type,
          duration: this.data.duration,
          sort: baseSort + index
        })
      }

      const res = await cloudApi.uploadAudios(uploaded)
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: `已上传${res.result.count}个音频`, icon: 'success' })
        this.setData({ files: [], duration: '', progressText: '' })
        await this.loadList()
      } else {
        throw new Error((res.result && res.result.msg) || '上传失败')
      }
    } catch (err) {
      wx.showToast({ title: err.message || '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ uploading: false, progressText: '' })
    }
  },

  async toggle(e) {
    const { id, enabled } = e.currentTarget.dataset
    const willEnable = nextEnabled(this.data.list, id, enabled)
    try {
      await cloudApi.toggleAdminContent('audios', id, willEnable)
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

  async loadList() {
    // 小程序新版本可能先于云函数上线，旧响应没有 total/ordering 字段，这里必须兜底。
    const detail = (await cloudApi.listAdminContentDetail('audios', this.data.keyword, 500)) || {}
    const items = Array.isArray(detail.items) ? detail.items : []
    const ordering = detail.ordering || {}
    this.setData({
      list: items,
      listTotal: Number(detail.total) || items.length,
      listTruncated: detail.truncated === true,
      orderingByName: ordering.mode === 'name'
    })
  },

  edit(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/content-editor/content-editor?target=audios&id=${encodeURIComponent(id)}` })
  },

  async toggleOrdering() {
    const backToManual = this.data.orderingByName
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: backToManual ? '改回手动顺序' : '按名称排序',
        content: backToManual
          ? '之后按每条音频的“展示顺序”数字排列，可在编辑页逐条调整。'
          : '会按音频名称升序重新排列，并记住这个规则；之后新上传的音频也会自动排到正确位置。',
        success: (res) => resolve(res.confirm === true),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return
    try {
      if (backToManual) {
        await cloudApi.useManualContentOrdering('audios')
      } else {
        await cloudApi.reorderAdminContentByName('audios')
      }
      await this.loadList()
      wx.showToast({ title: backToManual ? '已改回手动顺序' : '已按名称排序', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '排序失败', icon: 'none' })
    }
  }
})
