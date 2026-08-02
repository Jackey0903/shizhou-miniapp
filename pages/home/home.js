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
    grouped[category].push({
      ...course,
      displayName: stripPrefix(course.name) || course.name
    })
  })

  return Object.keys(grouped).map((category, idx) => {
    const bankList = grouped[category]
    const color = CARD_COLORS[idx % CARD_COLORS.length]
    return {
      id: `${category}-${idx}`,
      name: stripPrefix(category) || category,
      sort: Math.min(...bankList.map((item) => item.sort || 9999)),
      totalCount: bankList.reduce((sum, item) => sum + (item.totalCount || 0), 0),
      bankCount: bankList.length,
      directCourseId: bankList.length === 1 ? bankList[0]._id : '',
      directCourseName: bankList.length === 1 ? (bankList[0].name || '') : '',
      previews: bankList
        .slice()
        .sort((a, b) => (a.sort || 9999) - (b.sort || 9999))
        .slice(0, 3)
        .map((item) => ({
          _id: item._id,
          rawName: item.name || '',
          name: item.displayName || stripPrefix(item.name) || item.name,
          count: item.totalCount || 0
        })),
      locked: bankList.every((item) => item.isLocked),
      category,
      color
    }
  }).sort((a, b) => a.sort - b.sort)
}

Page({
  data: {
    categoryCards: [],
    homeCards: [],
    loading: true,
    userInfo: null,
    isVip: false,
    unreadCount: 0
  },

  onLoad() {
    const app = getApp()
    this.setData({
      userInfo: app.globalData.userInfo,
      isVip: app.globalData.isVip
    })
  },

  async onShow() {
    const app = getApp()
    this.setData({
      userInfo: app.globalData.userInfo,
      isVip: app.globalData.isVip
    })
    await this._loadData()
  },

  async _loadData() {
    this.setData({ loading: true })
    try {
      const [courses, messages] = await Promise.all([
        cloudApi.getCourses(),
        cloudApi.getMessages().catch(() => [])
      ])
      const categoryCards = buildCategoryCards(courses)
      const unreadCount = (messages || []).filter((item) => item.unread).length
      this._syncMessageBadge(unreadCount)
      this.setData({
        categoryCards,
        homeCards: categoryCards.slice(0, 8),
        unreadCount,
        loading: false
      })
    } catch (e) {
      console.error('首页加载失败', e)
      this.setData({ loading: false })
    }
  },

  _syncMessageBadge(count) {
    if (count > 0) {
      wx.setTabBarBadge({ index: 3, text: String(count > 99 ? '99+' : count), fail: () => null })
    } else {
      wx.removeTabBarBadge({ index: 3, fail: () => null })
    }
  },

  openCategory(e) {
    const { category, courseid, coursename, locked } = e.currentTarget.dataset
    if (locked && !this.data.isVip) {
      wx.navigateTo({ url: '/pages/vip/vip' })
      return
    }
    if (courseid) {
      wx.navigateTo({
        url: `/pages/study-plan/study-plan?courseId=${encodeURIComponent(courseid)}&courseName=${encodeURIComponent(coursename || '')}`
      })
      return
    }
    if (!category) return
    wx.navigateTo({
      url: `/pages/course-list/course-list?category=${encodeURIComponent(category)}`
    })
  },

  onPullDownRefresh() {
    this._loadData().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  onShareAppMessage() {
    return {
      title: '仕舟公考',
      path: '/pages/home/home',
      imageUrl: '/assets/images/logo.webp'
    }
  }
})
