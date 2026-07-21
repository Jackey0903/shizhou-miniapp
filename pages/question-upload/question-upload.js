const cloudApi = require('../../utils/cloudApi')
const questionCsv = require('../../utils/questionCsv')

const DEFAULT_FORM = {
  courseIndex: 0,
  typeIndex: 0,
  content: '',
  optionA: '',
  optionB: '',
  optionC: '',
  optionD: '',
  correctIndex: 0,
  answer: '',
  explanation: ''
}

function normalizeCourseName(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^(([0-9]+|[一二三四五六七八九十]{1,3})[\.、\s]*)/, '')
}

function resolveCourseIdByMeta(meta = {}, courses = []) {
  const bankName = normalizeCourseName(pickFirstValue(
    meta.courseName,
    meta.bankName,
    meta['题库名称']
  ))
  const subjectName = normalizeCourseName(pickFirstValue(
    meta.subjectName,
    meta.categoryName,
    meta['科目名称'],
    meta['分类名称'],
    meta['板块名称']
  ))

  if (bankName && subjectName) {
    const matched = courses.find((item) => (
      normalizeCourseName(item.name) === bankName
      && normalizeCourseName(item.category || item.subjectName) === subjectName
    ))
    if (matched) return matched._id
  }

  const fallbackName = bankName || subjectName
  if (!fallbackName) return ''
  const matched = courses.find((item) => (
    normalizeCourseName(item.name) === fallbackName
    || normalizeCourseName(item.displayName) === fallbackName
    || normalizeCourseName(item.category || item.subjectName) === fallbackName
  ))
  return matched ? matched._id : ''
}

function pickFirstValue(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return ''
}

function normalizeQuestionType(value = '') {
  const text = String(value || '').trim().toLowerCase()
  if ([
    'fill',
    '填空',
    '填空题',
    '简答题',
    '问答题',
    '归纳概括题',
    '提出对策题',
    '综合分析题',
    '应用文写作题',
    '主观题'
  ].includes(text)) return 'fill'
  return 'choice'
}

