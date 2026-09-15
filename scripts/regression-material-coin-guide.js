const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.resolve(__dirname, '..')
const material = { _id: 'test-material', name: '学习资料', type: 'document' }

function createPage({ coins = 0, exchangeCode = 2, loggedIn = true } = {}) {
  const calls = { modals: [], failures: [], navigations: [], exchanges: 0, opened: 0 }
  let currentCoins = coins
  let loading = false
  const api = {
    getMaterials: async () => [material],
    getCurrentUser: async () => ({ coins: currentCoins }),
    exchangeMaterial: async () => {
      calls.exchanges += 1
      return { result: { code: exchangeCode, msg: '舟币不足' } }
    }
  }
  const wxMock = {
    showLoading() { loading = true },
    hideLoading() { loading = false },
    showToast() {},
    navigateTo(options) { calls.navigations.push(options.url) },
    showModal(options) {
      // The native API rejects labels wider than four Chinese characters.
      const labelWidth = Array.from(options.confirmText || '').reduce((sum, ch) => sum + (ch.codePointAt(0) > 255 ? 2 : 1), 0)
      if (labelWidth > 8) {
        calls.failures.push('confirmText too long')
        if (options.fail) options.fail({ errMsg: 'showModal:fail confirmText length should not larger than 4 Chinese characters' })
        return
      }
      calls.modals.push({ ...options, loading })
    }
  }
  const target = path.join(root, 'pages/material/material.js')
  const originalLoad = Module._load
  const oldPage = global.Page
  let definition
  global.Page = (page) => { definition = page }
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === target && request === '../../utils/cloudApi') return api
    if (parent && parent.filename === target && request === '../../utils/auth') return { requireLogin: async () => loggedIn }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(target)]
    require(target)
  } finally {
    Module._load = originalLoad
    if (oldPage) global.Page = oldPage
    else delete global.Page
  }
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(update) { Object.assign(this.data, update) },
    async openMaterial() { calls.opened += 1 }
  }
  return { page, calls, wxMock, setCoins: (value) => { currentCoins = value } }
}

async function main() {
  const results = []
  const oldWx = global.wx
  async function test(name, options, run) {
    const context = createPage(options)
    global.wx = context.wxMock
    try {
      await run(context)
      results.push({ name, status: 'passed' })
    } catch (error) {
      results.push({ name, status: 'failed', reason: error.message })
    } finally {
      if (oldWx) global.wx = oldWx
      else delete global.wx
    }
  }

  await test('服务端返回余额不足时，原生弹窗有效且加载遮罩已关闭', { coins: 20 }, async ({ page, calls }) => {
    await page.loadData()
    await page.onActionTap({ currentTarget: { dataset: { item: material } } })
    assert.equal(calls.modals[0].title, '领取资料')
    await calls.modals[0].success({ confirm: true })
    assert.deepEqual(calls.failures, [], '余额不足的提示被原生接口拒绝')
    const guide = calls.modals.find((modal) => modal.title === '舟币不足')
    assert(guide, '未显示舟币不足提示')
    assert.equal(guide.loading, false)
    assert.match(guide.content, /分享/)
    guide.success({ confirm: true })
    assert.deepEqual(calls.navigations, ['/pages/coin-log/coin-log'])
  })

  await test('已知零余额时，点击领取直接提示分享且不请求扣币', {}, async ({ page, calls }) => {
    await page.loadData()
    await page.onActionTap({ currentTarget: { dataset: { item: material } } })
    assert.equal(calls.modals[0].title, '舟币不足')
    assert.equal(calls.exchanges, 0)
    calls.modals[0].success({ confirm: false })
    assert.equal(calls.navigations.length, 0)
  })

  await test('分享返回页面后刷新余额，再次领取进入正常确认', {}, async ({ page, calls, setCoins }) => {
    await page.onShow()
    assert.equal(page.data.userCoins, 0)
    assert.equal(page.data.balanceLoaded, true)
    setCoins(10)
    await page.onShow()
    assert.equal(page.data.userCoins, 10)
    await page.onActionTap({ currentTarget: { dataset: { item: material } } })
    assert.equal(calls.modals[0].title, '领取资料')
    await calls.modals[0].success({ confirm: false })
    assert.equal(calls.exchanges, 0)
  })

  await test('零余额仍可打开已领取资料，登录取消不弹领取提示', { loggedIn: false }, async ({ page, calls }) => {
    page.data.ownedMap[material._id] = true
    await page.onActionTap({ currentTarget: { dataset: { item: material } } })
    assert.equal(calls.opened, 1)
    page.data.ownedMap = {}
    await page.onActionTap({ currentTarget: { dataset: { item: material } } })
    assert.equal(calls.modals.length, 0)
  })

  await test('余额不足提示可直接看见，规则不再误写分享扣币', {}, async () => {
    const template = fs.readFileSync(path.join(root, 'pages/material/material.wxml'), 'utf8')
    assert.match(template, /class="mat-balance-notice"/)
    assert.match(template, /balanceLoaded && userCoins &lt; 10|balanceLoaded && userCoins < 10/)
    const coinTemplate = fs.readFileSync(path.join(root, 'pages/coin-log/coin-log.wxml'), 'utf8')
    assert(!coinTemplate.includes('分享打卡海报每次 -10'), '分享中心仍显示已废弃的扣币规则')
  })

  console.log(JSON.stringify(results, null, 2))
  assert(results.every((item) => item.status === 'passed'), '资料不足余额引导回归失败')
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
