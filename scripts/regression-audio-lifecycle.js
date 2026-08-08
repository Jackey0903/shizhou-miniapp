const assert = require('assert')
const path = require('path')

const root = path.resolve(__dirname, '..')
const callbacks = {}
const manager = {
  currentTime: 12,
  duration: 120,
  paused: false,
  play() {},
  pause() {},
  stop() {},
  seek() {},
  onPlay(callback) { callbacks.play = callback },
  onPause(callback) { callbacks.pause = callback },
  onStop(callback) { callbacks.stop = callback },
  onEnded(callback) { callbacks.ended = callback },
  onTimeUpdate(callback) { callbacks.timeUpdate = callback },
  onCanplay(callback) { callbacks.canplay = callback },
  onError(callback) { callbacks.error = callback }
}

const originalPage = global.Page
const originalWx = global.wx
let definition = null
global.Page = (value) => { definition = value }
global.wx = {
  getBackgroundAudioManager: () => manager,
  showToast() {}
}

try {
  require(path.join(root, 'pages/audio-ear/audio-ear.js'))
} finally {
  global.Page = originalPage
}

assert(definition, 'audio page definition was not loaded')
const page = Object.assign({}, definition)
page.data = JSON.parse(JSON.stringify(definition.data))
page.setData = function setData(patch) {
  Object.assign(this.data, patch)
}

page.ensureAudioContext()
assert.strictEqual(page._audioCtx, manager)
assert.strictEqual(typeof callbacks.timeUpdate, 'function')

// BackgroundAudioManager can deliver queued callbacks after the page has unloaded.
// Every callback must become a no-op once the page has released its context.
page.onUnload()
assert.strictEqual(page._audioCtx, null)
for (const name of ['play', 'pause', 'stop', 'ended', 'timeUpdate', 'canplay', 'error']) {
  assert.doesNotThrow(() => callbacks[name]({ errMsg: 'stale callback' }), `${name} callback must ignore an unloaded page`)
}

global.wx = originalWx
console.log(JSON.stringify({ ok: true, checkedCallbacks: Object.keys(callbacks).length }, null, 2))
