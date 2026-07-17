const cloudApi = require('../../utils/cloudApi')

const stripPrefix = (name = '') => name.replace(/^(([0-9]+|[一二三四五六七八九十]{1,3})[\.、\s]*)/, '')

Page({
  data: {
    courseId: '',
    activeTab: 'none',
    tabs: [
      { key: 'none', label: '不会' },
      { key: 'maybe', label: '不太会' },
      { key: 'know', label: '会' }
    ],
    records: [],
    allRecords: [],
    recordGroups: [],
    keyword: ''
  },

  onLoad(options) {
    const { courseId } = options
    this.setData({ courseId })
    this._loadRecords()
  },

  async _loadRecords() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      const [rawRecords, courses] = await Promise.all([
        cloudApi.getStudyRecords(this.data.courseId),
        cloudApi.getCourses()
      ])
      const courseMap = {}
      courses.forEach((item) => {
        courseMap[item._id] = item
      })
      const allRecords = await this._hydrateRecords(rawRecords, courseMap)
      this.setData({ allRecords })
      this._filterRecords()
    } catch (e) {
      console.error(e)
    } finally {
      wx.hideLoading()
    }
  },

  async _hydrateRecords(records, courseMap) {
    return records.map((item) => {
      const course = courseMap[item.courseId] || {}
      const courseName = stripPrefix(course.name || '') || '未分类题库'
      const missingQuestion = !item.questionContent
      return {
        ...item,
        questionContent: item.questionContent || '（题目已更新，请重新加入记忆）',
        questionOptions: item.questionOptions || [],
        questionType: item.questionType || '',
        questionAnswer: item.questionAnswer || '',
        questionExplanation: item.questionExplanation || '',
        categoryName: course.category || '综合',
        bankName: courseName,
        bankSeries: course.series || '',
        missingQuestion,
        reviewable: !!item.questionContent
      }
    })
  },

  _buildGroups(records) {
    const categoryMap = {}
    records.forEach((record) => {
      const categoryName = record.categoryName || '综合'
      const bankKey = record.bankName || '未分类题库'
      if (!categoryMap[categoryName]) {
        categoryMap[categoryName] = {}
      }
      if (!categoryMap[categoryName][bankKey]) {
        categoryMap[categoryName][bankKey] = {
          name: bankKey,
          series: record.bankSeries || '',
          records: []
        }
      }
      categoryMap[categoryName][bankKey].records.push(record)
    })

    return Object.keys(categoryMap).map((categoryName) => ({
      name: categoryName,
      banks: Object.values(categoryMap[categoryName])
    }))
  },

  _filterRecords() {
    const { allRecords, activeTab, keyword } = this.data
    let filtered = allRecords.filter((item) => item.result === activeTab)
    const search = (keyword || '').trim()
    if (search) {
      filtered = filtered.filter((item) => (
        (item.questionContent || '').includes(search)
        || (item.bankName || '').includes(search)
        || (item.categoryName || '').includes(search)
      ))
    }
    this.setData({
      records: filtered,
      recordGroups: this._buildGroups(filtered)
    })
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.key })
    this._filterRecords()
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this._filterRecords()
  },

  clearSearch() {
    this.setData({ keyword: '' })
    this._filterRecords()
  },

  startOrdered() {
    const validRecords = this.data.records.filter((item) => item.reviewable)
    if (!validRecords.length) {
      wx.showToast({ title: '暂无可复习题目', icon: 'none' })
      return
    }
    const ids = validRecords.map((item) => item.questionId)
    const reviewSessionKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    wx.setStorageSync(`reviewQuestionIds:${reviewSessionKey}`, ids)
    wx.navigateTo({
      url: `/pages/question/question?courseId=${this.data.courseId}&mode=review&reviewSessionKey=${reviewSessionKey}`
    })
  },

  startRandom() {
    const validRecords = this.data.records.filter((item) => item.reviewable)
    if (!validRecords.length) {
      wx.showToast({ title: '暂无可复习题目', icon: 'none' })
      return
    }
    const shuffled = [...validRecords].sort(() => Math.random() - 0.5)
    const ids = shuffled.map((item) => item.questionId)
    const reviewSessionKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    wx.setStorageSync(`reviewQuestionIds:${reviewSessionKey}`, ids)
    wx.navigateTo({
      url: `/pages/question/question?courseId=${this.data.courseId}&mode=review&reviewSessionKey=${reviewSessionKey}`
    })
  }
})
