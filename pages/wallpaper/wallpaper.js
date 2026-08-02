const cloudApi = require('../../utils/cloudApi')
const imageSharing = require('../../utils/imageSharing')

const DEFAULT_WALLPAPERS = [
  { _id: 'local-1', imageUrl: '/assets/images/default-wallpaper-1.webp', source: 'system' },
  { _id: 'local-2', imageUrl: '/assets/images/default-wallpaper-2.webp', source: 'system' },
  { _id: 'local-3', imageUrl: '/assets/images/default-wallpaper-3.webp', source: 'system' },
  { _id: 'local-4', imageUrl: '/assets/images/default-wallpaper-4.webp', source: 'system' }
]
const SHARE_IMAGE_SIZE = 1080

function getCoverRect(imageWidth, imageHeight, boxWidth, boxHeight) {
  const imageRatio = imageWidth / imageHeight
  const boxRatio = boxWidth / boxHeight
  let width = boxWidth
  let height = boxHeight
  if (imageRatio > boxRatio) {
    height = boxHeight
    width = boxHeight * imageRatio
  } else {
    width = boxWidth
    height = boxWidth / imageRatio
  }
  return {
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
    width,
    height
  }
}

function getContainRect(imageWidth, imageHeight, boxX, boxY, boxWidth, boxHeight) {
  const imageRatio = imageWidth / imageHeight
  const boxRatio = boxWidth / boxHeight
  let width = boxWidth
  let height = boxHeight
  if (imageRatio > boxRatio) {
    height = boxWidth / imageRatio
  } else {
    width = boxHeight * imageRatio
  }
  return {
    x: boxX + (boxWidth - width) / 2,
    y: boxY + (boxHeight - height) / 2,
    width,
    height
  }
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject
    })
  })
}

async function withTempUrls(list = []) {
  const fileIds = list.map((item) => item.fileId).filter(Boolean)
  if (fileIds.length === 0) return list

  const res = await wx.cloud.getTempFileURL({ fileList: fileIds })
  const urlMap = {}
  ;(res.fileList || []).forEach((item) => {
    urlMap[item.fileID] = item.tempFileURL
  })

  return list.map((item) => ({
    ...item,
    imageUrl: urlMap[item.fileId] || item.imageUrl || item.fileId || ''
  }))
}

