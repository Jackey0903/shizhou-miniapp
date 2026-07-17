const cloudApi = require('../../utils/cloudApi')

const TYPES = [
  { key: 'document', label: '文档' },
  { key: 'audio', label: '音频' },
  { key: 'image', label: '图片' }
]

const ACCESS_TYPES = [
  { key: 'free', label: '免费领取' },
  { key: 'vip', label: 'VIP免费领取' },
  { key: 'coin', label: '舟币兑换领取' }
]

Page({
  data: {
    types: TYPES,
    accessTypes: ACCESS_TYPES,
    typeIndex: 0,
    accessTypeIndex: 2,
    selectedAccessType: 'coin',
    name: '',
    description: '',
    coinCost: '5',
    linkUrl: '',
    selectedFile: null,
    coverFile: null,
    uploading: false
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value), selectedFile: null })
  },

  onAccessTypeChange(e) {
    const accessTypeIndex = Number(e.detail.value)
    const nextAccessType = ACCESS_TYPES[accessTypeIndex].key
    const nextCoinCost = nextAccessType === 'coin' && Number(this.data.coinCost) > 0 ? this.data.coinCost : '5'
    this.setData({
      accessTypeIndex,
      selectedAccessType: nextAccessType,
      coinCost: nextAccessType === 'coin' ? nextCoinCost : '0'
    })
  },

  async chooseFile() {
    const type = TYPES[this.data.typeIndex].key
    try {
      if (type === 'image') {
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
              name: file.tempFilePath.split('/').pop()
            }
          })
        }
        return
      }

      const extensions = type === 'audio'
        ? ['mp3', 'wav', 'm4a']
        : ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']
      const res = await wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: extensions
      })
      const file = res.tempFiles && res.tempFiles[0]
      if (file) this.setData({ selectedFile: file })
    } catch (err) {
      if (!(err && err.errMsg && err.errMsg.includes('cancel'))) {
        wx.showToast({ title: '选择文件失败', icon: 'none' })
      }
    }
  },

  async chooseCover() {
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album']
      })
      const file = res.tempFiles && res.tempFiles[0]
      if (file) {
        this.setData({
          coverFile: {
            path: file.tempFilePath,
            name: file.tempFilePath.split('/').pop()
          }
        })
      }
    } catch (err) {
      if (!(err && err.errMsg && err.errMsg.includes('cancel'))) {
        wx.showToast({ title: '选择封面失败', icon: 'none' })
      }
    }
  },

  async submit() {
    if (this.data.uploading) return
    const linkUrl = this.data.linkUrl.trim()
    if ((!this.data.selectedFile || !this.data.selectedFile.path) && !linkUrl) {
      wx.showToast({ title: '请选择文件或填写链接', icon: 'none' })
      return
    }
    const type = TYPES[this.data.typeIndex].key
    const title = this.data.name.trim() || ((this.data.selectedFile && this.data.selectedFile.name) || '资料').replace(/\.[^.]+$/, '')
    const accessType = this.data.selectedAccessType
    const coinCost = accessType === 'coin' ? Number(this.data.coinCost || 5) : 0
    if (accessType === 'coin' && (!Number.isFinite(coinCost) || coinCost <= 0)) {
      wx.showToast({ title: '请填写正确舟币数', icon: 'none' })
      return
    }
    this.setData({ uploading: true })
    wx.showLoading({ title: '上传中', mask: true })
    try {
      let uploadRes = null
      if (this.data.selectedFile && this.data.selectedFile.path) {
        const ext = (this.data.selectedFile.path || this.data.selectedFile.name || '').split('.').pop() || (type === 'image' ? 'jpg' : 'dat')
        uploadRes = await wx.cloud.uploadFile({
          cloudPath: `materials/${type}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
          filePath: this.data.selectedFile.path
        })
      }

      let coverFileId = ''
      let coverUrl = ''
      if (this.data.coverFile && this.data.coverFile.path) {
        const coverExt = (this.data.coverFile.path || this.data.coverFile.name || '').split('.').pop() || 'jpg'
        const coverRes = await wx.cloud.uploadFile({
          cloudPath: `materials/covers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${coverExt}`,
          filePath: this.data.coverFile.path
        })
        coverFileId = coverRes.fileID
        const temp = await wx.cloud.getTempFileURL({ fileList: [coverRes.fileID] })
        coverUrl = (temp.fileList && temp.fileList[0] && temp.fileList[0].tempFileURL) || ''
      }

      const payload = {
        name: title,
        description: this.data.description,
        type,
        accessType,
        coinCost,
        fileId: uploadRes ? uploadRes.fileID : '',
        fileUrl: linkUrl,
        linkUrl,
        coverFileId,
        coverUrl,
        sort: Date.now()
      }

      if (type === 'image' && uploadRes) {
        const temp = await wx.cloud.getTempFileURL({ fileList: [uploadRes.fileID] })
        payload.imageUrl = (temp.fileList && temp.fileList[0] && temp.fileList[0].tempFileURL) || ''
      }

      const res = await cloudApi.uploadMaterials([payload])
      if (res.result && res.result.code === 0) {
        this.setData({ name: '', description: '', coinCost: '5', linkUrl: '', selectedFile: null, coverFile: null, accessTypeIndex: 2, selectedAccessType: 'coin' })
        wx.showToast({ title: '资料已上传', icon: 'success' })
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
