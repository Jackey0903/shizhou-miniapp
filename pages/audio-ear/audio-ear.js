const cloudApi = require('../../utils/cloudApi')

const CATEGORY_LIST = ['常识', '数量', '言语', '逻辑', '资料', '申论', '综应', '面试']
const HOURS = Array.from({ length: 24 }, (_, i) => `${i}小时`)
const MINUTES = Array.from({ length: 12 }, (_, i) => `${i * 5}分钟`)

Page({
  data: {
    categories: CATEGORY_LIST,
    activeCategory: '常识',
    audios: [],
    filteredAudios: [],
    playingId: '',
    paused: false,
    playMode: 'single',
    timerValue: [0, 0],
    timerLabel: '未设置',
    currentTitle: '',
    currentCategory: '',
    currentTime: 0,
    duration: 0,
    progressValue: 0,
    currentTimeText: '00:00',
    durationText: '00:00',
    timerOptions: [HOURS, MINUTES]
  },

  async onLoad() {
    this.ensureAudioContext()
    await this.loadAudios()
  },

  onShow() {
    this.syncAudioState()
    this.checkSleepTimer()
  },

  onUnload() {
    this.clearSleepTimer()
    // 后台音频不在页面卸载时销毁，避免锁屏/切后台后播放被小程序页面生命周期打断。
    this.unbindAudioEvents()
    if (!this._usingBackgroundAudio) this.stopAudio()
    this._audioCtx = null
  },

  async loadAudios() {
    try {
      const audios = await cloudApi.getAudios()
      this.setData({ audios: audios || [] })
      this.applyFilter()
    } catch (e) {
      wx.showToast({ title: '音频加载失败', icon: 'none' })
    }
  },

  applyFilter() {
    const activeCategory = this.data.activeCategory
    const filteredAudios = (this.data.audios || []).filter((item) => item.category === activeCategory)
    this.setData({ filteredAudios })
  },

  switchCategory(e) {
    this.stopAudio()
    this.setData({
      activeCategory: e.currentTarget.dataset.category,
      playingId: '',
      paused: false,
      currentTitle: '',
      currentCategory: '',
      currentTime: 0,
      duration: 0,
      progressValue: 0,
      currentTimeText: '00:00',
      durationText: '00:00'
    })
    this.applyFilter()
  },

  toggleMode() {
    const playMode = this.data.playMode === 'single' ? 'list' : 'single'
    this.setData({ playMode })
    wx.showToast({ title: playMode === 'single' ? '单曲循环' : '连续播放', icon: 'none' })
  },

  onTimerChange(e) {
    const timerValue = e.detail.value
    const hours = Number(timerValue[0])
    const minutes = Number(timerValue[1]) * 5
    const timerLabel = hours === 0 && minutes === 0 ? '未设置' : `${hours}小时${minutes}分钟`
    this.setData({ timerValue, timerLabel })
    this.resetSleepTimer(hours, minutes)
  },

  resetSleepTimer(hours, minutes) {
    this.clearSleepTimer()
    const totalMs = (hours * 60 + minutes) * 60 * 1000
    if (!totalMs) return
    this._sleepDeadline = Date.now() + totalMs
    this._sleepTimer = setInterval(() => this.checkSleepTimer(true), 1000)
  },

  clearSleepTimer() {
    if (this._sleepTimer) {
      clearInterval(this._sleepTimer)
      this._sleepTimer = null
    }
    this._sleepDeadline = 0
  },

  checkSleepTimer(showToast = false) {
    if (!this._sleepDeadline || Date.now() < this._sleepDeadline) return
    this.clearSleepTimer()
    this.setData({ timerLabel: '已关闭' })
    this.pauseCurrent(showToast ? '已到定时关闭时间' : '')
  },

  stopAudio() {
    if (this._audioCtx && this.data.playingId) {
      try {
        this._audioCtx.stop()
      } catch (e) {}
    }
    this._currentIndex = 0
    this._currentSrc = ''
    this._seeking = false
  },

  playAudio(e) {
    const { item, index } = e.currentTarget.dataset
    if (!item) return

    this.ensureAudioContext()

    if (this.data.playingId === item._id) {
      this.toggleCurrent()
      return
    }

    this.startByIndex(Number(index), true)
  },

  toggleCurrent() {
    if (!this._audioCtx || !this.data.playingId) return
    if (this.data.paused) {
      try {
        this._audioCtx.play()
      } catch (e) {}
      this.setData({ paused: false })
      this.checkSleepTimer()
    } else {
      this.pauseCurrent()
    }
  },

  pauseCurrent(toastTitle = '') {
    if (this._audioCtx) {
      try {
        this._audioCtx.pause()
      } catch (e) {}
    }
    this.setData({ paused: true })
    if (toastTitle) wx.showToast({ title: toastTitle, icon: 'none' })
  },

  ensureAudioContext() {
    if (this._audioCtx) return
    this._usingBackgroundAudio = !!wx.getBackgroundAudioManager
    this._audioCtx = this._usingBackgroundAudio ? wx.getBackgroundAudioManager() : wx.createInnerAudioContext()
    if (!this._usingBackgroundAudio) this._audioCtx.obeyMuteSwitch = false

    this.bindAudioEvents()
  },

  bindAudioEvents() {
    if (!this._audioCtx || this._audioHandlers) return
    const handlers = {
      play: () => {
        this.setData({ paused: false })
        this.checkSleepTimer()
      },
      pause: () => {
        this.setData({ paused: true })
      },
      stop: () => {
        this._currentSrc = ''
        this.setData({ playingId: '', paused: false })
      },
      ended: () => {
        this.updateProgress(this.data.duration, this.data.duration)
        this.handleEnded()
      },
      timeUpdate: () => {
        this.checkSleepTimer(true)
        if (this._seeking) return
        const currentTime = this._audioCtx.currentTime || 0
        const duration = this._audioCtx.duration || this.data.duration || 0
        this.updateProgress(currentTime, duration)
      },
      canplay: () => {
        setTimeout(() => {
          if (!this._audioCtx) return
          this.updateProgress(this._audioCtx.currentTime || 0, this._audioCtx.duration || 0)
        }, 300)
      },
      error: (err) => {
        console.error('音频播放失败', err)
        wx.showToast({ title: '音频播放失败', icon: 'none' })
        this.setData({ playingId: '', paused: false })
      }
    }
    this._audioHandlers = handlers
    this._audioCtx.onPlay(handlers.play)
    this._audioCtx.onPause(handlers.pause)
    this._audioCtx.onStop(handlers.stop)
    this._audioCtx.onEnded(handlers.ended)
    this._audioCtx.onTimeUpdate(handlers.timeUpdate)
    this._audioCtx.onCanplay(handlers.canplay)
    this._audioCtx.onError(handlers.error)
  },

  unbindAudioEvents() {
    if (!this._audioCtx || !this._audioHandlers) return
    const handlers = this._audioHandlers
    if (this._audioCtx.offPlay) this._audioCtx.offPlay(handlers.play)
    if (this._audioCtx.offPause) this._audioCtx.offPause(handlers.pause)
    if (this._audioCtx.offStop) this._audioCtx.offStop(handlers.stop)
    if (this._audioCtx.offEnded) this._audioCtx.offEnded(handlers.ended)
    if (this._audioCtx.offTimeUpdate) this._audioCtx.offTimeUpdate(handlers.timeUpdate)
    if (this._audioCtx.offCanplay) this._audioCtx.offCanplay(handlers.canplay)
    if (this._audioCtx.offError) this._audioCtx.offError(handlers.error)
    this._audioHandlers = null
  },

  handleEnded() {
    if (this.data.playMode === 'single') {
      this.restartCurrent()
      return
    }
    const nextIndex = Number(this._currentIndex || 0) + 1
    if (nextIndex < this.data.filteredAudios.length) {
      this.startByIndex(nextIndex, true)
    } else {
      this.setData({ playingId: '', paused: false })
    }
  },

  restartCurrent() {
    if (!this._audioCtx || !this.data.playingId) return
    try {
      this._audioCtx.seek(0)
      setTimeout(() => {
        if (this._audioCtx && this.data.playingId) this._audioCtx.play()
      }, 120)
    } catch (e) {
      this.startByIndex(Number(this._currentIndex || 0), true)
    }
  },

  startByIndex(index, forceRestart = false) {
    const item = this.data.filteredAudios[index]
    if (!item) return
    this.ensureAudioContext()
    this.resolveAudioUrl(item).then((src) => {
      if (!src) {
        wx.showToast({ title: '音频地址缺失', icon: 'none' })
        return
      }
      this._currentIndex = index
      const title = item.title || '仕舟磨耳朵'
      if (this._usingBackgroundAudio) {
        this._audioCtx.title = title
        this._audioCtx.singer = '仕舟'
        if (item.coverUrl || item.imageUrl) this._audioCtx.coverImgUrl = item.coverUrl || item.imageUrl
      }
      if (this._currentSrc !== src || forceRestart) {
        this._audioCtx.src = src
        this._currentSrc = src
      }
      this._audioCtx.play()
      this.setData({
        playingId: item._id,
        paused: false,
        currentTitle: title,
        currentCategory: item.category || this.data.activeCategory,
        currentTime: 0,
        duration: 0,
        progressValue: 0,
        currentTimeText: '00:00',
        durationText: this.formatDurationText(item.duration)
      })
    }).catch(() => {
      wx.showToast({ title: '音频地址缺失', icon: 'none' })
    })
  },

  syncAudioState() {
    if (!this._audioCtx || !this.data.playingId) return
    const currentTime = this._audioCtx.currentTime || this.data.currentTime || 0
    const duration = this._audioCtx.duration || this.data.duration || 0
    this.updateProgress(currentTime, duration)
    if (typeof this._audioCtx.paused === 'boolean') {
      this.setData({ paused: this._audioCtx.paused })
    }
  },

  onProgressChanging(e) {
    const value = Number(e.detail.value || 0)
    this._seeking = true
    const duration = this.data.duration || 0
    const currentTime = duration ? duration * value / 100 : 0
    this.setData({
      progressValue: value,
      currentTime,
      currentTimeText: this.formatTime(currentTime)
    })
  },

  onProgressChange(e) {
    const value = Number(e.detail.value || 0)
    const duration = this.data.duration || 0
    this._seeking = false
    if (!this._audioCtx || !duration) return
    const currentTime = duration * value / 100
    this._audioCtx.seek(currentTime)
    this.updateProgress(currentTime, duration)
  },

  updateProgress(currentTime, duration) {
    const safeCurrent = Math.max(0, Number(currentTime || 0))
    const safeDuration = Math.max(0, Number(duration || 0))
    const progressValue = safeDuration ? Math.min(100, Math.round((safeCurrent / safeDuration) * 100)) : 0
    this.setData({
      currentTime: safeCurrent,
      duration: safeDuration,
      progressValue,
      currentTimeText: this.formatTime(safeCurrent),
      durationText: safeDuration ? this.formatTime(safeDuration) : this.data.durationText
    })
  },

  formatDurationText(value) {
    if (typeof value === 'number') return this.formatTime(value)
    if (/^\d+:\d{2}$/.test(String(value || ''))) return String(value)
    return '00:00'
  },

  formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds || 0)))
    const minutes = Math.floor(total / 60)
    const rest = total % 60
    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  },

  async resolveAudioUrl(item) {
    if (item.fileId && item.fileId.startsWith('cloud://')) {
      const res = await wx.cloud.getTempFileURL({ fileList: [item.fileId] })
      const file = (res.fileList || [])[0]
      return file ? file.tempFileURL : ''
    }
    if (item.fileUrl || item.audioUrl) return item.fileUrl || item.audioUrl
    return item.fileId || ''
  }
})
