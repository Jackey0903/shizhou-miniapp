// 客户第二轮反馈的 12 条问题里，代码层面真正需要修的 6 条回归测试。
// 这些断言存在的意义：#1 就是因为没有测试覆盖，才在上一版被"只写一个字段"改坏的。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function clone(value) {
  return structuredClone(value)
}

function createDb(initial = {}) {
  const state = clone(initial)
  const records = (name) => {
    if (!state[name]) state[name] = []
    return state[name]
  }
  const matches = (item, query = {}) => Object.entries(query).every(([key, value]) => item[key] === value)

  class Query {
    constructor(name) {
      this.name = name
      this.query = {}
      this.offset = 0
      this.maximum = Infinity
      this.sortField = ''
      this.sortDirection = 'asc'
    }
    where(query) { this.query = query || {}; return this }
    skip(value) { this.offset = Math.max(0, Number(value) || 0); return this }
    limit(value) { this.maximum = Math.max(0, Number(value) || 0); return this }
    orderBy(field, direction) { this.sortField = field; this.sortDirection = direction || 'asc'; return this }
    selected() {
      const list = records(this.name).filter((item) => matches(item, this.query))
      if (!this.sortField) return list
      const factor = this.sortDirection === 'desc' ? -1 : 1
      return list.slice().sort((left, right) => {
        const a = left[this.sortField]
        const b = right[this.sortField]
        return (Number(a || 0) - Number(b || 0) || String(a || '').localeCompare(String(b || ''))) * factor
      })
    }
    async get() { return { data: clone(this.selected().slice(this.offset, this.offset + this.maximum)) } }
    async count() { return { total: this.selected().length } }
    async add({ data }) {
      const id = `${this.name}-${records(this.name).length + 1}`
      records(this.name).push({ _id: id, ...clone(data) })
      return { _id: id }
    }
    doc(id) {
      const find = () => records(this.name).find((item) => item._id === id)
      return {
        get: async () => {
          const value = find()
          if (!value) throw new Error('document not found')
          return { data: clone(value) }
        },
        set: async ({ data }) => {
          const value = find()
          if (value) Object.assign(value, clone(data))
          else records(this.name).push({ _id: id, ...clone(data) })
          return { stats: { updated: 1 } }
        },
        update: async ({ data }) => {
          const value = find()
          if (!value) throw new Error('document not found')
          Object.assign(value, clone(data))
          return { stats: { updated: 1 } }
        },
        remove: async () => {
          const list = records(this.name)
          const index = list.findIndex((item) => item._id === id)
          if (index >= 0) list.splice(index, 1)
          return { stats: { removed: 1 } }
        }
      }
    }
  }

  return {
    state,
    collection: (name) => new Query(name),
    createCollection: async (name) => { records(name) },
    serverDate: () => new Date('2026-09-01T00:00:00.000Z'),
    command: {}
  }
}

function loadFunction(name, database, openid = '') {
  const target = path.join(root, `cloudfunctions/${name}/index.js`)
  delete require.cache[require.resolve(target)]
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => database,
    getWXContext: () => ({ OPENID: openid, APPID: 'test-appid' })
  }
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(target)
  } finally {
    Module._load = originalLoad
  }
}

const ADMIN = { _id: 'admin-1', _openid: 'openid-admin', role: 'super_admin', isAdmin: true, isSuperAdmin: true }

