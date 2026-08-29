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
        },
        async set({ data }) {
          const index = records(collectionName).findIndex((entry) => entry._id === id)
          const next = { _id: id, ...clone(data) }
          if (index < 0) records(collectionName).push(next)
          else records(collectionName)[index] = next
          return { stats: { updated: index < 0 ? 0 : 1 } }
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
      { _id: 'super-admin-1', _openid: 'openid-super-admin', nickName: '最高管理员', role: 'super_admin' },
      { _id: 'user-1', _openid: 'openid-user', nickName: '普通用户', role: 'user' }
    ],
    subjects: [{ _id: 'subject-1', name: '常识判断', enabled: true, status: 'enabled' }],
    question_banks: [{ _id: 'bank-1', subjectId: 'subject-1', name: '判断推理', totalCount: 2, enabled: true, status: 'enabled' }],
    audios: [
      { _id: 'audio-a', title: 'B. 第二条', category: '常识', type: '晨听', fileId: 'cloud://test/audio-a', enabled: true, sort: 20 },
      { _id: 'audio-b', title: 'A. 第一条', category: '常识', type: '晨听', fileId: 'cloud://test/audio-b', enabled: true, sort: 10 }
    ],
    materials: [
      { _id: 'material-a', name: '旧资料', type: 'document', fileId: 'cloud://test/material-a', enabled: true, sort: 10 }
    ],
    wallpapers: [
      { _id: 'wallpaper-a', title: '旧壁纸', fileId: 'cloud://test/wallpaper-a', enabled: true, sort: 10 }
    ],
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
  const uploadQuestions = loadFunction('uploadQuestions', database, () => currentOpenid)

  currentOpenid = 'openid-user'
  const forbidden = await operations.main({ action: 'listManagedQuestions', payload: { courseId: 'bank-1' } })
  assert.equal(forbidden.code, 403, 'ordinary users must not access question management')

  currentOpenid = 'openid-admin'
  currentOpenid = 'openid-super-admin'
  const superAdminImport = await uploadQuestions.main({
    questions: [{
      subjectName: '常识判断',
      bankName: '最高管理员导入题库',
      type: 'fill',
      sort: 1,
      content: '最高管理员能否导题？',
      answer: '可以',
      explanation: '最高管理员与管理员拥有同等内容上传权限。'
    }]
  })
  assert.equal(superAdminImport.code, 0, 'highest administrators must be allowed to upload questions')
  assert(database.state.question_banks.some((item) => item.name === '最高管理员导入题库'))

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

  database.state.subjects[0].enabled = false
  const hiddenByModule = await getQuestions.main({ courseId: 'bank-1', skip: 0, limit: 20 })
  assert.equal(hiddenByModule.code, 404, 'taking a module offline must also hide all of its question banks')
  database.state.subjects[0].enabled = true

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

  const audioBefore = await operations.main({ action: 'listContent', payload: { target: 'audios', limit: 20 } })
  assert.deepEqual(audioBefore.data.map((item) => item._id), ['audio-b', 'audio-a'], 'content lists must follow the persisted ascending order')

  const savedAudio = await operations.main({
    action: 'saveContent',
    payload: {
      target: 'audios', id: 'audio-a', title: 'A. 已替换音频', category: '言语', type: '技巧', duration: '05:00',
      fileId: 'cloud://test/audio-replaced', fileUrl: '', sort: 5
    }
  })
  assert.equal(savedAudio.code, 0)
  assert.deepEqual(database.state.audios.find((item) => item._id === 'audio-a'), {
    _id: 'audio-a', title: 'A. 已替换音频', category: '言语', type: '技巧', duration: '05:00',
    fileId: 'cloud://test/audio-replaced', fileUrl: '', enabled: true, sort: 5,
    updatedAt: new Date('2026-08-27T00:00:00.000Z')
  })

  const savedMaterial = await operations.main({
    action: 'saveContent',
    payload: {
      target: 'materials', id: 'material-a', name: '资料已编辑', description: '替换后的资料', type: 'document',
      fileId: 'cloud://test/material-replaced', fileUrl: '', linkUrl: '', coverFileId: '', coverUrl: '', imageUrl: '', sort: 30
    }
  })
  assert.equal(savedMaterial.code, 0)
  const material = database.state.materials.find((item) => item._id === 'material-a')
  assert.equal(material.accessType, 'coin', 'editing must preserve the fixed coin redemption rule')
  assert.equal(material.coinCost, 10, 'editing must not permit a material price override')

  const reordered = await operations.main({ action: 'reorderContentByName', payload: { target: 'audios' } })
  assert.equal(reordered.code, 0)
  assert.deepEqual(
    database.state.audios.slice().sort((left, right) => left.sort - right.sort).map((item) => item.title),
    ['A. 第一条', 'A. 已替换音频'],
    'name sorting must write a durable public display order'
  )

  console.log('question management regression checks passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
