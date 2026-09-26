const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')

function createHarness() {
  const state = {
    users: [
      { _id: 'user-a', _openid: 'openid-a', nickName: '甲' },
      { _id: 'user-b', _openid: 'openid-b', nickName: '乙' },
      { _id: 'admin', _openid: 'openid-admin', isAdmin: true }
    ],
    supervision_profiles: []
  }
  let openid = 'openid-a'
  const matches = (item, criteria) => Object.entries(criteria).every(([key, value]) => {
    if (value && value.operator === 'in') return value.values.includes(item[key])
    if (value && value.operator === 'neq') return item[key] !== value.value
    return item[key] === value
  })
  const collection = (name) => ({
    where(criteria) {
      const query = {
        skip(count) { this.offset = count; return this },
        limit(count) { this.max = count; return this },
        orderBy(key, order) { this.sort = [key, order]; return this },
        async get() {
          let rows = (state[name] || []).filter((item) => matches(item, criteria))
          if (this.sort) rows = rows.slice().sort((a, b) => this.sort[1] === 'desc'
            ? new Date(b[this.sort[0]]) - new Date(a[this.sort[0]])
            : new Date(a[this.sort[0]]) - new Date(b[this.sort[0]]))
          return { data: structuredClone(rows.slice(this.offset || 0, (this.offset || 0) + (this.max || rows.length))) }
        }
      }
      return query
    },
    doc(id) {
      return {
        async get() {
          const row = (state[name] || []).find((item) => item._id === id)
          if (!row) throw new Error('document not found')
          return { data: structuredClone(row) }
        },
        async set({ data }) {
          const rows = state[name] || (state[name] = [])
          const row = rows.find((item) => item._id === id)
          if (row) Object.assign(row, structuredClone(data))
          else rows.push({ _id: id, ...structuredClone(data) })
        },
        async update({ data }) {
          const row = (state[name] || []).find((item) => item._id === id)
          if (!row) throw new Error('document not found')
          Object.assign(row, structuredClone(data))
        },
        async remove() {
          state[name] = (state[name] || []).filter((item) => item._id !== id)
        }
      }
    },
    async add({ data }) {
      const rows = state[name] || (state[name] = [])
      const id = `${name}-${rows.length + 1}`
      rows.push({ _id: id, ...structuredClone(data) })
      return { _id: id }
    }
  })
  const db = {
    collection,
    command: {
      in: (values) => ({ operator: 'in', values }),
      neq: (value) => ({ operator: 'neq', value })
    },
    serverDate: () => new Date('2026-09-26T09:00:00.000Z'),
    createCollection: async (name) => { if (!state[name]) state[name] = [] }
  }
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: openid })
  }
  const target = path.resolve(__dirname, '../cloudfunctions/supervisionMatch/index.js')
  delete require.cache[require.resolve(target)]
  const original = Module._load
  Module._load = function mock(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return original.call(this, request, parent, isMain)
  }
  let fn
  try { fn = require(target) } finally { Module._load = original }
  return {
    state,
    call: (as, event) => { openid = as; return fn.main(event) }
  }
}

async function testPageBindings() {
  const apiCalls = []
  const navigations = []
  const profile = {
    _id: 'public-other', mode: 'part', displayName: '备考乙', examType: '国考',
    modules: ['常识'], dailyPeriods: ['晚上'], interestedByMe: false
  }
  const api = {
    getSupervisionMatches: async (mode, page) => {
      apiCalls.push(['list', mode, page])
      return { result: { code: 0, data: {
        mine: null,
        matches: page === 0 ? [profile] : [{ ...profile, _id: 'public-next' }],
        hasMore: page === 0
      } } }
    },
    setSupervisionInterest: async (mode, id, withdraw) => {
      apiCalls.push(['interest', mode, id, withdraw])
      return { result: { code: 0 } }
    },
    saveSupervisionData: async () => ({ result: { code: 0 } }),
    joinSupervisionMatch: async (mode) => {
      apiCalls.push(['publish', mode])
      return { result: { code: 0, data: { mine: { _id: 'my-post' } } } }
    }
  }
  const originalPage = global.Page
  const originalWx = global.wx
  let definition
  global.Page = (value) => { definition = value }
  global.wx = {
    showToast() {}, showLoading() {}, hideLoading() {},
    navigateTo: ({ url }) => navigations.push(url)
  }
  const target = path.resolve(__dirname, '../pages/supervision/supervision.js')
  delete require.cache[require.resolve(target)]
  const originalLoad = Module._load
  Module._load = function mock(request, parent, isMain) {
    if (request === '../../utils/cloudApi') return api
    return originalLoad.call(this, request, parent, isMain)
  }
  try { require(target) } finally { Module._load = originalLoad }
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() }
  }
  try {
    await page.loadMatchState()
    assert.equal(page.data.publicProfiles[0].displayName, '备考乙')
    assert.equal(page.data.publicProfiles[0].modeLabel, '在职备考')
    assert.equal(page.data.publicProfiles[0].modulesText, '常识')
    await page.loadMoreProfiles()
    assert.equal(page.data.publicProfiles.length, 2)
    assert(apiCalls.some((call) => call[0] === 'list' && call[2] === 1))
    await page.toggleInterest({ currentTarget: { dataset: { id: 'public-other' } } })
    assert(apiCalls.some((call) => call[0] === 'interest' && call[2] === 'public-other' && call[3] === false))

    page.setData({ currentProfile: {
      displayName: '备考甲', contact: 'private-a', examType: '国考',
      targetCityLabel: '广州', examDate: '2026-12-01'
    } })
    await page.joinMatch()
    assert(apiCalls.some((call) => call[0] === 'publish'))
    assert.equal(navigations.length, 0, 'publishing a post must not force users into payment')
    page.goSupervisionPay()
    assert.equal(navigations[0], '/pages/supervision-pay/supervision-pay?mode=full')
  } finally {
    global.Page = originalPage
    global.wx = originalWx
  }
}

