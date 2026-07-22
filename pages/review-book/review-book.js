const cloudApi = require('../../utils/cloudApi')

const stripPrefix = (name = '') => name.replace(/^(([0-9]+|[一二三四五六七八九十]{1,3})[\.、\s]*)/, '')

function shuffle(list = []) {
  const result = [...list]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const current = result[index]
    result[index] = result[target]
    result[target] = current
  }
  return result
}

function toReviewQuestion(record = {}) {
  const rawCorrectIndex = record.questionCorrectIndex
  const correctIndex = rawCorrectIndex === '' || rawCorrectIndex === null || rawCorrectIndex === undefined
    ? -1
    : Number(rawCorrectIndex)
  return {
    _id: String(record.questionId || ''),
    type: record.questionType || 'fill',
    content: record.questionContent || '',
    options: Array.isArray(record.questionOptions) ? record.questionOptions : [],
    answer: record.questionAnswer || '',
    explanation: record.questionExplanation || '',
    correctIndex: Number.isInteger(correctIndex) && correctIndex >= 0 ? correctIndex : -1,
    imageUrl: record.questionImageUrl || '',
    fromRecord: true
  }
}

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
    keyword: '',
    loading: true,
    loadError: ''
  },

  onLoad(options = {}) {
    const courseId = String(options.courseId || '')
    this.setData({ courseId })
    this._loadRecords()
  },

  async _loadRecords() {
    this.setData({ loading: true, loadError: '' })
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
      const message = (e && (e.message || e.errMsg)) || '复习记录加载失败'
      console.error('复习记录加载失败', message, e)
      this.setData({
        allRecords: [],
        records: [],
        recordGroups: [],
        loadError: message
      })
    } finally {
      this.setData({ loading: false })
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
        reviewable: !!(item.questionId && item.questionContent)
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

  retryLoad() {
    this._loadRecords()
  },

  _startReview(records) {
    if (this._openingReview) return
    const validRecords = records.filter((item) => item.reviewable)
    if (!validRecords.length) {
      wx.showToast({ title: '暂无可复习题目', icon: 'none' })
      return
    }

    const questions = validRecords.map(toReviewQuestion).filter((item) => item._id && item.content)
    const ids = questions.map((item) => item._id)
    const reviewSessionKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const sessionStorageKey = `reviewSession:${reviewSessionKey}`
    const idsStorageKey = `reviewQuestionIds:${reviewSessionKey}`

    try {
      wx.setStorageSync(idsStorageKey, ids)
      const session = { courseId: this.data.courseId, questions }
      // 单键同步缓存有容量限制；超大复习集仍可通过题目 ID 从云端恢复。
      if (JSON.stringify(session).length <= 800 * 1024) {
        wx.setStorageSync(sessionStorageKey, session)
      }
    } catch (err) {
      console.warn('复习会话缓存失败，将从云端重新加载', err)
    }

    this._openingReview = true
    wx.navigateTo({
      url: `/pages/question/question?courseId=${encodeURIComponent(this.data.courseId)}&mode=review&reviewSessionKey=${encodeURIComponent(reviewSessionKey)}`,
      fail: (err) => {
        console.error('打开复习题失败', err)
        wx.removeStorageSync(sessionStorageKey)
        wx.removeStorageSync(idsStorageKey)
        wx.showToast({ title: '打开失败，请重试', icon: 'none' })
      },
      complete: () => {
        this._openingReview = false
      }
    })
  },

  startOrdered() {
    this._startReview(this.data.records)
  },

  startRandom() {
    this._startReview(shuffle(this.data.records))
  }
})
