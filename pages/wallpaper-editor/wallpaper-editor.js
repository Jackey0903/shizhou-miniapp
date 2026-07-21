const cloudApi = require('../../utils/cloudApi')
const imageSharing = require('../../utils/imageSharing')

const POSTER_WIDTH = 750
const POSTER_HEIGHT = 1334
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

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const content = String(text || '').trim()
  if (!content) return y
  let line = ''
  let lineCount = 0
  let consumedAll = true
  for (let i = 0; i < content.length; i += 1) {
    const testLine = line + content[i]
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y)
      line = content[i]
      y += lineHeight
      lineCount += 1
      if (maxLines && lineCount >= maxLines - 1) {
        consumedAll = i === content.length - 1
        break
      }
    } else {
      line = testLine
    }
  }
  if (line) {
    const shouldEllipsize = maxLines && lineCount >= maxLines - 1 && !consumedAll
    const rest = shouldEllipsize ? `${line.slice(0, Math.max(0, line.length - 1))}…` : line
    ctx.fillText(rest, x, y)
    y += lineHeight
  }
  return y
}

Page({
  data: {
    imageUrl: '',
    customText: '',
    includeQuestion: false,
    questionOptions: [],
    selectedQuestionIndex: 0,
    selectedQuestionText: '',
    saving: false,
    posterTempFilePath: '',
    shareTempFilePath: '',
    imageActionBusy: false,
    showPrivacyDialog: false,
    privacyContractName: '《仕舟小程序隐私保护指引》'
  },

  async onLoad(options) {
    const imageUrl = decodeURIComponent(options.src || '')
    const customText = decodeURIComponent(options.text || '')
    const selectedQuestionText = decodeURIComponent(options.question || '')
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    this.setData({
      imageUrl,
      customText,
      selectedQuestionText,
      includeQuestion: !!selectedQuestionText
    })
    await this.loadQuestionOptions()
  },

  async loadQuestionOptions() {
    try {
      const records = await cloudApi.getStudyRecords()
      const list = (records || [])
        .filter((item) => item.result !== 'know' && item.questionContent)
        .map((item) => ({
          id: item.questionId || item._id,
          text: item.questionContent,
          label: `${item.bankName || item.courseName || '记忆题库'}：${String(item.questionContent).slice(0, 20)}`
        }))
      const selectedQuestionIndex = Math.max(0, list.findIndex((item) => item.text === this.data.selectedQuestionText))
      this.setData({
        questionOptions: list,
        selectedQuestionIndex,
        selectedQuestionText: list[selectedQuestionIndex] ? list[selectedQuestionIndex].text : this.data.selectedQuestionText
      })
    } catch (err) {}
  },

  onTextInput(e) {
    this.setData({ customText: e.detail.value, posterTempFilePath: '', shareTempFilePath: '' })
  },

  onToggleQuestion(e) {
    const includeQuestion = e.detail.value
    const current = this.data.questionOptions[this.data.selectedQuestionIndex]
    this.setData({
      includeQuestion,
      selectedQuestionText: includeQuestion && current ? current.text : this.data.selectedQuestionText,
      posterTempFilePath: '',
      shareTempFilePath: ''
    })
  },

  onQuestionChange(e) {
    const selectedQuestionIndex = Number(e.detail.value || 0)
    const current = this.data.questionOptions[selectedQuestionIndex]
    this.setData({
      selectedQuestionIndex,
      selectedQuestionText: current ? current.text : '',
      posterTempFilePath: '',
      shareTempFilePath: ''
    })
  },

  drawPoster(imageInfo) {
    return new Promise((resolve, reject) => {
      const width = POSTER_WIDTH
      const height = POSTER_HEIGHT
      const ctx = wx.createCanvasContext('posterCanvas', this)
      const bgRect = getCoverRect(imageInfo.width, imageInfo.height, width, height)

      ctx.drawImage(imageInfo.path, bgRect.x, bgRect.y, bgRect.width, bgRect.height)
      ctx.setFillStyle('rgba(15,23,42,0.08)')
      ctx.fillRect(0, 0, width, height)

      ctx.setFillStyle('#FFFFFF')
      ctx.setFontSize(44)
      ctx.setTextAlign('left')
      ctx.setTextBaseline('top')
      let y = 72
      y = wrapText(ctx, this.data.customText || '日积月累，仕舟渡你上岸。', 48, y, width - 96, 62, 4)

      if (this.data.includeQuestion && this.data.selectedQuestionText) {
        ctx.setFillStyle('rgba(255,255,255,0.16)')
        ctx.fillRect(40, height - 420, width - 80, 260)
        ctx.setFillStyle('#FFFFFF')
        ctx.setFontSize(24)
        ctx.fillText('错题记忆', 64, height - 390)
        ctx.setFontSize(30)
        wrapText(ctx, this.data.selectedQuestionText, 64, height - 336, width - 128, 46, 4)
      }

      ctx.setFontSize(22)
      ctx.setFillStyle('rgba(255,255,255,0.85)')
      ctx.fillText('仕舟 · 自定义记忆壁纸', 48, height - 78)
      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: 'posterCanvas',
          x: 0,
          y: 0,
          width,
          height,
          destWidth: width,
          destHeight: height,
          fileType: 'jpg',
          quality: 0.92,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this)
      })
    })
  },

  async buildPosterFile(forceRefresh = false) {
    if (!forceRefresh && this.data.posterTempFilePath) return this.data.posterTempFilePath
    if (!this.data.imageUrl) throw new Error('壁纸地址缺失')
    const imageInfo = await getImageInfo(this.data.imageUrl)
    const filePath = await this.drawPoster(imageInfo)
    this.setData({ posterTempFilePath: filePath, shareTempFilePath: '' })
    return filePath
  },

  async drawShareImage(posterFilePath) {
    const imageInfo = await getImageInfo(posterFilePath)
    const size = SHARE_IMAGE_SIZE
    const ctx = wx.createCanvasContext('shareCanvas', this)
    const bgRect = getCoverRect(imageInfo.width, imageInfo.height, size, size)
    const posterRect = getContainRect(imageInfo.width, imageInfo.height, 36, 36, size - 72, size - 72)

    ctx.setFillStyle('#F7F0D6')
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(imageInfo.path, bgRect.x, bgRect.y, bgRect.width, bgRect.height)
    ctx.setFillStyle('rgba(255,255,255,0.72)')
    ctx.fillRect(0, 0, size, size)
    ctx.setFillStyle('rgba(255,255,255,0.96)')
    ctx.fillRect(posterRect.x - 18, posterRect.y - 18, posterRect.width + 36, posterRect.height + 36)
    ctx.drawImage(imageInfo.path, posterRect.x, posterRect.y, posterRect.width, posterRect.height)

    return new Promise((resolve, reject) => {
      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: 'shareCanvas',
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

  async buildShareImageFile(forceRefresh = false) {
    if (!forceRefresh && this.data.shareTempFilePath) return this.data.shareTempFilePath
    const posterFilePath = await this.buildPosterFile(forceRefresh)
    const shareFilePath = await this.drawShareImage(posterFilePath)
    this.setData({ shareTempFilePath: shareFilePath })
    return shareFilePath
  },

  async savePoster() {
    if (this.data.imageActionBusy) return
    this.setData({ saving: true, imageActionBusy: true })
    wx.showLoading({ title: '生成中', mask: true })
    try {
      const tempFilePath = await this.buildPosterFile(true)
      const result = await this.runImageAction(tempFilePath, 'save')
      await this.handleImageActionResult(result, 'save')
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ saving: false, imageActionBusy: false })
    }
  },

  async shareImage() {
    if (this.data.imageActionBusy) return
    this.setData({ imageActionBusy: true })
    wx.showLoading({ title: '生成中', mask: true })
    let loadingVisible = true
    try {
      const filePath = await this.buildShareImageFile(true)
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
    this.setData({ showPrivacyDialog: false, imageActionBusy: true, saving: action === 'save' })
    if (!filePath) {
      this.setData({ imageActionBusy: false, saving: false })
      return
    }
    try {
      const result = await this.runImageAction(filePath, action, action === 'share')
      await this.handleImageActionResult(result, action)
    } catch (error) {
      wx.showToast({ title: imageSharing.getErrorMessage(error) || '图片保存失败', icon: 'none' })
    } finally {
      this.setData({ imageActionBusy: false, saving: false })
    }
  },

  handleRejectPrivacyAuthorization() {
    this._pendingImageFilePath = ''
    this._pendingImageAction = ''
    this.setData({ showPrivacyDialog: false, imageActionBusy: false, saving: false })
  },

  openPrivacyContract() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.navigateTo({ url: '/pages/privacy/privacy' })
      return
    }
    wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: '/pages/privacy/privacy' }) })
  },

  noop() {},

  onShareAppMessage() {
    const query = [
      `src=${encodeURIComponent(this.data.imageUrl || '')}`,
      `text=${encodeURIComponent(this.data.customText || '')}`,
      `question=${encodeURIComponent(this.data.includeQuestion ? this.data.selectedQuestionText : '')}`
    ].join('&')
    return {
      title: this.data.customText || '我做了一张记忆壁纸',
      path: `/pages/wallpaper-editor/wallpaper-editor?${query}`,
      imageUrl: this.data.imageUrl || ''
    }
  }
})
