const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const Module = require('node:module')

const ROOT = path.resolve(__dirname, '..')

function copy(value) {
  return structuredClone(value)
}

function createCloudHarness() {
  let currentOpenid = ''
  let nextId = 1
  const state = {
    users: [
      {
        _id: 'owner',
        _openid: 'openid-owner',
        nickName: '最高管理员',
        phone: '15058073343',
        isAdmin: true,
        isSuperAdmin: true,
        role: 'super_admin',
        lastLoginAt: new Date('2026-08-02T01:00:00.000Z')
      },
      {
        _id: 'operator',
        _openid: 'openid-operator',
        nickName: '普通管理员',
        isAdmin: true,
        isSuperAdmin: false,
        role: 'admin',
        lastLoginAt: new Date('2026-08-01T01:00:00.000Z')
      },
      {
        _id: 'student-new',
        _openid: 'openid-student-new',
        nickName: '测试学员',
        phone: '13900000000',
        role: 'user',
        lastLoginAt: new Date('2026-07-31T01:00:00.000Z')
      },
      {
        _id: 'legacy-user',
        _openid: 'openid-legacy',
        nickName: '历史用户',
        phone: '',
        role: 'user'
      }
    ],
    admin_audit_logs: []
  }

  function records(name) {
    if (!state[name]) state[name] = []
    return state[name]
  }

  function matches(item, query) {
    return Object.entries(query || {}).every(([key, expected]) => item[key] === expected)
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

    where(query) {
      this.query = query || {}
      return this
    }

    skip(offset) {
      this.offset = Number(offset) || 0
      return this
    }

    limit(maximum) {
      this.maximum = Number(maximum)
      return this
    }

    orderBy(field, direction) {
      this.sortField = field
      this.sortDirection = direction
      return this
    }

    selected() {
      let items = records(this.name).filter((item) => matches(item, this.query))
      if (this.sortField) {
        const field = this.sortField
        const factor = this.sortDirection === 'desc' ? -1 : 1
        items = items.slice().sort((left, right) => String(left[field] || '').localeCompare(String(right[field] || '')) * factor)
      }
      return items
    }

    async get() {
      return { data: copy(this.selected().slice(this.offset, this.offset + this.maximum)) }
    }

    async count() {
      return { total: this.selected().length }
    }

    async update({ data }) {
      let updated = 0
      this.selected().forEach((item) => {
        Object.assign(item, copy(data))
        updated += 1
      })
      return { stats: { updated } }
    }

    async remove() {
      const selected = new Set(this.selected())
      state[this.name] = records(this.name).filter((item) => !selected.has(item))
      return { stats: { removed: selected.size } }
    }

    doc(id) {
      return {
        get: async () => ({ data: copy(records(this.name).find((item) => item._id === id) || null) }),
        update: async ({ data }) => {
          const item = records(this.name).find((entry) => entry._id === id)
          if (!item) throw new Error('document not found')
          Object.assign(item, copy(data))
          return { stats: { updated: 1 } }
        },
        set: async ({ data }) => {
          const items = records(this.name)
          const index = items.findIndex((entry) => entry._id === id)
          const value = { _id: id, ...copy(data) }
          if (index >= 0) items[index] = value
          else items.push(value)
          return { _id: id }
        }
      }
    }

    async add({ data }) {
      const id = `generated-${nextId++}`
      records(this.name).push({ _id: id, ...copy(data) })
      return { _id: id }
    }
  }

  const database = {
    collection: (name) => new Query(name),
    createCollection: async (name) => {
      records(name)
    },
    runTransaction: async (callback) => callback({ collection: (name) => new Query(name) }),
    serverDate: () => new Date('2026-08-02T02:00:00.000Z')
  }
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => database,
    getWXContext: () => ({ OPENID: currentOpenid }),
    openapi: {}
  }

  const operationsPath = path.join(ROOT, 'cloudfunctions/adminOperations/index.js')
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return originalLoad.call(this, request, parent, isMain)
  }
  delete require.cache[require.resolve(operationsPath)]
  let operations
  try {
    operations = require(operationsPath)
  } finally {
    Module._load = originalLoad
  }

  return {
    state,
    call: async (openid, action, payload = {}) => {
      currentOpenid = openid
      return operations.main({ action, payload })
    }
  }
}

