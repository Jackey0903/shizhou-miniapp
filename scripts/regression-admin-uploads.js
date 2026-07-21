const assert = require('assert')
const Module = require('module')
const path = require('path')

const root = path.resolve(__dirname, '..')

function createMemoryDb(initial = {}) {
  const state = {}
  Object.keys(initial).forEach((name) => {
    state[name] = initial[name].map((item, index) => ({ _id: item._id || `${name}_${index + 1}`, ...item }))
  })

  function collection(name) {
    if (!state[name]) state[name] = []
    let filter = null
    let limitValue = null
    const api = {
      where(nextFilter) { filter = nextFilter; return api },
      limit(nextLimit) { limitValue = nextLimit; return api },
      async get() {
        let data = state[name].filter((item) => !filter || Object.keys(filter).every((key) => item[key] === filter[key]))
        if (limitValue !== null) data = data.slice(0, limitValue)
        return { data: data.map((item) => ({ ...item })) }
      },
      async add({ data }) {
        const _id = `${name}_${state[name].length + 1}`
        state[name].push({ _id, ...data })
        return { _id }
      },
      doc(id) {
        return {
          async set({ data }) {
            const index = state[name].findIndex((item) => item._id === id)
            if (index >= 0) state[name][index] = { _id: id, ...data }
            else state[name].push({ _id: id, ...data })
            return { _id: id }
          }
        }
      }
    }
    return api
  }

  return { state, collection, serverDate: () => new Date('2026-07-21T00:00:00.000Z') }
}

function loadFunction(name, db, openid) {
  const target = path.join(root, `cloudfunctions/${name}/index.js`)
  delete require.cache[require.resolve(target)]
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: openid })
  }
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloudMock
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(target)
  } finally {
    Module._load = originalLoad
  }
}

async function testUpload(name, eventKey, collectionName, validItem, invalidItem) {
  const adminDb = createMemoryDb({ users: [{ _openid: 'admin', role: 'admin' }] })
  const adminFunction = loadFunction(name, adminDb, 'admin')
  const first = await adminFunction.main({ [eventKey]: [validItem] })
  assert.strictEqual(first.code, 0, JSON.stringify(first))
  assert.strictEqual(first.count, 1)
  assert.strictEqual(adminDb.state[collectionName].length, 1)

  const retry = await adminFunction.main({ [eventKey]: [validItem] })
  assert.strictEqual(retry.code, 0, JSON.stringify(retry))
  assert.strictEqual(adminDb.state[collectionName].length, 1, `${name} retries must not duplicate records`)

  const invalid = await adminFunction.main({ [eventKey]: [invalidItem] })
  assert.notStrictEqual(invalid.code, 0, `${name} must reject invalid items instead of reporting success with count 0`)
  assert.strictEqual(adminDb.state[collectionName].length, 1)

  const userDb = createMemoryDb({ users: [{ _openid: 'user', role: 'user' }] })
  const userFunction = loadFunction(name, userDb, 'user')
  const forbidden = await userFunction.main({ [eventKey]: [validItem] })
  assert.notStrictEqual(forbidden.code, 0)
  assert.strictEqual((userDb.state[collectionName] || []).length, 0)
}

async function main() {
  await testUpload('uploadMaterials', 'materials', 'materials', {
    name: '测试资料', type: 'document', accessType: 'coin', coinCost: 5,
    fileId: 'cloud://test/materials/test.pdf'
  }, { name: '', type: 'document' })
  await testUpload('uploadAudios', 'audios', 'audios', {
    title: '测试音频', category: '常识', type: '晨听',
    fileId: 'cloud://test/audios/test.mp3'
  }, { title: '错误音频', category: '', fileId: '' })
  await testUpload('uploadWallpapers', 'wallpapers', 'wallpapers', {
    title: '测试壁纸', type: 'default', fileId: 'cloud://test/wallpapers/test.png'
  }, { title: '错误壁纸', fileId: '' })
  console.log('admin upload regression checks passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
