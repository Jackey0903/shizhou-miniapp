// pages/study-plan/study-plan.js
const cloudApi = require('../../utils/cloudApi')
const { decodeRouteParam } = require('../../utils/routeParams')

const DAILY_COUNT_OPTIONS = Array.from({ length: 50 }, (_, index) => index + 1)

function calcRemainDays(deadline, fallbackTotal = 0, dailyCount = 10, learnedCount = 0) {
    if (deadline) {
        return Math.max(0, Math.ceil((new Date(deadline) - Date.now()) / 86400000))
    }
    const remainCount = Math.max(0, fallbackTotal - learnedCount)
    return remainCount > 0 ? Math.max(1, Math.ceil(remainCount / Math.max(1, dailyCount))) : 0
}

function isSameDay(value, targetDate) {
    if (!value) return false
    const date = value instanceof Date ? value : new Date(value)
    return date.getFullYear() === targetDate.getFullYear()
        && date.getMonth() === targetDate.getMonth()
        && date.getDate() === targetDate.getDate()
}

Page({
    data: {
        courseId: '',
        courseName: '',
        course: {},
        plan: {},
        bannerAdUnitId: '',
        saving: false,
        learnedCount: 0,
        learnedPct: 0,
        remainDays: 0,
        todayNew: 0,
        todayReview: 0,
        dailyCountOptions: DAILY_COUNT_OPTIONS,
        dailyCountIndex: 9,
        modeOptions: ['顺序刷题', '随机刷题'],
        modeIndex: 0
    },

    async onLoad(options) {
        const courseId = options.courseId || ''
        const courseName = decodeRouteParam(options.courseName)
        this.setData({ courseId, courseName })
        wx.setNavigationBarTitle({ title: courseName || '制定计划' })
        await Promise.all([this._loadData(), this._loadAdSlot()])
    },

    async _loadAdSlot() {
        try {
            const app = getApp()
            if (app.globalData.isVip) {
                this.setData({ bannerAdUnitId: '' })
                return
            }
            const slot = await cloudApi.getAdSlot('study-plan-banner')
            this.setData({ bannerAdUnitId: slot ? (slot.unitId || slot.adUnitId || '') : '' })
        } catch (err) {}
    },

    async _loadData() {
        wx.showLoading({ title: '加载中' })
        try {
            const [course, plans] = await Promise.all([
                cloudApi.getCourse(this.data.courseId),
                cloudApi.getPlans()
            ])

            const plan = plans.find(p => p.courseId === this.data.courseId) || {}
            const total = course.totalCount || 0

            // 计算已学数
            const records = await cloudApi.getStudyRecords(this.data.courseId)
            const planRecords = records
            const learnedCount = new Set(planRecords.map(r => r.questionId).filter(Boolean)).size
            const learnedPct = total > 0 ? Math.round((learnedCount / total) * 100) : 0

            // 今日进度
            const today = new Date()
            const todayNew = planRecords.filter(r => isSameDay(r.createdAt, today)).length
            const todayReview = planRecords.filter(r =>
                !isSameDay(r.createdAt, today) && isSameDay(r.updatedAt, today)
            ).length

            // 剩余天数
            const dailyCount = plan.dailyCount || this.data.dailyCountOptions[this.data.dailyCountIndex] || 10
            const remainDays = calcRemainDays(plan.deadline, total, dailyCount, learnedCount)

            const dailyCountIndex = this.data.dailyCountOptions.indexOf(plan.dailyCount || 10)
            const modeIndex = plan.mode === 'random' ? 1 : 0

            this.setData({
                course,
                plan,
                learnedCount,
                learnedPct,
                remainDays,
                todayNew,
                todayReview,
                dailyCountIndex: dailyCountIndex >= 0 ? dailyCountIndex : 9,
                modeIndex
            })
        } catch (e) {
            console.error(e)
        } finally {
            wx.hideLoading()
        }
    },

    onDailyCountChange(e) {
        const dailyCountIndex = parseInt(e.detail.value)
        const dailyCount = this.data.dailyCountOptions[dailyCountIndex]
        this.setData({
            dailyCountIndex,
            remainDays: calcRemainDays(this.data.plan.deadline, this.data.course.totalCount || 0, dailyCount, this.data.learnedCount)
        })
    },

    onModeChange(e) {
        this.setData({ modeIndex: parseInt(e.detail.value) })
    },

    onDeadlineChange(e) {
        const deadline = e.detail.value
        const dailyCount = this.data.dailyCountOptions[this.data.dailyCountIndex]
        this.setData({
            'plan.deadline': deadline,
            'plan.deadlineLabel': deadline,
            remainDays: calcRemainDays(deadline, this.data.course.totalCount || 0, dailyCount, this.data.learnedCount)
        })
    },

    async savePlan(options = {}) {
        const silent = options && options.silent === true
        if (this.data.saving) return false
        this.setData({ saving: true })
        const dailyCount = this.data.dailyCountOptions[this.data.dailyCountIndex]
        const mode = this.data.modeIndex === 1 ? 'random' : 'sequential'

        try {
            const res = await cloudApi.savePlan({
                planId: this.data.plan._id || '',
                courseId: this.data.courseId,
                dailyCount,
                mode,
                deadline: this.data.plan.deadline || null
            })
            if (res.result && res.result.code === 0) {
                this.setData({
                    'plan._id': (res.result.data && res.result.data.planId) || this.data.plan._id,
                    'plan.dailyCount': dailyCount,
                    'plan.mode': mode,
                    remainDays: calcRemainDays(this.data.plan.deadline, this.data.course.totalCount || 0, dailyCount, this.data.learnedCount)
                })
                if (!silent) {
                    wx.showToast({ title: '计划已保存', icon: 'success' })
                    wx.redirectTo({
                        url: '/pages/study-book/study-book',
                        fail: () => {
                            wx.navigateTo({
                                url: '/pages/study-book/study-book',
                                fail: () => wx.navigateBack({ delta: 1 })
                            })
                        }
                    })
                }
                return true
            }
            throw new Error((res.result && (res.result.error || res.result.msg)) || '保存失败')
        } catch (e) {
            wx.showToast({ title: e.message || '保存失败', icon: 'none' })
            return false
        } finally {
            this.setData({ saving: false })
        }
    },

    async startNew() {
        const saved = await this.savePlan({ silent: true })
        if (!saved) return
        wx.navigateTo({
            url: `/pages/question/question?courseId=${encodeURIComponent(this.data.courseId)}&courseName=${encodeURIComponent(this.data.courseName)}&planId=${encodeURIComponent(this.data.plan._id || '')}&mode=new`
        })
    },

    startReview() {
        wx.navigateTo({
            url: `/pages/question/question?courseId=${encodeURIComponent(this.data.courseId)}&courseName=${encodeURIComponent(this.data.courseName)}&planId=${encodeURIComponent(this.data.plan._id || '')}&mode=review`
        })
    }
})
