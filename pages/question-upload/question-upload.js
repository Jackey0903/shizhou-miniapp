const cloudApi = require('../../utils/cloudApi')

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
      importKey: buildImportKey([subjectName, bankName, sort, type, content]),
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
    importKey: buildImportKey([subjectName, bankName, sort, type, content]),
    type,
    sort,
    content,
    imageUrl,
    answer,
    explanation
  }
}

function parseImportFileContent(content, fallbackCourseId, startSort, courses = []) {
  let parsed = null
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new Error('JSON 格式不正确，请检查逗号和引号')
  }

  let questions = []
  let rootCourseId = fallbackCourseId
  let rootCourseName = ''
  let rootSubjectName = ''
  if (Array.isArray(parsed)) {
    questions = parsed
  } else if (parsed && Array.isArray(parsed.banks || parsed.bankList || parsed['题库列表'])) {
    const banks = parsed.banks || parsed.bankList || parsed['题库列表']
    questions = []
    rootCourseId = ''
    banks.forEach((bank, bankIndex) => {
      const bankQuestions = bank.questions || bank.questionList || bank['题目列表'] || bank['题目'] || []
      if (!Array.isArray(bankQuestions)) return
      const bankName = pickFirstValue(bank.courseName, bank.bankName, bank.name, bank['题库名称'])
      const subjectName = pickFirstValue(bank.subjectName, bank.categoryName, bank['科目名称'], bank['分类名称'], bank['板块名称'])
      const bankCourseId = pickFirstValue(
        bank.courseId,
        bank.bankId,
        bank['题库ID'],
        resolveCourseIdByMeta({ courseName: bankName, subjectName }, courses)
      )
      bankQuestions.forEach((question, questionIndex) => {
        questions.push({
          ...question,
          courseId: pickFirstValue(question.courseId, question.bankId, question['题库ID'], bankCourseId),
          bankId: pickFirstValue(question.bankId, question.courseId, question['题库ID'], bankCourseId),
          bankName: pickFirstValue(question.bankName, question.courseName, question['题库名称'], bankName),
          courseName: pickFirstValue(question.courseName, question.bankName, question['题库名称'], bankName),
          subjectName: pickFirstValue(question.subjectName, question.categoryName, question['科目名称'], subjectName),
          categoryName: pickFirstValue(question.categoryName, question.subjectName, question['科目名称'], subjectName),
          sort: pickFirstValue(question.sort, question['序号'], questionIndex + 1),
          _bankIndex: bankIndex + 1
        })
      })
    })
    rootCourseName = banks.length > 1 ? `${banks.length}个题库` : pickFirstValue(banks[0] && banks[0].bankName, banks[0] && banks[0].courseName, banks[0] && banks[0] && banks[0]['题库名称'])
  } else if (parsed && Array.isArray(parsed.questions || parsed['题目列表'] || parsed['题目'])) {
    questions = parsed.questions || parsed['题目列表'] || parsed['题目']
    rootCourseName = pickFirstValue(parsed.courseName, parsed.bankName, parsed.categoryName, parsed['题库名称'], parsed['科目名称'], parsed['分类名称'])
    rootSubjectName = pickFirstValue(parsed.subjectName, parsed['科目名称'], parsed['分类名称'], parsed['板块名称'])
    rootCourseId = pickFirstValue(
      parsed.courseId,
      parsed.bankId,
      parsed['题库ID'],
      resolveCourseIdByMeta({
        courseName: pickFirstValue(parsed.courseName, parsed.bankName, parsed['题库名称']),
        subjectName: rootSubjectName || pickFirstValue(parsed.categoryName, parsed['分类名称'], parsed['板块名称'])
      }, courses),
      fallbackCourseId
    )
  } else {
    throw new Error('JSON 顶层必须是数组，或包含 questions / 题目列表 / 题库列表')
  }

  if (!questions.length) {
    throw new Error('JSON 文件里没有题目数据')
  }

  const mappedQuestions = questions.map((item, index) => {
    try {
      const itemCourseId = pickFirstValue(
        item.courseId,
        item.bankId,
        item['题库ID'],
        resolveCourseIdByMeta({
          courseName: pickFirstValue(item.courseName, item.bankName, item['题库名称']),
          subjectName: pickFirstValue(item.subjectName, item.categoryName, item['科目名称'], item['分类名称'], item['板块名称'])
            || rootSubjectName
        }, courses),
        rootCourseId
      )
      return buildImportPayload({
        ...item,
        courseId: itemCourseId,
        bankId: itemCourseId
      }, itemCourseId, startSort + index)
    } catch (err) {
      throw new Error(`第 ${index + 1} 题格式错误：${err.message}`)
    }
  })

  const bankNames = [...new Set(mappedQuestions.map((item) => item.bankName || item.courseName).filter(Boolean))]
  const resolvedCourseName = (bankNames.length > 1 ? `${bankNames.length}个题库` : rootCourseName)
    || (mappedQuestions[0] && (() => {
      const course = courses.find((item) => item._id === mappedQuestions[0].courseId)
      if (!course) return ''
      const subject = course.category || course.subjectName || ''
      return subject ? `${subject} / ${course.name}` : course.name
    })())
    || ''

  return {
    questions: mappedQuestions,
    resolvedCourseName
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

  async chooseJsonFile() {
    if (!this.data.hasAccess) return
    try {
      const res = await wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['json']
      })
      const file = res.tempFiles && res.tempFiles[0]
      if (!file || !file.path) {
        throw new Error('未选择文件')
      }
      const course = this.data.courses[this.data.form.courseIndex]
      const content = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (readRes) => resolve(readRes.data || ''),
          fail: reject
        })
      })
      const parsed = parseImportFileContent(content, course && course._id, this.data.nextSort, this.data.courses)
      const questions = parsed.questions
      const choiceCount = questions.filter((item) => item.type === 'choice').length
      const fillCount = questions.filter((item) => item.type === 'fill').length
      this._importQuestions = questions
      this.setData({
        importFileName: file.name || file.path.split('/').pop() || 'questions.json',
        importSummary: {
          total: questions.length,
          choiceCount,
          fillCount,
          courseName: parsed.resolvedCourseName || (course ? course.name : '未指定题库')
        }
      })
      wx.showToast({ title: 'JSON 解析成功', icon: 'success' })
    } catch (err) {
      if (!(err && err.errMsg && err.errMsg.includes('cancel'))) {
        this._importQuestions = []
        this.setData({ importFileName: '', importSummary: null })
        wx.showToast({ title: err.message || '读取文件失败', icon: 'none' })
      }
    }
  },

  clearImportFile() {
    this._importQuestions = []
    this.setData({
      importFileName: '',
      importSummary: null
    })
  },

  async importQuestionsFromJson() {
    if (this.data.importing || !this._importQuestions || this._importQuestions.length === 0) {
      wx.showToast({ title: '请先选择 JSON 文件', icon: 'none' })
      return
    }

    this.setData({ importing: true })
    wx.showLoading({ title: '导入中', mask: true })
    try {
      const total = this._importQuestions.length
      let imported = 0
      const uploadBatch = async (batch, offset) => {
        wx.showLoading({ title: `导入${Math.min(offset + batch.length, total)}/${total}`, mask: true })
        let res = null
        let message = ''
        try {
          res = await cloudApi.uploadQuestions(batch)
          if (res.result && res.result.code === 0) return res.result
          message = (res.result && res.result.msg) || '导入失败'
        } catch (err) {
          message = (err && (err.errMsg || err.message)) || '导入失败'
        }
        const isTimeout = /time limit|TIME_LIMIT|timed out|超时/i.test(message)
        if (batch.length <= 1 || !isTimeout) {
          throw new Error(message)
        }

        const middle = Math.ceil(batch.length / 2)
        await uploadBatch(batch.slice(0, middle), offset)
        return uploadBatch(batch.slice(middle), offset + middle)
      }

      const batchSize = 5
      for (let index = 0; index < total; index += batchSize) {
        const batch = this._importQuestions.slice(index, index + batchSize)
        await uploadBatch(batch, index)
        imported = Math.min(index + batch.length, total)
        this.setData({
          importSummary: {
            ...(this.data.importSummary || {}),
            imported
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
      wx.showToast({ title: '批量导入成功', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '导入失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ importing: false })
    }
  }
})
