const cloudApi = require('../../utils/cloudApi')

const MATERIAL_TYPES = [
  { key: 'document', label: '文档' },
  { key: 'audio', label: '音频' },
  { key: 'image', label: '图片' }
]
const TARGETS = {
  audios: { label: '编辑音频', fileLabel: '替换音频文件' },
  materials: { label: '编辑资料', fileLabel: '替换资料文件' },
  wallpapers: { label: '编辑壁纸', fileLabel: '替换壁纸图片' }
}

function materialTypeIndex(type) {
  const index = MATERIAL_TYPES.findIndex((item) => item.key === type)
  return index < 0 ? 0 : index
}

function normalizeForm(target, item = {}) {
  const form = {
    id: item._id || '',
    title: item.title || '',
    name: item.name || '',
    description: item.description || '',
    category: item.category || '',
    type: item.type || (target === 'wallpapers' ? 'default' : 'document'),
    duration: item.duration || '',
    fileId: item.fileId || '',
    fileUrl: item.fileUrl || '',
    linkUrl: item.linkUrl || '',
    coverFileId: item.coverFileId || '',
    coverUrl: item.coverUrl || '',
    imageUrl: item.imageUrl || '',
    sort: String(item.sort === undefined || item.sort === null ? '' : item.sort)
  }
  return { form, materialTypeIndex: materialTypeIndex(form.type) }
}

function getFileName(path = '') {
  return String(path || '').split('/').pop() || ''
}

Page({
  data: {
    target: '',
    targetLabel: '',
    fileLabel: '',
    materialTypes: MATERIAL_TYPES,
    materialTypeIndex: 0,
    form: normalizeForm('', {}).form,
    loading: true,
    saving: false,
    replacing: false,
    replacementName: ''
  },

  async onLoad(options = {}) {
    const target = String(options.target || '')
    const id = String(options.id || '')
    const meta = TARGETS[target]
    if (!meta || !id) {
      wx.showToast({ title: '内容参数无效', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 300)
      return
    }
    this.setData({ target, targetLabel: meta.label, fileLabel: meta.fileLabel })
    try {
      await cloudApi.assertAdmin()
      const item = await cloudApi.getAdminContent(target, id)
      if (!item) throw new Error('内容不存在或已删除')
      const normalized = normalizeForm(target, item)
      this.setData({ ...normalized, loading: false })
    } catch (err) {
      wx.showModal({
        title: '无法编辑内容',
        content: err.message || '请确认管理员权限后重试。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    if (!field) return
    const value = event.detail.value || ''
    const patch = { [`form.${field}`]: value }
    if (field === 'linkUrl' && value.trim()) {
      patch['form.fileId'] = ''
      patch['form.fileUrl'] = ''
    }
    this.setData(patch)
  },

  onMaterialTypeChange(event) {
    const materialTypeIndex = Math.max(0, Number(event.detail.value) || 0)
    this.setData({
      materialTypeIndex,
      'form.type': MATERIAL_TYPES[materialTypeIndex].key
    })
  },

  async chooseFile() {
    if (this.data.replacing) return
    const { target, form } = this.data
    try {
      let file = null
      if (target === 'wallpapers' || (target === 'materials' && form.type === 'image')) {
        const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'] })
        file = (result.tempFiles || [])[0]
      } else {
        const extensions = target === 'audios' || form.type === 'audio'
          ? ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
          : ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']
        const result = await wx.chooseMessageFile({ count: 1, type: 'file', extension: extensions })
        file = (result.tempFiles || [])[0]
      }
      const filePath = file && (file.tempFilePath || file.path)
      if (!filePath) return
      await this.uploadReplacement(filePath, file.name || getFileName(filePath))
    } catch (err) {
      if (!String(err && err.errMsg || '').includes('cancel')) {
        wx.showToast({ title: err.message || '选择文件失败', icon: 'none' })
      }
    }
  },

  async chooseCover() {
    if (this.data.replacing) return
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'] })
      const file = (result.tempFiles || [])[0]
      const filePath = file && file.tempFilePath
      if (!filePath) return
      this.setData({ replacing: true })
      wx.showLoading({ title: '上传封面中', mask: true })
      const upload = await this.uploadFile(filePath, 'materials/covers')
      this.setData({
        'form.coverFileId': upload.fileID,
        'form.coverUrl': '',
        replacementName: `已替换封面：${file.name || getFileName(filePath)}`
      })
    } catch (err) {
      wx.showToast({ title: err.message || '替换封面失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ replacing: false })
    }
  },

  async uploadFile(filePath, folder) {
    const rawExt = String(filePath || '').split('.').pop() || 'dat'
    const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '') || 'dat'
    return wx.cloud.uploadFile({
      cloudPath: `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`,
      filePath
    })
  },

  async uploadReplacement(filePath, originalName) {
    const { target, form } = this.data
    this.setData({ replacing: true })
    wx.showLoading({ title: '替换文件中', mask: true })
    try {
      const folder = target === 'audios'
        ? 'audios'
        : target === 'wallpapers'
          ? 'wallpapers'
          : `materials/${form.type}`
      const upload = await this.uploadFile(filePath, folder)
      const patch = {
        'form.fileId': upload.fileID,
        'form.fileUrl': '',
        'form.linkUrl': ''
      }
      if (target === 'wallpapers') patch['form.imageUrl'] = ''
      if (target === 'materials' && form.type === 'image') {
        patch['form.coverFileId'] = upload.fileID
        patch['form.coverUrl'] = ''
        patch['form.imageUrl'] = ''
      }
      this.setData({ ...patch, replacementName: `已替换：${originalName}` })
      wx.showToast({ title: '文件已替换，请保存', icon: 'success' })
    } finally {
      wx.hideLoading()
      this.setData({ replacing: false })
    }
  },

  async save() {
    if (this.data.saving) return
    const { target, form } = this.data
    const payload = { ...form, sort: Number(form.sort) }
    this.setData({ saving: true })
    try {
      await cloudApi.saveAdminContent(target, payload)
      wx.showToast({ title: '已保存并同步前台', icon: 'success' })
      wx.navigateBack()
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
