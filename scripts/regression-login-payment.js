const assert = require('assert')
const Module = require('module')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')

function loadWithCloudMock(modulePath, cloudMock) {
  const target = path.resolve(projectRoot, modulePath)
  delete require.cache[target]
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

function createMemoryDb(initial = {}, options = {}) {
  const state = {}
  Object.keys(initial).forEach((name) => {
    state[name] = initial[name].map((item, index) => ({
      _id: item._id || `${name}_${index + 1}`,
      ...item
    }))
  })
  let nextId = 1000

  function assertValidDocumentValue(value, path = 'data') {
    if (!options.rejectInvalidDocuments) return
    if (value === undefined) throw new Error(`invalid document value at ${path}: undefined`)
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`invalid document value at ${path}: non-finite number`)
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertValidDocumentValue(item, `${path}[${index}]`))
      return
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      Object.keys(value).forEach((key) => assertValidDocumentValue(value[key], `${path}.${key}`))
    }
  }

  function matches(doc, query = {}) {
    return Object.keys(query).every((key) => doc[key] === query[key])
  }

  function collection(name) {
    if (!state[name]) state[name] = []
    const query = { filter: null, limitValue: null, orderField: '', orderDirection: 'asc' }

    const api = {
      where(filter) {
        query.filter = filter
        return api
      },
      limit(value) {
        query.limitValue = value
        return api
      },
      orderBy(field, direction) {
        query.orderField = field
        query.orderDirection = direction === 'desc' ? 'desc' : 'asc'
        return api
      },
      async get() {
        let data = state[name].filter((item) => !query.filter || matches(item, query.filter))
        if (query.orderField) {
          const direction = query.orderDirection === 'desc' ? -1 : 1
          data = data.slice().sort((a, b) => {
            const left = new Date(a[query.orderField] || 0).getTime()
            const right = new Date(b[query.orderField] || 0).getTime()
            return (left - right) * direction
          })
        }
        if (query.limitValue !== null) data = data.slice(0, query.limitValue)
        return { data: data.map((item) => ({ ...item })) }
      },
      async remove() {
        const before = state[name].length
        state[name] = state[name].filter((item) => query.filter && !matches(item, query.filter))
        return { stats: { removed: before - state[name].length } }
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
          async set({ data }) {
            const index = state[name].findIndex((item) => item._id === id)
            if (index >= 0) state[name][index] = { _id: id, ...data }
            else state[name].push({ _id: id, ...data })
            return { _id: id }
          },
          async update({ data }) {
            assertValidDocumentValue(data)
            const index = state[name].findIndex((item) => item._id === id)
            if (index >= 0) state[name][index] = { ...state[name][index], ...data }
            return { stats: { updated: index >= 0 ? 1 : 0 } }
          }
        }
      }
    }
    return api
  }

  return {
    state,
    collection,
    async runTransaction(callback) {
      return callback({ collection })
    },
    async createCollection(name) {
      if (!state[name]) state[name] = []
      return {}
    },
    serverDate() {
      return new Date('2026-07-06T00:00:00.000Z')
    }
  }
}

async function testPhoneLoginSupportsModernCode() {
  const db = createMemoryDb()
  let requestedCode = ''
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_phone', APPID: 'wxca6ebd21699eca53' }),
    openapi: {
      phonenumber: {
        async getPhoneNumber({ code }) {
          requestedCode = code
          return { phone_info: { phoneNumber: '13800000000' } }
        },
        async decryptPhoneNumber() {
          throw new Error('legacy decrypt should not be used for code login')
        }
      }
    }
  }

  const fn = loadWithCloudMock('cloudfunctions/userLogin/index.js', cloudMock)
  const result = await fn.main({ loginType: 'phone', phoneCode: 'PHONE_CODE_123' })
  assert.strictEqual(result.code, 0, JSON.stringify(result))
  assert.strictEqual(requestedCode, 'PHONE_CODE_123')
  assert.strictEqual(result.data.phone, '13800000000')
  assert.strictEqual(db.state.phone_identities.length, 1, 'verified phone must have a unique identity reservation')
  assert.strictEqual(db.state.phone_identities[0].userId, result.data._id)
  assert(!db.state.phone_identities[0].phone, 'identity reservation must not duplicate the raw phone number')
}