// ── 问题 1：模块/题库点“上线”没反应 ────────────────────────────────────────
// isEnabled 要求 enabled 和 status 两个字段都不表示下线。只写其中一个，
// 残留的旧字段会一直把内容挡在前台之外。
async function testPublishToggleWritesBothFields() {
  const db = createDb({
    users: [ADMIN],
    // 典型的历史脏数据：status 是上线的，但残留了 enabled:false
    subjects: [{ _id: 'subject-common', name: '常识判断', enabled: false, status: 'enabled', sort: 1 }],
    question_banks: [{ _id: 'bank-1', subjectId: 'subject-common', name: '常识题库', enabled: false, status: 'enabled', sort: 1 }],
    materials: [{ _id: 'material-1', name: '资料', enabled: true, status: 'disabled', sort: 1 }]
  })
  const admin = loadFunction('adminOperations', db, 'openid-admin')

  const toggled = await admin.main({ action: 'toggleContent', payload: { target: 'subjects', id: 'subject-common', enabled: true } })
  assert.equal(toggled.code, 0)
  const subject = db.state.subjects[0]
  assert.equal(subject.enabled, true, '模块上线必须清掉残留的 enabled:false')
  assert.equal(subject.status, 'enabled')

  await admin.main({ action: 'toggleContent', payload: { target: 'question_banks', id: 'bank-1', enabled: true } })
  assert.equal(db.state.question_banks[0].enabled, true)
  assert.equal(db.state.question_banks[0].status, 'enabled')

  // 反向：enabledField 是 enabled 的内容，也必须同时清掉残留的 status:'disabled'
  await admin.main({ action: 'toggleContent', payload: { target: 'materials', id: 'material-1', enabled: true } })
  assert.equal(db.state.materials[0].enabled, true)
  assert.equal(db.state.materials[0].status, 'enabled', '资料上线必须清掉残留的 status:disabled')

  // 上线后用户端确实能看到
  const courses = await loadFunction('getCourses', db).main()
  assert.equal(courses.code, 0)
  assert.deepEqual(courses.data.map((item) => item._id), ['bank-1'], '上线后的题库必须出现在用户端')

  // 下线同样要两个字段一起写
  await admin.main({ action: 'toggleContent', payload: { target: 'subjects', id: 'subject-common', enabled: false } })
  assert.equal(db.state.subjects[0].enabled, false)
  assert.equal(db.state.subjects[0].status, 'disabled')

  // 新建模块/题库也必须两个字段都写全
  const created = await admin.main({ action: 'saveSubject', payload: { name: '新模块', enabled: true } })
  assert.equal(created.code, 0)
  const newSubject = db.state.subjects.find((item) => item.name === '新模块')
  assert.equal(newSubject.enabled, true)
  assert.equal(newSubject.status, 'enabled')
}

// ── 问题 4 / 12：顺序错乱、新传的内容排到最后甚至找不到 ────────────────────
// 展示顺序普遍用 Date.now() 生成（约 1.7e12），旧代码用 integer() 处理会全部
// 钳到 1e9，导致所有新内容并列在最后。
async function testSortValueKeepsTimestampOrdering() {
  const core = require(path.join(root, 'cloudfunctions/adminOperations/adminCore.js'))
  const base = Date.now()
  assert.equal(core.integer(base, 0), 1000000000, '旧的 integer() 确实会钳掉时间戳（保留此断言以说明为何需要 sortValue）')
  assert.equal(core.sortValue(base), base, 'sortValue 必须原样保留时间戳排序值')
  assert.ok(core.sortValue(base + 1) > core.sortValue(base), '相邻时间戳必须仍可比较')
  assert.equal(core.sortValue('not-a-number', 42), 42)
  assert.equal(core.sortValue(-5), 0, '排序值不能为负')
  assert.deepEqual(core.publicationFields(true), { enabled: true, status: 'enabled' })
  assert.deepEqual(core.publicationFields(false), { enabled: false, status: 'disabled' })
}

