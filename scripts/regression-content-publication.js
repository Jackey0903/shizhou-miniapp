const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function clone(value) {
  return structuredClone(value)
}

function createDb(initial = {}) {
  const state = clone(initial)
  const records = (name) => {
    if (!state[name]) state[name] = []
    return state[name]
  }
  const matches = (item, query = {}) => Object.entries(query).every(([key, value]) => item[key] === value)

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
    skip(value) { this.offset = Math.max(0, Number(value) || 0); return this }
    limit(value) { this.maximum = Math.max(0, Number(value) || 0); return this }
    orderBy(field, direction) { this.sortField = field; this.sortDirection = direction || 'asc'; return this }
    selected() {
      const list = records(this.name).filter((item) => matches(item, this.query))
      if (!this.sortField) return list
      const factor = this.sortDirection === 'desc' ? -1 : 1
      return list.slice().sort((left, right) => {
        const a = left[this.sortField]
        const b = right[this.sortField]
        return (Number(a || 0) - Number(b || 0) || String(a || '').localeCompare(String(b || ''))) * factor
      })
    }
    async get() { return { data: clone(this.selected().slice(this.offset, this.offset + this.maximum)) } }
    async add({ data }) {
      const id = `${this.name}-${records(this.name).length + 1}`
      records(this.name).push({ _id: id, ...clone(data) })
      return { _id: id }
    }
    doc(id) {
      return {
        get: async () => {
          const value = records(this.name).find((item) => item._id === id)
          if (!value) throw new Error('document not found')
          return { data: clone(value) }
        },
        update: async ({ data }) => {
          const value = records(this.name).find((item) => item._id === id)
          if (!value) throw new Error('document not found')
          Object.assign(value, clone(data))
          return { stats: { updated: 1 } }
        }
      }
    }
  }

  return {
    state,
    collection: (name) => new Query(name),
    createCollection: async (name) => { records(name) },
    serverDate: () => new Date('2026-08-29T00:00:00.000Z')
  }
}

function loadFunction(name, database, openid = '') {
  const target = path.join(root, `cloudfunctions/${name}/index.js`)
  delete require.cache[require.resolve(target)]
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => database,
    getWXContext: () => ({ OPENID: openid })
  }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(target)
  } finally {
    Module._load = originalLoad
  }
}

async function testMergedPublishedCourses() {
  const db = createDb({
    subjects: [
      { _id: 'subject-on', name: '常识判断', enabled: true, status: 'enabled', sort: 1 },
      { _id: 'subject-off', name: '已下线模块', enabled: false, status: 'enabled', sort: 2 }
    ],
    question_banks: [
      { _id: 'bank-new', subjectId: 'subject-on', name: '新题库', enabled: true, status: 'enabled', sort: 10 },
      { _id: 'bank-hidden', subjectId: 'subject-off', name: '隐藏题库', enabled: true, status: 'enabled', sort: 11 }
    ],
    courses: [
      { _id: 'bank-legacy', category: '常识判断', name: '旧题库', enabled: true, status: 'enabled', sort: 20 },
      { _id: 'bank-offline', category: '常识判断', name: '旧下线题库', enabled: true, status: 'offline', sort: 21 }
    ]
  })
  const fn = loadFunction('getCourses', db)
  const result = await fn.main()
  assert.equal(result.code, 0)
  assert.equal(result.source, 'merged')
  assert.deepEqual(result.data.map((item) => item._id), ['bank-new', 'bank-legacy'])
}

async function testPublishedMaterialsAndBackgroundReplacement() {
  const db = createDb({
    users: [{ _id: 'admin', _openid: 'openid-admin', role: 'super_admin', isSuperAdmin: true }],
    materials: [
      { _id: 'material-on', name: '可领取', sort: 20, fileId: 'cloud://test/on', enabled: true },
      { _id: 'material-legacy', name: '旧资料', sort: 10, fileId: 'cloud://test/legacy' },
      { _id: 'material-off', name: '不可领取', sort: 30, fileId: 'cloud://test/off', enabled: true, status: 'offline' }
    ],
    material_redemptions: [],
    punch_backgrounds: [
      { _id: 'bg-current', title: '旧背景', activeDate: 'default', enabled: true, sort: 100, fileId: 'cloud://test/old' },
      { _id: 'bg-duplicate', title: '更早背景', activeDate: 'default', enabled: true, sort: 10, fileId: 'cloud://test/older' }
    ]
  })
  const materialsFn = loadFunction('getMaterials', db, 'openid-reader')
  const materials = await materialsFn.main()
  assert.equal(materials.code, 0)
  assert.deepEqual(materials.data.map((item) => item._id), ['material-legacy', 'material-on'])
  assert.equal(materials.data[0].fileId, undefined, 'unclaimed material resources must remain hidden')

  const configFn = loadFunction('adminConfigCenter', db, 'openid-admin')
  const saved = await configFn.main({
    action: 'save',
    target: 'punch_backgrounds',
    payload: {
      title: '新背景', activeDate: 'default', fileId: 'cloud://test/new', imageUrl: '', enabled: true, sort: 999
    }
  })
  assert.equal(saved.code, 0)
  assert.equal(db.state.punch_backgrounds.find((item) => item._id === 'bg-current').title, '新背景')
  assert.equal(db.state.punch_backgrounds.find((item) => item._id === 'bg-duplicate').enabled, false)
  const publicList = await configFn.main({ action: 'publicList', target: 'punch_backgrounds' })
  assert.deepEqual(publicList.data.map((item) => item._id), ['bg-current'])
}

async function testBasicVipConfigurationKeepsMonthlySupervision() {
  const db = createDb({
    users: [{ _id: 'admin', _openid: 'openid-admin', isAdmin: true }],
    vip_plans: [{
      _id: 'basic', code: 'basic_vip_year', price: 19800, days: 365,
      supervisionDays: 0, virtualProductId: 'sz_basic_vip_year', enabled: true
    }]
  })
  const fn = loadFunction('adminConfigCenter', db, 'openid-admin')
  const updated = await fn.main({
    action: 'save', target: 'vip_plans', payload: { id: 'basic', supervisionDays: 30 }
  })
  assert.equal(updated.code, 0, JSON.stringify(updated))
  const outdated = await fn.main({
    action: 'save', target: 'vip_plans', payload: { id: 'basic', supervisionDays: 0 }
  })
  assert.notEqual(outdated.code, 0, 'an older admin client must not reset basic VIP to zero supervision days')
  assert.equal(db.state.vip_plans[0].supervisionDays, 30)
}

async function main() {
  await testMergedPublishedCourses()
  await testPublishedMaterialsAndBackgroundReplacement()
  await testBasicVipConfigurationKeepsMonthlySupervision()
  console.log('content publication and configuration regression checks passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
