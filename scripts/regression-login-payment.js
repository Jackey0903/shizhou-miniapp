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

function createMemoryDb(initial = {}) {
  const state = {}
  Object.keys(initial).forEach((name) => {
    state[name] = initial[name].map((item, index) => ({
      _id: item._id || `${name}_${index + 1}`,
      ...item
    }))
  })
  let nextId = 1000

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
  assert(!loginJs.includes('wx.getUserProfile'), 'WeChat one-tap login should not require profile authorization')
  assert(loginJs.includes('cloudApi.userLogin({})'), 'WeChat one-tap login should create/login by openid')
}

async function testCreateVipOrderCreatesMissingUser() {
  const db = createMemoryDb({
    users: [],
    vip_plans: [{
      code: 'basic_vip_year',
      name: '基础VIP包年',
      tag: '基础VIP',
      price: 19800,
      days: 365,
      supervisionDays: 0,
      virtualProductId: 'basic_vip_year',
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
    assert.strictEqual(db.state.users.length, 1, 'missing user should be created before payment order')
    assert.strictEqual(db.state.orders.length, 1, 'payment order should be created')
    assert(result.data.payment.signData, 'payment signData should be returned')
    const signData = JSON.parse(result.data.payment.signData)
    assert.strictEqual(signData.goodsPrice, 19800, 'price must come from the server plan')
    assert.strictEqual(signData.productId, 'basic_vip_year')
  } finally {
    require('https').request = originalRequest
    process.env = oldEnv
  }
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

async function main() {
  await testPhoneLoginSupportsModernCode()
  await testPhoneLoginRejectsClientProvidedPhoneData()
  testWechatLoginAvoidsDeprecatedProfileAuth()
  await testCreateVipOrderCreatesMissingUser()
  await testCreateVipOrderDoesNotUseHardcodedPlanFallback()
  await testOrderListIsScopedAndComplete()
  console.log('login/payment regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