async function testContentOrderingIsSticky() {
  const now = Date.now()
  const db = createDb({
    users: [ADMIN],
    materials: [
      { _id: 'm-b', name: 'B 行测资料', sort: now + 1, fileId: 'cloud://t/b', enabled: true },
      { _id: 'm-a', name: 'A 申论资料', sort: now + 2, fileId: 'cloud://t/a', enabled: true },
      { _id: 'm-c', name: 'C 面试资料', sort: now, fileId: 'cloud://t/c', enabled: true }
    ],
    material_redemptions: []
  })
  const admin = loadFunction('adminOperations', db, 'openid-admin')

  // 手动模式：按 sort 数值升序，时间戳不能被钳平
  const manual = await admin.main({ action: 'listContent', payload: { target: 'materials' } })
  assert.equal(manual.code, 0)
  assert.deepEqual(manual.data.map((item) => item._id), ['m-c', 'm-b', 'm-a'], '手动模式必须按真实 sort 排序')
  assert.equal(manual.ordering.mode, 'manual')
  assert.equal(manual.total, 3)

  // 切到名称排序，并且这个选择要被记住
  const reordered = await admin.main({ action: 'reorderContentByName', payload: { target: 'materials' } })
  assert.equal(reordered.code, 0)
  assert.equal(reordered.data.ordering.mode, 'name')

  const byName = await admin.main({ action: 'listContent', payload: { target: 'materials' } })
  assert.deepEqual(byName.data.map((item) => item._id), ['m-a', 'm-b', 'm-c'])
  assert.equal(byName.ordering.mode, 'name', '名称排序模式必须被持久化')

  // 关键诉求：之后补传的内容要自动落到正确位置，不需要重新排一次
  db.state.materials.push({ _id: 'm-b2', name: 'B2 常识资料', sort: Date.now() + 999, fileId: 'cloud://t/b2', enabled: true })
  const afterUpload = await admin.main({ action: 'listContent', payload: { target: 'materials' } })
  assert.deepEqual(
    afterUpload.data.map((item) => item._id),
    ['m-a', 'm-b', 'm-b2', 'm-c'],
    '名称排序模式下，后补的资料必须自动排到正确位置'
  )

  // 用户端读取必须与后台一致
  const publicMaterials = await loadFunction('getMaterials', db, 'openid-reader').main()
  assert.deepEqual(
    publicMaterials.data.map((item) => item._id),
    ['m-a', 'm-b', 'm-b2', 'm-c'],
    '用户端资料顺序必须与后台排序模式一致'
  )

  // 可以切回手动
  const backToManual = await admin.main({ action: 'reorderContentByName', payload: { target: 'materials', mode: 'manual' } })
  assert.equal(backToManual.code, 0)
  const manualAgain = await admin.main({ action: 'listContent', payload: { target: 'materials' } })
  assert.equal(manualAgain.ordering.mode, 'manual')
}

async function testEditingContentKeepsItsSortValue() {
  const stamp = Date.now()
  const db = createDb({
    users: [ADMIN],
    materials: [{ _id: 'm-1', name: '资料', type: 'document', fileId: 'cloud://t/1', sort: stamp, enabled: true }]
  })
  const admin = loadFunction('adminOperations', db, 'openid-admin')
  const saved = await admin.main({
    action: 'saveContent',
    payload: { target: 'materials', id: 'm-1', name: '资料（改名）' }
  })
  assert.equal(saved.code, 0)
  assert.equal(db.state.materials[0].sort, stamp, '编辑内容不能把展示顺序钳成 1e9')
}

async function testAudioAndWallpaperOrderingFollowsMode() {
  const db = createDb({
    users: [ADMIN],
    audios: [
      { _id: 'a-2', title: 'B 音频', category: '常识', sort: 20, enabled: true },
      { _id: 'a-1', title: 'A 音频', category: '常识', sort: 10, enabled: true }
    ],
    wallpapers: [
      { _id: 'w-2', title: 'B 壁纸', sort: 20, enabled: true },
      { _id: 'w-1', title: 'A 壁纸', sort: 10, enabled: true }
    ],
    content_orderings: [
      { _id: 'audios', target: 'audios', mode: 'name', direction: 'desc' },
      { _id: 'wallpapers', target: 'wallpapers', mode: 'name', direction: 'asc' }
    ]
  })
  const audios = await loadFunction('uploadAudios', db, 'openid-reader').main({ action: 'list' })
  assert.deepEqual(audios.data.map((item) => item._id), ['a-2', 'a-1'], '音频必须遵循后台的名称降序模式')

  const wallpapers = await loadFunction('uploadWallpapers', db, 'openid-reader').main({ action: 'list' })
  assert.deepEqual(wallpapers.data.map((item) => item._id), ['w-1', 'w-2'], '壁纸必须遵循后台的名称升序模式')
}

