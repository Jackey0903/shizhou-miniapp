const cloudApi = require('../../utils/cloudApi')
const imageSharing = require('../../utils/imageSharing')
const auth = require('../../utils/auth')

const DEFAULT_BG = '/assets/images/default-checkin-bg.webp'
const DEFAULT_QUOTE = '今日完成一点点，未来上岸一大步。'
const SHARE_CANVAS_SIZE = 1080
const CHECKIN_SHARE_REWARD = 10
const PENDING_SHARE_REWARD_KEY = 'pendingCheckinShareRewardClaimId'
const LEGACY_PENDING_SHARE_CHARGE_KEY = 'pendingCheckinShareClaimId'

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function resolvePreferredWallpaper() {
  const pref = wx.getStorageSync('checkinWallpaperPreference')
  if (!pref) return ''
  if (pref.fileId && pref.fileId.startsWith('cloud://')) {
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: [pref.fileId] })
      const file = (res.fileList || [])[0]
      return file ? file.tempFileURL : (pref.imageUrl || '')
    } catch (e) {
      return pref.imageUrl || ''
    }
  }
  return pref.imageUrl || ''
}

function getContainRect(imageWidth, imageHeight, boxX, boxY, boxWidth, boxHeight) {
  const imageRatio = imageWidth / imageHeight
  const boxRatio = boxWidth / boxHeight
  let drawWidth = boxWidth
  let drawHeight = boxHeight
  if (imageRatio > boxRatio) {
    drawHeight = boxWidth / imageRatio
  } else {
    drawWidth = boxHeight * imageRatio
  }
  return {
    x: boxX + (boxWidth - drawWidth) / 2,
    y: boxY + (boxHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight
  }
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const content = String(text || '').trim()
  if (!content) return y
  let line = ''
  let lineCount = 0
  let index = 0
  for (; index < content.length; index += 1) {
    const testLine = line + content[index]
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y)
      line = content[index]
      y += lineHeight
      lineCount += 1
      if (maxLines && lineCount >= maxLines - 1) break
    } else {
      line = testLine
    }
  }
  if (line) {
    const finalLine = maxLines && lineCount >= maxLines - 1 && index < content.length - 1
      ? `${line.slice(0, Math.max(0, line.length - 1))}…`
      : line
    ctx.fillText(finalLine, x, y)
    y += lineHeight
  }
  return y
}