async function testLoginRequiresPhoneAuthorization() {
  const db = createMemoryDb()
  const fn = loadWithCloudMock('cloudfunctions/userLogin/index.js', {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_without_phone', APPID: 'wxca6ebd21699eca53' })
  })
  const result = await fn.main({})
  assert.strictEqual(result.code, 428, JSON.stringify(result))
  assert.strictEqual(result.errorCode, 'PHONE_REQUIRED')
  assert.strictEqual((db.state.users || []).length, 0)
  assert.strictEqual((db.state.tokens || []).length, 0)
}

async function testLegacyClientCanResumeOnlyAnAlreadyPhoneBoundAccount() {
  const db = createMemoryDb({
    users: [{ _id: 'bound_legacy_client', _openid: 'openid_bound_legacy', phone: '13800000009' }]
  })
  const fn = loadWithCloudMock('cloudfunctions/userLogin/index.js', {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_bound_legacy', APPID: 'wxca6ebd21699eca53' })
  })
  const result = await fn.main({})
  assert.strictEqual(result.code, 0, JSON.stringify(result))
  assert.strictEqual(result.data._id, 'bound_legacy_client')
  assert.strictEqual(result.data.phone, '13800000009')
  assert(result.data.token, 'legacy client compatibility must still issue an expiring token')
  assert.strictEqual(db.state.phone_identities.length, 1)
}

async function testPhoneLoginRejectsClientProvidedPhoneData() {
  const db = createMemoryDb()
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_forged', APPID: 'wxca6ebd21699eca53' }),
    openapi: { phonenumber: { async getPhoneNumber() { throw new Error('must not run') } } }
  }
  const fn = loadWithCloudMock('cloudfunctions/userLogin/index.js', cloudMock)
  const result = await fn.main({ loginType: 'phone', phoneData: { phoneNumber: '13800000000' } })
  assert.notStrictEqual(result.code, 0, 'client-provided phone data must not be trusted')
  assert.strictEqual((db.state.users || []).length, 0)
}

function testWechatLoginAvoidsDeprecatedProfileAuth() {
  const loginWxml = require('fs').readFileSync(path.join(projectRoot, 'pages/login/login.wxml'), 'utf8')
  const loginJs = require('fs').readFileSync(path.join(projectRoot, 'pages/login/login.js'), 'utf8')
  assert(!loginWxml.includes('open-type="getUserInfo"'), 'login.wxml must not use deprecated open-type=getUserInfo')
  assert(!loginJs.includes('wx.getUserProfile'), 'WeChat login must not require deprecated profile authorization')
  assert(!loginJs.includes('cloudApi.userLogin({})'), 'openid-only login must not be available')
  assert.strictEqual((loginWxml.match(/open-type="getPhoneNumber"/g) || []).length, 1, 'login must use one phone authorization button')
  assert(loginWxml.includes('disabled="{{loading || !agreed}}"'), 'phone authorization must require agreement consent')
  assert(loginJs.includes('phoneCode'), 'login must forward the modern one-time phone code')
}

async function testLegacyUserBindsPhoneWithoutLosingIdentityOrRole() {
  const db = createMemoryDb({
    users: [{
      _id: 'legacy_admin',
      _openid: 'openid_legacy',
      phone: '',
      role: 'admin',
      isAdmin: true,
      coins: 77,
      streak: 9
    }]
  })
  const fn = loadWithCloudMock('cloudfunctions/userLogin/index.js', {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_legacy', APPID: 'wxca6ebd21699eca53' }),
    openapi: {
      phonenumber: {
        async getPhoneNumber() {
          return { phone_info: { purePhoneNumber: '13900000001' } }
        }
      }
    }
  })
  const result = await fn.main({ loginType: 'phone', phoneCode: 'LEGACY_BIND_CODE' })
  assert.strictEqual(result.code, 0, JSON.stringify(result))
  assert.strictEqual(result.data._id, 'legacy_admin')
  assert.strictEqual(result.data.phone, '13900000001')
  assert.strictEqual(result.data.role, 'admin')
  assert.strictEqual(result.data.coins, 77)
  assert.strictEqual(result.data.streak, 9)
  assert.strictEqual(db.state.users.length, 1)
}