// ── 问题 8：打卡海报背景改了没反应，还会冒出旧海报 ─────────────────────────
// 早期背景文档没有 activeDate 字段，where({activeDate}) 查不到它们，
// 于是旧背景一直是 enabled，和新背景按天轮播。
async function testPunchBackgroundReplacementDisablesLegacyRecords() {
  const db = createDb({
    users: [ADMIN],
    punch_backgrounds: [
      { _id: 'bg-legacy', title: '很早以前的海报', enabled: true, sort: 5, fileId: 'cloud://t/legacy' },
      { _id: 'bg-default', title: '上一版海报', activeDate: 'default', enabled: true, sort: 100, fileId: 'cloud://t/prev' }
    ]
  })
  const config = loadFunction('adminConfigCenter', db, 'openid-admin')
  const saved = await config.main({
    action: 'save',
    target: 'punch_backgrounds',
    payload: { title: '新海报', fileId: 'cloud://t/new', imageUrl: '', activeDate: 'default', enabled: true, sort: 200 }
  })
  assert.equal(saved.code, 0)

  const legacy = db.state.punch_backgrounds.find((item) => item._id === 'bg-legacy')
  assert.equal(legacy.enabled, false, '没有 activeDate 的历史背景也必须被下线，否则会隔天冒出来')

  const enabled = db.state.punch_backgrounds.filter((item) => item.enabled !== false)
  assert.equal(enabled.length, 1, '同一个生效日期只能保留一张启用的背景')
  assert.equal(enabled[0].fileId, 'cloud://t/new')
}

// 客户端选背景必须"最后保存的立即生效"，不能按天轮播。
async function testPunchConfigPicksNewestBackground() {
  const source = fs.readFileSync(path.join(root, 'utils/cloudApi.js'), 'utf8')
  assert.ok(source.includes('const chooseLatest ='), 'getPunchConfig 必须有确定性的最新背景选择逻辑')
  assert.ok(
    /let background = chooseLatest\(backgrounds, 'default'\)/.test(source),
    '打卡背景必须用 chooseLatest 而不是按天轮播的 chooseDaily'
  )
  assert.ok(
    /quote: chooseDaily\(quotes, 'default'\)/.test(source),
    '励志文案保留按天轮播'
  )
}

// 用户把自己的壁纸设为打卡背景后，必须有入口撤销，否则官方海报永远被覆盖。
async function testCheckinCanRestoreOfficialBackground() {
  const js = fs.readFileSync(path.join(root, 'pages/checkin/checkin.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/checkin/checkin.wxml'), 'utf8')
  assert.ok(js.includes('restoreOfficialBackground'), '打卡页必须提供恢复官方海报的方法')
  assert.ok(js.includes("wx.removeStorageSync('checkinWallpaperPreference')"), '恢复官方海报必须清掉个人壁纸偏好')
  assert.ok(wxml.includes('bindtap="restoreOfficialBackground"'), '恢复官方海报必须有可见入口')
  assert.ok(js.includes('onShow()'), '打卡页需要在返回时刷新海报配置')
}

// ── 问题 5：长答案出界 ───────────────────────────────────────────────────
async function testAnswerBlockCannotOverflowCard() {
  const wxss = fs.readFileSync(path.join(root, 'pages/question/question.wxss'), 'utf8')
  const block = (selector) => {
    const match = wxss.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))
    assert.ok(match, `缺少样式块 ${selector}`)
    return match[1]
  }
  const reveal = block('.q-answer-reveal')
  assert.ok(/min-width:\s*0/.test(reveal), '.q-answer-reveal 必须设置 min-width:0，否则 flex 子项会被长答案撑出卡片')
  assert.ok(/max-width:\s*100%/.test(reveal))
  assert.ok(/overflow:\s*hidden/.test(reveal))

  for (const selector of ['.q-answer-text', '.q-explanation', '.q-fill-user-answer']) {
    const rules = block(selector)
    // overflow-wrap:anywhere 在 iOS 15.4 以下 WKWebView 和部分安卓 WebView 不生效，
    // word-break:break-word 又是非标准值；必须同时带全引擎兜底，否则真机上长答案照样出界。
    assert.ok(/word-wrap:\s*break-word/.test(rules), `${selector} 必须带 word-wrap:break-word 兜底`)
    assert.ok(/word-break:\s*break-all/.test(rules), `${selector} 必须允许长词换行（break-all）`)
    assert.ok(/overflow-wrap:\s*anywhere/.test(rules), `${selector} 必须允许任意位置换行`)
    assert.ok(/max-width:\s*100%/.test(rules), `${selector} 必须限制最大宽度`)
  }
  assert.ok(/overflow:\s*hidden/.test(block('.q-content')), '题干容器必须裁剪溢出')
}