Page({
  data: {
    wallpapers: [],
    uploading: false,
    currentShareItem: null,
    imageActionBusy: false,
    showPrivacyDialog: false,
    privacyContractName: '《仕舟小程序隐私保护指引》'
  },

  async onLoad() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    await this.loadWallpapers()
  },

  async loadWallpapers() {
    try {
      const [publicList, mineRes] = await Promise.all([
        cloudApi.getWallpapers(),
        cloudApi.getMyWallpapers().catch(() => ({ result: { code: 0, data: [] } }))
      ])
      const mine = mineRes.result && mineRes.result.code === 0 ? mineRes.result.data || [] : []
      const merged = await withTempUrls([
        ...mine.map((item) => ({ ...item, source: 'mine' })),
        ...(publicList.length > 0 ? publicList : DEFAULT_WALLPAPERS)
      ])
      this.setData({ wallpapers: merged })
    } catch (e) {
      const merged = await withTempUrls(DEFAULT_WALLPAPERS)
      this.setData({ wallpapers: merged })
    }
  },

  async uploadLocal() {
    if (this.data.uploading) return
    this.setData({ uploading: true })
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album']
      })
      const file = chooseRes.tempFiles && chooseRes.tempFiles[0]
      if (!file || !file.tempFilePath) {
        throw new Error('未选择图片')
      }

      wx.showLoading({ title: '上传中', mask: true })
      const ext = file.tempFilePath.split('.').pop() || 'jpg'
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `user-wallpapers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
        filePath: file.tempFilePath
      })

      const saveRes = await cloudApi.saveMyWallpaper(uploadRes.fileID)
      if (!saveRes.result || saveRes.result.code !== 0) {
        throw new Error((saveRes.result && saveRes.result.msg) || '壁纸保存失败')
      }

      await this.loadWallpapers()
      wx.showToast({ title: '壁纸已上传', icon: 'success' })
    } catch (e) {
      if (!(e && e.errMsg && e.errMsg.includes('cancel'))) {
        wx.showToast({ title: e.message || '上传失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ uploading: false })
    }
  },

  preview(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.src,
      urls: this.data.wallpapers.map((item) => item.imageUrl).filter(Boolean)
    })
  },

  async resolveImageFile(item) {
    if (!item || !item.imageUrl) throw new Error('图片地址缺失')
    if (item.fileId && item.fileId.startsWith('cloud://')) {
      const res = await wx.cloud.downloadFile({ fileID: item.fileId })
      return res.tempFilePath
    }
    if (item.imageUrl.startsWith('/')) {
      const res = await wx.getImageInfo({ src: item.imageUrl })
      return res.path
    }
    const res = await wx.downloadFile({ url: item.imageUrl })
    return res.tempFilePath
  },

  async drawShareImage(imagePath) {
    const imageInfo = await getImageInfo(imagePath)
    const size = SHARE_IMAGE_SIZE
    const ctx = wx.createCanvasContext('wallpaperShareCanvas', this)
    const bgRect = getCoverRect(imageInfo.width, imageInfo.height, size, size)
    const imageRect = getContainRect(imageInfo.width, imageInfo.height, 36, 36, size - 72, size - 72)

    ctx.setFillStyle('#F7F0D6')
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(imageInfo.path, bgRect.x, bgRect.y, bgRect.width, bgRect.height)
    ctx.setFillStyle('rgba(255,255,255,0.72)')
    ctx.fillRect(0, 0, size, size)
    ctx.setFillStyle('rgba(255,255,255,0.96)')
    ctx.fillRect(imageRect.x - 18, imageRect.y - 18, imageRect.width + 36, imageRect.height + 36)
    ctx.drawImage(imageInfo.path, imageRect.x, imageRect.y, imageRect.width, imageRect.height)

    return new Promise((resolve, reject) => {
      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: 'wallpaperShareCanvas',
          x: 0,
          y: 0,
          width: size,
          height: size,
          destWidth: size,
          destHeight: size,
          fileType: 'jpg',
          quality: 0.92,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this)
      })
    })
  },

  async buildShareImageFile(item) {
    const imagePath = await this.resolveImageFile(item)
    return this.drawShareImage(imagePath)
  },

  async save(e) {
    const { item } = e.currentTarget.dataset
    if (!item || !item.imageUrl || this.data.imageActionBusy) return

    this.setData({ imageActionBusy: true })
    wx.showLoading({ title: '保存中', mask: true })
    try {
      const tempFilePath = await this.resolveImageFile(item)
      const result = await this.runImageAction(tempFilePath, 'save')
      await this.handleImageActionResult(result, 'save')
    } catch (error) {
      const message = error && error.code === 'PRIVACY_SCOPE_NOT_DECLARED'
        ? '相册权限配置尚未生效，请稍后重试'
        : (imageSharing.getErrorMessage(error) || '保存失败，请稍后重试')
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ imageActionBusy: false })
    }
  },

  async shareImage(e) {
    const { item } = e.currentTarget.dataset
    if (!item || this.data.imageActionBusy) return
    this.setData({ imageActionBusy: true })
    let loadingVisible = true
    wx.showLoading({ title: '准备图片中', mask: true })
    try {
      const filePath = await this.buildShareImageFile(item)
      this.setData({ currentShareItem: item || null })
      wx.hideLoading()
      loadingVisible = false
      const result = await this.runImageAction(filePath, 'share')
      await this.handleImageActionResult(result, 'share')
    } catch (error) {
      if (loadingVisible) wx.hideLoading()
      const message = error && error.code === 'PRIVACY_SCOPE_NOT_DECLARED'
        ? '相册权限配置尚未生效，请稍后重试'
        : (imageSharing.getErrorMessage(error) || '图片分享失败，请稍后重试')
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      this.setData({ imageActionBusy: false })
    }
  },

  requestPrivacyConsent(filePath, privacyContractName, action) {
    this._pendingImageFilePath = filePath
    this._pendingImageAction = action
    this.setData({
      showPrivacyDialog: true,
      privacyContractName: privacyContractName || '《仕舟小程序隐私保护指引》'
    })
  },

  recoverAlbumPermission() {
    return imageSharing.recoverAlbumPermission(wx)
  },

  runImageAction(filePath, action, skipShareMenu = false) {
    const options = {
      wxApi: wx,
      onPrivacyRequired: (pendingPath, contractName) => this.requestPrivacyConsent(pendingPath, contractName, action),
      recoverAlbumPermission: () => this.recoverAlbumPermission()
    }
    if (action === 'share') {
      return imageSharing.shareImageWithFallback(filePath, { ...options, skipShareMenu })
    }
    return imageSharing.saveImageWithPermission(filePath, options)
  },

  async handleImageActionResult(result, action) {
    if (!result || result.status === 'cancelled' || result.status === 'privacy-required') return
    if (result.status === 'shared') {
      await this.rewardShareTimeline()
      return
    }
    if (result.status === 'saved') {
      wx.showToast({ title: action === 'share' ? '已保存到相册，请去朋友圈发布' : '已保存到相册', icon: action === 'share' ? 'none' : 'success' })
      return
    }
    if (result.status === 'permission-denied') {
      wx.showToast({ title: '未开启相册权限，暂未保存', icon: 'none' })
    }
  },

  async handleAgreePrivacyAuthorization() {
    const filePath = this._pendingImageFilePath
    const action = this._pendingImageAction || 'save'
    this._pendingImageFilePath = ''
    this._pendingImageAction = ''
    this.setData({ showPrivacyDialog: false, imageActionBusy: true })
    if (!filePath) {
      this.setData({ imageActionBusy: false })
      return
    }
    try {
      const result = await this.runImageAction(filePath, action, action === 'share')
      await this.handleImageActionResult(result, action)
    } catch (error) {
      wx.showToast({ title: imageSharing.getErrorMessage(error) || '图片保存失败', icon: 'none' })
    } finally {
      this.setData({ imageActionBusy: false })
    }
  },

  handleRejectPrivacyAuthorization() {
    this._pendingImageFilePath = ''
    this._pendingImageAction = ''
    this.setData({ showPrivacyDialog: false, imageActionBusy: false })
  },

  openPrivacyContract() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.navigateTo({ url: '/pages/privacy/privacy' })
      return
    }
    wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: '/pages/privacy/privacy' }) })
  },

  noop() {},

  async rewardShareTimeline() {
    try {
      const res = await cloudApi.grantCoinReward('shareTimeline')
      const result = res.result || {}
      if (result.code === 0) {
        const amount = result.data && result.data.amount ? result.data.amount : 10
        const app = getApp()
        if (app.globalData.userInfo) {
          app.globalData.userInfo.coins = result.data && typeof result.data.coins === 'number'
            ? result.data.coins
            : (app.globalData.userInfo.coins || 0) + amount
        }
        wx.showToast({ title: `分享成功，获得${amount}舟币`, icon: 'none' })
        return
      }
      wx.showToast({ title: result.msg || '今日分享奖励已达上限', icon: 'none' })
    } catch (e) {
      wx.showToast({ title: '分享奖励发放失败', icon: 'none' })
    }
  },

  edit(e) {
    const { item } = e.currentTarget.dataset
    const url = item && item.imageUrl
      ? `/pages/wallpaper-editor/wallpaper-editor?src=${encodeURIComponent(item.imageUrl)}`
      : '/pages/wallpaper/wallpaper'
    wx.navigateTo({ url })
  },

  useForCheckin(e) {
    const { item } = e.currentTarget.dataset
    if (!item || !item.imageUrl) {
      wx.showToast({ title: '壁纸地址缺失', icon: 'none' })
      return
    }
    wx.setStorageSync('checkinWallpaperPreference', {
      imageUrl: item.imageUrl,
      fileId: item.fileId || '',
      updatedAt: Date.now()
    })
    wx.showToast({ title: '已设为打卡背景', icon: 'success' })
    setTimeout(() => {
      wx.navigateTo({ url: '/pages/checkin/checkin?from=wallpaper' })
    }, 300)
  },

  onShareAppMessage() {
    const current = this.data.currentShareItem
    const first = current || this.data.wallpapers[0]
    return {
      title: '仕舟壁纸',
      path: '/pages/wallpaper/wallpaper',
      imageUrl: first ? first.imageUrl : ''
    }
  }
})
