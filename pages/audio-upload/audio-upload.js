const cloudApi = require('../../utils/cloudApi')

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
    list: []
  },

  async onShow() {
    try {
      await cloudApi.assertAdmin()
      const [tree, list] = await Promise.all([
        cloudApi.getAdminCourseTree(),
        cloudApi.listAdminContent('audios', '', 100)
      ])
      const categories = tree.filter((item) => item.enabled !== false).map((item) => item.name)
      this.setData({
        categories: categories.length ? categories : CATEGORIES,
        categoryIndex: 0,
        list
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
          sort: Date.now() + index
        })
      }

      const res = await cloudApi.uploadAudios(uploaded)
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: `已上传${res.result.count}个音频`, icon: 'success' })
        this.setData({ files: [], duration: '', progressText: '' })
        this.setData({ list: await cloudApi.listAdminContent('audios', '', 100) })
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
    try {
      await cloudApi.toggleAdminContent('audios', id, !enabled)
      this.setData({ list: await cloudApi.listAdminContent('audios', '', 100) })
      wx.showToast({ title: enabled ? '已下线' : '已上线', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  }
})