// ── 问题 6：后台配了套餐、前台不显示，却没有任何提示 ────────────────────────
async function testPlanVisibilityDiagnostics() {
  const db = createDb({
    users: [ADMIN],
    vip_plans: [
      { _id: 'p1', code: 'basic_vip_year', price: 19800, days: 365, supervisionDays: 0, virtualProductId: 'sz_basic_vip_year', enabled: true },
      // 客户最常踩的坑：道具ID漏填 / 价格改过 / 忘了上线
      { _id: 'p2', code: 'supervision_month', price: 19800, days: 365, supervisionDays: 30, virtualProductId: '', enabled: true },
      { _id: 'p3', code: 'premium_vip_year', price: 88800, days: 365, supervisionDays: 365, virtualProductId: 'sz_premium_vip_year', enabled: true },
      { _id: 'p4', code: 'supervision_trial_day', price: 800, days: 365, supervisionDays: 1, virtualProductId: 'sz_supervision_1d', enabled: false }
    ]
  })
  const fn = loadFunction('createVipOrder', db, 'openid-admin')
  const result = await fn.main({ action: 'planDiagnostics' })
  assert.equal(result.code, 0)
  const map = Object.fromEntries(result.data.map((item) => [item.code, item]))

  assert.equal(map.basic_vip_year.visible, true)
  assert.equal(map.basic_vip_year.problem, '')

  assert.equal(map.supervision_month.visible, false)
  assert.ok(map.supervision_month.problem.includes('道具ID'), '缺道具ID要说清楚：' + map.supervision_month.problem)

  assert.equal(map.premium_vip_year.visible, false)
  assert.ok(map.premium_vip_year.problem.includes('价格'), '价格对不上要说清楚：' + map.premium_vip_year.problem)

  assert.equal(map.supervision_trial_day.visible, false)
  assert.ok(map.supervision_trial_day.problem.includes('下线'), '未上线要说清楚：' + map.supervision_trial_day.problem)

  // 非管理员不能看诊断
  const asUser = loadFunction('createVipOrder', createDb({
    users: [{ _id: 'u1', _openid: 'openid-user' }],
    vip_plans: []
  }), 'openid-user')
  const denied = await asUser.main({ action: 'planDiagnostics' })
  assert.equal(denied.code, 403)

  // 后台页面必须把诊断结果显示出来
  const wxml = fs.readFileSync(path.join(root, 'pages/vip-plan-config/vip-plan-config.wxml'), 'utf8')
  assert.ok(wxml.includes('前台可购买'), '套餐配置页必须显示前台可见状态')
  assert.ok(wxml.includes('bindtap="repairPlan"'), '套餐配置页必须提供一键修正入口')
}

// ── 后台列表：条数与截断必须如实告知，避免"资料找不到"却毫无提示 ──────────
async function testAdminListReportsTruncation() {
  const materials = Array.from({ length: 12 }, (_, index) => ({
    _id: `m-${String(index).padStart(2, '0')}`,
    name: `资料${String(index).padStart(2, '0')}`,
    sort: Date.now() + index,
    fileId: `cloud://t/${index}`,
    enabled: true
  }))
  const db = createDb({ users: [ADMIN], materials })
  const admin = loadFunction('adminOperations', db, 'openid-admin')
  const limited = await admin.main({ action: 'listContent', payload: { target: 'materials', limit: 5 } })
  assert.equal(limited.data.length, 5)
  assert.equal(limited.total, 12, '必须返回真实总条数')
  assert.equal(limited.truncated, true, '被截断时必须明确告知')

  const full = await admin.main({ action: 'listContent', payload: { target: 'materials', limit: 500 } })
  assert.equal(full.truncated, false)
  assert.equal(full.data.length, 12)

  for (const page of ['material-upload', 'audio-upload', 'wallpaper-upload']) {
    const wxml = fs.readFileSync(path.join(root, `pages/${page}/${page}.wxml`), 'utf8')
    assert.ok(wxml.includes('listTotal'), `${page} 必须显示总条数`)
    assert.ok(wxml.includes('bindtap="toggleOrdering"'), `${page} 必须提供排序模式切换`)
  }
}

