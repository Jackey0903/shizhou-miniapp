const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const path = require('path')

const root = path.resolve(__dirname, '..')
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))

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

function instantiate(config) {
  const instance = Object.assign({}, config)
  instance.data = clone(config.data || {})
  instance._pendingControlCallbacks = []
  instance.setData = function setData(patch = {}, callback) {
    Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
    if (callback) {
      const result = callback()
      if (result && typeof result.then === 'function') this._pendingControlCallbacks.push(result)
    }
  }
  const audio = createAudioMock()
  instance.audioCtx = audio
  instance._audioCtx = audio
  instance.innerAudioContext = audio
  return instance
}

function createAudioMock() {
  const audio = {
    currentTime: 0,
    duration: 100,
    paused: true,
    src: '',
    play() { audio.paused = false },
    pause() { audio.paused = true },
    stop() { audio.paused = true },
    seek() {},
    destroy() {},
    onPlay() {},
    onPause() {},
    onStop() {},
    onEnded() {},
    onTimeUpdate() {},
    onCanplay() {},
    onError() {}
  }
  return audio
}

function createCanvasMock() {
  const context = new Proxy({}, {
    get(_target, property) {
      if (property === 'measureText') return (text) => ({ width: String(text || '').length * 12 })
      if (property === 'draw') return (_reserve, callback) => { if (callback) callback() }
      return () => context
    },
    set() { return true }
  })
  return context
}

function createWxMock() {
  const storage = new Map()
  const fileSystem = {
    readFile(options) { if (options.fail) options.fail({ errMsg: 'cancel' }) },
    writeFile(options) { if (options.success) options.success() },
    access(options) { if (options.success) options.success() }
  }
  const known = {
    env: { USER_DATA_PATH: '/tmp' },
    getStorageSync: (key) => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    createInnerAudioContext: createAudioMock,
    getBackgroundAudioManager: createAudioMock,
    createRewardedVideoAd: () => ({
      onLoad() {}, onError() {}, onClose() {},
      show: async () => {}, load: async () => {}
    }),
    createCanvasContext: createCanvasMock,
    getFileSystemManager: () => fileSystem,
    showModal: (options = {}) => {
      const result = { confirm: false, cancel: true, content: '' }
      if (options.success) options.success(result)
      if (options.complete) options.complete(result)
      return Promise.resolve(result)
    },
    showActionSheet: (options = {}) => {
      const result = { errMsg: 'showActionSheet:fail cancel' }
      if (options.fail) options.fail(result)
      if (options.complete) options.complete(result)
      return Promise.reject(result).catch(() => result)
    },
    chooseMedia: (options = {}) => { if (options.fail) options.fail({ errMsg: 'chooseMedia:fail cancel' }) },
    chooseMessageFile: (options = {}) => { if (options.fail) options.fail({ errMsg: 'chooseMessageFile:fail cancel' }) },
    canvasToTempFilePath: (options = {}) => { if (options.fail) options.fail({ errMsg: 'canvasToTempFilePath:fail test' }) },
    getImageInfo: (options = {}) => { if (options.fail) options.fail({ errMsg: 'getImageInfo:fail test' }) },
    downloadFile: (options = {}) => { if (options.fail) options.fail({ errMsg: 'downloadFile:fail test' }) },
    saveFile: (options = {}) => { if (options.fail) options.fail({ errMsg: 'saveFile:fail test' }) },
    openDocument: (options = {}) => { if (options.success) options.success() },
    previewImage: (options = {}) => { if (options.success) options.success() },
    setClipboardData: (options = {}) => { if (options.success) options.success() },
    requestSubscribeMessage: (options = {}) => { if (options.success) options.success({}) },
    openPrivacyContract: (options = {}) => { if (options.success) options.success() },
    navigateTo: (options = {}) => { if (options.fail) options.fail({ errMsg: 'navigateTo:fail test' }); if (options.complete) options.complete() },
    redirectTo: (options = {}) => { if (options.fail) options.fail({ errMsg: 'redirectTo:fail test' }); if (options.complete) options.complete() },
    switchTab: (options = {}) => { if (options.fail) options.fail({ errMsg: 'switchTab:fail test' }); if (options.complete) options.complete() },
    navigateBack: (options = {}) => { if (options.success) options.success() },
    cloud: {
      callFunction: (options = {}) => {
        const response = { result: { code: 0, data: {} } }
        if (options.success) options.success(response)
        return Promise.resolve(response)
      },
      uploadFile: (options = {}) => {
        const response = { fileID: 'cloud://test/file' }
        if (options.success) options.success(response)
        return Promise.resolve(response)
      }
    }
  }
  const noopApi = (options = {}) => {
    if (options && typeof options.success === 'function') options.success({})
    if (options && typeof options.complete === 'function') options.complete({})
    return Promise.resolve({})
  }
  return new Proxy(known, {
    get(target, property) {
      if (property in target) return target[property]
      return noopApi
    }
  })
}

const listMethods = new Set([
  'getAudios', 'getCheckins', 'getCoinLogs', 'getCourses', 'getMaterials', 'getMessages',
  'getMyOrders', 'getMyWallpapers', 'getPlans', 'getQuestions', 'getStudyRecords',
  'getStudyReminders', 'getSupervisionMatches', 'getTodayReviews', 'getVipPlans', 'getWallpapers',
  'listAdminConfigs'
])

