const assert = require('assert')
const fs = require('fs')
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

function loadPage(pagePath, cloudApi) {
  const target = path.join(root, `${pagePath}.js`)
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

function dateKeyAfter(days) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  const { calcRemainDays, toDateKey } = require(path.join(root, 'utils/studyPlan.js'))
  const fixedNow = new Date(2026, 7, 8, 23, 59, 0)
  assert.strictEqual(calcRemainDays('2026-08-08', 0, 10, 0, fixedNow), 0)
  assert.strictEqual(calcRemainDays('2026-08-09', 0, 10, 0, fixedNow), 1, 'remaining days must not change with the time of day')
  assert.strictEqual(toDateKey(new Date('2026-08-13T00:00:00.000Z')), '2026-08-13', 'legacy cloud dates must preserve their selected day')

  const deadlineKey = dateKeyAfter(5)
  const calls = {
    saves: [],
    toasts: [],
    redirects: [],
    navigations: []
  }
  const cloudApi = {
    async getCourse() {
      return { _id: 'course-1', name: '类比推理28式', totalCount: 28 }
    },
    async getCourses() {
      return [{ _id: 'course-1', name: '类比推理28式', totalCount: 28 }]
    },
    async getPlans() {
      return [{
        _id: 'plan-1',
        courseId: 'course-1',
        dailyCount: 7,
        mode: 'random',
        deadline: new Date(`${deadlineKey}T00:00:00.000Z`)
      }]
    },
    async getStudyRecords() {
      return []
    },
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
    navigateBack() {},
    showLoading() {},
    hideLoading() {}
  }

  try {
    const config = loadPage('pages/study-plan/study-plan', cloudApi)

    const restoredPage = createPage(config)
    await restoredPage._loadData()
    assert.strictEqual(restoredPage.data.plan.deadline, deadlineKey, 'saved deadline must be restored as a picker-compatible date')
    assert.strictEqual(restoredPage.data.plan.deadlineLabel, deadlineKey, 'saved deadline must remain visible after reopening')
    assert.strictEqual(restoredPage.data.remainDays, 5, 'remaining time must use calendar days')
    assert.strictEqual(restoredPage.data.dailyCountIndex, 6, 'saved daily target must be restored')
    assert.strictEqual(restoredPage.data.modeIndex, 1, 'saved learning mode must be restored')

    const changedPage = createPage(config)
    changedPage.onDeadlineChange({ detail: { value: deadlineKey } })
    assert.strictEqual(changedPage.data.remainDays, 5, 'changing the deadline must update remaining time immediately')
    changedPage.onDailyCountChange({ detail: { value: '6' } })
    assert.strictEqual(changedPage.data.plan.dailyCount, 7, 'changing the daily target must update the visible plan immediately')
    assert.strictEqual(changedPage.data.remainDays, 5, 'changing the daily target must preserve deadline-based remaining days')
    changedPage.onModeChange({ detail: { value: '1' } })
    assert.strictEqual(changedPage.data.plan.mode, 'random', 'changing the learning mode must update the visible plan immediately')

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

    const studyBookConfig = loadPage('pages/study-book/study-book', cloudApi)
    const studyBookPage = instantiate(studyBookConfig)
    await studyBookPage.loadPlans()
    assert.strictEqual(studyBookPage.data.plans.length, 1)
    assert.strictEqual(studyBookPage.data.plans[0].deadlineLabel, deadlineKey, 'saved-plan list must display the completion date')
    assert.strictEqual(studyBookPage.data.plans[0].remainDays, 5, 'saved-plan list must display synchronized remaining days')
    assert.strictEqual(studyBookPage.data.plans[0].dailyCount, 7, 'saved-plan list must display the daily target')

    const studyBookWxml = fs.readFileSync(path.join(root, 'pages/study-book/study-book.wxml'), 'utf8')
    assert(studyBookWxml.includes('完成日期'), 'saved-plan list must render the completion date')
    assert(studyBookWxml.includes('剩余 {{item.remainDays}} 天'), 'saved-plan list must render remaining days')

    const savePlanCloud = fs.readFileSync(path.join(root, 'cloudfunctions/savePlan/index.js'), 'utf8')
    assert(savePlanCloud.includes('deadline: safeDeadline'), 'cloud persistence must store a normalized date key')
    assert(!savePlanCloud.includes('deadline: parsedDeadline'), 'cloud persistence must not store picker dates as Date objects')
  } finally {
    global.wx = originalWx
  }

  console.log('study-plan save feedback regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
