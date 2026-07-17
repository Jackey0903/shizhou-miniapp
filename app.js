// app.js
const CLOUD_ENV_ID = 'cloud-2ge02vrucaf8a6ab'

App({
  onLaunch() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: true
      })
    }

    // 检查本地缓存的用户信息
    const userInfo = wx.getStorageSync('userInfo')
    const token = wx.getStorageSync('token')
    if (userInfo) {
      this.globalData.userInfo = userInfo
      this.globalData.isLogin = true
    }
    if (token) {
      this.globalData.token = token
    }

    // 检查更新
    this._checkUpdate()
  },

  _checkUpdate() {
    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager()
      updateManager.onUpdateReady(() => {
        wx.showModal({
          title: '更新提示',
          content: '新版本已经准备好，是否重启应用？',
          success(res) {
            if (res.confirm) {
              updateManager.applyUpdate()
            }
          }
        })
      })
    }
  },

  // 全局工具方法：跳转到登录页
  goLogin(redirect = '') {
    wx.navigateTo({
      url: `/pages/login/login?redirect=${encodeURIComponent(redirect)}`
    })
  },

  // 全局工具方法：显示 loading
  showLoading(title = '加载中...') {
    wx.showLoading({ title, mask: true })
  },

  hideLoading() {
    wx.hideLoading()
  },

  globalData: {
    userInfo: null,
    isLogin: false,
    cloudEnv: CLOUD_ENV_ID,
    // VIP 状态（登录后从云端同步）
    isVip: false,
    vipExpireDate: null,
    // 舟币余额
    coins: 0,
    token: ''
  }
})