async function main() {
  const app = createHarness()
  const a = { displayName: '备考甲', contact: 'private-a', examType: '国考', city: '广州', examDate: '2026-12-01', avgHours: '3-5h', dailyPeriods: ['上午'], modules: ['常识'] }
  const b = { ...a, displayName: '备考乙', contact: 'private-b', city: '深圳' }

  const publishedA = await app.call('openid-a', { action: 'upsert', mode: 'full', profile: a })
  assert.equal(publishedA.code, 0, 'unpaid learners can publish a preparation post')
  const listB = await app.call('openid-b', { action: 'list', mode: 'part' })
  assert.equal(listB.code, 0)
  assert.equal(listB.data.matches.length, 1, 'other modes must see the public post')
  assert.equal(listB.data.matches[0].displayName, '备考甲')
  assert.equal(listB.data.matches[0].contact, undefined, 'contact must remain private before mutual interest')
  assert.equal(listB.data.matches[0]._openid, undefined)
  const listAdmin = await app.call('openid-admin', { action: 'list', mode: 'full' })
  assert.equal(listAdmin.data.matches.length, 1, 'administrators can browse public posts')
  const unpublishedInterest = await app.call('openid-admin', { action: 'interest', targetId: listAdmin.data.matches[0]._id })
  assert.notEqual(unpublishedInterest.code, 0, 'browsing without a post must not disclose contact')

  const publishedB = await app.call('openid-b', { action: 'upsert', mode: 'part', profile: b })
  assert.equal(publishedB.code, 0)
  const aList = await app.call('openid-a', { action: 'list', mode: 'full' })
  const bId = aList.data.matches[0]._id
  const aId = listB.data.matches[0]._id

  const request = await app.call('openid-b', { action: 'interest', targetId: aId })
  assert.equal(request.code, 0)
  const incoming = await app.call('openid-a', { action: 'list', mode: 'full' })
  assert.equal(incoming.data.matches[0].interestedInMe, true)
  assert.equal(incoming.data.matches[0].contact, undefined)

  const accepted = await app.call('openid-a', { action: 'interest', targetId: bId })
  assert.equal(accepted.code, 0)
  const mutualA = await app.call('openid-a', { action: 'list', mode: 'full' })
  const mutualB = await app.call('openid-b', { action: 'list', mode: 'full' })
  assert.equal(mutualA.data.matches[0].mutual, true)
  assert.equal(mutualA.data.matches[0].contact, 'private-b')
  assert.equal(mutualB.data.matches[0].contact, 'private-a')

  const withdrawn = await app.call('openid-b', { action: 'withdrawInterest', targetId: aId })
  assert.equal(withdrawn.code, 0)
  const afterWithdrawal = await app.call('openid-a', { action: 'list', mode: 'full' })
  assert.equal(afterWithdrawal.data.matches[0].contact, undefined)

  await app.call('openid-a', { action: 'leave', mode: 'full' })
  const afterLeave = await app.call('openid-b', { action: 'list', mode: 'part' })
  assert.equal(afterLeave.data.matches.length, 0, 'withdrawn posts must disappear from the public list')

  for (let index = 0; index < 23; index++) {
    app.state.supervision_profiles.push({
      _id: `other-${index}`, _openid: `other-openid-${index}`, mode: 'full', status: 'published',
      displayName: `考友${index}`, contact: `hidden-${index}`, updatedAt: new Date('2026-09-26T09:00:00.000Z')
    })
  }
  const firstPage = await app.call('openid-admin', { action: 'list', page: 0 })
  const secondPage = await app.call('openid-admin', { action: 'list', page: 1 })
  assert.equal(firstPage.data.matches.length, 20)
  assert.equal(firstPage.data.hasMore, true)
  assert.equal(secondPage.data.matches.length, 4)
  assert.equal(secondPage.data.hasMore, false)

  const giftPage = fs.readFileSync(path.resolve(__dirname, '../pages/share-gift/share-gift.wxml'), 'utf8')
  for (const copy of [
    '反馈有礼', '欢迎提交真实使用感受', '优质反馈有机会获得督学体验',
    '写下你的备考使用感受', '将感受发送客服登记', '遴选优质反馈，达标方可体验'
  ]) assert(giftPage.includes(copy), `missing approved feedback copy: ${copy}`)
  assert(!giftPage.includes('小红书'))
  await testPageBindings()
  console.log('supervision community regression checks passed')
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 })
