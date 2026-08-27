const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function clone(value) {
  return structuredClone(value)
}

function createMemoryDb(initial) {
  const state = clone(initial)

  function records(name) {
    if (!state[name]) state[name] = []
    return state[name]
  }

  function matches(item, query = {}) {
    return Object.entries(query).every(([key, expected]) => item[key] === expected)
  }

  class Query {
    constructor(name, query = {}) {
      this.name = name
      this.query = query
      this.offset = 0
      this.maximum = Infinity
      this.sortField = ''
      this.sortDirection = 'asc'
    }

    where(query) { this.query = query || {}; return this }
    skip(offset) { this.offset = Math.max(0, Number(offset) || 0); return this }
    limit(maximum) { this.maximum = Math.max(0, Number(maximum) || 0); return this }
    orderBy(field, direction) { this.sortField = field; this.sortDirection = direction || 'asc'; return this }

    selected() {
      const rows = records(this.name).filter((item) => matches(item, this.query))
      if (!this.sortField) return rows
      const factor = this.sortDirection === 'desc' ? -1 : 1
      return rows.slice().sort((left, right) => {
        const first = Number(left[this.sortField])
        const second = Number(right[this.sortField])
        if (Number.isFinite(first) && Number.isFinite(second)) return (first - second) * factor
        return String(left[this.sortField] || '').localeCompare(String(right[this.sortField] || '')) * factor
      })
    }

    async get() {
      return { data: clone(this.selected().slice(this.offset, this.offset + this.maximum)) }
    }

    async count() {
      return { total: this.selected().length }
    }

    async update({ data }) {
      this.selected().forEach((item) => Object.assign(item, clone(data)))
      return { stats: { updated: this.selected().length } }
    }

    async remove() {
      const selected = new Set(this.selected())
      state[this.name] = records(this.name).filter((item) => !selected.has(item))
      return { stats: { removed: selected.size } }
    }

    async add({ data }) {
      const id = `${this.name}-${records(this.name).length + 1}`
      records(this.name).push({ _id: id, ...clone(data) })
      return { _id: id }
    }

    doc(id) {
      const collectionName = this.name
      return {
        async get() {
          const item = records(collectionName).find((entry) => entry._id === id)
          if (!item) throw new Error('document not found')
          return { data: clone(item) }
        },
        async update({ data }) {
          const item = records(collectionName).find((entry) => entry._id === id)
          if (!item) throw new Error('document not found')
          Object.assign(item, clone(data))
          return { stats: { updated: 1 } }
        },
        async remove() {
          const index = records(collectionName).findIndex((entry) => entry._id === id)
          if (index < 0) throw new Error('document not found')
          records(collectionName).splice(index, 1)
          return { stats: { removed: 1 } }
        }
      }
    }
  }

  return {
    state,
    collection: (name) => new Query(name),
    createCollection: async (name) => { records(name) },
    serverDate: () => new Date('2026-08-27T00:00:00.000Z')
  }
}

