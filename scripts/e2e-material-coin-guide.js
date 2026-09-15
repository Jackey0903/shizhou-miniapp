const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const automator = require('miniprogram-automator')

const output = path.resolve(__dirname, '../tmp/qa-material-coin-guide')
const screenshots = process.env.QA_SCREENSHOTS === '1'

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const mini = await automator.connect({ wsEndpoint: process.env.MINIPROGRAM_WS_ENDPOINT || 'ws://127.0.0.1:9420' })
  const results = []
  let observing = false
  const bounded = async (promise, label, timeout = 15000) => {
    let timer
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeout) })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const waitUntil = async (predicate, description) => {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      if (await predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error(`Timed out: ${description}`)
  }
  const modalState = () => mini.evaluate(() => {
    const probe = getApp().__materialModalProbe
    return { modals: probe.modals, errors: probe.errors }
  })
  const record = (name) => { results.push({ name, status: 'passed' }); console.log(`PASS ${name}`) }
  const capture = async (name) => {
    if (screenshots) await bounded(mini.screenshot({ path: path.join(output, name) }), name)
  }

  try {
    console.log('Checking the existing QA session')
    const login = await mini.evaluate(() => new Promise((resolve) => {
      const profile = wx.getStorageSync('userInfo')
      const token = wx.getStorageSync('token')
      const expiresAt = wx.getStorageSync('tokenExpiresAt')
      if (profile && /^1\d{10}$/.test(String(profile.phone || '')) && token && (!expiresAt || new Date(expiresAt).getTime() > Date.now())) {
        resolve({ code: 0, ready: true, coins: profile.coins })
        return
      }
      wx.cloud.callFunction({
        name: 'userLogin', data: {},
        success(response) {
          const result = response.result || {}
          const data = result.data || {}
          if (result.code !== 0 || !data.token || !data.phone) {
            resolve({ code: result.code, ready: false })
            return
          }
          const { token, tokenExpiresAt, ...profile } = data
          const app = getApp()
          Object.assign(app.globalData, { userInfo: profile, isLogin: true, token, tokenExpiresAt })
          wx.setStorageSync('userInfo', profile)
          wx.setStorageSync('token', token)
          wx.setStorageSync('tokenExpiresAt', tokenExpiresAt)
          resolve({ code: 0, ready: true, coins: profile.coins })
        },
        fail(error) { resolve({ ready: false, error: error.errMsg }) }
      })
    }))
    assert(login.ready, 'The existing account must already have a verified phone before this test')
    assert.equal(login.coins, 0, 'Use an authorized zero-balance QA account')
    console.log('Opening the material page with real cloud data')
    await mini.evaluate(() => {
      const app = getApp()
      if (app.__materialModalProbe) throw new Error('Another modal probe is active')
      const original = wx.showModal
      const probe = app.__materialModalProbe = { original, modals: [], errors: [] }
      // Observe real native calls without replacing their results or callbacks.
      wx.showModal = (options) => {
        probe.modals.push({ title: options.title, confirmText: options.confirmText })
        return original.call(wx, {
          ...options,
          fail(error) {
            probe.errors.push(error.errMsg || String(error))
            if (options.fail) options.fail(error)
          }
        })
      }
    })
    observing = true
    let page
    try {
      page = await bounded(mini.reLaunch('/pages/material/material'), 'open material page')
    } catch (error) {
      page = await mini.currentPage()
      if (!page || page.path !== 'pages/material/material') throw error
    }
    await waitUntil(async () => {
      const data = await page.data()
      return !data.loading && data.balanceLoaded
    }, 'material list and balance')
    let data = await page.data()
    assert.equal(data.userCoins, 0, 'Use an authorized zero-balance QA account; this script does not change balances')
    assert(await page.$('.mat-balance-notice'), 'Zero-balance banner is missing')
    await capture('zero-balance.png')
    record('真实零余额页面显示分享提示')

    const index = data.filteredMaterials.findIndex((item) => !item.owned)
    assert(index >= 0, 'No unowned document available')
    const target = data.filteredMaterials[index]
    const cards = await page.$$('.mat-item')
    const button = await cards[index].$('.mat-btn')
    await button.tap()
    let state = await modalState()
    assert.equal(state.modals.at(-1).title, '舟币不足')
    assert.equal(state.modals.at(-1).confirmText, '去分享')
    assert.deepEqual(state.errors, [])
    await capture('native-share-guide.png')
    await mini.native().confirmModal()
    await waitUntil(async () => (await mini.currentPage()).path === 'pages/coin-log/coin-log', 'native confirmation navigates to coin center')
    record('真实点击领取后原生弹窗可显示，点击去分享进入舟币中心')

    await mini.native().navigateLeft()
    await waitUntil(async () => {
      const current = await mini.currentPage()
      if (!current || current.path !== 'pages/material/material') return false
      const value = await current.data()
      if (value.loading !== false || !value.balanceLoaded) return false
      page = current
      return true
    }, 'material route and balance refresh on return')
    data = await page.data()
    assert.equal(data.userCoins, 0)
    assert(!data.ownedMap[target._id])
    record('未执行分享任务不会赠币或领取，返回后余额仍准确')

    // Only make the displayed balance stale; the real server account remains at zero.
    await page.setData({ userCoins: 20, balanceLoaded: true })
    await page.callMethod('onActionTap', { currentTarget: { dataset: { item: target } } })
    state = await modalState()
    assert.equal(state.modals.at(-1).title, '领取资料')
    await mini.native().confirmModal()
    const previousCount = state.modals.length
    await waitUntil(async () => (await modalState()).modals.length > previousCount, 'server insufficient-balance response')
    state = await modalState()
    assert.equal(state.modals.at(-1).title, '舟币不足')
    assert.deepEqual(state.errors, [])
    await capture('server-insufficient-guide.png')
    await mini.native().cancelModal()
    assert.equal((await mini.currentPage()).path, 'pages/material/material')
    await page.callMethod('loadData')
    data = await page.data()
    assert.equal(data.userCoins, 0)
    assert(!data.ownedMap[target._id])
    record('服务端零余额分支真实返回并显示弹窗，取消不跳转、不扣币')
  } catch (error) {
    results.push({ name: '资料分享引导原生验收', status: 'failed', reason: error.message })
    process.exitCode = 1
  } finally {
    if (observing) {
      await bounded(mini.native().cancelModal(), 'dismiss test modal', 3000).catch(() => {})
      await mini.evaluate(() => {
        const app = getApp()
        if (app.__materialModalProbe) {
          wx.showModal = app.__materialModalProbe.original
          delete app.__materialModalProbe
        }
      })
    }
    const report = { generatedAt: new Date().toISOString(), environment: 'production', nativeModal: true, screenshots, results }
    fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    await mini.disconnect()
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
