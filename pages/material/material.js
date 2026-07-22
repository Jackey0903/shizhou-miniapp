const cloudApi = require('../../utils/cloudApi')
const auth = require('../../utils/auth')

let audioCtx = null
const MATERIAL_COST = 10
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|flac|ogg)(\?|#|$)/i
const DOC_EXT_RE = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)(\?|#|$)/i

function getMaterialType(item = {}) {
  const type = item.type || item.categoryType
  if (['document', 'audio', 'image'].includes(type)) return type
  if (item.category === 'audio' || item.category === 'image') return item.category
  return 'document'
}

function getAccessLabel(item, owned) {
  if (owned) return '已领取'
  return `${MATERIAL_COST}舟币`
}

function getConfirmText(item) {
  return `确认消耗 ${MATERIAL_COST} 舟币领取《${item.name}》吗？领取后可反复打开，不会重复扣费。`
}

function wxPromise(api, options = {}) {
  return new Promise((resolve, reject) => {
    api({
      ...options,
      success: resolve,
      fail: reject
    })
  })
}

Page({
  data: {
    tabs: [
      { key: 'document', label: '文档' },
      { key: 'audio', label: '音频' },
      { key: 'image', label: '图片' }
    ],
    activeTab: 'document',
    materials: [],
    filteredMaterials: [],
    ownedMap: {},
    userCoins: 0,
    loading: true
  },

  async onLoad() {
    await this.loadData()
  },

  onUnload() {
    if (audioCtx) {
      audioCtx.destroy()
      audioCtx = null
    }
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const [materials, user] = await Promise.all([
        cloudApi.getMaterials(),
        cloudApi.getCurrentUser().catch(() => null)
      ])
      const normalizedMaterials = await this.withCoverUrls(materials || [])
      const ownedMap = {}
      ;(normalizedMaterials || []).forEach((item) => {
        if (item.owned) ownedMap[item._id] = true
      })
      this.setData({
        materials: normalizedMaterials,
        ownedMap,
        userCoins: (user && user.coins) || 0,
        loading: false
      })
      this.applyFilter()
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '资料加载失败', icon: 'none' })
    }
  },

  async withCoverUrls(materials) {
    const coverIds = materials
      .filter((item) => item.coverFileId && item.coverFileId.startsWith('cloud://'))
      .map((item) => item.coverFileId)
    if (!coverIds.length) {
      return materials.map((item) => ({
        ...item,
        coverUrl: item.coverUrl || (item.type === 'image' ? item.imageUrl : '')
      }))
    }
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: coverIds })
      const urlMap = {}
      ;(res.fileList || []).forEach((item) => {
        if (item.fileID && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL
      })
      return materials.map((item) => ({
        ...item,
        coverUrl: urlMap[item.coverFileId] || item.coverUrl || (item.type === 'image' ? item.imageUrl : '')
      }))
    } catch (err) {
      return materials.map((item) => ({
        ...item,
        coverUrl: item.coverUrl || (item.type === 'image' ? item.imageUrl : '')
      }))
    }
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.key })
    this.applyFilter()
  },

  applyFilter() {
    const key = this.data.activeTab
    const filteredMaterials = (this.data.materials || []).filter((item) => {
      return getMaterialType(item) === key
    }).map((item) => {
      const type = getMaterialType(item)
      const owned = !!this.data.ownedMap[item._id]
      const actionLabel = owned
        ? (type === 'audio' ? '播放' : '打开/下载')
        : '领取'
      return {
        ...item,
        type,
        accessType: 'coin',
        coinCost: MATERIAL_COST,
        accessLabel: getAccessLabel(item, owned),
        actionLabel,
        owned,
        canDownload: owned && type === 'audio'
      }
    })
    this.setData({ filteredMaterials })
  },

  async onActionTap(e) {
    const item = e.currentTarget.dataset.item
    if (!item || !item._id) return
    const alreadyOwned = !!this.data.ownedMap[item._id]

    if (alreadyOwned) {
      await this.openMaterial(item)
      return
    }

    if (!(await auth.requireLogin('领取学习资料前请先登录账号'))) return

    const actionText = '领取'
    const confirmText = getConfirmText(item)

    wx.showModal({
      title: `${actionText}资料`,
      content: confirmText,
      success: async (res) => {
        if (!res.confirm) return
        try {
          wx.showLoading({ title: `${actionText}中`, mask: true })
          const redeemRes = await cloudApi.exchangeMaterial(item._id)
          const result = redeemRes.result || {}
          if (result.code === 0) {
            const grantedMaterial = (result.data && result.data.material) || item
            const materials = this.data.materials.map((material) => (
              material._id === item._id ? { ...material, ...grantedMaterial, owned: true } : material
            ))
            this.setData({
              [`ownedMap.${item._id}`]: true,
              materials,
              userCoins: result.data ? result.data.remainingCoins : this.data.userCoins
            })
            this.applyFilter()
            wx.showToast({ title: result.data && result.data.alreadyOwned ? '已领取' : '领取成功', icon: 'success' })
            await this.openMaterial(grantedMaterial)
          } else {
            wx.showToast({ title: result.msg || `${actionText}失败`, icon: 'none' })
          }
        } catch (err) {
          wx.showToast({ title: `${actionText}失败`, icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  async openMaterial(item) {
    const type = getMaterialType(item)
    const url = await this.resolveUrl(item)
    if (!url) {
      wx.showToast({ title: '资料链接缺失', icon: 'none' })
      return
    }

    if (type === 'image') {
      wx.previewImage({ current: url, urls: [url] })
      return
    }

    if (type === 'audio') {
      if (audioCtx) audioCtx.destroy()
      audioCtx = wx.createInnerAudioContext()
      audioCtx.autoplay = true
      audioCtx.src = url
      wx.showToast({ title: '开始播放', icon: 'none' })
      return
    }

    wx.showLoading({ title: '打开中', mask: true })
    try {
      const res = item.fileId && item.fileId.startsWith('cloud://')
        ? await wx.cloud.downloadFile({ fileID: item.fileId })
        : await wx.downloadFile({ url })
      await wx.openDocument({ filePath: res.tempFilePath, showMenu: true })
      wx.showToast({ title: '可点右上角菜单保存/转发', icon: 'none' })
    } catch (err) {
      if (item.linkUrl && !DOC_EXT_RE.test(item.linkUrl)) {
        wx.setClipboardData({
          data: item.linkUrl,
          success: () => wx.showToast({ title: '链接已复制', icon: 'none' })
        })
      } else {
        wx.showToast({ title: '打开失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
    }
  },

  async downloadMaterial(e) {
    const item = e.currentTarget.dataset.item
    if (!item || !item._id) return
    if (!this.data.ownedMap[item._id]) {
      wx.showToast({ title: '请先领取资料', icon: 'none' })
      return
    }

    wx.showLoading({ title: '下载中', mask: true })
    try {
      const tempFilePath = await this.downloadToTempFile(item)
      wx.hideLoading()
      const itemList = wx.shareFileMessage ? ['保存到小程序本地', '转发音频文件'] : ['保存到小程序本地']
      wx.showActionSheet({
        itemList,
        success: async (res) => {
          if (res.tapIndex === 1 && wx.shareFileMessage) {
            await this.shareDownloadedAudio(tempFilePath, item)
            return
          }
          await this.saveDownloadedAudio(tempFilePath)
        }
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '下载失败', icon: 'none' })
    }
  },

  async downloadToTempFile(item) {
    if (item.fileId && item.fileId.startsWith('cloud://')) {
      const res = await wxPromise(wx.cloud.downloadFile, { fileID: item.fileId })
      return res.tempFilePath
    }
    const url = await this.resolveUrl(item)
    if (!url) throw new Error('missing audio url')
    const res = await wxPromise(wx.downloadFile, { url })
    if (res.statusCode && res.statusCode !== 200) throw new Error(`download status ${res.statusCode}`)
    return res.tempFilePath
  },

  async saveDownloadedAudio(tempFilePath) {
    await wxPromise(wx.saveFile, { tempFilePath })
    wx.showModal({
      title: '下载完成',
      content: '音频已保存到小程序本地文件，后续可在本页反复播放。需要转发给微信好友时，可再次点击“下载/转发”选择转发音频文件。',
      showCancel: false
    })
  },

  async shareDownloadedAudio(tempFilePath, item) {
    const title = item.name || item.title || '仕舟音频资料'
    const hasExt = AUDIO_EXT_RE.test(title)
    await wxPromise(wx.shareFileMessage, {
      filePath: tempFilePath,
      fileName: hasExt ? title : `${title}.mp3`
    })
  },

  async resolveUrl(item) {
    if (item.fileId && item.fileId.startsWith('cloud://')) {
      const res = await wx.cloud.getTempFileURL({ fileList: [item.fileId] })
      const file = (res.fileList || [])[0]
      if (file && file.tempFileURL) return file.tempFileURL
    }
    if (item.fileUrl) return item.fileUrl
    if (item.linkUrl) return item.linkUrl
    if (item.imageUrl) return item.imageUrl
    return item.fileId || ''
  }
})
