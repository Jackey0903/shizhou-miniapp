const cloudApi = require('../../utils/cloudApi')

const QUESTION_TYPES = ['选择题', '填空题']
const PAGE_SIZE = 20

function parseOptions(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function optionLabels(value = '') {
  const options = parseOptions(value)
  return options.length
    ? options.map((item, index) => `${String.fromCharCode(65 + index)}. ${item}`)
    : ['请先填写选项']
}

function buildForm(question = {}) {
  const optionsText = Array.isArray(question.options) ? question.options.join('\n') : ''
  return {
    id: question._id || '',
    typeIndex: question.type === 'fill' ? 1 : 0,
    sort: String(question.sort || ''),
    content: question.content || '',
    imageUrl: question.imageUrl || '',
    optionsText,
    correctIndex: Number(question.correctIndex) || 0,
    answer: question.answer || '',
    explanation: question.explanation || ''
  }
}

function formatQuestion(question = {}) {
  const enabled = question.enabled !== false
  return {
    ...question,
    typeLabel: question.type === 'fill' ? '填空题' : '选择题',
    stateLabel: enabled ? '已上线' : '已下线',
    stateClass: enabled ? 'online' : 'offline',
    contentPreview: String(question.content || '').replace(/\s+/g, ' ').slice(0, 120),
    answerPreview: question.type === 'fill'
      ? `答案：${String(question.answer || '').slice(0, 60)}`
      : `正确答案：${String.fromCharCode(65 + Number(question.correctIndex || 0))}`
  }
}

function flattenBanks(tree = []) {
  return tree.flatMap((subject) => (subject.banks || []).map((bank) => ({
    _id: bank._id,
    name: `${subject.name || '未分类'} · ${bank.name || '未命名题库'}`,
    enabled: bank.enabled !== false
  })))
}

Page({
  data: {
    loading: true,
    authorized: false,
    loadingQuestions: false,
    saving: false,
    courses: [],
    courseNames: [],
    courseIndex: 0,
    keyword: '',
    questions: [],
    total: 0,
    page: 1,
    hasMore: false,
    showEditor: false,
    form: buildForm(),
    questionTypes: QUESTION_TYPES,
    optionLabels: ['请先填写选项']
  },

  async onLoad() {
    await this.initPage()
  },

  async initPage() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      await cloudApi.assertAdmin()
      const tree = await cloudApi.getAdminCourseTree()
      const courses = flattenBanks(tree)
      this.setData({
        authorized: true,
        courses,
        courseNames: courses.map((item) => item.name),
        courseIndex: 0
      })
      if (courses.length) await this.loadQuestions({ reset: true })
    } catch (err) {
      wx.showModal({
        title: '无管理员权限',
        content: err.message || '当前账号不是管理员，无法管理题目。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    } finally {
      wx.hideLoading()
      this.setData({ loading: false })
    }
  },

  getCurrentCourse() {
    return this.data.courses[this.data.courseIndex] || null
  },

  async loadQuestions(options = {}) {
    const course = this.getCurrentCourse()
    if (!course || this.data.loadingQuestions) return
    const reset = options.reset === true
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loadingQuestions: true })
    try {
      const result = await cloudApi.listManagedQuestions(course._id, this.data.keyword, page, PAGE_SIZE)
      const received = (result.items || []).map(formatQuestion)
      this.setData({
        questions: reset ? received : this.data.questions.concat(received),
        total: Number(result.total || 0),
        page: Number(result.page || page),
        hasMore: result.hasMore === true
      })
    } catch (err) {
      wx.showToast({ title: err.message || '题目加载失败', icon: 'none' })
    } finally {
      this.setData({ loadingQuestions: false })
    }
  },

  async onCourseChange(event) {
    const courseIndex = Math.max(0, Number(event.detail.value) || 0)
    this.setData({ courseIndex, keyword: '', showEditor: false })
    await this.loadQuestions({ reset: true })
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value || '' })
  },

  async search() {
    await this.loadQuestions({ reset: true })
  },

  async clearSearch() {
    this.setData({ keyword: '' })
    await this.loadQuestions({ reset: true })
  },

  async loadMore() {
    if (!this.data.hasMore) return
    await this.loadQuestions()
  },

  openEditor(event) {
    const id = event.currentTarget.dataset.id
    const question = this.data.questions.find((item) => item._id === id)
    if (!question) return
    const form = buildForm(question)
    this.setData({
      showEditor: true,
      form,
      optionLabels: optionLabels(form.optionsText)
    })
  },

  closeEditor() {
    if (this.data.saving) return
    this.setData({ showEditor: false, form: buildForm(), optionLabels: ['请先填写选项'] })
  },

  onFormInput(event) {
    const field = event.currentTarget.dataset.field
    if (!field) return
    const form = { ...this.data.form, [field]: event.detail.value || '' }
    const patch = { form }
    if (field === 'optionsText') {
      const labels = optionLabels(form.optionsText)
      const correctIndex = Math.min(Math.max(0, Number(form.correctIndex) || 0), labels.length - 1)
      patch.form = { ...form, correctIndex }
      patch.optionLabels = labels
    }
    this.setData(patch)
  },

  onTypeChange(event) {
    const typeIndex = Math.max(0, Number(event.detail.value) || 0)
    this.setData({ form: { ...this.data.form, typeIndex } })
  },

  onCorrectChange(event) {
    this.setData({ form: { ...this.data.form, correctIndex: Math.max(0, Number(event.detail.value) || 0) } })
  },

  async chooseQuestionImage() {
    if (this.data.saving) return
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'] })
      const file = (result.tempFiles || [])[0]
      if (!file || !file.tempFilePath) return
      this.setData({ saving: true })
      wx.showLoading({ title: '上传图片中', mask: true })
      const ext = (file.tempFilePath.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '') || 'jpg'
      const upload = await wx.cloud.uploadFile({
        cloudPath: `question-images/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`,
        filePath: file.tempFilePath
      })
      this.setData({ 'form.imageUrl': upload.fileID })
      wx.showToast({ title: '图片已替换，请保存题目', icon: 'success' })
    } catch (err) {
      if (!String(err && err.errMsg || '').includes('cancel')) {
        wx.showToast({ title: err.message || '替换图片失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ saving: false })
    }
  },

  clearQuestionImage() {
    this.setData({ 'form.imageUrl': '' })
  },

  async saveQuestion() {
    if (this.data.saving) return
    const course = this.getCurrentCourse()
    const form = this.data.form
    if (!course || !form.id) return
    const payload = {
      id: form.id,
      courseId: course._id,
      type: form.typeIndex === 1 ? 'fill' : 'choice',
      sort: Number(form.sort),
      content: form.content,
      imageUrl: form.imageUrl,
      explanation: form.explanation
    }
    if (payload.type === 'choice') {
      payload.options = parseOptions(form.optionsText)
      payload.correctIndex = Number(form.correctIndex)
    } else {
      payload.answer = form.answer
    }

    this.setData({ saving: true })
    try {
      await cloudApi.saveManagedQuestion(payload)
      wx.showToast({ title: '题目已保存', icon: 'success' })
      this.setData({
        showEditor: false,
        form: buildForm(),
        optionLabels: ['请先填写选项']
      })
      await this.loadQuestions({ reset: true })
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async confirm(title, content) {
    return new Promise((resolve) => {
      wx.showModal({ title, content, success: (result) => resolve(result.confirm === true), fail: () => resolve(false) })
    })
  },

  async toggleQuestion(event) {
    const id = event.currentTarget.dataset.id
    const enabled = event.currentTarget.dataset.enabled === true || event.currentTarget.dataset.enabled === 'true'
    const course = this.getCurrentCourse()
    if (!id || !course) return
    const action = enabled ? '上线' : '下线'
    const confirmed = await this.confirm(`${action}题目`, enabled
      ? '上线后，普通用户可以重新看到并作答这道题。'
      : '下线后，普通用户将不再看到这道题；历史答题记录会保留。')
    if (!confirmed) return
    try {
      await cloudApi.toggleManagedQuestion(id, course._id, enabled)
      wx.showToast({ title: `题目已${action}`, icon: 'success' })
      await this.loadQuestions({ reset: true })
    } catch (err) {
      wx.showToast({ title: err.message || `${action}失败`, icon: 'none' })
    }
  },

  async removeQuestion(event) {
    const id = event.currentTarget.dataset.id
    const course = this.getCurrentCourse()
    if (!id || !course) return
    const confirmed = await this.confirm('永久删除题目', '删除后不可恢复，用户已有答题记录会保留。确认永久删除这道题吗？')
    if (!confirmed) return
    try {
      await cloudApi.deleteManagedQuestion(id, course._id)
      wx.showToast({ title: '题目已删除', icon: 'success' })
      this.closeEditor()
      await this.loadQuestions({ reset: true })
    } catch (err) {
      wx.showToast({ title: err.message || '删除失败', icon: 'none' })
    }
  }
})
