const cloudApi = require('../../utils/cloudApi')
const { nextEnabled } = require('../../utils/dataset')

const TYPES = [
  { key: 'document', label: '文档' },
  { key: 'audio', label: '音频' },
  { key: 'image', label: '图片' }
]

function normalizeFile(file, index) {
  const path = file.tempFilePath || file.path || ''
  const name = file.name || path.split('/').pop() || `资料${index + 1}`
  return {
    path,
    name,
    title: name.replace(/\.[^.]+$/, ''),
    coverPath: '',
    coverPreview: '',
    preview: path
  }
}

Page({
  data: {
    types: TYPES,
    typeIndex: 0,
    description: '',
    linkUrl: '',
    linkTitle: '',
    files: [],
    uploading: false,
    progressText: '',
    list: [],
    listLoading: false,
    keyword: '',
    listTotal: 0,
    listTruncated: false,
    orderingByName: false
  },

  async onShow() {
    await this.loadList()
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value), files: [] })
  },

  async chooseFiles() {
    const type = TYPES[this.data.typeIndex].key
    try {
      let selected = []
      if (type === 'image') {
        const res = await wx.chooseMedia({
          count: 9,
          mediaType: ['image'],
          sourceType: ['album']
        })
        selected = res.tempFiles || []
      } else {
        const extensions = type === 'audio'
          ? ['mp3', 'wav', 'm4a']
          : ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']
        const res = await wx.chooseMessageFile({
          count: 9,
          type: 'file',
          extension: extensions
        })
        selected = res.tempFiles || []
      }
      this.setData({ files: selected.map(normalizeFile) })
    } catch (err) {
      if (!String(err && err.errMsg || '').includes('cancel')) {
        wx.showToast({ title: '选择文件失败', icon: 'none' })
      }
    }
  },

  onFileTitleInput(e) {
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

  async chooseCovers() {
    if (!this.data.files.length) {
      wx.showToast({ title: '请先选择资料文件', icon: 'none' })
      return
    }
    try {
      const res = await wx.chooseMedia({
        count: Math.min(9, this.data.files.length),
        mediaType: ['image'],
        sourceType: ['album']
      })
      const covers = res.tempFiles || []
      const files = this.data.files.map((file, index) => {
        const cover = covers[index]
        return cover
          ? { ...file, coverPath: cover.tempFilePath, coverPreview: cover.tempFilePath }
          : file
      })
      this.setData({ files })
    } catch (err) {
      if (!String(err && err.errMsg || '').includes('cancel')) {
        wx.showToast({ title: '选择封面失败', icon: 'none' })
      }
    }
  },

  async uploadCloudFile(path, folder, index) {
    const ext = String(path || '').split('.').pop() || 'dat'
    return wx.cloud.uploadFile({
      cloudPath: `${folder}/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
      filePath: path
    })
  },

  async submit() {
    if (this.data.uploading) return
    const type = TYPES[this.data.typeIndex].key
    const linkUrl = this.data.linkUrl.trim()
    if (!this.data.files.length && !linkUrl) {
      wx.showToast({ title: '请选择文件或填写HTTPS链接', icon: 'none' })
      return
    }
    if (linkUrl && !/^https:\/\//i.test(linkUrl)) {
      wx.showToast({ title: '外部链接必须使用HTTPS', icon: 'none' })
      return
    }

    this.setData({ uploading: true, progressText: '准备上传' })
    try {
      await cloudApi.assertAdmin()
      const materials = []
      const baseSort = Date.now()
      if (this.data.files.length) {
        for (let index = 0; index < this.data.files.length; index += 1) {
          const file = this.data.files[index]
          this.setData({ progressText: `正在上传 ${index + 1}/${this.data.files.length}` })
          const uploaded = await this.uploadCloudFile(file.path, `materials/${type}`, index)
          let coverFileId = ''
          if (file.coverPath) {
            const cover = await this.uploadCloudFile(file.coverPath, 'materials/covers', index)
            coverFileId = cover.fileID
          } else if (type === 'image') {
            coverFileId = uploaded.fileID
          }
          materials.push({
            name: file.title.trim() || file.name.replace(/\.[^.]+$/, ''),
            description: this.data.description.trim(),
            type,
            accessType: 'coin',
            coinCost: 10,
            fileId: uploaded.fileID,
            fileUrl: '',
            linkUrl: '',
            coverFileId,
            coverUrl: '',
            imageUrl: '',
            sort: baseSort + index
          })
        }
      } else {
        materials.push({
          name: this.data.linkTitle.trim() || '外部学习资料',
          description: this.data.description.trim(),
          type,
          accessType: 'coin',
          coinCost: 10,
          fileId: '',
          fileUrl: linkUrl,
          linkUrl,
          coverFileId: '',
          coverUrl: '',
          imageUrl: '',
          sort: baseSort
        })
      }

      const res = await cloudApi.uploadMaterials(materials)
      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.msg) || '上传失败')
      }
      this.setData({
        description: '',
        linkUrl: '',
        linkTitle: '',
        files: [],
        progressText: ''
      })
      await this.loadList()
      wx.showToast({ title: `已上传${materials.length}份资料`, icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '上传失败', icon: 'none' })
    } finally {
      this.setData({ uploading: false, progressText: '' })
    }
  },

  async loadList() {
    // 小程序新版本可能先于云函数上线，旧响应没有 total/ordering 字段，这里必须兜底。
    const detail = (await cloudApi.listAdminContentDetail('materials', this.data.keyword, 500)) || {}
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
      await cloudApi.toggleAdminContent('materials', id, willEnable)
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
    if (id) wx.navigateTo({ url: `/pages/content-editor/content-editor?target=materials&id=${encodeURIComponent(id)}` })
  },

  async toggleOrdering() {
    const backToManual = this.data.orderingByName
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: backToManual ? '改回手动顺序' : '按名称排序',
        content: backToManual
          ? '之后按每条资料的“展示顺序”数字排列，可在编辑页逐条调整。'
          : '会按资料名称升序重新排列，并记住这个规则；之后新上传的资料也会自动排到正确位置。',
        success: (res) => resolve(res.confirm === true),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return
    try {
      if (backToManual) {
        await cloudApi.useManualContentOrdering('materials')
      } else {
        await cloudApi.reorderAdminContentByName('materials')
      }
      await this.loadList()
      wx.showToast({ title: backToManual ? '已改回手动顺序' : '已按名称排序', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '排序失败', icon: 'none' })
    }
  }
})
