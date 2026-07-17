// pages/login/login.js
const cloudApi = require('../../utils/cloudApi')

Page({
    data: {
        agreed: false,
        loading: false,
        redirect: ''
    },

    onLoad(options = {}) {
        this.setData({ redirect: options.redirect ? decodeURIComponent(options.redirect) : '' })
    },

    onAgreeChange(e) {
        this.setData({ agreed: e.detail.value.includes('agree') })
    },

    // 微信一键登录
    async onWechatLogin() {
        if (!this.data.agreed) {
            wx.showToast({ title: '请先勾选并同意用户协议和隐私政策', icon: 'none' })
            return
        }

        this.setData({ loading: true })
        wx.showLoading({ title: '登录中...', mask: true })

        try {
            const res = await cloudApi.userLogin({})

            if (res.result && res.result.code === 0) {
                this._loginSuccess(res.result.data)
            } else {
                wx.showToast({ title: (res.result && (res.result.msg || res.result.error)) || '登录失败，请重试', icon: 'none' })
            }
        } catch (err) {
            wx.showToast({ title: err.message || '登录失败，请重试', icon: 'none' })
        } finally {
            wx.hideLoading()
            this.setData({ loading: false })
        }
    },

    // 手机号登录
    async onPhoneLogin(e) {
        if (!this.data.agreed) {
            wx.showToast({ title: '请先勾选并同意用户协议和隐私政策', icon: 'none' })
            return
        }
        if (e.detail.errMsg !== 'getPhoneNumber:ok') return

        this.setData({ loading: true })
        wx.showLoading({ title: '登录中...', mask: true })
        try {
            const payload = { loginType: 'phone' }
            if (e.detail.code) payload.phoneCode = e.detail.code
            if (e.detail.cloudID) payload.phoneData = wx.cloud.CloudID(e.detail.cloudID)
            if (e.detail.encryptedData && e.detail.iv) {
                payload.encryptedData = e.detail.encryptedData
                payload.iv = e.detail.iv
            }
            if (!payload.phoneCode && !payload.phoneData && !payload.encryptedData) {
                throw new Error('未获取到手机号授权凭证')
            }
            const res = await cloudApi.userLogin({
                ...payload
            })
            if (res.result && res.result.code === 0) {
                this._loginSuccess(res.result.data)
            } else {
                wx.showToast({ title: (res.result && (res.result.msg || res.result.error)) || '登录失败', icon: 'none' })
            }
        } catch (err) {
            wx.showToast({ title: err.message || '登录失败，请重试', icon: 'none' })
        } finally {
            wx.hideLoading()
            this.setData({ loading: false })
        }
    },

    _loginSuccess(userInfo) {
        const { token, ...profile } = userInfo
        const app = getApp()
        app.globalData.userInfo = profile
        app.globalData.isLogin = true
        app.globalData.isVip = profile.isVip
        app.globalData.coins = profile.coins || 0
        if (token) {
            app.globalData.token = token
            wx.setStorageSync('token', token)
        }

        wx.setStorageSync('userInfo', profile)

        const redirect = this.data.redirect
        if (redirect) {
            wx.redirectTo({
                url: redirect,
                fail: () => wx.switchTab({ url: '/pages/home/home' })
            })
            return
        }

        const pages = getCurrentPages()
        if (pages.length > 1) {
            wx.navigateBack()
        } else {
            wx.switchTab({ url: '/pages/home/home' })
        }
    },

    skipLogin() {
        wx.switchTab({ url: '/pages/home/home' })
    }
})