Page({
  data: {
    currentWallpaper: DEFAULT_BG,
    currentTime: '',
    currentDate: '',
    streak: 0,
    totalDays: 0,
    checkedToday: false,
    loading: false,
    quote: DEFAULT_QUOTE,
    backgroundTitle: '今日打卡海报',
    shareReady: false,
    sharing: false,
    showPrivacyDialog: false,
    privacyContractName: '《仕舟小程序隐私保护指引》',
    autoOpenedFromQuestion: false,
    enteredAfterCheckin: false,
    usingCustomWallpaper: false
  },

  onLoad(options = {}) {
    const enteredAfterCheckin = options.alreadyChecked === '1'
    wx.removeStorageSync(LEGACY_PENDING_SHARE_CHARGE_KEY)
    this.setData({
      autoOpenedFromQuestion: options.from === 'question',
      enteredAfterCheckin,
      checkedToday: enteredAfterCheckin,
      shareReady: enteredAfterCheckin
    })
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage'],
      fail: () => {}
    })
    this._updateTime()
    this._timer = setInterval(() => this._updateTime(), 30000)
    this._loadPunchConfig()
    this._loadUserData()
    this._checkTodayStatusAndAutoCheckin()
  },

  onUnload() {
    clearInterval(this._timer)
  },

  async _loadPunchConfig() {
    try {
      const config = await cloudApi.getPunchConfig(this.data.currentDate)
      const background = config.background || {}
      const quote = config.quote || {}
      const preferredWallpaper = await resolvePreferredWallpaper()
      this.setData({
        currentWallpaper: preferredWallpaper || background.imageUrl || DEFAULT_BG,
        backgroundTitle: background.title || '今日打卡海报',
        quote: quote.content || DEFAULT_QUOTE,
        usingCustomWallpaper: !!preferredWallpaper
      })
    } catch (e) {
      const preferredWallpaper = await resolvePreferredWallpaper()
      this.setData({
        currentWallpaper: preferredWallpaper || DEFAULT_BG,
        backgroundTitle: '今日打卡海报',
        quote: DEFAULT_QUOTE,
        usingCustomWallpaper: !!preferredWallpaper
      })
    }
  },

  _updateTime() {
    const now = new Date()
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    this.setData({ currentTime: `${h}:${m}`, currentDate: dateStr })
  },

  async _loadUserData() {
    const app = getApp()
    const user = app.globalData.userInfo
    if (user) {
      this.setData({ streak: user.streak || 0, totalDays: user.totalCheckins || 0 })
    }
    try {
      const latest = await cloudApi.getCurrentUser()
      if (latest) {
        this.setData({ streak: latest.streak || 0, totalDays: latest.totalCheckins || 0 })
      }
    } catch (e) {
      if (this.data.autoOpenedFromQuestion && !this.data.enteredAfterCheckin) {
        await this._autoCheckin()
      }
    }
  },

  async _checkTodayStatusAndAutoCheckin() {
    const today = formatDateKey(new Date())
    try {
      const checkins = await cloudApi.getCheckins(new Date().getFullYear(), new Date().getMonth() + 1)
      const checkedToday = checkins.some((item) => item.dateStr === today)
      this.setData({ checkedToday, shareReady: checkedToday })
      if (this.data.autoOpenedFromQuestion) {
        if (checkedToday || this.data.enteredAfterCheckin) {
          wx.showToast({ title: '今日已打卡，点右上角分享', icon: 'none' })
          return
        }
        await this._autoCheckin()
      }
    } catch (e) {}
  },

  async _autoCheckin() {
    if (this.data.checkedToday) {
      return
    }
    this.setData({ loading: true })
    try {
      const res = await cloudApi.doCheckin()
      if (res.result.code === 0) {
        const { streak, totalCheckins } = res.result.data
        this.setData({
          streak,
          totalDays: totalCheckins,
          checkedToday: true,
          shareReady: true,
          loading: false
        })
        const app = getApp()
        if (app.globalData.userInfo) {
          app.globalData.userInfo.streak = streak
          app.globalData.userInfo.totalCheckins = totalCheckins
        }
        wx.showToast({ title: '已打卡，可分享图片赚10舟币', icon: 'none' })
      } else {
        wx.showToast({ title: res.result.msg || '今日已打卡', icon: 'none' })
        const alreadyChecked = res.result.code === 1
        this.setData({
          checkedToday: alreadyChecked,
          shareReady: alreadyChecked,
          loading: false
        })
      }
    } catch (e) {
      wx.showToast({ title: '打卡失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  async resolveCurrentImageFile() {
    const src = this.data.currentWallpaper
    if (!src) throw new Error('图片地址缺失')
    const pref = wx.getStorageSync('checkinWallpaperPreference')
    if (pref && pref.fileId && pref.fileId.startsWith('cloud://')) {
      const res = await wx.cloud.downloadFile({ fileID: pref.fileId })
      return res.tempFilePath
    }
    if (src.startsWith('/')) {
      const res = await wx.getImageInfo({ src })
      return res.path
    }
    const res = await wx.downloadFile({ url: src })
    return res.tempFilePath
  },

  async buildShareImageFile() {
    const filePath = await this.resolveCurrentImageFile()
    const imageInfo = await wx.getImageInfo({ src: filePath })
    const width = SHARE_CANVAS_SIZE
    const height = SHARE_CANVAS_SIZE
    const ctx = wx.createCanvasContext('checkinShareCanvas', this)
    const rect = getContainRect(imageInfo.width, imageInfo.height, 0, 0, width, height)

    ctx.setFillStyle('#F7F0D6')
    ctx.fillRect(0, 0, width, height)

    // 先铺一层居中裁切背景，避免 contain 留白太硬；再把完整壁纸放在上面。
    const coverRatio = Math.max(width / imageInfo.width, height / imageInfo.height)
    const coverWidth = imageInfo.width * coverRatio
    const coverHeight = imageInfo.height * coverRatio
    ctx.drawImage(imageInfo.path, (width - coverWidth) / 2, (height - coverHeight) / 2, coverWidth, coverHeight)
    ctx.setFillStyle('rgba(255,255,255,0.62)')
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(imageInfo.path, rect.x, rect.y, rect.width, rect.height)

    ctx.setFillStyle('rgba(15,23,42,0.52)')
    drawRoundRect(ctx, 64, height - 286, width - 128, 220, 36)
    ctx.fill()

    ctx.setFillStyle('#FFFFFF')
    ctx.setFontSize(34)
    ctx.setTextAlign('left')
    ctx.setTextBaseline('top')
    ctx.fillText('今日打卡海报', 96, height - 254)
    ctx.setFontSize(46)
    wrapText(ctx, this.data.quote || DEFAULT_QUOTE, 96, height - 184, width - 192, 60, 2)

    ctx.setFontSize(30)
    ctx.setFillStyle('rgba(255,255,255,0.88)')
    ctx.fillText(`${this.data.currentDate}  ${this.data.currentTime}`, 96, height - 78)
    ctx.setTextAlign('right')
    ctx.fillText(`连续${this.data.streak}天 · 累计${this.data.totalDays}天`, width - 96, height - 78)

    return new Promise((resolve, reject) => {
      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: 'checkinShareCanvas',
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

  updateCoinBalance(coins) {
    if (typeof coins !== 'number') return
    const app = getApp()
    app.globalData.coins = coins
    if (app.globalData.userInfo) {
      app.globalData.userInfo.coins = coins
      wx.setStorageSync('userInfo', app.globalData.userInfo)
    }
  },

  async rewardShareCoins(claimId) {
    const safeClaimId = String(claimId || '').trim()
    if (!safeClaimId) throw new Error('分享凭证缺失，请重新分享')
    wx.setStorageSync(PENDING_SHARE_REWARD_KEY, safeClaimId)
    const response = await cloudApi.grantCheckinShareReward(safeClaimId)
    const result = response.result || {}
    if (result.code !== 0) {
      if ([2, 3, 4].includes(result.code)) wx.removeStorageSync(PENDING_SHARE_REWARD_KEY)
      const error = new Error(result.msg || '舟币奖励发放失败，请稍后重试')
      error.businessCode = result.code
      throw error
    }
    wx.removeStorageSync(PENDING_SHARE_REWARD_KEY)
    const coins = result.data && Number(result.data.coins)
    if (Number.isFinite(coins)) this.updateCoinBalance(coins)
    return result
  },

  async reconcilePendingShareReward() {
    const pendingClaimId = wx.getStorageSync(PENDING_SHARE_REWARD_KEY)
    if (!pendingClaimId) return true
    try {
      await this.rewardShareCoins(pendingClaimId)
      return true
    } catch (error) {
      wx.showToast({ title: error.message || '上次分享奖励确认中，请稍后重试', icon: 'none' })
      return false
    }
  },

  async ensureShareReady() {
    if (this.data.checkedToday || this.data.shareReady || this.data.enteredAfterCheckin) return true
    const today = formatDateKey(new Date())
    try {
      const now = new Date()
      const checkins = await cloudApi.getCheckins(now.getFullYear(), now.getMonth() + 1)
      const checkedToday = checkins.some((item) => item.dateStr === today)
      this.setData({ checkedToday, shareReady: checkedToday })
      if (checkedToday) return true
    } catch (error) {
      wx.showToast({ title: '打卡状态加载失败，请稍后重试', icon: 'none' })
      return false
    }
    wx.showToast({ title: '完成今日学习任务并打卡后才能分享海报', icon: 'none' })
    return false
  },

  requestPrivacyConsent(filePath, privacyContractName) {
    this._pendingShareFilePath = filePath
    this.setData({
      showPrivacyDialog: true,
      privacyContractName: privacyContractName || '《仕舟小程序隐私保护指引》'
    })
  },

  async recoverAlbumPermission() {
    return imageSharing.recoverAlbumPermission(wx, {
      albumPermissionMessage: '保存打卡海报需要“添加到相册”权限。请在设置中开启，返回后将自动继续保存。'
    })
  },

  async runImageShare(filePath, skipShareMenu = false) {
    return imageSharing.shareImageWithFallback(filePath, {
      wxApi: wx,
      skipShareMenu,
      onPrivacyRequired: (pendingPath, contractName) => this.requestPrivacyConsent(pendingPath, contractName),
      recoverAlbumPermission: () => this.recoverAlbumPermission()
    })
  },

  async handleShareResult(result) {
    if (!result || result.status === 'privacy-required') return
    if (result.status === 'cancelled') {
      this._shareClaimId = ''
      return
    }
    if (result.status === 'shared' || result.status === 'saved') {
      const reward = await this.rewardShareCoins(this._shareClaimId)
      this._shareClaimId = ''
      const amount = Number(reward.data && reward.data.amount) || CHECKIN_SHARE_REWARD
      wx.showToast({
        title: result.status === 'shared' ? `分享成功，+${amount}舟币` : `图片已保存，+${amount}舟币`,
        icon: 'none'
      })
      return
    }
    if (result.status === 'permission-denied') {
      this._shareClaimId = ''
      wx.showToast({ title: '未开启相册权限，暂未保存', icon: 'none' })
    }
  },

  async handleAgreePrivacyAuthorization() {
    const filePath = this._pendingShareFilePath
    this._pendingShareFilePath = ''
    this.setData({ showPrivacyDialog: false, sharing: true })
    if (!filePath) {
      this.setData({ sharing: false })
      return
    }
    try {
      const result = await this.runImageShare(filePath, true)
      await this.handleShareResult(result)
    } catch (error) {
      if (!wx.getStorageSync(PENDING_SHARE_REWARD_KEY)) this._shareClaimId = ''
      wx.showToast({ title: imageSharing.getErrorMessage(error) || '图片保存失败', icon: 'none' })
    } finally {
      this.setData({ sharing: false })
    }
  },

  handleRejectPrivacyAuthorization() {
    this._pendingShareFilePath = ''
    this._shareClaimId = ''
    this.setData({ showPrivacyDialog: false, sharing: false })
  },

  openPrivacyContract() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.navigateTo({ url: '/pages/privacy/privacy' })
      return
    }
    wx.openPrivacyContract({
      fail: () => wx.navigateTo({ url: '/pages/privacy/privacy' })
    })
  },

  noop() {},

  async shareFullImage() {
    if (this.data.sharing) return
    const loggedIn = await auth.requireLogin('分享打卡海报前请先登录账号。')
    if (!loggedIn) return
    const shareReady = await this.ensureShareReady()
    if (!shareReady) return
    const pendingReconciled = await this.reconcilePendingShareReward()
    if (!pendingReconciled) return
    this._shareClaimId = `checkinShare:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`
    this.setData({ sharing: true })
    wx.showLoading({ title: '准备图片中', mask: true })
    let loadingVisible = true
    try {
      const filePath = await this.buildShareImageFile()
      wx.hideLoading()
      loadingVisible = false
      const result = await this.runImageShare(filePath)
      await this.handleShareResult(result)
    } catch (err) {
      if (loadingVisible) wx.hideLoading()
      if (!wx.getStorageSync(PENDING_SHARE_REWARD_KEY)) this._shareClaimId = ''
      const message = err && err.code === 'PRIVACY_SCOPE_NOT_DECLARED'
        ? '相册权限配置尚未生效，请稍后重试'
        : (imageSharing.getErrorMessage(err) || '图片分享失败，请稍后重试')
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      this.setData({ sharing: false })
    }
  },

  onShareAppMessage() {
    return {
      title: `${this.data.quote}`,
      path: '/pages/home/home',
      imageUrl: this.data.currentWallpaper
    }
  }
})