async function testDuplicatePhoneCannotBindAnotherWechatAccount() {
  const db = createMemoryDb({
    users: [{ _id: 'phone_owner', _openid: 'openid_owner', phone: '13900000002' }]
  })
  const fn = loadWithCloudMock('cloudfunctions/userLogin/index.js', {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_other', APPID: 'wxca6ebd21699eca53' }),
    openapi: {
      phonenumber: {
        async getPhoneNumber() {
          return { phone_info: { purePhoneNumber: '13900000002' } }
        }
      }
    }
  })
  const result = await fn.main({ loginType: 'phone', phoneCode: 'DUPLICATE_PHONE_CODE' })
  assert.strictEqual(result.code, 409, JSON.stringify(result))
  assert.strictEqual(result.errorCode, 'PHONE_ALREADY_BOUND')
  assert.strictEqual(db.state.users.length, 1)
  assert.strictEqual((db.state.tokens || []).length, 0)
}

async function testBoundAccountCannotSilentlyChangePhone() {
  const db = createMemoryDb({
    users: [{ _id: 'bound_user', _openid: 'openid_bound', phone: '13900000003' }]
  })
  const fn = loadWithCloudMock('cloudfunctions/userLogin/index.js', {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_bound', APPID: 'wxca6ebd21699eca53' }),
    openapi: {
      phonenumber: {
        async getPhoneNumber() {
          return { phone_info: { purePhoneNumber: '13900000004' } }
        }
      }
    }
  })
  const result = await fn.main({ loginType: 'phone', phoneCode: 'CHANGE_PHONE_CODE' })
  assert.strictEqual(result.code, 409, JSON.stringify(result))
  assert.strictEqual(result.errorCode, 'PHONE_CHANGE_FORBIDDEN')
  assert.strictEqual(db.state.users[0].phone, '13900000003')
}

async function testCurrentUserRequiresBoundPhone() {
  const db = createMemoryDb({
    users: [{ _id: 'legacy_user', _openid: 'openid_legacy_current', phone: '' }]
  })
  const fn = loadWithCloudMock('cloudfunctions/userLogin/index.js', {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_legacy_current', APPID: 'wxca6ebd21699eca53' })
  })
  const result = await fn.main({ action: 'getCurrentUser' })
  assert.strictEqual(result.code, 428, JSON.stringify(result))
  assert.strictEqual(result.errorCode, 'PHONE_REQUIRED')
}

async function testCreateVipOrderRequiresPhoneBoundUser() {
  const db = createMemoryDb({
    users: [],
    vip_plans: [{
      code: 'basic_vip_year', name: '基础VIP包年', tag: '基础VIP', price: 19800,
      days: 365, supervisionDays: 0, virtualProductId: 'sz_basic_vip_year',
      benefits: [], enabled: true, sort: 1
    }]
  })
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_pay', APPID: 'wxca6ebd21699eca53' })
  }
  const oldEnv = { ...process.env }
  process.env.VIRTUAL_PAY_ENV = '0'
  process.env.VIRTUAL_PAY_OFFER_ID = '1450567889'
  process.env.VIRTUAL_PAY_PROD_APP_KEY = 'test_app_key'
  process.env.WECHAT_APP_SECRET = 'test_secret'
  try {
    const fn = loadWithCloudMock('cloudfunctions/createVipOrder/index.js', cloudMock)
    const result = await fn.main({ planCode: 'basic_vip_year', jsCode: 'JS_CODE' })
    assert.strictEqual(result.code, 428, JSON.stringify(result))
    assert.strictEqual(result.errorCode, 'PHONE_REQUIRED')
    assert.strictEqual(db.state.users.length, 0, 'payment must not create an unverified user')
    assert.strictEqual((db.state.orders || []).length, 0)
  } finally {
    process.env = oldEnv
  }
}