function loadAdminPage(apiOverrides = {}) {
  let definition = null
  const calls = { modal: [], toast: [], navigateBack: 0, stopPullDownRefresh: 0 }
  const api = {
    getAdminIdentity: async () => ({ current: { _id: 'owner', isSuperAdmin: true } }),
    getAdministrators: async () => [],
    getAdminUsers: async (page, pageSize) => ({ items: [], page, pageSize, total: 0, hasMore: false }),
    searchAdminUsers: async () => [],
    setAdministrator: async (userId, enabled) => ({
      code: 0,
      msg: enabled ? '已设为管理员' : '已取消管理员',
      data: { _id: userId, nickName: '测试用户', isAdmin: enabled, isSuperAdmin: false, role: enabled ? 'admin' : 'user' }
    }),
    transferSuperAdministrator: async () => ({ code: 0 }),
    ...apiOverrides
  }
  const wx = {
    showModal(options) {
      calls.modal.push(options)
      if (options.success) options.success({ confirm: true, cancel: false })
    },
    showToast(options) {
      calls.toast.push(options)
    },
    navigateBack() {
      calls.navigateBack += 1
    },
    stopPullDownRefresh() {
      calls.stopPullDownRefresh += 1
    }
  }
  const source = fs.readFileSync(path.join(ROOT, 'pages/admin-role-manager/admin-role-manager.js'), 'utf8')
  vm.runInNewContext(source, {
    require(request) {
      if (request === '../../utils/cloudApi') return api
      throw new Error(`unexpected require: ${request}`)
    },
    Page(config) {
      definition = config
    },
    wx,
    Promise,
    Date,
    Number,
    String,
    console,
    setTimeout,
    clearTimeout
  }, { filename: 'admin-role-manager.js' })

  const page = {
    ...definition,
    data: copy(definition.data),
    setData(patch) {
      this.data = { ...this.data, ...patch }
    }
  }
  return { page, api, calls }
}

test('highest administrator can page through every user without leaking openid', async () => {
  const harness = createCloudHarness()
  const first = await harness.call('openid-owner', 'listUsers', { page: 1, pageSize: 2 })
  const second = await harness.call('openid-owner', 'listUsers', { page: 2, pageSize: 2 })

  assert.equal(first.code, 0)
  assert.equal(first.data.total, 4)
  assert.equal(first.data.hasMore, true)
  assert.equal(second.data.hasMore, false)
  const users = first.data.items.concat(second.data.items)
  assert.deepEqual(new Set(users.map((item) => item._id)), new Set(['owner', 'operator', 'student-new', 'legacy-user']))
  users.forEach((user) => assert.equal(Object.hasOwn(user, '_openid'), false))
})

test('ordinary administrators cannot list, search or change administrator roles', async () => {
  const harness = createCloudHarness()
  const results = await Promise.all([
    harness.call('openid-operator', 'listUsers'),
    harness.call('openid-operator', 'searchUsers', { keyword: '测试' }),
    harness.call('openid-operator', 'listAdministrators'),
    harness.call('openid-operator', 'setAdministrator', { userId: 'student-new', enabled: true }),
    harness.call('openid-operator', 'transferSuperAdmin', { userId: 'student-new' })
  ])
  results.forEach((result) => assert.equal(result.code, 403))
})

test('highest administrator can search users and list only administrators', async () => {
  const harness = createCloudHarness()
  const byPhone = await harness.call('openid-owner', 'searchUsers', { keyword: '13900000000' })
  const byNickname = await harness.call('openid-owner', 'searchUsers', { keyword: '历史' })
  const administrators = await harness.call('openid-owner', 'listAdministrators')

  assert.deepEqual(byPhone.data.map((item) => item._id), ['student-new'])
  assert.deepEqual(byNickname.data.map((item) => item._id), ['legacy-user'])
  assert.deepEqual(administrators.data.map((item) => item._id), ['owner', 'operator'])
})

