const assert = require('assert')
const Module = require('module')
const path = require('path')

const root = path.resolve(__dirname, '..')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function instantiate(config) {
  const instance = Object.assign({}, config)
  instance.data = clone(config.data || {})
  instance.setData = function setData(patch) {
    this.data = { ...this.data, ...patch }
  }
  return instance
}

function loadPage(relativePath, cloudApi) {
  const target = path.join(root, relativePath)
  delete require.cache[require.resolve(target)]
  const originalLoad = Module._load
  const originalPage = global.Page
  let config = null
  global.Page = (value) => { config = value }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../../utils/cloudApi') return cloudApi
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    require(target)
    return config
  } finally {
    Module._load = originalLoad
    global.Page = originalPage
  }
}

function createWxMock() {
  const storage = new Map()
  const navigations = []
  return {
    storage,
    navigations,
    api: {
      showLoading() {},
      hideLoading() {},
      showToast() {},
      setNavigationBarTitle() {},
      navigateBack() {},
      redirectTo() {},
      setStorageSync(key, value) { storage.set(key, clone(value)) },
      getStorageSync(key) { return storage.has(key) ? clone(storage.get(key)) : '' },
      removeStorageSync(key) { storage.delete(key) },
      navigateTo(options) {
        navigations.push(options.url)
        if (options.success) options.success()
        if (options.complete) options.complete()
      }
    }
  }
}

function parseQuery(url) {
  const query = url.split('?')[1] || ''
  return Object.fromEntries(query.split('&').filter(Boolean).map((entry) => {
    const [key, value = ''] = entry.split('=')
    return [decodeURIComponent(key), decodeURIComponent(value)]
  }))
}

async function waitUntil(predicate, message, timeoutMs = 1000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(message)
}

async function main() {
  const wxMock = createWxMock()
  const originalWx = global.wx
  const originalGetApp = global.getApp
  global.wx = wxMock.api
  global.getApp = () => ({ globalData: { isVip: true } })

  const records = [
    {
      _id: 'record_1',
      questionId: 'question_1',
      courseId: 'bank_1',
      result: 'none',
      questionType: 'fill',
      questionContent: '第一道复习题',
      questionAnswer: '答案一',
      questionOptions: []
    },
    {
      _id: 'record_2',
      questionId: 'question_2',
      courseId: 'bank_1',
      result: 'none',
      questionType: 'choice',
      questionContent: '第二道复习题',
      questionAnswer: 'B. 正确',
      questionCorrectIndex: 1,
      questionOptions: ['错误', '正确']
    }
  ]

  let studyRecordCalls = 0
  const cloudApi = {
    async getStudyRecords() {
      studyRecordCalls += 1
      return clone(records)
    },
    async getCourses() {
      return [{ _id: 'bank_1', name: '测试题库', category: '测试' }]
    },
    async getTodayReviews() {
      throw new Error('不应在会话快照存在时重新请求')
    }
  }

  try {
    const reviewConfig = loadPage('pages/review-book/review-book.js', cloudApi)
    const reviewPage = instantiate(reviewConfig)
    reviewPage.onLoad({})
    await waitUntil(() => reviewPage.data.loading === false, '复习本加载超时')
    assert.strictEqual(reviewPage.data.courseId, '', '缺失课程参数必须归一化为空字符串')
    assert.strictEqual(reviewPage.data.records.length, 2)
    assert(reviewPage.data.records.every((item) => item.reviewable))

    reviewPage.startOrdered()
    assert.strictEqual(wxMock.navigations.length, 1, '顺选必须触发一次跳转')
    const orderedOptions = parseQuery(wxMock.navigations[0])
    assert.strictEqual(orderedOptions.mode, 'review')
    assert(!orderedOptions.courseId.includes('undefined'), '跳转地址不得包含 undefined')
    assert(orderedOptions.reviewSessionKey, '顺选必须创建复习会话')

    const questionConfig = loadPage('pages/question/question.js', cloudApi)
    const questionPage = instantiate(questionConfig)
    questionPage.onLoad(orderedOptions)
    await waitUntil(() => questionPage.data.loading === false, '顺选答题页加载超时')
    assert.strictEqual(questionPage.data.questions.length, 2)
    assert.strictEqual(questionPage.data.currentQuestion.content, '第一道复习题')
    assert.deepStrictEqual(questionPage.data.questions.map((item) => item._id), ['question_1', 'question_2'])
    assert.strictEqual(studyRecordCalls, 1, '答题页应使用复习本快照，不应重复请求记录')
    assert(!wxMock.storage.has(`reviewSession:${orderedOptions.reviewSessionKey}`), '一次性会话读取后必须清理')

    reviewPage.startRandom()
    assert.strictEqual(wxMock.navigations.length, 2, '随机必须触发一次跳转')
    const randomOptions = parseQuery(wxMock.navigations[1])
    const randomSession = wxMock.storage.get(`reviewSession:${randomOptions.reviewSessionKey}`)
    assert(randomSession && randomSession.questions.length === 2, '随机会话必须保留完整题目集合')
    assert.deepStrictEqual(
      randomSession.questions.map((item) => item._id).sort(),
      ['question_1', 'question_2']
    )

    const failingCloudApi = {
      async getTodayReviews() { throw new Error('模拟网络错误') },
      async getStudyRecords() { throw new Error('模拟网络错误') }
    }
    const failingQuestionConfig = loadPage('pages/question/question.js', failingCloudApi)
    const failingPage = instantiate(failingQuestionConfig)
    failingPage.data.mode = 'review'
    failingPage.data.courseId = ''
    failingPage.data.questionIds = []
    await failingPage._loadQuestions()
    assert.strictEqual(failingPage.data.loading, false)
    assert.strictEqual(failingPage.data.questions.length, 0)
    assert.strictEqual(failingPage.data.emptyState.actionType, 'retry')
    assert.strictEqual(failingPage.data.emptyState.actionText, '重新加载')

    console.log('review ordered/random navigation regression checks passed')
  } finally {
    global.wx = originalWx
    global.getApp = originalGetApp
  }
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