async function testCreateVipOrderSupportsPhoneBoundUser() {
  const db = createMemoryDb({
    users: [{ _id: 'bound_pay_user', _openid: 'openid_pay', phone: '13900000005' }],
    vip_plans: [{
      code: 'basic_vip_year',
      name: '基础VIP包年',
      tag: '基础VIP',
      price: 19800,
      days: 365,
      supervisionDays: 0,
      virtualProductId: 'sz_basic_vip_year',
      benefits: [],
      enabled: true,
      sort: 1
    }]
  })

  const originalRequest = require('https').request
  require('https').request = function requestMock(url, options, callback) {
    const listeners = {}
    const res = {
      on(event, cb) {
        listeners[event] = cb
      }
    }
    process.nextTick(() => {
      callback(res)
      listeners.data && listeners.data(JSON.stringify({
        openid: 'openid_pay',
        session_key: 'mock_session_key'
      }))
      listeners.end && listeners.end()
    })
    return {
      on() {},
      write() {},
      end() {}
    }
  }

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_pay', APPID: 'wxca6ebd21699eca53' })
  }

  const oldEnv = { ...process.env }
  process.env.VIRTUAL_PAY_ENV = '0'
  process.env.VIRTUAL_PAY_OFFER_ID = '1450567889'
  process.env.VIRTUAL_PAY_PROD_APP_KEY = 'test_app_key'
  process.env.WECHAT_APP_SECRET = 'test_secret'

  try {
    const fn = loadWithCloudMock('cloudfunctions/createVipOrder/index.js', cloudMock)
    const result = await fn.main({ planCode: 'basic_vip_year', jsCode: 'JS_CODE' })
    assert.strictEqual(result.code, 0, JSON.stringify(result))
    assert.strictEqual(db.state.users.length, 1, 'payment must preserve the verified user')
    assert.strictEqual(db.state.orders.length, 1, 'payment order should be created')
    assert(result.data.payment.signData, 'payment signData should be returned')
    const signData = JSON.parse(result.data.payment.signData)
    assert.strictEqual(signData.goodsPrice, 19800, 'price must come from the server plan')
    assert.strictEqual(signData.productId, 'sz_basic_vip_year')
  } finally {
    require('https').request = originalRequest
    process.env = oldEnv
  }
}

async function testPlansOnlyExposePublishedProductMappings() {
  const db = createMemoryDb({
    vip_plans: [
      {
        code: 'basic_vip_year', virtualProductId: 'sz_basic_vip_year', name: '有效套餐',
        price: 19800, days: 365, supervisionDays: 0, enabled: true, sort: 1
      },
      {
        code: 'supervision_trial_day', virtualProductId: 'supervision_trial_day', name: '错误道具ID',
        price: 800, days: 1, supervisionDays: 0, enabled: true, sort: 2
      },
      {
        code: 'supervision_month', virtualProductId: 'sz_supervision_mon', name: '错误价格',
        price: 800, days: 365, supervisionDays: 30, enabled: true, sort: 3
      },
      {
        code: 'unknown_plan', virtualProductId: 'unknown_product', name: '未发布套餐',
        price: 100, days: 1, supervisionDays: 0, enabled: true, sort: 4
      }
    ]
  })
  const fn = loadWithCloudMock('cloudfunctions/createVipOrder/index.js', {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_pay', APPID: 'wxca6ebd21699eca53' })
  })
  const result = await fn.main({ action: 'plans' })
  assert.strictEqual(result.code, 0, JSON.stringify(result))
  assert.deepStrictEqual(result.data.map((item) => item.code), ['basic_vip_year'])
}

async function testCreateVipOrderNeverFallsBackToBusinessPlanCodeAsProductId() {
  const db = createMemoryDb({
    users: [],
    vip_plans: [{
      code: 'basic_vip_year', name: '基础VIP包年', price: 19800,
      days: 365, supervisionDays: 0, enabled: true, sort: 1
    }]
  })
  const fn = loadWithCloudMock('cloudfunctions/createVipOrder/index.js', {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_pay', APPID: 'wxca6ebd21699eca53' })
  })
  const result = await fn.main({ planCode: 'basic_vip_year', jsCode: 'UNUSED' })
  assert.notStrictEqual(result.code, 0)
  assert.strictEqual((db.state.orders || []).length, 0, 'missing product ID must never create an unpayable order')
}

async function testCreateVipOrderDoesNotUseHardcodedPlanFallback() {
  const db = createMemoryDb({ users: [], vip_plans: [] })
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_no_plan', APPID: 'wxca6ebd21699eca53' })
  }
  const fn = loadWithCloudMock('cloudfunctions/createVipOrder/index.js', cloudMock)
  const result = await fn.main({ planCode: 'basic_vip_year', jsCode: 'UNUSED' })
  assert.notStrictEqual(result.code, 0)
  assert.strictEqual((db.state.orders || []).length, 0, 'missing server plan must never create an order')
}

