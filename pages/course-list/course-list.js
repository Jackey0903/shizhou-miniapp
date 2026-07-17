const cloudApi = require('../../utils/cloudApi')

const stripPrefix = (name = '') => name.replace(/^(([0-9]+|[一二三四五六七八九十]{1,3})[\.、\s]*)/, '')
const CARD_COLORS = [
  { bg: '#FEF2F2', border: '#FECACA', accent: '#DC2626' },
  { bg: '#FFF7ED', border: '#FED7AA', accent: '#EA580C' },
  { bg: '#FEFCE8', border: '#FDE68A', accent: '#CA8A04' },
  { bg: '#F0FDF4', border: '#BBF7D0', accent: '#16A34A' },
  { bg: '#ECFEFF', border: '#A5F3FC', accent: '#0891B2' },
  { bg: '#EFF6FF', border: '#BFDBFE', accent: '#2563EB' },
  { bg: '#F5F3FF', border: '#DDD6FE', accent: '#7C3AED' },
  { bg: '#FDF2F8', border: '#FBCFE8', accent: '#DB2777' }
]

function buildCategoryCards(courses = []) {
  const grouped = {}
  courses.forEach((course) => {
    const category = course.category || '综合题库'
    if (!grouped[category]) grouped[category] = []
    grouped[category].push(course)
  })

  return Object.keys(grouped).map((category, idx) => {
    const banks = grouped[category]
      .slice()
      .sort((a, b) => (a.sort || 9999) - (b.sort || 9999))

    const previews = banks.slice(0, 3).map((item) => ({
      _id: item._id,
      name: stripPrefix(item.name) || item.name,
      rawName: item.name || '',
      count: item.totalCount || 0,
      isLocked: !!item.isLocked
    }))

    return {
      id: `${category}-${idx}`,
      name: stripPrefix(category) || category,
      category,
      totalCount: banks.reduce((sum, item) => sum + (item.totalCount || 0), 0),
      bankCount: banks.length,
      previews,
      directCourseId: banks.length === 1 ? banks[0]._id : '',
      directCourseName: banks.length === 1 ? (banks[0].name || '') : '',
      locked: banks.length === 1 ? !!banks[0].isLocked : banks.every((item) => item.isLocked),
      color: CARD_COLORS[idx % CARD_COLORS.length],
      sort: Math.min(...banks.map((item) => item.sort || 9999)),
      actionText: banks.length === 1 ? '进入题库' : '查看全部'
    }
  }).sort((a, b) => a.sort - b.sort)
}

Page({
  data: {
    title: '全部考点记忆卡',
    subtitle: '选择考点记忆卡，再进入对应题库',
    category: '',
    categoryCards: [],
    courses: [],
    showCategories: true,
    isVip: false
  },

  async onLoad(options = {}) {
    const app = getApp()
    this.setData({ isVip: !!app.globalData.isVip })
    const category = options.category ? decodeURIComponent(options.category) : ''
    const allCourses = await cloudApi.getCourses()

    if (!category) {
      this.setData({
        title: '全部考点记忆卡',
        subtitle: `共${buildCategoryCards(allCourses).length}个科目`,
        categoryCards: buildCategoryCards(allCourses),
        showCategories: true
      })
      return
    }

    const courses = allCourses
      .filter((item) => item.category === category)
      .map((item) => ({
        ...item,
        displayName: stripPrefix(item.name) || item.name
      }))

    this.setData({
      title: stripPrefix(category) || category,
      subtitle: `${courses.length}个题库`,
      category,
      courses,
      showCategories: false
    })
  },

  openCourse(e) {
    const { courseid, coursename, locked } = e.currentTarget.dataset
    if (!courseid) return
    if (locked && !this.data.isVip) {
      wx.navigateTo({ url: '/pages/vip/vip' })
      return
    }
    wx.navigateTo({
      url: `/pages/study-plan/study-plan?courseId=${courseid}&courseName=${coursename || ''}`
    })
  },

  openCategory(e) {
    const { category, courseid, coursename, locked } = e.currentTarget.dataset
    if (courseid) {
      this.openCourse({
        currentTarget: {
          dataset: { courseid, coursename, locked }
        }
      })
      return
    }
    if (!category) return
    wx.navigateTo({
      url: `/pages/course-list/course-list?category=${encodeURIComponent(category)}`
    })
  }
})