test('granting and revoking administrator updates role fields and audit logs', async () => {
  const harness = createCloudHarness()
  const granted = await harness.call('openid-owner', 'setAdministrator', { userId: 'student-new', enabled: true })
  assert.equal(granted.code, 0)
  assert.equal(granted.data.isAdmin, true)
  assert.equal(granted.data.role, 'admin')

  const revoked = await harness.call('openid-owner', 'setAdministrator', { userId: 'student-new', enabled: false })
  assert.equal(revoked.code, 0)
  assert.equal(revoked.data.isAdmin, false)
  assert.equal(revoked.data.role, 'user')
  assert.deepEqual(harness.state.admin_audit_logs.map((item) => item.action), ['grant_admin', 'revoke_admin'])
})

test('highest administrator transfer is atomic from the caller perspective', async () => {
  const harness = createCloudHarness()
  const transferred = await harness.call('openid-owner', 'transferSuperAdmin', { userId: 'student-new' })
  assert.equal(transferred.code, 0)

  const owner = harness.state.users.find((item) => item._id === 'owner')
  const target = harness.state.users.find((item) => item._id === 'student-new')
  assert.deepEqual({ isAdmin: owner.isAdmin, isSuperAdmin: owner.isSuperAdmin, role: owner.role }, {
    isAdmin: true,
    isSuperAdmin: false,
    role: 'admin'
  })
  assert.deepEqual({ isAdmin: target.isAdmin, isSuperAdmin: target.isSuperAdmin, role: target.role }, {
    isAdmin: true,
    isSuperAdmin: true,
    role: 'super_admin'
  })
  assert.equal(harness.state.users.filter((item) => item.isSuperAdmin || item.role === 'super_admin').length, 1)
  assert.equal((await harness.call('openid-owner', 'listUsers')).code, 403)
  assert.equal((await harness.call('openid-student-new', 'listUsers')).code, 0)
})

test('administrator page loads users, searches and grants a role', async () => {
  const { page } = loadAdminPage({
    getAdministrators: async () => [{ _id: 'owner', nickName: '最高管理员', isAdmin: true, isSuperAdmin: true }],
    getAdminUsers: async (number, pageSize) => ({
      items: [{ _id: 'student-new', nickName: '测试学员', isAdmin: false, isSuperAdmin: false }],
      page: number,
      pageSize,
      total: 1,
      hasMore: false
    }),
    searchAdminUsers: async () => [{ _id: 'student-new', nickName: '测试学员', isAdmin: false, isSuperAdmin: false }]
  })
  await page.onLoad()
  assert.equal(page.data.authorized, true)
  assert.equal(page.data.userTotal, 1)
  assert.equal(page.data.administrators.length, 1)

  page.setData({ keyword: '13900000000' })
  await page.search()
  assert.equal(page.data.searchMode, true)
  page.selectUser({ currentTarget: { dataset: { id: 'student-new', source: 'users' } } })
  page.confirm = async () => true
  await page.setAdmin({ currentTarget: { dataset: { enabled: 'true' } } })
  assert.equal(page.data.selectedUser.isAdmin, true)
  assert.equal(page.data.selectedUser.roleLabel, '管理员')
})

test('administrator page rejects an ordinary administrator before loading lists', async () => {
  let listCalls = 0
  const { page, calls } = loadAdminPage({
    getAdminIdentity: async () => ({ current: { _id: 'operator', isSuperAdmin: false } }),
    getAdministrators: async () => {
      listCalls += 1
      return []
    },
    getAdminUsers: async () => {
      listCalls += 1
      return { items: [], total: 0 }
    }
  })
  await page.onLoad()
  assert.equal(page.data.authorized, false)
  assert.equal(listCalls, 0)
  assert.equal(calls.modal[0].title, '无操作权限')
  assert.equal(calls.navigateBack, 1)
})
