const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const path = require('path')

const root = path.resolve(__dirname, '..')

const plans = [
  { code: 'basic_vip_year', name: '基础VIP包年', tag: '基础VIP', price: 19800, days: 365, supervisionDays: 0, benefits: [] },
  { code: 'supervision_trial_day', name: '督学试用1日', tag: '督学试用', price: 800, days: 365, supervisionDays: 1, benefits: [] },
  { code: 'supervision_month', name: '督学包月', tag: '督学包月', price: 19800, days: 365, supervisionDays: 30, benefits: [] },
  { code: 'premium_vip_year', name: '高级VIP包年', tag: '高级VIP', price: 98800, days: 365, supervisionDays: 365, benefits: [] }
]

function loadPage(relativePath) {
  const target = path.join(root, relativePath)
  delete require.cache[require.resolve(target)]
  let definition = null
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../../utils/cloudApi') return { getVipPlans: async () => plans }
    if (request === '../../utils/virtualPayment') return {}
    if (request === '../../utils/auth') return {}
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = (page) => { definition = page }
  try {
    require(target)
  } finally {
    Module._load = originalLoad
    delete global.Page
  }
  assert(definition, `Page definition not captured: ${relativePath}`)
  return definition
}

function createPageContext(definition) {
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) {
      this.data = { ...this.data, ...update }
    }
  }
}

async function main() {
  const vip = createPageContext(loadPage('pages/vip/vip.js'))
  await vip.loadPlans()
  assert.deepStrictEqual(
    vip.data.plans.map((item) => item.code),
    ['basic_vip_year', 'premium_vip_year'],
    'VIP page must only show basic and premium VIP'
  )

  const supervision = createPageContext(loadPage('pages/supervision-pay/supervision-pay.js'))
  await supervision.loadPlans()
  assert.deepStrictEqual(
    supervision.data.plans.map((item) => item.code),
    ['supervision_trial_day', 'supervision_month', 'premium_vip_year'],
    'supervision page must show trial, monthly and annual plans'
  )
  const annual = supervision.data.plans.find((item) => item.code === 'premium_vip_year')
  assert.strictEqual(annual.title, '督学包年')
  assert.strictEqual(annual.price, 98800)

  const supervisionEntry = fs.readFileSync(path.join(root, 'pages/supervision/supervision.js'), 'utf8')
  const supervisionPlan = fs.readFileSync(path.join(root, 'pages/supervision-plan/supervision-plan.js'), 'utf8')
  assert(supervisionEntry.includes('/pages/supervision-pay/supervision-pay?mode='), 'matching flow must enter supervision payment page')
  assert(supervisionPlan.includes("wx.redirectTo({ url: '/pages/supervision-pay/supervision-pay' })"), 'locked supervision plan must return to supervision payment page')

  console.log('VIP/supervision plan separation regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