const objectMethods = new Set([
  'getAdSlot', 'getCourse', 'getCurrentUser', 'getHelpConfig', 'getPunchConfig',
  'getReminderConfig', 'getSupervisionData'
])

function createCloudApiMock() {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'getQuestionCount') return async () => 0
      if (property === 'getMutualHelpDashboard') return async () => ({ approved: [], mine: [], pending: [] })
      if (listMethods.has(property)) return async () => []
      if (objectMethods.has(property)) return async () => null
      if (property === 'assertAdmin') return async () => true
      return async () => ({ result: { code: 0, data: {} } })
    }
  })
}

function loadPage(page, mocks) {
  const target = path.join(root, `${page}.js`)
  delete require.cache[require.resolve(target)]
  const originalLoad = Module._load
  const originalPage = global.Page
  let config = null
  global.Page = (definition) => { config = definition }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../../utils/cloudApi') return mocks.cloudApi
    if (request === '../../utils/auth') return { hasLocalLogin: () => true, requireLogin: async () => false }
    if (request === '../../utils/virtualPayment') {
      return {
        createOrder: async () => ({ result: { code: -1, msg: '测试取消' } }),
        requestVirtualPayment: async () => { throw new Error('requestVirtualPayment:fail cancel') },
        waitForPaidOrder: async () => null,
        reportPaymentError: async () => {},
        getPaymentErrorMessage: () => '测试取消',
        getVirtualPaymentSupport: () => ({ ok: true }),
        canUseVirtualPayment: () => true
      }
    }
    if (request === '../../utils/imageSharing') {
      return {
        shareImageWithFallback: async () => ({ status: 'cancelled' }),
        saveImageWithPermission: async () => ({ status: 'cancelled' }),
        recoverAlbumPermission: async () => false,
        getAlbumAuthorization: async () => false,
        getErrorMessage: (err) => (err && err.message) || '测试取消'
      }
    }
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

function parseDataset(attributes) {
  const dataset = {
    id: '', key: 'full', index: 0, type: 'document', result: 'know', field: 'title',
    category: 'all', mode: 'sequential', status: 'enabled', code: 'basic_vip_year', action: ''
  }
  for (const match of attributes.matchAll(/\bdata-([\w-]+)\s*=\s*["']([^"']*)["']/g)) {
    const raw = match[2]
    if (!raw.includes('{{')) dataset[match[1]] = /^-?\d+$/.test(raw) ? Number(raw) : raw
  }
  return dataset
}

function makeEvent(attributes) {
  const dataset = parseDataset(attributes)
  return {
    currentTarget: { dataset },
    target: { dataset },
    detail: { value: '', index: 0, current: 0, code: '', authSetting: {} },
    stopPropagation() {},
    preventDefault() {}
  }
}

async function invoke(handler, page, event) {
  const result = handler.call(page, event)
  const pending = result && typeof result.then === 'function' ? [result] : []
  pending.push(...page._pendingControlCallbacks)
  if (!pending.length) return
  await Promise.race([
    Promise.all(pending),
    new Promise((_, reject) => setTimeout(() => reject(new Error('handler timed out')), 1000))
  ])
}

async function main() {
  const originals = {
    wx: global.wx,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages
  }
  global.wx = createWxMock()
  global.getApp = () => ({
    globalData: {
      userInfo: { _id: 'test-user', _openid: 'test-openid', isAdmin: true, coins: 100 },
      isLogin: true,
      isAdmin: true,
      isVip: false,
      token: 'test-token',
      tokenExpiresAt: '2099-01-01T00:00:00.000Z'
    }
  })
  global.getCurrentPages = () => [{ route: 'pages/home/home', options: {} }]

  const failures = []
  const invoked = []
  const mocks = { cloudApi: createCloudApiMock() }
  try {
    for (const pagePath of app.pages) {
      const wxml = fs.readFileSync(path.join(root, `${pagePath}.wxml`), 'utf8')
      const config = loadPage(pagePath, mocks)
      const tagPattern = /<([\w-]+)\b([^>]*)>/g
      let tagMatch = null
      while ((tagMatch = tagPattern.exec(wxml))) {
        const tag = tagMatch[1]
        const attributes = tagMatch[2]
        const bindings = [...attributes.matchAll(/((?:bind|catch)(?::|-)?[\w-]+)\s*=\s*["']([A-Za-z_$][\w$]*)["']/g)]
        for (const binding of bindings) {
          const eventType = binding[1]
          const handlerName = binding[2]
          const handler = config && config[handlerName]
          if (typeof handler !== 'function') continue
          const page = instantiate(config)
          try {
            await invoke(handler, page, makeEvent(attributes))
            invoked.push(`${pagePath}:${tag}:${eventType}:${handlerName}`)
          } catch (err) {
            failures.push(`${pagePath} <${tag}> ${eventType}=${handlerName}: ${err.message || err}`)
          }
        }
      }
    }
  } finally {
    global.wx = originals.wx
    global.getApp = originals.getApp
    global.getCurrentPages = originals.getCurrentPages
  }

  assert.deepStrictEqual(failures, [], `Control handlers threw in isolated execution:\n${failures.join('\n')}`)
  assert.ok(
    invoked.length >= 226,
    `Expected at least the established 226 event bindings, invoked ${invoked.length}`
  )
  console.log(JSON.stringify({ ok: true, invokedEventBindings: invoked.length, pages: app.pages.length }, null, 2))
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
