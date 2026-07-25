const cloudApi = require('../../utils/cloudApi')

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
    listLoading: false
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
            sort: Date.now() + index
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
          sort: Date.now()
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
    this.setData({ listLoading: true })
    try {
      const list = await cloudApi.listAdminContent('materials', '', 100)
      this.setData({ list })
    } catch (err) {
      this.setData({ list: [] })
    } finally {
      this.setData({ listLoading: false })
    }
  },

  async toggle(e) {
    const { id, enabled } = e.currentTarget.dataset
    try {
      await cloudApi.toggleAdminContent('materials', id, !enabled)
      await this.loadList()
      wx.showToast({ title: enabled ? '已下线' : '已上线', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  }
})