async function testOrderListIsScopedAndComplete() {
  const db = createMemoryDb({
    orders: [
      {
        _id: 'order_current',
        _openid: 'openid_pay',
        outTradeNo: 'OUT_CURRENT',
        status: 'paid',
        planCode: 'basic_vip_year',
        planLabel: '基础VIP包年',
        price: 19800,
        deliveryStatus: 'confirmed',
        benefits: ['免广告学习'],
        createdAt: '2026-07-02T00:00:00.000Z'
      },
      {
        _id: 'order_other',
        _openid: 'openid_other',
        outTradeNo: 'OUT_OTHER',
        status: 'paid',
        price: 98800,
        createdAt: '2026-07-03T00:00:00.000Z'
      }
    ]
  })
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_pay', APPID: 'wxca6ebd21699eca53' })
  }
  const fn = loadWithCloudMock('cloudfunctions/createVipOrder/index.js', cloudMock)
  const result = await fn.main({ action: 'list', limit: 100 })
  assert.strictEqual(result.code, 0, JSON.stringify(result))
  assert.strictEqual(result.data.length, 1, 'users must only see their own orders')
  assert.strictEqual(result.data[0].outTradeNo, 'OUT_CURRENT')
  assert.strictEqual(result.data[0].price, 19800)
  assert.strictEqual(result.data[0].deliveryStatus, 'confirmed')
}

async function testSyncVirtualOrderRejectsIncompleteWechatResponseWithoutInvalidDbWrite() {
  const db = createMemoryDb({
    orders: [{
      _id: 'order_pending',
      _openid: 'openid_pay',
      outTradeNo: 'OUT_PENDING_123',
      status: 'pending',
      payChannel: 'wechat_virtual',
      price: 800
    }]
  }, { rejectInvalidDocuments: true })

  const responses = [
    { access_token: 'mock_access_token', expires_in: 7200 },
    { errcode: 0, errmsg: '' }
  ]
  const originalRequest = require('https').request
  require('https').request = function requestMock(url, options, callback) {
    const listeners = {}
    const response = responses.shift() || {}
    const res = {
      on(event, cb) {
        listeners[event] = cb
      }
    }
    process.nextTick(() => {
      callback(res)
      listeners.data && listeners.data(JSON.stringify(response))
      listeners.end && listeners.end()
    })
    return {
      on() {},
      write() {},
      end() {}
    }
  }

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid_pay', APPID: 'wxca6ebd21699eca53' })
  }
  const oldEnv = { ...process.env }
  process.env.VIRTUAL_PAY_ENV = '0'
  process.env.VIRTUAL_PAY_OFFER_ID = '1450567889'
  process.env.VIRTUAL_PAY_PROD_APP_KEY = 'test_app_key'
  process.env.WECHAT_APP_SECRET = 'test_secret'

  try {
    const fn = loadWithCloudMock('cloudfunctions/createVipOrder/index.js', cloudMock)
    const result = await fn.main({ action: 'sync', outTradeNo: 'OUT_PENDING_123' })
    assert.strictEqual(result.code, 1, JSON.stringify(result))
    assert.match(result.msg, /订单|支付结果/)
    assert(!Object.prototype.hasOwnProperty.call(db.state.orders[0], 'remoteStatus'))
  } finally {
    require('https').request = originalRequest
    process.env = oldEnv
  }
}