function buildImportKey(parts = []) {
  return parts
    .map((item) => String(item || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('|')
}

function resolveCorrectIndex(rawQuestion = {}, options = []) {
  if (rawQuestion.correctIndex !== undefined && rawQuestion.correctIndex !== null && rawQuestion.correctIndex !== '') {
    const index = Number(rawQuestion.correctIndex)
    if (!Number.isNaN(index)) return index
  }

  const rawAnswer = pickFirstValue(rawQuestion.correctAnswer, rawQuestion.answer, rawQuestion['答案'], rawQuestion['参考答案']).toString().trim()
  if (!rawAnswer) return -1

  const upper = rawAnswer.toUpperCase()
  if (/^[A-Z]$/.test(upper)) {
    return upper.charCodeAt(0) - 65
  }

  return options.findIndex((item) => item === rawAnswer)
}

function buildImportPayload(rawQuestion = {}, fallbackCourseId, fallbackSort) {
  const type = normalizeQuestionType(pickFirstValue(rawQuestion.type, rawQuestion['题型']))
  const courseId = pickFirstValue(rawQuestion.courseId, rawQuestion.bankId, rawQuestion['题库ID'], fallbackCourseId)
  const bankName = String(pickFirstValue(rawQuestion.bankName, rawQuestion.courseName, rawQuestion['题库名称'])).trim()
  const subjectName = String(pickFirstValue(rawQuestion.subjectName, rawQuestion.categoryName, rawQuestion['科目名称'], rawQuestion['分类名称'], rawQuestion['板块名称'])).trim()
  const content = String(pickFirstValue(rawQuestion.content, rawQuestion.title, rawQuestion.question, rawQuestion['题目'], rawQuestion['题干'])).trim()
  const explanation = String(pickFirstValue(rawQuestion.explanation, rawQuestion['解析'])).trim()
  const imageUrl = String(pickFirstValue(rawQuestion.imageUrl, rawQuestion['图片'])).trim()
  const sort = Number(pickFirstValue(rawQuestion.sort, rawQuestion['序号'])) || fallbackSort

  if (!courseId && !bankName) {
    throw new Error('缺少题库名称或题库ID')
  }
  if (!content) {
    throw new Error('题干不能为空')
  }

  if (type === 'choice') {
    const options = Array.isArray(rawQuestion.options)
      ? rawQuestion.options.map((item) => (item || '').trim()).filter(Boolean)
      : Array.isArray(rawQuestion['选项'])
        ? rawQuestion['选项'].map((item) => (item || '').trim()).filter(Boolean)
      : [rawQuestion.optionA, rawQuestion.optionB, rawQuestion.optionC, rawQuestion.optionD]
        .concat([rawQuestion['A'], rawQuestion['B'], rawQuestion['C'], rawQuestion['D']])
        .map((item) => (item || '').trim()).filter(Boolean)
    const correctIndex = resolveCorrectIndex(rawQuestion, options)
    if (options.length < 2) {
      throw new Error('选择题至少需要两个选项')
    }
    if (correctIndex < 0 || correctIndex >= options.length) {
      throw new Error('选择题缺少正确答案或答案超出选项范围')
    }
    return {
      courseId,
      bankId: courseId,
      bankName,
      courseName: bankName,
      subjectName,
      categoryName: subjectName,
      importKey: buildImportKey([subjectName, bankName, type, content]),
      type,
      sort,
      content,
      imageUrl,
      options,
      correctIndex,
      explanation
    }
  }

  const answer = String(pickFirstValue(rawQuestion.answer, rawQuestion.correctAnswer, rawQuestion['答案'], rawQuestion['参考答案'])).trim()
  if (!answer) {
    throw new Error('填空题答案不能为空')
  }
  return {
    courseId,
    bankId: courseId,
    bankName,
    courseName: bankName,
    subjectName,
    categoryName: subjectName,
    importKey: buildImportKey([subjectName, bankName, type, content]),
    type,
    sort,
    content,
    imageUrl,
    answer,
    explanation
  }
}

Page({
  data: {
    loading: true,
    hasAccess: false,
    courses: [],
    courseNames: [],
    questionTypes: ['选择题', '填空题'],
    answerOptions: ['A', 'B', 'C', 'D'],
    nextSort: 1,
    saving: false,
    form: { ...DEFAULT_FORM },
    importFileName: '',
    importSummary: null,
    importErrors: [],
    previewQuestions: [],
    importing: false
  },

  async onLoad() {
    this._importQuestions = []
    await this.initPage()
  },

  async initPage() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      const user = await cloudApi.getCurrentUser()
      const hasAccess = !!(user && (user.isAdmin === true || user.role === 'admin'))
      if (!hasAccess) {
        this.setData({ loading: false, hasAccess: false })
        return
      }

      const courses = await cloudApi.getCourses()
      const courseNames = courses.map(item => item.name)
      this.setData({
        hasAccess: true,
        loading: false,
        courses,
        courseNames
      })

      if (courses.length > 0) {
        await this.refreshNextSort(courses[0]._id)
      }
    } catch (err) {
      console.error('初始化录题页失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async refreshNextSort(courseId) {
    if (!courseId) return
    try {
      const count = await cloudApi.getQuestionCount(courseId)
      this.setData({ nextSort: count + 1 })
    } catch (err) {
      console.error('获取题号失败', err)
      this.setData({ nextSort: Date.now() })
    }
  },

  async onCourseChange(e) {
    const courseIndex = parseInt(e.detail.value, 10) || 0
    this.setData({
      form: {
        ...this.data.form,
        courseIndex
      }
    })
    const course = this.data.courses[courseIndex]
    await this.refreshNextSort(course && course._id)
  },

  onTypeChange(e) {
    const typeIndex = parseInt(e.detail.value, 10) || 0
    this.setData({
      form: {
        ...this.data.form,
        typeIndex
      }
    })
  },

  onCorrectIndexChange(e) {
    const correctIndex = parseInt(e.detail.value, 10) || 0
    this.setData({
      form: {
        ...this.data.form,
        correctIndex
      }
    })
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset
    this.setData({
      form: {
        ...this.data.form,
        [field]: e.detail.value
      }
    })
  },

  async submitQuestion() {
    if (this.data.saving || !this.data.hasAccess) return
    const course = this.data.courses[this.data.form.courseIndex]
    if (!course) {
      wx.showToast({ title: '请先选择课程', icon: 'none' })
      return
    }

    const isChoice = this.data.form.typeIndex === 0
    const payload = {
      courseId: course._id,
      type: isChoice ? 'choice' : 'fill',
      sort: this.data.nextSort,
      content: (this.data.form.content || '').trim(),
      explanation: (this.data.form.explanation || '').trim()
    }

    if (isChoice) {
      payload.options = [
        this.data.form.optionA,
        this.data.form.optionB,
        this.data.form.optionC,
        this.data.form.optionD
      ].map(item => (item || '').trim()).filter(Boolean)
      payload.correctIndex = this.data.form.correctIndex
    } else {
      payload.answer = (this.data.form.answer || '').trim()
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      const res = await cloudApi.uploadQuestions([payload])
      if (res.result.code !== 0) {
        throw new Error(res.result.msg || '提交失败')
      }
      wx.showToast({ title: '题目录入成功', icon: 'success' })
      this.setData({
        form: {
          ...DEFAULT_FORM,
          courseIndex: this.data.form.courseIndex
        }
      })
      await this.refreshNextSort(course._id)
    } catch (err) {
      console.error('录题失败', err)
      wx.showToast({ title: err.message || '录题失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ saving: false })
    }
  },

  showCsvHelp() {
    wx.showModal({
      title: 'CSV 填写规则',
      content: '只接收 .csv，不接收 Excel、Word 或 PDF。使用固定表头，每题一行，必填科目、题库、题型、题目和答案。题型只填选择题/填空题；选择题答案填 A-D。用 Excel/WPS 另存为“CSV UTF-8（逗号分隔）”。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  async shareCsvTemplate() {
    if (!this.data.hasAccess) return
    wx.showLoading({ title: '生成模板', mask: true })
    try {
      const filePath = `${wx.env.USER_DATA_PATH}/仕舟题库导入模板.csv`
      await new Promise((resolve, reject) => {
        wx.getFileSystemManager().writeFile({
          filePath,
          data: questionCsv.buildTemplateCsv(),
          encoding: 'utf8',
          success: resolve,
          fail: reject
        })
      })
      if (!wx.shareFileMessage) throw new Error('当前微信版本不支持发送文件，请升级微信')
      await new Promise((resolve, reject) => {
        wx.shareFileMessage({
          filePath,
          fileName: '仕舟题库导入模板.csv',
          success: resolve,
          fail: reject
        })
      })
    } catch (err) {
      if (!(err && err.errMsg && err.errMsg.includes('cancel'))) {
        wx.showToast({ title: err.message || err.errMsg || '模板生成失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
    }
  },

  async chooseCsvFile() {
    if (!this.data.hasAccess) return
    try {
      const res = await wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['csv']
      })
      const file = res.tempFiles && res.tempFiles[0]
      if (!file || !file.path) {
        throw new Error('未选择文件')
      }
      if (Number(file.size || 0) > 5 * 1024 * 1024) {
        throw new Error('CSV 文件不能超过 5MB')
      }
      const content = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (readRes) => resolve(readRes.data || ''),
          fail: reject
        })
      })
      const parsed = questionCsv.parseQuestionCsv(content)
      const mappedEntries = []
      const mappingErrors = []
      parsed.questions.forEach((item, index) => {
        try {
          const itemCourseId = resolveCourseIdByMeta({
            courseName: item.bankName,
            subjectName: item.subjectName
          }, this.data.courses)
          const payload = buildImportPayload({
            ...item,
            courseId: itemCourseId,
            bankId: itemCourseId
          }, itemCourseId, item.sort || index + 1)
          payload.sourceRowNumber = item._rowNumber || index + 2
          mappedEntries.push({ rowNumber: item._rowNumber || index + 2, payload })
        } catch (err) {
          mappingErrors.push(`第 ${item._rowNumber || index + 2} 行：${err.message}`)
        }
      })
      const importErrors = parsed.errors.concat(mappingErrors)
      const mappedQuestions = mappedEntries.map((item) => item.payload)
      const questions = importErrors.length ? [] : mappedQuestions
      const choiceCount = mappedQuestions.filter((item) => item.type === 'choice').length
      const fillCount = mappedQuestions.filter((item) => item.type === 'fill').length
      this._importQuestions = questions
      this.setData({
        importFileName: file.name || file.path.split('/').pop() || 'questions.csv',
        importSummary: {
          total: parsed.totalRows,
          validCount: mappedQuestions.length,
          errorCount: importErrors.length,
          choiceCount,
          fillCount
        },
        importErrors: importErrors.slice(0, 50),
        previewQuestions: mappedEntries.slice(0, 5).map(({ payload: item, rowNumber }) => ({
          rowNumber,
          location: `${item.subjectName || '综合题库'} / ${item.bankName || item.courseName}`,
          typeLabel: item.type === 'fill' ? '填空题' : '选择题',
          content: item.content,
          answer: item.type === 'fill' ? item.answer : String.fromCharCode(65 + item.correctIndex)
        }))
      })
      wx.showToast({
        title: importErrors.length ? `发现${importErrors.length}处错误` : 'CSV 校验通过',
        icon: importErrors.length ? 'none' : 'success'
      })
    } catch (err) {
      if (!(err && err.errMsg && err.errMsg.includes('cancel'))) {
        this._importQuestions = []
        this.setData({ importFileName: '', importSummary: null, importErrors: [], previewQuestions: [] })
        wx.showToast({ title: err.message || '读取文件失败', icon: 'none' })
      }
    }
  },

  clearImportFile() {
    this._importQuestions = []
    this.setData({
      importFileName: '',
      importSummary: null,
      importErrors: [],
      previewQuestions: []
    })
  },

  async importQuestionsFromFile() {
    if (this.data.importing || !this._importQuestions || this._importQuestions.length === 0) {
      wx.showToast({ title: '请先选择并通过校验的 CSV 文件', icon: 'none' })
      return
    }

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认导入',
        content: `将导入 ${this._importQuestions.length} 道题。已存在的重复题目会自动跳过。`,
        confirmText: '确认导入',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return

    this.setData({ importing: true })
    wx.showLoading({ title: '导入中', mask: true })
    try {
      const total = this._importQuestions.length
      let processed = 0
      let insertedCount = 0
      let skippedCount = 0
      const uploadBatch = async (batch, offset) => {
        wx.showLoading({ title: `导入${Math.min(offset + batch.length, total)}/${total}`, mask: true })
        let res = null
        let message = ''
        try {
          res = await cloudApi.uploadQuestions(batch)
          if (res.result && res.result.code === 0) return res.result.data || {
            insertedCount: batch.length,
            skippedCount: 0,
            totalCount: batch.length
          }
          message = (res.result && res.result.msg) || '导入失败'
        } catch (err) {
          message = (err && (err.errMsg || err.message)) || '导入失败'
        }
        const isTimeout = /time limit|TIME_LIMIT|timed out|超时/i.test(message)
        if (batch.length <= 1 || !isTimeout) {
          throw new Error(message)
        }

        const middle = Math.ceil(batch.length / 2)
        const left = await uploadBatch(batch.slice(0, middle), offset)
        const right = await uploadBatch(batch.slice(middle), offset + middle)
        return {
          insertedCount: Number(left.insertedCount || 0) + Number(right.insertedCount || 0),
          skippedCount: Number(left.skippedCount || 0) + Number(right.skippedCount || 0),
          totalCount: Number(left.totalCount || 0) + Number(right.totalCount || 0)
        }
      }

      const batchSize = 25
      for (let index = 0; index < total; index += batchSize) {
        const batch = this._importQuestions.slice(index, index + batchSize)
        const batchResult = await uploadBatch(batch, index)
        insertedCount += Number(batchResult.insertedCount || 0)
        skippedCount += Number(batchResult.skippedCount || 0)
        processed = Math.min(index + batch.length, total)
        this.setData({
          importSummary: {
            ...(this.data.importSummary || {}),
            imported: processed
          }
        })
      }
      const course = this.data.courses[this.data.form.courseIndex]
      this.clearImportFile()
      const courses = await cloudApi.getCourses()
      await this.refreshNextSort(course && course._id)
      this.setData({
        courses,
        courseNames: courses.map(item => item.name)
      })
      wx.showModal({
        title: '导入完成',
        content: `新增 ${insertedCount} 道，跳过重复 ${skippedCount} 道。`,
        showCancel: false
      })
    } catch (err) {
      wx.showToast({ title: err.message || '导入失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ importing: false })
    }
  }
})
