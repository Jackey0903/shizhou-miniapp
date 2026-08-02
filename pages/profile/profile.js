const cloudApi = require('../../utils/cloudApi')
const auth = require('../../utils/auth')

Page({
    data: {
        userInfo: null,
        isLogin: false,
        isVip: false
    },

    onShow() {
        const app = getApp()
        this.setData({
            userInfo: app.globalData.userInfo,
            isLogin: app.globalData.isLogin,
            isVip: app.globalData.isVip
        })

        // 如果已登录，刷新用户数据
        if (app.globalData.isLogin) {
            this._refreshUser()
        }
    },

    async _refreshUser() {
        try {
            const user = await cloudApi.getCurrentUser()
            if (user) {
                const app = getApp()
                const vipExpiryTime = user.vipExpireDate ? new Date(user.vipExpireDate).getTime() : 0
                app.globalData.userInfo = user
                app.globalData.isVip = !!(user.isVip && (!vipExpiryTime || vipExpiryTime > Date.now()))
                app.globalData.vipExpireDate = user.vipExpireDate || null
                app.globalData.coins = user.coins || 0
                wx.setStorageSync('userInfo', user)
                this.setData({ userInfo: user, isVip: app.globalData.isVip })
            } else {
                this._clearSession()
            }
        } catch (e) {
            console.error('刷新用户失败', e)
            if (e.code === 428 || e.errorCode === 'PHONE_REQUIRED') {
                this._clearSession()
                wx.showToast({ title: '请绑定手机号后重新登录', icon: 'none' })
            }
        }
    },

    _clearSession() {
        auth.clearLocalLogin()
        this.setData({ userInfo: null, isLogin: false, isVip: false })
    },

    goLogin() {
        wx.navigateTo({ url: '/pages/login/login' })
    },

    onLogout() {
        wx.showModal({
            title: '确认退出',
            content: '退出后需要重新登录',
            success: (res) => {
                if (res.confirm) {
                    this._clearSession()
                }
            }
        })
    }
})
