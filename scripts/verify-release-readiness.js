const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const maxMiniProgramSize = 2 * 1024 * 1024

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function run(command, args, options = {}) {
  const res = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe'
  })
  if (res.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${res.stdout || ''}${res.stderr || ''}`)
  }
  return res.stdout
}

function listFiles(dir, predicate, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = path.relative(root, full)
    if (rel.includes(`${path.sep}node_modules${path.sep}`) || rel.startsWith(`tmp${path.sep}node-tools${path.sep}`)) continue
    const stat = fs.statSync(full)
    if (stat.isDirectory()) listFiles(full, predicate, out)
    else if (predicate(full)) out.push(full)
  }
  return out
}

function checkSyntax() {
  const files = listFiles(root, (file) => file.endsWith('.js'))
  for (const file of files) {
    run(process.execPath, ['--check', file])
  }
  return files.length
}

function checkNoLegacyRuntimePayment() {
  const targets = ['pages', 'utils', 'cloudfunctions', 'app.js', 'app.json']
  const banned = [
    /open-type="getUserInfo"/,
    /bindgetuserinfo/,
    /wx\.getUserProfile/,
    /getUserInfo\(/,
    /wx\.requestPayment/,
    /requestPayment\(/,
    /cloudPay/,
    /unifiedOrder/,
    /prepay_id/,
    /mchId/,
    /subMch/,
    /paySign/,
    /signType/
  ]
  const files = []
  for (const target of targets) {
    const full = path.join(root, target)
    if (!fs.existsSync(full)) continue
    if (fs.statSync(full).isDirectory()) {
      listFiles(full, (file) => /\.(js|wxml|json)$/.test(file), files)
    } else {
      files.push(full)
    }
  }
  const offenders = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const pattern of banned) {
      if (pattern.test(text)) offenders.push(`${path.relative(root, file)}: ${pattern}`)
    }
  }
  assert(!offenders.length, `Legacy login/payment patterns found:\n${offenders.join('\n')}`)
}

function checkLoginAndPaymentFixes() {
  const loginWxml = read('pages/login/login.wxml')
  const loginJs = read('pages/login/login.js')
  const authJs = read('utils/auth.js')
  const appJs = read('app.js')
  const userLogin = read('cloudfunctions/userLogin/index.js')
  const vipJs = read('pages/vip/vip.js')
  const supervisionPayJs = read('pages/supervision-pay/supervision-pay.js')
  const createVipOrder = read('cloudfunctions/createVipOrder/index.js')
  const projectConfig = JSON.parse(read('project.config.json'))
  const appJson = JSON.parse(read('app.json'))

  assert(!loginWxml.includes('open-type="getUserInfo"'), 'login page still uses deprecated getUserInfo')
  assert(!loginJs.includes('cloudApi.userLogin({})'), 'openid-only login must be disabled')
  assert((loginWxml.match(/open-type="getPhoneNumber"/g) || []).length === 1, 'login should use one official phone authorization button')
  assert(loginWxml.includes('disabled="{{loading || !agreed}}"'), 'phone authorization must require prior agreement consent')
  assert(loginJs.includes('phoneCode'), 'phone login should pass modern getPhoneNumber code')
  assert(userLogin.includes('getPhoneNumber'), 'userLogin cloud function should support phone code API')
  assert(userLogin.includes("errorCode: 'PHONE_REQUIRED'"), 'userLogin must reject accounts without a verified phone')
  assert(userLogin.includes("ensureCollection('phone_identities')"), 'phone ownership must be reserved uniquely on the server')
  assert(authJs.includes('hasBoundPhone(userInfo)'), 'local auth must reject a cached user without a phone')
  assert(appJs.includes('hasBoundPhone(userInfo)'), 'app startup must reject a cached user without a phone')
  assert(vipJs.includes('auth.requireLogin'), 'VIP purchase should require login before payment')
  assert(supervisionPayJs.includes('auth.requireLogin'), 'supervision purchase should require login before payment')
  assert(createVipOrder.includes('if (!hasBoundPhone(currentUser))'), 'createVipOrder must reject users without a verified phone')
  assert(createVipOrder.includes('requestVirtualPayment'), 'createVipOrder should generate virtual payment signatures')
  assert(appJson.pages.includes('pages/order-center/order-center'), 'order center page must be registered')

  const ignored = ((projectConfig.packOptions || {}).ignore || []).map((item) => `${item.type}:${item.value}`)
  assert(ignored.includes('folder:cloudfunctions'), 'cloudfunctions must be ignored from mini program frontend upload')
  assert(ignored.includes('folder:tmp'), 'tmp must be ignored from mini program frontend upload')
}

function checkCloudFunctionDeps() {
  const cloudRoot = path.join(root, 'cloudfunctions')
  const missing = []
  for (const name of fs.readdirSync(cloudRoot).sort()) {
    const pkgPath = path.join(cloudRoot, name, 'package.json')
    if (!fs.existsSync(pkgPath)) continue
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    for (const dep of Object.keys(pkg.dependencies || {})) {
      if (!fs.existsSync(path.join(cloudRoot, name, 'node_modules', dep, 'package.json'))) {
        missing.push(`${name}:${dep}`)
      }
    }
  }
  assert(!missing.length, `Missing cloud function dependencies:\n${missing.join('\n')}`)
}

function checkUploadInfo() {
  const requestedVersion = process.env.RELEASE_VERSION || process.argv[2] || ''
  const candidates = fs.existsSync(path.join(root, 'tmp'))
    ? fs.readdirSync(path.join(root, 'tmp'))
      .filter((name) => /^upload-\d+\.\d+\.\d+\.json$/.test(name))
      .sort((left, right) => {
        const a = left.match(/\d+/g).map(Number)
        const b = right.match(/\d+/g).map(Number)
        for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
          if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0)
        }
        return 0
      })
    : []
  const selected = requestedVersion ? `upload-${requestedVersion}.json` : candidates[candidates.length - 1]
  const infoPath = selected ? `tmp/${selected}` : ''
  assert(exists(infoPath), `${infoPath} is missing`)
  const info = JSON.parse(read(infoPath))
  const total = info && info.size && Number(info.size.total)
  assert(total > 0, 'upload info has no package size')
  assert(total < maxMiniProgramSize, `mini program package too large: ${total}`)
  return { total, version: selected.replace(/^upload-|\.json$/g, '') }
}

function main() {
  const checkedFiles = checkSyntax()
  checkNoLegacyRuntimePayment()
  checkLoginAndPaymentFixes()
  checkCloudFunctionDeps()
  const upload = checkUploadInfo()
  run(process.execPath, ['scripts/regression-login-payment.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-vip-reconcile.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-customer-reported-issues.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-image-share-permission.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-checkin-share-reward.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-material-redemption.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-privacy-api-declarations.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-question-csv-import.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-question-upload-cloud.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-admin-uploads.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-plan-separation.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-learning-flow.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-study-plan-save.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-review-navigation.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-control-inventory.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-control-handlers.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-release-integrity.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/regression-security-critical.js'], { stdio: 'pipe' })
  run(process.execPath, ['--test', 'scripts/admin-core.test.js'], { stdio: 'pipe' })
  run(process.execPath, ['--test', 'scripts/admin-management.test.js'], { stdio: 'pipe' })
  run(process.execPath, ['scripts/validate-admin-console.js'], { stdio: 'pipe' })

  console.log(JSON.stringify({
    ok: true,
    checkedJsFiles: checkedFiles,
    uploadVersion: upload.version,
    uploadSize: upload.total,
    checks: [
      'syntax',
      'legacy-login-payment-scan',
      'login-payment-fix-invariants',
      'cloud-function-dependencies',
      'upload-size',
      'login-payment-regression',
      'VIP-payment-scheduled-reconciliation-regression',
      'customer-reported-issue-regression',
      'image-share-permission-regression',
      'check-in-share-reward-regression',
      'material-fixed-cost-idempotence-regression',
      'privacy-API-declaration-regression',
      'question-CSV-import-regression',
      'question-upload-cloud-regression',
      'admin-material-audio-wallpaper-upload-regression',
      'VIP-supervision-plan-separation',
      'learning-review-checkin-regression',
      'study-plan-save-feedback-regression',
      'review-ordered-random-navigation-regression',
      'all-page-control-inventory-regression',
      'all-control-handler-isolated-execution-regression',
      'page-route-asset-cloud-function-integrity',
      'critical-security-business-invariants',
      'administrator-operation-core-tests',
      'administrator-management-integration-tests',
      'administrator-console-structure'
    ]
  }, null, 2))
}

try {
  main()
} catch (err) {
  console.error(err.stack || err.message || err)
  process.exit(1)
}
