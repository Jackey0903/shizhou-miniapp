const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
}

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
    serverDate: () => new Date(),
    runTransaction: (handler) => handler(db)
  }
  return db
}

function loadCloudFunction(db, openid = 'user') {
  const target = path.join(root, 'cloudfunctions/grantCoinReward/index.js')
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

async function testClientRewardsOnlyCompletedShare() {
  const cloudApi = require('../utils/cloudApi')
  const originalGrant = cloudApi.grantCheckinShareReward
  const storage = new Map()
  let grantCalls = 0
  let pageDefinition = null
  const app = { globalData: { userInfo: { coins: 20 } } }

  global.wx = {
    getStorageSync(key) { return storage.get(key) || '' },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    showToast() {}
  }
  global.getApp = () => app
  global.Page = (definition) => { pageDefinition = definition }
  cloudApi.grantCheckinShareReward = async (claimId) => {
    grantCalls += 1
    assert.strictEqual(claimId, 'checkinShare:123456:abcdef')
    return { result: { code: 0, data: { amount: 10, coins: 30 } } }
  }

  const pagePath = path.join(root, 'pages/checkin/checkin.js')
  delete require.cache[require.resolve(pagePath)]
  require(pagePath)
  const page = { ...pageDefinition, data: {}, _shareClaimId: 'checkinShare:123456:abcdef' }

  await page.handleShareResult({ status: 'cancelled' })
  assert.strictEqual(grantCalls, 0, 'cancelling the share menu must not grant coins')

  page._shareClaimId = 'checkinShare:123456:abcdef'
  await page.handleShareResult({ status: 'shared' })
  assert.strictEqual(grantCalls, 1, 'a completed image share must grant coins once')
  assert.strictEqual(app.globalData.userInfo.coins, 30)
  assert.strictEqual(storage.has('pendingCheckinShareRewardClaimId'), false, 'a confirmed reward must clear its retry marker')

  cloudApi.grantCheckinShareReward = originalGrant
  delete require.cache[require.resolve(pagePath)]
  delete global.wx
  delete global.getApp
  delete global.Page
}

async function testServerRewardAndIdempotence() {
  const db = createMemoryDb({
    users: [{ _id: 'user-1', _openid: 'user', coins: 5 }],
    checkins: [{ _openid: 'user', dateStr: todayInShanghai() }],
    coin_logs: []
  })
  const cloudFunction = loadCloudFunction(db)
  const first = await cloudFunction.main({ action: 'checkinShareReward', claimId: 'checkinShare:claim-001' })
  assert.strictEqual(first.code, 0, JSON.stringify(first))
  assert.strictEqual(first.data.amount, 10)
  assert.strictEqual(first.data.coins, 15)

  const retry = await cloudFunction.main({ action: 'checkinShareReward', claimId: 'checkinShare:claim-001' })
  assert.strictEqual(retry.code, 0, JSON.stringify(retry))
  assert.strictEqual(retry.data.duplicate, true)
  assert.strictEqual(db.state.users[0].coins, 15, 'claim retries must not grant twice')
  assert.strictEqual(db.state.coin_logs.length, 1)

  const second = await cloudFunction.main({ action: 'checkinShareReward', claimId: 'checkinShare:claim-002' })
  assert.strictEqual(second.code, 0, JSON.stringify(second))
  assert.strictEqual(db.state.users[0].coins, 25)
  const overLimit = await cloudFunction.main({ action: 'checkinShareReward', claimId: 'checkinShare:claim-003' })
  assert.strictEqual(overLimit.code, 2)
  assert.strictEqual(db.state.users[0].coins, 25, 'daily reward must be capped at 20 coins')

  const legacy = await cloudFunction.main({ action: 'consumeCheckinShare', claimId: 'checkinShare:legacy-001' })
  assert.strictEqual(legacy.code, 2, 'legacy charge calls must map to the capped reward path')
  assert(!db.state.coin_logs.some((item) => Number(item.amount) < 0), 'share flow must never create a negative coin log')

  const noCheckinDb = createMemoryDb({ users: [{ _id: 'user-2', _openid: 'user', coins: 5 }], checkins: [], coin_logs: [] })
  const noCheckinFunction = loadCloudFunction(noCheckinDb)
  const rejected = await noCheckinFunction.main({ action: 'checkinShareReward', claimId: 'checkinShare:claim-004' })
  assert.strictEqual(rejected.code, 4)
  assert.strictEqual(noCheckinDb.state.users[0].coins, 5)
}

async function main() {
  const cloudFunction = read('cloudfunctions/grantCoinReward/index.js')
  const cloudApi = read('utils/cloudApi.js')
  const checkinPage = read('pages/checkin/checkin.js')
  const checkinTemplate = read('pages/checkin/checkin.wxml')
  const coinLogPage = read('pages/coin-log/coin-log.js')

  assert(cloudFunction.includes('checkinShareReward'), 'cloud function must expose the check-in share reward')
  assert(cloudFunction.includes('requiresTodayCheckin: true'), 'share rewards must require a current-day check-in')
  assert(cloudFunction.includes('runTransaction'), 'share rewards must be transactional')
  assert(cloudFunction.includes('dailyLimit: 20'), 'share rewards must enforce the daily cap')
  assert(cloudFunction.includes("requestedAction === 'consumeCheckinShare' ? 'checkinShareReward'"), 'legacy clients must be migrated away from deductions')
  assert(!cloudFunction.includes('amount: -CHECKIN_SHARE'), 'share flow must not retain a deduction path')

  assert(cloudApi.includes('grantCheckinShareReward'), 'client API must expose check-in share rewards')
  assert(checkinPage.includes('ensureShareReady'), 'button taps must actively verify the check-in state')
  assert(checkinPage.includes('rewardShareCoins'), 'completed image sharing must grant the reward')
  assert(!checkinPage.includes('ensureShareCoinBalance'), 'sharing must not require an existing coin balance')
  assert(checkinTemplate.includes('disabled="{{sharing}}"'), 'a stale shareReady value must not disable the button')
  assert(checkinTemplate.includes('分享图片（+10舟币）'), 'the button must disclose the reward')
  assert(coinLogPage.includes('checkin_share_reward'), 'the coin ledger must label the reward')

  await testClientRewardsOnlyCompletedShare()
  await testServerRewardAndIdempotence()
  console.log('check-in share reward regression checks passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