async function testPaidOrderGrantsBenefitsAndConfirmsDeliveryOnlyOnce() {
  const db = createMemoryDb({
    users: [{
      _id: 'user_paid', _openid: 'openid_pay', isVip: false,
      vipExpireDate: new Date('2026-07-01T00:00:00.000Z')
    }],
    orders: [{
      _id: 'order_paid', _openid: 'openid_pay', outTradeNo: 'OUT_PAID_123',
      status: 'pending', payChannel: 'wechat_virtual', planCode: 'basic_vip_year',
      planId: 'basic_vip_year', planLabel: '基础VIP包年', price: 19800,
      days: 365, supervisionDays: 0, benefits: ['免广告学习']
    }],
    coin_logs: []
  })
  const paidOrder = {
    errcode: 0,
    order: {
      order_id: 'OUT_PAID_123', wx_order_id: 'WX_ORDER_123',
      status: 2, order_fee: 19800
    }
  }
  const responses = [
    { access_token: 'mock_access_token', expires_in: 7200 },
    paidOrder,
    {},
    paidOrder
  ]
  const requests = []
  const originalRequest = require('https').request
  require('https').request = function requestMock(url, options, callback) {
    const listeners = {}
    const chunks = []
    const response = responses.shift() || {}
    requests.push({ url: String(url), chunks, headers: options.headers || {} })
    const res = {
      on(event, cb) { listeners[event] = cb }
    }
    process.nextTick(() => {
      callback(res)
      listeners.data && listeners.data(JSON.stringify(response))
      listeners.end && listeners.end()
    })
    return {
      on() {},
      write(chunk) { chunks.push(String(chunk)) },
      end() {}
    }
  }

  const oldEnv = { ...process.env }
  process.env.VIRTUAL_PAY_ENV = '0'
  process.env.VIRTUAL_PAY_OFFER_ID = '1450567889'
  process.env.VIRTUAL_PAY_PROD_APP_KEY = 'test_app_key'
  process.env.WECHAT_APP_SECRET = 'test_secret'
  try {
    const fn = loadWithCloudMock('cloudfunctions/createVipOrder/index.js', {
      DYNAMIC_CURRENT_ENV: 'mock-env',
      init() {}, database: () => db,
      getWXContext: () => ({ OPENID: 'openid_pay', APPID: 'wxca6ebd21699eca53' })
    })
    const first = await fn.main({ action: 'sync', outTradeNo: 'OUT_PAID_123' })
    assert.strictEqual(first.code, 0, JSON.stringify(first))
    assert.strictEqual(db.state.orders[0].status, 'paid')
    assert.strictEqual(db.state.orders[0].benefitsGranted, true)
    assert.strictEqual(db.state.orders[0].deliveryStatus, 'notified')
    assert.strictEqual(db.state.coin_logs.length, 1)
    const firstExpiry = new Date(db.state.users[0].vipExpireDate).getTime()
    assert(firstExpiry > new Date('2026-07-06T00:00:00.000Z').getTime())

    const second = await fn.main({ action: 'sync', outTradeNo: 'OUT_PAID_123' })
    assert.strictEqual(second.code, 0, JSON.stringify(second))
    assert.strictEqual(new Date(db.state.users[0].vipExpireDate).getTime(), firstExpiry, 'retries must not add benefits twice')
    assert.strictEqual(db.state.coin_logs.length, 1, 'retries must not duplicate payment logs')

    const queryRequest = requests.find((item) => item.url.includes('/xpay/query_order'))
    const deliveryRequest = requests.find((item) => item.url.includes('/xpay/notify_provide_goods'))
    assert(queryRequest && queryRequest.url.includes('pay_sig='), 'query_order must carry its server signature')
    assert(Number(queryRequest.headers['Content-Length']) > 0, 'server POST requests must include Content-Length')
    assert(deliveryRequest, 'paid orders must confirm goods delivery')
    assert.strictEqual(JSON.parse(deliveryRequest.chunks.join('')).order_id, 'OUT_PAID_123')
  } finally {
    require('https').request = originalRequest
    process.env = oldEnv
  }
}

async function main() {
  await testLoginRequiresPhoneAuthorization()
  await testLegacyClientCanResumeOnlyAnAlreadyPhoneBoundAccount()
  await testPhoneLoginSupportsModernCode()
  await testPhoneLoginRejectsClientProvidedPhoneData()
  testWechatLoginAvoidsDeprecatedProfileAuth()
  await testLegacyUserBindsPhoneWithoutLosingIdentityOrRole()
  await testDuplicatePhoneCannotBindAnotherWechatAccount()
  await testBoundAccountCannotSilentlyChangePhone()
  await testCurrentUserRequiresBoundPhone()
  await testCreateVipOrderRequiresPhoneBoundUser()
  await testCreateVipOrderSupportsPhoneBoundUser()
  await testCreateVipOrderDoesNotUseHardcodedPlanFallback()
  await testPlansOnlyExposePublishedProductMappings()
  await testCreateVipOrderNeverFallsBackToBusinessPlanCodeAsProductId()
  await testOrderListIsScopedAndComplete()
  await testSyncVirtualOrderRejectsIncompleteWechatResponseWithoutInvalidDbWrite()
  await testPaidOrderGrantsBenefitsAndConfirmsDeliveryOnlyOnce()
  console.log('login/payment regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
