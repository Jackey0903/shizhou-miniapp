function buildCurrentPageUrl() {
  const pages = getCurrentPages ? getCurrentPages() : []
  const current = pages[pages.length - 1]
  if (!current || !current.route) return ''
  const options = current.options || {}
  const query = Object.keys(options)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`)
    .join('&')
  return `/${current.route}${query ? `?${query}` : ''}`
}

function hasLocalLogin() {
  const app = getApp()
  if (app.globalData && app.globalData.isLogin && app.globalData.userInfo) return true
  try {
    return !!wx.getStorageSync('userInfo')
  } catch (err) {
    return false
  }
}

function requireLogin(message = '购买前请先登录账号') {
  if (hasLocalLogin()) return Promise.resolve(true)

  const redirect = buildCurrentPageUrl()
  return new Promise((resolve) => {
    wx.showModal({
      title: '请先登录',
      content: message,
      confirmText: '去登录',
      cancelText: '取消',
      success(res) {
        if (!res.confirm) {
          resolve(false)
          return
        }
        wx.navigateTo({
          url: `/pages/login/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`,
          success: () => resolve(false),
          fail: () => {
            wx.showToast({ title: '无法打开登录页', icon: 'none' })
            resolve(false)
          }
        })
      },
      fail() {
        resolve(false)
      }
    })
  })
}

module.exports = {
  hasLocalLogin,
  requireLogin
}
