const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(dir, predicate, result = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, predicate, result)
    else if (predicate(full)) result.push(full)
  }
  return result
}

function checkPageBundlesAndEvents() {
  const missing = []
  const missingHandlers = []
  for (const page of app.pages) {
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      if (!fs.existsSync(path.join(root, `${page}.${ext}`))) missing.push(`${page}.${ext}`)
    }
    if (missing.some((item) => item.startsWith(`${page}.`))) continue
    const wxml = read(`${page}.wxml`)
    const js = read(`${page}.js`)
    const eventPattern = /(?:bind|catch)(?::|-)?[a-zA-Z]+\s*=\s*["']([A-Za-z_$][\w$]*)["']/g
    let match = null
    while ((match = eventPattern.exec(wxml))) {
      const handler = match[1].replace(/\$/g, '\\$')
      const definition = new RegExp(`(?:^|[,{\\s])(?:async\\s+)?${handler}\\s*\\(`)
      if (!definition.test(js)) missingHandlers.push(`${page}: ${match[1]}`)
    }
  }
  assert.deepStrictEqual(missing, [], `Missing page files:\n${missing.join('\n')}`)
  assert.deepStrictEqual(missingHandlers, [], `Missing WXML event handlers:\n${missingHandlers.join('\n')}`)
}

function checkRoutesAndAssets() {
  const registered = new Set(app.pages)
  const invalidRoutes = []
  const missingAssets = []
  for (const page of app.pages) {
    for (const ext of ['js', 'wxml']) {
      const text = read(`${page}.${ext}`)
      const routePattern = /["'`](\/pages\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)/g
      let match = null
      while ((match = routePattern.exec(text))) {
        if (!registered.has(match[1].slice(1))) invalidRoutes.push(`${page}.${ext}: ${match[1]}`)
      }
      if (ext === 'wxml') {
        const assetPattern = /\bsrc=["'](\/(?:assets|QRcode\.png)[^"'{}]*)["']/g
        while ((match = assetPattern.exec(text))) {
          const asset = match[1].split('?')[0].slice(1)
          if (!fs.existsSync(path.join(root, asset))) missingAssets.push(`${page}: /${asset}`)
        }
      }
    }
  }
  for (const item of (app.tabBar && app.tabBar.list) || []) {
    for (const key of ['iconPath', 'selectedIconPath']) {
      if (!fs.existsSync(path.join(root, item[key] || ''))) missingAssets.push(`tabBar: ${item[key]}`)
    }
  }
  assert.deepStrictEqual(invalidRoutes, [], `Unregistered page routes:\n${invalidRoutes.join('\n')}`)
  assert.deepStrictEqual(missingAssets, [], `Missing packaged assets:\n${missingAssets.join('\n')}`)
}

function checkCloudFunctionReferences() {
  const sourceFiles = [
    ...walk(path.join(root, 'pages'), (file) => file.endsWith('.js')),
    ...walk(path.join(root, 'utils'), (file) => file.endsWith('.js')),
    path.join(root, 'app.js')
  ]
  const referenced = new Set()
  for (const file of sourceFiles) {
    const text = fs.readFileSync(file, 'utf8')
    const callPattern = /callFunction\s*\(\s*\{[\s\S]{0,500}?\bname\s*:\s*["']([^"']+)["']/g
    let match = null
    while ((match = callPattern.exec(text))) referenced.add(match[1])
  }
  const missing = []
  for (const name of referenced) {
    const dir = path.join(root, 'cloudfunctions', name)
    if (!fs.existsSync(path.join(dir, 'index.js')) || !fs.existsSync(path.join(dir, 'package.json'))) {
      missing.push(name)
    }
  }
  assert.deepStrictEqual(missing, [], `Referenced cloud functions are incomplete: ${missing.join(', ')}`)
  assert(referenced.has('createVipOrder'))
  assert(referenced.has('userLogin'))
  assert(referenced.has('submitAnswer'))
}

function checkPackagingAndQr() {
  const maxPackagedMediaBytes = 200 * 1024
  const config = JSON.parse(read('project.config.json'))
  const ignored = new Set(((config.packOptions || {}).ignore || []).map((item) => `${item.type}:${item.value}`))
  for (const folder of ['cloudfunctions', 'docs', 'samples', 'scripts', 'tmp']) {
    assert(ignored.has(`folder:${folder}`), `${folder} must not be included in the mini program package`)
  }
  const qrPath = path.join(root, 'QRcode.png')
  assert(fs.existsSync(qrPath) && fs.statSync(qrPath).size > 1024, 'Customer-service QR image is missing or empty')
  assert(!ignored.has('file:QRcode.png'), 'Customer-service QR image is excluded from upload')

  const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.m4a'])
  const packageMediaRoots = ['assets', 'pages', 'components', 'custom-tab-bar']
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(dir))
  const mediaFiles = [qrPath]
  for (const dir of packageMediaRoots) {
    mediaFiles.push(...walk(dir, (file) => mediaExtensions.has(path.extname(file).toLowerCase())))
  }
  const uniqueMediaFiles = [...new Set(mediaFiles)]
  const packagedMediaBytes = uniqueMediaFiles.reduce((total, file) => total + fs.statSync(file).size, 0)
  assert(
    packagedMediaBytes < maxPackagedMediaBytes,
    `Packaged image/audio assets total ${packagedMediaBytes} bytes; WeChat DevTools requires less than ${maxPackagedMediaBytes} bytes`
  )
}

function checkNoClientDatabaseAccess() {
  const sourceFiles = [
    ...walk(path.join(root, 'pages'), (file) => file.endsWith('.js')),
    ...walk(path.join(root, 'utils'), (file) => file.endsWith('.js')),
    path.join(root, 'app.js')
  ]
  const offenders = sourceFiles.filter((file) => /wx\.cloud\.database\s*\(|cloudApi\.db\b/.test(fs.readFileSync(file, 'utf8')))
  assert.deepStrictEqual(offenders, [], `Client database access found:\n${offenders.map((file) => path.relative(root, file)).join('\n')}`)
}

function main() {
  checkPageBundlesAndEvents()
  checkRoutesAndAssets()
  checkCloudFunctionReferences()
  checkPackagingAndQr()
  checkNoClientDatabaseAccess()
  console.log(`release integrity checks passed (${app.pages.length} pages)`)
}

main()
