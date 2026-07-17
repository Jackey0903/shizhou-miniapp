// pages/calendar/calendar.js
const cloudApi = require('../../utils/cloudApi')

function sameDate(value, target) {
    if (!value) return false
    const date = value instanceof Date ? value : new Date(value)
    return date.getFullYear() === target.getFullYear()
        && date.getMonth() === target.getMonth()
        && date.getDate() === target.getDate()
}

function stripPrefix(name = '') {
    return name.replace(/^(([0-9]+|[一二三四五六七八九十]{1,3})[\.、\s]*)/, '')
}

function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

Page({
    data: {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        weekdays: ['日', '一', '二', '三', '四', '五', '六'],
        calDays: [],
        checkinDates: [],
        todayRecords: [],
        planItems: [],
        canCheckin: false
    },

    onLoad() {
        this._buildCalendar()
        this._loadData()
    },

    onShow() {
        this._loadData()
    },

    _buildCalendar() {
        const { year, month } = this.data
        const firstDay = new Date(year, month - 1, 1).getDay()
        const daysInMonth = new Date(year, month, 0).getDate()
        const daysInPrev = new Date(year, month - 1, 0).getDate()
        const today = new Date()
        const todayStr = formatDateKey(today)

        const days = []
        for (let i = firstDay - 1; i >= 0; i--) {
            days.push({ day: daysInPrev - i, isCurrentMonth: false, date: '' })
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            days.push({
                day: d,
                date: dateStr,
                isCurrentMonth: true,
                isToday: dateStr === todayStr,
                isCheckin: this.data.checkinDates.includes(dateStr)
            })
        }

        while (days.length < 42) {
            days.push({ day: days.length - daysInMonth - firstDay + 1, isCurrentMonth: false, date: '' })
        }

        this.setData({ calDays: days })
    },

    async _loadData() {
        try {
            const [checkins, records, plans, courses] = await Promise.all([
                cloudApi.getCheckins(this.data.year, this.data.month),
                cloudApi.getStudyRecords(),
                cloudApi.getPlans(),
                cloudApi.getCourses()
            ])
            const checkinDates = checkins.map(c => c.dateStr)
            this.setData({ checkinDates })
            this._buildCalendar()

            const today = new Date()
            const bankMap = {}
            courses.forEach((course) => {
                bankMap[course._id] = course
            })

            const todayRecords = records
                .filter((r) => sameDate(r.updatedAt, today))
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
                .slice(0, 20)
                .map((r) => {
                    const bank = bankMap[r.courseId] || {}
                    return {
                        ...r,
                        timeLabel: new Date(r.updatedAt).toTimeString().slice(0, 5),
                        bankName: stripPrefix(bank.name || '未分类题库'),
                        description: r.questionContent || '已完成学习任务',
                        doneText: r.result === 'know' ? '已掌握' : r.result === 'maybe' ? '待加强' : '需复习'
                    }
                })

            const planItems = plans.map((plan) => {
                const bank = bankMap[plan.courseId] || {}
                const bankRecords = records.filter((r) => (
                    (r.planId && r.planId === plan._id) || (!r.planId && r.courseId === plan.courseId)
                ))
                const finishedToday = bankRecords.filter((r) => sameDate(r.updatedAt, today)).length
                const targetCount = plan.dailyCount || 10
                const remainingCount = Math.max(0, targetCount - finishedToday)
                const done = remainingCount === 0 && targetCount > 0
                return {
                    _id: plan._id,
                    courseId: plan.courseId,
                    title: stripPrefix(bank.name || '未命名题库'),
                    deadline: plan.deadline ? new Date(plan.deadline).toLocaleDateString() : '未设置',
                    targetCount,
                    finishedToday,
                    remainingCount,
                    done,
                    tag: done ? '已完成' : `还差${remainingCount}题`
                }
            }).sort((a, b) => Number(a.done) - Number(b.done))

            const canCheckin = planItems.some((item) => item.done)

            this.setData({ todayRecords, planItems, canCheckin })
        } catch (e) {
            console.error(e)
        }
    },

    prevMonth() {
        let { year, month } = this.data
        month -= 1
        if (month < 1) { month = 12; year -= 1 }
        this.setData({ year, month })
        this._buildCalendar()
        this._loadData()
    },

    nextMonth() {
        let { year, month } = this.data
        month += 1
        if (month > 12) { month = 1; year += 1 }
        this.setData({ year, month })
        this._buildCalendar()
        this._loadData()
    },

    onPlanTap(e) {
        const { courseid } = e.currentTarget.dataset
        if (!courseid) return
        wx.navigateTo({ url: `/pages/study-plan/study-plan?courseId=${courseid}` })
    },

    goCheckin() {
        if (!this.data.canCheckin) {
            wx.showToast({
                title: '完成任一题库今日任务后即可打卡',
                icon: 'none'
            })
            return
        }
        wx.navigateTo({ url: '/pages/checkin/checkin' })
    }
})
