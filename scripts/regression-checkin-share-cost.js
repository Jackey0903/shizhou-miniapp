const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

async function testClientChargesOnlyCompletedShare() {
  const cloudApi = require('../utils/cloudApi')
  const originalConsume = cloudApi.consumeCheckinShare
  const storage = new Map()
  let consumeCalls = 0
  let pageDefinition = null

  global.wx = {
    getStorageSync(key) { return storage.get(key) || '' },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    showToast() {}
  }
  global.getApp = () => ({ globalData: { userInfo: { coins: 20 } } })
  global.Page = (definition) => { pageDefinition = definition }
  cloudApi.consumeCheckinShare = async (claimId) => {
    consumeCalls += 1
    assert.strictEqual(claimId, 'checkinShare:123456:abcdef')
    return { result: { code: 0, data: { coins: 10 } } }
  }

  const pagePath = path.join(root, 'pages/checkin/checkin.js')
  delete require.cache[require.resolve(pagePath)]
  require(pagePath)
  const page = { ...pageDefinition, data: {}, _shareClaimId: 'checkinShare:123456:abcdef' }

  await page.handleShareResult({ status: 'cancelled' })
  assert.strictEqual(consumeCalls, 0, 'cancelling the share menu must not spend coins')

  page._shareClaimId = 'checkinShare:123456:abcdef'
  await page.handleShareResult({ status: 'shared' })
  assert.strictEqual(consumeCalls, 1, 'a completed image share must spend coins once')
  assert.strictEqual(storage.has('pendingCheckinShareClaimId'), false, 'a confirmed charge must clear its retry marker')

  cloudApi.consumeCheckinShare = originalConsume
  delete require.cache[require.resolve(pagePath)]
  delete global.wx
  delete global.getApp
  delete global.Page
}

async function main() {
  const cloudFunction = read('cloudfunctions/grantCoinReward/index.js')
  const cloudApi = read('utils/cloudApi.js')
  const checkinPage = read('pages/checkin/checkin.js')
  const checkinTemplate = read('pages/checkin/checkin.wxml')
  const coinLogPage = read('pages/coin-log/coin-log.js')

  assert(cloudFunction.includes("action === 'consumeCheckinShare'"), 'cloud function must expose the check-in share charge action')
  assert(cloudFunction.includes('CHECKIN_SHARE_COST = 10'), 'check-in share cost must be fixed on the server')
  assert(cloudFunction.includes('runTransaction'), 'check-in share charge must be transactional')
  assert(cloudFunction.includes('coins < CHECKIN_SHARE_COST'), 'server must reject insufficient coin balances')
  assert(cloudFunction.includes('amount: -CHECKIN_SHARE_COST'), 'coin log must persist a negative 10-coin entry')
  assert(cloudFunction.includes('existing'), 'claim replay must be idempotent')

  assert(cloudApi.includes('consumeCheckinShare'), 'client API must expose check-in share charging')
  assert(checkinPage.includes('ensureShareCoinBalance'), 'check-in page must verify balance before opening share')
  assert(checkinPage.includes('consumeShareCoins'), 'check-in page must charge after a completed share action')
  assert(!checkinPage.includes("grantCoinReward('shareTimeline')"), 'check-in sharing must no longer grant coins')
  assert(checkinTemplate.includes('消耗10舟币'), 'check-in share button must disclose the cost')
  assert(coinLogPage.includes('checkin_share_cost'), 'coin ledger must label the check-in share charge')

  await testClientChargesOnlyCompletedShare()

  console.log('check-in share cost regression checks passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
