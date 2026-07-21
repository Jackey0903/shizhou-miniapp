const assert = require('assert')
const Module = require('module')
const path = require('path')

const root = path.resolve(__dirname, '..')

function createMemoryDb(initial = {}) {
  const state = {}
  Object.keys(initial).forEach((name) => {
    state[name] = initial[name].map((item, index) => ({ _id: item._id || `${name}_${index + 1}`, ...item }))
  })
  let nextId = 1

  function matches(item, filter = {}) {
    return Object.keys(filter).every((key) => item[key] === filter[key])
  }

  function collection(name) {
    if (!state[name]) state[name] = []
    const query = { filter: null, limit: null }
    const api = {
      where(filter) {
        query.filter = filter
        return api
      },
      limit(value) {
        query.limit = value
        return api
      },
      async get() {
        let data = state[name].filter((item) => !query.filter || matches(item, query.filter))
        if (query.limit !== null) data = data.slice(0, query.limit)
        return { data: data.map((item) => ({ ...item })) }
      },
      async count() {
        return { total: state[name].filter((item) => !query.filter || matches(item, query.filter)).length }
      },
      async add({ data }) {
        const _id = `${name}_${nextId++}`
        state[name].push({ _id, ...data })
        return { _id }
      },
      doc(id) {
        return {
          async get() {
            const item = state[name].find((entry) => entry._id === id)
            if (!item) throw new Error('document not found')
            return { data: { ...item } }
          },
          async update({ data }) {
            const index = state[name].findIndex((entry) => entry._id === id)
            if (index < 0) throw new Error('document not found')
            state[name][index] = { ...state[name][index], ...data }
            return { stats: { updated: 1 } }
          },
          async set({ data }) {
            const index = state[name].findIndex((entry) => entry._id === id)
            if (index < 0) state[name].push({ _id: id, ...data })
            else state[name][index] = { _id: id, ...data }
            return { _id: id }
          }
        }
      }
    }
    return api
  }

  return {
    state,
    collection,
    serverDate() {
      return new Date('2026-07-21T00:00:00.000Z')
    }
  }
}

function loadUploadFunction(db, openid) {
  const target = path.join(root, 'cloudfunctions/uploadQuestions/index.js')
  delete require.cache[require.resolve(target)]
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: openid })
  }
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloudMock
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(target)
  } finally {
    Module._load = originalLoad
  }
}

async function testAdminCanImportAndRetryWithoutDuplicates() {
  const db = createMemoryDb({
    users: [{ _openid: 'admin_openid', role: 'admin' }],
    subjects: [],
    question_banks: [],
    courses: [],
    questions: []
  })
  const fn = loadUploadFunction(db, 'admin_openid')
  const questions = [
    {
      subjectName: '行测', bankName: '判断推理', type: 'choice', sort: 1,
      content: '测试选择题', options: ['A项', 'B项'], correctIndex: 1,
      importKey: 'client-controlled-key'
    },
    {
      subjectName: '申论', bankName: '归纳概括', type: 'fill', sort: 1,
      content: '测试填空题', answer: '参考答案'
    }
  ]

  const first = await fn.main({ questions })
  assert.strictEqual(first.code, 0, JSON.stringify(first))
  assert.deepStrictEqual(first.data, { totalCount: 2, insertedCount: 2, skippedCount: 0, bankCount: 2 })
  assert.strictEqual(db.state.questions.length, 2)
  assert(db.state.questions.every((item) => /^q_[a-f0-9]{30}$/.test(item._id)))
  assert.notStrictEqual(db.state.questions[0].importKey, 'client-controlled-key')
  assert.strictEqual(db.state.question_banks.length, 2)

  const second = await fn.main({ questions })
  assert.strictEqual(second.code, 0, JSON.stringify(second))
  assert.strictEqual(second.data.insertedCount, 0)
  assert.strictEqual(second.data.skippedCount, 2)
  assert.strictEqual(db.state.questions.length, 2)
}

async function testNonAdminCannotImport() {
  const db = createMemoryDb({ users: [{ _openid: 'user_openid', role: 'user' }] })
  const fn = loadUploadFunction(db, 'user_openid')
  const result = await fn.main({ questions: [{ content: '不应写入' }] })
  assert.notStrictEqual(result.code, 0)
  assert.strictEqual((db.state.questions || []).length, 0)
}

async function testLegacyQuestionWithoutImportKeyIsSkipped() {
  const db = createMemoryDb({
    users: [{ _openid: 'admin_openid', role: 'admin' }],
    subjects: [{ _id: 'subject_1', name: '行测' }],
    question_banks: [{ _id: 'bank_1', subjectId: 'subject_1', name: '判断推理' }],
    questions: [{ bankId: 'bank_1', courseId: 'bank_1', type: 'fill', content: '旧题目', answer: '旧答案' }]
  })
  const fn = loadUploadFunction(db, 'admin_openid')
  const result = await fn.main({
    questions: [{ bankId: 'bank_1', type: 'fill', content: '旧题目', answer: '新答案' }]
  })
  assert.strictEqual(result.code, 0, JSON.stringify(result))
  assert.strictEqual(result.data.insertedCount, 0)
  assert.strictEqual(result.data.skippedCount, 1)
  assert.strictEqual(db.state.questions.length, 1)
}

async function testInvalidBatchDoesNotCreateEmptySubjectOrBank() {
  const db = createMemoryDb({
    users: [{ _openid: 'admin_openid', role: 'admin' }],
    subjects: [], question_banks: [], courses: [], questions: []
  })
  const fn = loadUploadFunction(db, 'admin_openid')
  const result = await fn.main({
    questions: [
      {
        sourceRowNumber: 2,
        subjectName: '新科目', bankName: '新题库', type: 'choice',
        content: '合法题目', options: ['A项', 'B项'], correctIndex: 0
      },
      {
        sourceRowNumber: 3,
        subjectName: '新科目', bankName: '新题库', type: 'fill',
        content: '缺少答案'
      }
    ]
  })
  assert.notStrictEqual(result.code, 0)
  assert.match(result.msg, /第 3 行/)
  assert.strictEqual(db.state.subjects.length, 0, 'invalid batches must not leave an empty subject')
  assert.strictEqual(db.state.question_banks.length, 0, 'invalid batches must not leave an empty bank')
  assert.strictEqual(db.state.questions.length, 0, 'invalid batches must not write partial questions')
}

async function testUnknownQuestionTypeIsRejected() {
  const db = createMemoryDb({
    users: [{ _openid: 'admin_openid', role: 'admin' }],
    subjects: [], question_banks: [], courses: [], questions: []
  })
  const fn = loadUploadFunction(db, 'admin_openid')
  const result = await fn.main({
    questions: [{
      subjectName: '行测', bankName: '判断推理', type: 'unknown',
      content: '错误题型', options: ['A项', 'B项'], correctIndex: 0
    }]
  })
  assert.notStrictEqual(result.code, 0)
  assert.match(result.msg, /题型只能是/)
  assert.strictEqual(db.state.subjects.length, 0)
}

async function main() {
  await testAdminCanImportAndRetryWithoutDuplicates()
  await testNonAdminCannotImport()
  await testLegacyQuestionWithoutImportKeyIsSkipped()
  await testInvalidBatchDoesNotCreateEmptySubjectOrBank()
  await testUnknownQuestionTypeIsRejected()
  console.log('question upload cloud regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
