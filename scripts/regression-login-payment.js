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
    const query = { filter: null, limitValue: null }

    const api = {
      where(filter) {
        query.filter = filter
        return api
      },
      limit(value) {
        query.limitValue = value
        return api
      },
      async get() {
        let data = state[name].filter((item) => !query.filter || matches(item, query.filter))
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
    vip_plans: []
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
  } finally {
    require('https').request = originalRequest
    process.env = oldEnv
  }
}

async function main() {
  await testPhoneLoginSupportsModernCode()
  testWechatLoginAvoidsDeprecatedProfileAuth()
  await testCreateVipOrderCreatesMissingUser()
  console.log('login/payment regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
