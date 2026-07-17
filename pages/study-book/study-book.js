const cloudApi = require('../../utils/cloudApi')

const stripPrefix = (name = '') => name.replace(/^(([0-9]+|[一二三四五六七八九十]{1,3})[\.、\s]*)/, '')

Page({
  data: {
    plans: [],
    loading: true
  },

  onLoad() {
    this.loadPlans()
  },

  onShow() {
    this.loadPlans()
  },

  async loadPlans() {
    this.setData({ loading: true })
    try {
      const [plans, courses, records] = await Promise.all([
        cloudApi.getPlans(),
        cloudApi.getCourses(),
        cloudApi.getStudyRecords().catch(() => [])
      ])
      const courseMap = {}
      courses.forEach((course) => {
        courseMap[course._id] = course
      })

      const formattedPlans = plans.map((plan) => {
        const course = courseMap[plan.courseId] || {}
        const planRecords = records.filter((record) => record.courseId === plan.courseId)
        const learnedCount = new Set(planRecords.map((record) => record.questionId).filter(Boolean)).size
        const totalCount = course.totalCount || 0
        const progress = totalCount > 0 ? Math.min(100, Math.round((learnedCount / totalCount) * 100)) : 0
        return {
          ...plan,
          courseName: stripPrefix(course.name || '') || '未命名题库',
          courseDescription: course.description || '已加入学习计划，可继续学习或调整计划。',
          courseCover: course.cover || '/assets/icons/default-cover.png',
          totalCount,
          learnedCount,
          remainingCount: Math.max(0, totalCount - learnedCount),
          progress
        }
      })

      this.setData({ plans: formattedPlans })
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  addCourse() {
    wx.navigateTo({ url: '/pages/course-list/course-list' })
  },

  openPlan(e) {
    const { courseid, coursename } = e.currentTarget.dataset
    if (!courseid) return
    wx.navigateTo({
      url: `/pages/study-plan/study-plan?courseId=${courseid}&courseName=${coursename || ''}`
    })
  },

  async removePlan(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return
    try {
      const res = await cloudApi.deletePlan(id)
      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && (res.result.error || res.result.msg)) || '移除失败')
      }
      const plans = this.data.plans.filter((plan) => plan._id !== id)
      this.setData({ plans })
      wx.showToast({ title: '已移除', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '移除失败', icon: 'none' })
    }
  }
})