function loadFunction(name, database, getOpenid) {
  const target = path.join(root, `cloudfunctions/${name}/index.js`)
  delete require.cache[require.resolve(target)]
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => database,
    getWXContext: () => ({ OPENID: getOpenid() })
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

async function main() {
  let currentOpenid = 'openid-admin'
  const database = createMemoryDb({
    users: [
      { _id: 'admin-1', _openid: 'openid-admin', nickName: '运营管理员', isAdmin: true, role: 'admin' },
      { _id: 'user-1', _openid: 'openid-user', nickName: '普通用户', role: 'user' }
    ],
    question_banks: [{ _id: 'bank-1', name: '判断推理', totalCount: 2, status: 'enabled' }],
    questions: [
      {
        _id: 'question-0', bankId: 'bank-1', courseId: 'bank-1', type: 'choice', sort: 0,
        content: '已下线的第一道题', options: ['甲', '乙'], correctIndex: 0, answer: 'A. 甲', enabled: false, status: 'disabled'
      },
      {
        _id: 'question-1', bankId: 'bank-1', courseId: 'bank-1', type: 'choice', sort: 1,
        content: '第一道选择题', options: ['甲', '乙'], correctIndex: 0, answer: 'A. 甲', explanation: '原解析'
      },
      {
        _id: 'question-2', bankId: 'bank-1', courseId: 'bank-1', type: 'fill', sort: 2,
        content: '材料分析题', answer: '参考答案', explanation: '材料解析'
      }
    ],
    study_records: [{ _id: 'record-1', questionId: 'question-1', questionContent: '第一道选择题' }],
    admin_audit_logs: []
  })
  const operations = loadFunction('adminOperations', database, () => currentOpenid)
  const getQuestions = loadFunction('getQuestions', database, () => currentOpenid)

  currentOpenid = 'openid-user'
  const forbidden = await operations.main({ action: 'listManagedQuestions', payload: { courseId: 'bank-1' } })
  assert.equal(forbidden.code, 403, 'ordinary users must not access question management')

  currentOpenid = 'openid-admin'
  const listed = await operations.main({
    action: 'listManagedQuestions',
    payload: { courseId: 'bank-1', keyword: '材料', page: 1, pageSize: 20 }
  })
  assert.equal(listed.code, 0)
  assert.equal(listed.data.total, 1)
  assert.equal(listed.data.items[0]._id, 'question-2')
  assert.equal(listed.data.items[0].enabled, true)

  const edited = await operations.main({
    action: 'saveManagedQuestion',
    payload: {
      id: 'question-1', courseId: 'bank-1', type: 'choice', sort: 8,
      content: '已经编辑的选择题', options: ['新甲', '新乙'], correctIndex: 1, explanation: '更新后的解析'
    }
  })
  assert.equal(edited.code, 0)
  const updatedQuestion = database.state.questions.find((item) => item._id === 'question-1')
  assert.equal(updatedQuestion.sort, 8)
  assert.equal(updatedQuestion.answer, 'B. 新乙')
  assert.equal(updatedQuestion.content, '已经编辑的选择题')

  const invalidAnswer = await operations.main({
    action: 'saveManagedQuestion',
    payload: {
      id: 'question-1', courseId: 'bank-1', type: 'choice', sort: 8,
      content: '已经编辑的选择题', options: ['新甲', '新乙'], correctIndex: -1, explanation: '更新后的解析'
    }
  })
  assert.equal(invalidAnswer.code, -1)
  assert.equal(updatedQuestion.correctIndex, 1, 'invalid answer index must not overwrite the question')

  const duplicate = await operations.main({
    action: 'saveManagedQuestion',
    payload: {
      id: 'question-1', courseId: 'bank-1', type: 'fill', sort: 8,
      content: '材料分析题', answer: '重复答案', explanation: '重复题测试'
    }
  })
  assert.equal(duplicate.code, -1, 'editing must not create a duplicate of a legacy question without importKey')

  const offline = await operations.main({
    action: 'toggleManagedQuestion',
    payload: { id: 'question-2', courseId: 'bank-1', enabled: false }
  })
  assert.equal(offline.code, 0)
  assert.equal(database.state.questions.find((item) => item._id === 'question-2').enabled, false)
  assert.equal(database.state.question_banks[0].totalCount, 1, 'offline questions must not be included in the user-facing total')

  const hiddenFirstPage = await getQuestions.main({ courseId: 'bank-1', skip: 0, limit: 1 })
  assert.equal(hiddenFirstPage.code, 0)
  assert.deepEqual(hiddenFirstPage.data, [], 'a disabled first record must not reach learners')
  assert.equal(hiddenFirstPage.nextSkip, 1, 'the public API must return a raw-data cursor after disabled records')
  assert.equal(hiddenFirstPage.sourceExhausted, false)

  const publicQuestions = await getQuestions.main({ courseId: 'bank-1', skip: hiddenFirstPage.nextSkip, limit: 20 })
  assert.equal(publicQuestions.code, 0)
  assert.deepEqual(publicQuestions.data.map((item) => item._id), ['question-1'], 'offline questions must not reach learners')

  const deleted = await operations.main({
    action: 'deleteManagedQuestion',
    payload: { id: 'question-1', courseId: 'bank-1' }
  })
  assert.equal(deleted.code, 0)
  assert.equal(database.state.questions.some((item) => item._id === 'question-1'), false)
  assert.equal(database.state.study_records.length, 1, 'permanent question deletion must preserve historical study records')
  assert.equal(database.state.question_banks[0].totalCount, 0)
  assert.deepEqual(
    database.state.admin_audit_logs.map((item) => item.action),
    ['update_question', 'toggle_question', 'delete_question'],
    'all write operations must be auditable'
  )

  console.log('question management regression checks passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