// dataset 上的 data-enabled 在部分基础库里是字符串，直接 !value 会把 "false" 当真值，
// 点“上线”反而发出下线请求——同样表现为“点上线没反应”。
async function testDatasetBooleanIsParsedSafely() {
  const { readBoolean, toggledBoolean } = require(path.join(root, 'utils/dataset.js'))
  assert.equal(readBoolean(false), false)
  assert.equal(readBoolean('false'), false, '字符串 "false" 必须当成 false')
  assert.equal(readBoolean('true'), true)
  assert.equal(readBoolean(undefined, true), true)
  assert.equal(toggledBoolean('false'), true, '已下线的内容点一下必须变成上线')
  assert.equal(toggledBoolean(false), true)
  assert.equal(toggledBoolean('true'), false)

  const pages = [
    'course-upload', 'audio-upload', 'material-upload', 'wallpaper-upload',
    'ad-config', 'message-config', 'punch-quote-config', 'punch-background-config', 'vip-plan-config'
  ]
  for (const page of pages) {
    const source = fs.readFileSync(path.join(root, `pages/${page}/${page}.js`), 'utf8')
    assert.ok(
      source.includes("require('../../utils/dataset')"),
      `${page} 的上下线开关必须使用 dataset 布尔安全读取`
    )
    assert.ok(
      !/!\s*e?\.?currentTarget\.dataset\.enabled/.test(source) && !/,\s*!enabled\)/.test(source),
      `${page} 不能再直接对 dataset.enabled 取反`
    )
  }
}

async function main() {
  await testPublishToggleWritesBothFields()
  await testDatasetBooleanIsParsedSafely()
  await testSortValueKeepsTimestampOrdering()
  await testContentOrderingIsSticky()
  await testEditingContentKeepsItsSortValue()
  await testAudioAndWallpaperOrderingFollowsMode()
  await testPunchBackgroundReplacementDisablesLegacyRecords()
  await testPunchConfigPicksNewestBackground()
  await testCheckinCanRestoreOfficialBackground()
  await testAnswerBlockCannotOverflowCard()
  await testPlanVisibilityDiagnostics()
  await testAdminListReportsTruncation()
  console.log('customer issues round-2 regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})

// ---- wx.downloadFile 返回 DownloadTask 而非 Promise；直接 await 得到 undefined.tempFilePath ----
// 包内背景不走该分支所以历史验收未暴露；客户上传云端打卡背景后海报生成必然失败。
{
  const fs = require('fs')
  const path = require('path')
  const root = path.resolve(__dirname, '..')
  const walk = (dir, out = []) => { for (const n of fs.readdirSync(dir)) { const f = path.join(dir, n); fs.statSync(f).isDirectory() ? walk(f, out) : (f.endsWith('.js') && out.push(f)) } return out }
  const offenders = [...walk(path.join(root, 'pages')), ...walk(path.join(root, 'utils'))]
    .filter((f) => /await\s+wx\.downloadFile\s*\(/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f))
  assert.deepStrictEqual(offenders, [], 'wx.downloadFile 不能直接 await（返回的是 DownloadTask）：' + offenders.join(', '))
  const sharing = fs.readFileSync(path.join(root, 'utils/imageSharing.js'), 'utf8')
  assert.ok(/async function downloadFile\(/.test(sharing) && /downloadFile,/.test(sharing), 'imageSharing 必须导出 promise 化的 downloadFile')
  const checkin = fs.readFileSync(path.join(root, 'pages/checkin/checkin.js'), 'utf8')
  assert.ok(/imageSharing\.downloadFile\(/.test(checkin) && /return DEFAULT_BG/.test(checkin), '打卡背景下载必须走封装且失败时回退默认背景')
  console.log('ok: wx.downloadFile 全部经由 promise 封装，打卡背景有兜底')
}
