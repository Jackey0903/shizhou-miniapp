const assert = require('assert')
const Module = require('module')
const path = require('path')

const root = path.resolve(__dirname, '..')

function createMemoryDb(initial = {}) {
  const state = {}
  Object.keys(initial).forEach((name) => {
    state[name] = initial[name].map((item, index) => ({ _id: item._id || `${name}_${index + 1}`, ...item }))
  })

  function collection(name) {
    if (!state[name]) state[name] = []
    let filter = null
    let limitValue = null
    const api = {
      where(nextFilter) { filter = nextFilter; return api },
      limit(nextLimit) { limitValue = nextLimit; return api },
      async get() {
        let data = state[name].filter((item) => !filter || Object.keys(filter).every((key) => item[key] === filter[key]))
        if (limitValue !== null) data = data.slice(0, limitValue)
        return { data: data.map((item) => ({ ...item })) }
      },
      doc(id) {
        return {
          async get() {
            const item = state[name].find((entry) => entry._id === id)
            if (!item) throw new Error('document not found')
            return { data: { ...item } }
          },
          async set({ data }) {
            const index = state[name].findIndex((entry) => entry._id === id)
            if (index >= 0) state[name][index] = { _id: id, ...data }
            else state[name].push({ _id: id, ...data })
          },
          async update({ data }) {
            const index = state[name].findIndex((entry) => entry._id === id)
            if (index < 0) throw new Error('document not found')
            state[name][index] = { ...state[name][index], ...data }
          }
        }
      }
    }
    return api
  }

  const db = {
    state,
    collection,
    serverDate: () => new Date('2026-07-22T00:00:00.000Z'),
    runTransaction: (handler) => handler(db)
  }
  return db
}

function loadFunction(db, openid = 'user') {
  const target = path.join(root, 'cloudfunctions/exchangeMaterial/index.js')
  delete require.cache[require.resolve(target)]
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
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

async function testFixedCostAndIdempotence() {
  const db = createMemoryDb({
    users: [{ _id: 'user-1', _openid: 'user', coins: 70 }],
    materials: [{ _id: 'material-1', name: '旧免费资料', accessType: 'free', coinCost: 0, enabled: true }],
    material_redemptions: [],
    coin_logs: []
  })
  const fn = loadFunction(db)
  const first = await fn.main({ materialId: 'material-1' })
  assert.strictEqual(first.code, 0, JSON.stringify(first))
  assert.strictEqual(first.data.alreadyOwned, false)
  assert.strictEqual(first.data.remainingCoins, 60)
  assert.strictEqual(db.state.users[0].coins, 60)
  assert.strictEqual(db.state.coin_logs.length, 1)
  assert.strictEqual(db.state.coin_logs[0].amount, -10)
  assert.strictEqual(db.state.material_redemptions[0].cost, 10)

  const retry = await fn.main({ materialId: 'material-1' })
  assert.strictEqual(retry.code, 0, JSON.stringify(retry))
  assert.strictEqual(retry.data.alreadyOwned, true)
  assert.strictEqual(retry.data.remainingCoins, 60)
  assert.strictEqual(db.state.users[0].coins, 60, 'owned materials must reopen without another deduction')
  assert.strictEqual(db.state.coin_logs.length, 1, 'owned materials must not create another ledger entry')
}

async function testInsufficientBalanceIsAtomic() {
  const db = createMemoryDb({
    users: [{ _id: 'user-2', _openid: 'user', coins: 9 }],
    materials: [{ _id: 'material-2', name: '资料', accessType: 'vip', coinCost: 1, enabled: true }],
    material_redemptions: [],
    coin_logs: []
  })
  const fn = loadFunction(db)
  const result = await fn.main({ materialId: 'material-2' })
  assert.strictEqual(result.code, 2)
  assert.strictEqual(db.state.users[0].coins, 9)
  assert.strictEqual(db.state.material_redemptions.length, 0)
  assert.strictEqual(db.state.coin_logs.length, 0)
}

async function main() {
  await testFixedCostAndIdempotence()
  await testInsufficientBalanceIsAtomic()
  console.log('material fixed-cost redemption regression checks passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
