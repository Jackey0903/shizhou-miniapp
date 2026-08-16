// pages/study-plan/study-plan.js
const cloudApi = require('../../utils/cloudApi')
const { decodeRouteParam } = require('../../utils/routeParams')
const { calcStudySchedule } = require('../../utils/studyPlan')

const DAILY_COUNT_OPTIONS = Array.from({ length: 50 }, (_, index) => index + 1)

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

            const savedPlan = plans.find(p => p.courseId === this.data.courseId) || {}
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

            const dailyCount = savedPlan.dailyCount || this.data.dailyCountOptions[this.data.dailyCountIndex] || 10
            const schedule = calcStudySchedule(total, dailyCount, learnedCount)
            const plan = {
                ...savedPlan,
                dailyCount,
                deadline: schedule.deadline,
                deadlineLabel: schedule.deadlineLabel
            }

            const dailyCountIndex = this.data.dailyCountOptions.indexOf(plan.dailyCount || 10)
            const modeIndex = plan.mode === 'random' ? 1 : 0

            this.setData({
                course,
                plan,
                learnedCount,
                learnedPct,
                remainDays: schedule.remainDays,
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
        const schedule = calcStudySchedule(
            this.data.course.totalCount || 0,
            dailyCount,
            this.data.learnedCount
        )
        this.setData({
            dailyCountIndex,
            'plan.dailyCount': dailyCount,
            'plan.deadline': schedule.deadline,
            'plan.deadlineLabel': schedule.deadlineLabel,
            remainDays: schedule.remainDays
        })
    },

    onModeChange(e) {
        const modeIndex = parseInt(e.detail.value)
        this.setData({
            modeIndex,
            'plan.mode': modeIndex === 1 ? 'random' : 'sequential'
        })
    },

    async savePlan(options = {}) {
        const silent = options && options.silent === true
        if (this.data.saving) return false
        this.setData({ saving: true })
        const dailyCount = this.data.dailyCountOptions[this.data.dailyCountIndex]
        const mode = this.data.modeIndex === 1 ? 'random' : 'sequential'
        const schedule = calcStudySchedule(
            this.data.course.totalCount || 0,
            dailyCount,
            this.data.learnedCount
        )
        this.setData({
            'plan.dailyCount': dailyCount,
            'plan.mode': mode,
            'plan.deadline': schedule.deadline,
            'plan.deadlineLabel': schedule.deadlineLabel,
            remainDays: schedule.remainDays
        })

        try {
            const res = await cloudApi.savePlan({
                planId: this.data.plan._id || '',
                courseId: this.data.courseId,
                dailyCount,
                mode,
                deadline: schedule.deadline || null
            })
            if (res.result && res.result.code === 0) {
                this.setData({
                    'plan._id': (res.result.data && res.result.data.planId) || this.data.plan._id,
                    'plan.dailyCount': dailyCount,
                    'plan.mode': mode,
                    'plan.deadline': schedule.deadline,
                    'plan.deadlineLabel': schedule.deadlineLabel,
                    remainDays: schedule.remainDays
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
