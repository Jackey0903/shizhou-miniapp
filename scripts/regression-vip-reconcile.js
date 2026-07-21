const assert = require('assert')
const Module = require('module')
const path = require('path')

const target = path.resolve(__dirname, '../cloudfunctions/vipPayCallback/index.js')

function loadFunction({ openid = '', orders = [] } = {}) {
  const calls = []
  const updates = []
  let queryCount = 0
  const db = {
    serverDate() {
      return new Date()
    },
    collection(name) {
      assert.strictEqual(name, 'orders')
      const api = {
        where(filter) {
          assert.deepStrictEqual(filter, { status: 'pending' })
          return api
        },
        limit(value) {
          assert.strictEqual(value, 100)
          return api
        },
        async get() {
          queryCount += 1
          return { data: orders }
        },
        doc(id) {
          return {
            async update(payload) {
              updates.push({ id, payload })
              const order = orders.find((item) => item._id === id)
              if (order) Object.assign(order, payload.data)
              return { updated: 1 }
            }
          }
        }
      }
      return api
    }
  }
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: openid }),
    async callFunction(options) {
      calls.push(options)
      return { result: { ErrCode: options.data.OutTradeNo.includes('paid') ? 0 : -1 } }
    }
  }
  delete require.cache[target]
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloudMock
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return { fn: require(target), calls, updates, getQueryCount: () => queryCount }
  } finally {
    Module._load = originalLoad
  }
}

async function testClientCannotStartBatchReconciliation() {
  const loaded = loadFunction({ openid: 'client_openid' })
  const result = await loaded.fn.main({})
  assert.strictEqual(result.ErrCode, -1)
  assert.strictEqual(loaded.getQueryCount(), 0)
}

async function testTimerOnlyChecksRecentVirtualOrders() {
  const now = Date.now()
  const orders = [
    { _id: 'paid', outTradeNo: 'paid_recent', status: 'pending', payChannel: 'wechat_virtual', createdAt: new Date(now - 1000) },
    { _id: 'pending', outTradeNo: 'pending_recent', status: 'pending', payChannel: 'wechat_virtual', createdAt: new Date(now - 2000) },
    { outTradeNo: 'legacy_recent', status: 'pending', payChannel: 'legacy_wechat', createdAt: new Date(now - 1000) },
    { outTradeNo: 'virtual_old', status: 'pending', payChannel: 'wechat_virtual', createdAt: new Date(now - 4 * 86400000) }
  ]
  const loaded = loadFunction({ orders })
  const result = await loaded.fn.main({ Type: 'Timer' })
  assert.deepStrictEqual(result, { code: 0, checked: 2, reconciled: 2, paid: 1 })
  assert.deepStrictEqual(loaded.calls.map((item) => item.data.OutTradeNo), ['paid_recent', 'pending_recent'])
  assert(loaded.calls.every((item) => item.name === 'createVipOrder'))
  assert.strictEqual(loaded.updates.length, 1)
  assert.strictEqual(loaded.updates[0].id, 'pending')
  assert.strictEqual(loaded.updates[0].payload.data.reconcileAttempts, 1)
  assert(loaded.updates[0].payload.data.reconcileNextAt.getTime() > now)
}

async function testBackoffLetsOtherPendingOrdersRotateIn() {
  const now = Date.now()
  const coolingDown = Array.from({ length: 10 }, (_, index) => ({
    _id: `cooling_${index}`,
    outTradeNo: `cooling_${index}`,
    status: 'pending',
    payChannel: 'wechat_virtual',
    createdAt: new Date(now - index * 1000),
    reconcileNextAt: new Date(now + 10 * 60 * 1000)
  }))
  const due = [
    { _id: 'due_1', outTradeNo: 'due_1', status: 'pending', payChannel: 'wechat_virtual', createdAt: new Date(now - 20000) },
    { _id: 'due_2', outTradeNo: 'due_2', status: 'pending', payChannel: 'wechat_virtual', createdAt: new Date(now - 30000) }
  ]
  const loaded = loadFunction({ orders: [...coolingDown, ...due] })
  const result = await loaded.fn.main({ Type: 'Timer' })
  assert.deepStrictEqual(result, { code: 0, checked: 2, reconciled: 2, paid: 0 })
  assert.deepStrictEqual(loaded.calls.map((item) => item.data.OutTradeNo), ['due_1', 'due_2'])
  assert.deepStrictEqual(loaded.updates.map((item) => item.id), ['due_1', 'due_2'])
}

async function main() {
  await testClientCannotStartBatchReconciliation()
  await testTimerOnlyChecksRecentVirtualOrders()
  await testBackoffLetsOtherPendingOrdersRotateIn()
  console.log('VIP payment scheduled reconciliation regression checks passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
