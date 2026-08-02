const assert = require('assert')
const Module = require('module')
const path = require('path')

const root = path.resolve(__dirname, '..')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function setByPath(target, key, value) {
  const parts = String(key).split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function instantiate(config, data = {}) {
  const page = Object.assign({}, config)
  page.data = Object.assign(clone(config.data || {}), data)
  page.setData = function setData(patch = {}) {
    Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
  }
  return page
}

function loadStudyPlan(cloudApi) {
  const target = path.join(root, 'pages/study-plan/study-plan.js')
  delete require.cache[require.resolve(target)]
  const originalLoad = Module._load
  const originalPage = global.Page
  let config = null

  global.Page = (definition) => { config = definition }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../../utils/cloudApi') return cloudApi
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    require(target)
    return config
  } finally {
    Module._load = originalLoad
    global.Page = originalPage
  }
}

function createPage(config, data = {}) {
  return instantiate(config, Object.assign({
    courseId: 'course-1',
    courseName: '类比推理28式',
    course: { totalCount: 28 },
    plan: {},
    learnedCount: 0,
    dailyCountIndex: 9,
    modeIndex: 0
  }, data))
}

async function main() {
  const calls = {
    saves: [],
    toasts: [],
    redirects: [],
    navigations: []
  }
  const cloudApi = {
    async savePlan(payload) {
      calls.saves.push(payload)
      return { result: { code: 0, data: { planId: 'plan-1' } } }
    }
  }
  const originalWx = global.wx
  global.wx = {
    showToast(options) { calls.toasts.push(options) },
    redirectTo(options) { calls.redirects.push(options) },
    navigateTo(options) { calls.navigations.push(options) },
    navigateBack() {}
  }

  try {
    const config = loadStudyPlan(cloudApi)

    const explicitPage = createPage(config)
    assert.strictEqual(await explicitPage.savePlan(), true)
    assert.strictEqual(explicitPage.data.plan._id, 'plan-1')
    assert.strictEqual(explicitPage.data.saving, false)
    assert.strictEqual(calls.toasts.at(-1).title, '计划已保存')
    assert.ok(calls.redirects.at(-1), 'explicit save must navigate after the cloud write succeeds')
    assert.strictEqual(
      calls.redirects.at(-1).url,
      '/pages/study-book/study-book',
      'explicit save must open the saved-plan list so the user can see the result'
    )

    const redirectCount = calls.redirects.length
    const toastCount = calls.toasts.length
    const silentPage = createPage(config)
    assert.strictEqual(await silentPage.savePlan({ silent: true }), true)
    assert.strictEqual(calls.redirects.length, redirectCount, 'silent save must not leave the current flow')
    assert.strictEqual(calls.toasts.length, toastCount, 'silent save must not show a success toast')

    const newPage = createPage(config)
    await newPage.startNew()
    assert.strictEqual(calls.redirects.length, redirectCount, 'starting a lesson must not redirect to the plan list')
    assert.match(calls.navigations.at(-1).url, /pages\/question\/question/)
    assert.match(calls.navigations.at(-1).url, /planId=plan-1/)

    const saveCount = calls.saves.length
    const busyPage = createPage(config, { saving: true })
    assert.strictEqual(await busyPage.savePlan(), false)
    assert.strictEqual(calls.saves.length, saveCount, 'repeated taps while saving must not create another request')
  } finally {
    global.wx = originalWx
  }

  console.log('study-plan save feedback regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
