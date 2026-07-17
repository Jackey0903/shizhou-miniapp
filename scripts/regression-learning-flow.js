const assert = require('assert')
const Module = require('module')
const crypto = require('crypto')
const path = require('path')

const root = path.resolve(__dirname, '..')

function loadWithCloudMock(relativePath, cloudMock) {
  const target = path.join(root, relativePath)
  delete require.cache[require.resolve(target)]
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

function createMemoryDb(initial = {}) {
  const state = {}
  Object.entries(initial).forEach(([name, docs]) => {
    state[name] = docs.map((doc, index) => ({ _id: doc._id || `${name}_${index + 1}`, ...doc }))
  })
  let nextId = 1000
  const command = {
    inc(value) { return { __op: 'inc', value: Number(value) || 0 } },
    gte(value) { return { and() { return { __op: 'range', start: value } } } }
  }

  function matches(doc, filter = {}) {
    return Object.entries(filter).every(([key, value]) => {
      if (value && value.__op === 'range') return true
      return doc[key] === value
    })
  }

  function applyUpdate(doc, data) {
    const next = { ...doc }
    Object.entries(data).forEach(([key, value]) => {
      next[key] = value && value.__op === 'inc' ? Number(next[key] || 0) + value.value : value
    })
    return next
  }

  function collection(name) {
    if (!state[name]) state[name] = []
    const query = { filter: {}, skip: 0, limit: Infinity, order: null }
    const api = {
      where(filter) { query.filter = filter || {}; return api },
      skip(value) { query.skip = Number(value) || 0; return api },
      limit(value) { query.limit = Number(value) || 0; return api },
      orderBy(field, direction) { query.order = { field, direction }; return api },
      async get() {
        let data = state[name].filter((doc) => matches(doc, query.filter))
        if (query.order) {
          const factor = query.order.direction === 'desc' ? -1 : 1
          data = data.slice().sort((a, b) => {
            const left = a[query.order.field]
            const right = b[query.order.field]
            return (left > right ? 1 : left < right ? -1 : 0) * factor
          })
        }
        return { data: data.slice(query.skip, query.skip + query.limit).map((doc) => ({ ...doc })) }
      },
      async count() {
        return { total: state[name].filter((doc) => matches(doc, query.filter)).length }
      },
      async add({ data }) {
        const _id = `${name}_${nextId++}`
        state[name].push({ _id, ...data })
        return { _id }
      },
      doc(id) {
        return {
          async get() {
            const doc = state[name].find((item) => item._id === id)
            if (!doc) throw new Error('document not found')
            return { data: { ...doc } }
          },
          async set({ data }) {
            const index = state[name].findIndex((item) => item._id === id)
            const doc = { _id: id, ...data }
            if (index >= 0) state[name][index] = doc
            else state[name].push(doc)
            return { _id: id }
          },
          async update({ data }) {
            const index = state[name].findIndex((item) => item._id === id)
            if (index < 0) throw new Error('document not found')
            state[name][index] = applyUpdate(state[name][index], data)
            return { stats: { updated: 1 } }
          },
          async remove() {
            state[name] = state[name].filter((item) => item._id !== id)
            return { stats: { removed: 1 } }
          }
        }
      }
    }
    return api
  }

  const db = {
    state,
    command,
    collection,
    serverDate() { return new Date() },
    async runTransaction(callback) { return callback(db) }
  }
  return db
}

function createCloudMock(db, context) {
  return {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => context
  }
}

async function testAnswerSubmissionAndReviewAccess() {
  const db = createMemoryDb({
    users: [{ _id: 'user_1', _openid: 'user_a', isVip: false }],
    question_banks: [{ _id: 'bank_1', name: '公开题库', status: 'enabled', isLocked: false }],
    questions: [{
      _id: 'question_1',
      bankId: 'bank_1',
      type: 'choice',
      content: '正确答案是哪项？',
      options: ['错误', '正确'],
      correctIndex: 1,
      answer: 'B. 正确',
      explanation: '测试解析'
    }],
    study_records: []
  })
  const context = { OPENID: 'user_a' }
  const fn = loadWithCloudMock('cloudfunctions/submitAnswer/index.js', createCloudMock(db, context))

  const first = await fn.main({
    questionId: 'question_1',
    courseId: 'spoofed_bank',
    result: 'know',
    userOptionIndex: 0,
    submissionId: 'submission:answer:0001'
  })
  assert.strictEqual(first.code, 0, JSON.stringify(first))
  assert.strictEqual(first.data.isCorrect, false, 'correctness must be derived from the stored question')
  assert.strictEqual(db.state.study_records.length, 1)
  assert.strictEqual(db.state.study_records[0].courseId, 'bank_1', 'client courseId must not override the question bank')
  assert.strictEqual(db.state.study_records[0].questionContent, '正确答案是哪项？')

  const duplicate = await fn.main({
    questionId: 'question_1',
    result: 'know',
    userOptionIndex: 1,
    submissionId: 'submission:answer:0001'
  })
  assert.strictEqual(duplicate.code, 0)
  assert.strictEqual(duplicate.data.duplicate, true)
  assert.strictEqual(db.state.study_records[0].reviewTimes, 1, 'duplicate submissions must not advance the schedule')

  db.state.question_banks[0].isLocked = true
  let list = await fn.main({ action: 'list', courseId: 'bank_1' })
  assert.strictEqual(list.code, 403, 'expired/non-VIP users must not read locked review snapshots')
  db.state.users[0].isVip = true
  db.state.users[0].vipExpireDate = new Date(Date.now() + 86400000)
  list = await fn.main({ action: 'list', courseId: 'bank_1' })
  assert.strictEqual(list.code, 0)
  assert.strictEqual(list.data.length, 1)

  context.OPENID = 'user_b'
  const otherList = await fn.main({ action: 'list' })
  assert.strictEqual(otherList.code, 0)
  assert.strictEqual(otherList.data.length, 0, 'study records must be scoped to the current WeChat identity')
}

async function testLockedQuestionSubmission() {
  const db = createMemoryDb({
    users: [{ _id: 'user_2', _openid: 'user_locked', isVip: false }],
    question_banks: [{ _id: 'bank_locked', status: 'enabled', isLocked: true }],
    questions: [{ _id: 'question_locked', bankId: 'bank_locked', type: 'fill', content: '填空', answer: '答案' }],
    study_records: []
  })
  const fn = loadWithCloudMock(
    'cloudfunctions/submitAnswer/index.js',
    createCloudMock(db, { OPENID: 'user_locked' })
  )
  const result = await fn.main({
    questionId: 'question_locked',
    result: 'know',
    userAnswer: '答案',
    submissionId: 'submission:locked:001'
  })
  assert.strictEqual(result.code, 403)
  assert.strictEqual(db.state.study_records.length, 0)
}

async function testCheckinEligibilityAndIdempotency() {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
  const db = createMemoryDb({
    users: [{ _id: 'user_checkin', _openid: 'checkin_user', streak: 0, totalCheckins: 0 }],
    plans: [{ _id: 'plan_1', _openid: 'checkin_user', courseId: 'bank_1', dailyCount: 2 }],
    study_records: [
      { _id: 'record_1', _openid: 'checkin_user', courseId: 'bank_1', questionId: 'q1', firstStudyDateStr: dateStr },
      { _id: 'record_2', _openid: 'checkin_user', courseId: 'bank_1', questionId: 'q2', firstStudyDateStr: dateStr }
    ],
    checkins: []
  })
  const fn = loadWithCloudMock('cloudfunctions/checkin/index.js', createCloudMock(db, { OPENID: 'checkin_user' }))
  const first = await fn.main({})
  assert.strictEqual(first.code, 0, JSON.stringify(first))
  assert.strictEqual(db.state.checkins.length, 1)
  assert.strictEqual(db.state.users[0].totalCheckins, 1)

  const duplicate = await fn.main({})
  assert.strictEqual(duplicate.code, 1)
  assert.strictEqual(db.state.checkins.length, 1, 'one user can only check in once per Shanghai calendar day')
  assert.strictEqual(db.state.users[0].totalCheckins, 1)

  db.state.checkins = []
  db.state.study_records = db.state.study_records.slice(0, 1)
  const incomplete = await fn.main({})
  assert.strictEqual(incomplete.code, 2, 'daily plan target must be completed before check-in')
}

async function main() {
  await testAnswerSubmissionAndReviewAccess()
  await testLockedQuestionSubmission()
  await testCheckinEligibilityAndIdempotency()
  console.log('learning, review and check-in regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
