const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function clone(value) {
  return structuredClone(value)
}

function instantiate(config) {
  const page = { ...config, data: clone(config.data) }
  page.setData = function setData(patch = {}) {
    this.data = { ...this.data, ...patch }
  }
  return page
}

function loadPage(cloudApi, wx) {
  const target = path.join(root, 'pages/question-manager/question-manager.js')
  delete require.cache[require.resolve(target)]
  const originalLoad = Module._load
  const originalPage = global.Page
  const originalWx = global.wx
  let definition = null
  global.Page = (config) => { definition = config }
  global.wx = wx
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../../utils/cloudApi') return cloudApi
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    require(target)
    return definition
  } finally {
    Module._load = originalLoad
    global.Page = originalPage
    global.wx = originalWx
  }
}

async function main() {
  const calls = { list: [], save: [], toggle: [], remove: [], toasts: [] }
  const question = {
    _id: 'q-1', type: 'choice', sort: 1, content: '原始题干', options: ['甲', '乙'],
    correctIndex: 0, answer: 'A. 甲', explanation: '原始解析', enabled: true
  }
  const cloudApi = {
    assertAdmin: async () => true,
    getAdminCourseTree: async () => [{ name: '判断推理', banks: [{ _id: 'bank-1', name: '定义判断' }] }],
    listManagedQuestions: async (...args) => {
      calls.list.push(args)
      return { items: [question], total: 1, page: 1, hasMore: false }
    },
    saveManagedQuestion: async (payload) => { calls.save.push(payload); return { code: 0 } },
    toggleManagedQuestion: async (...args) => { calls.toggle.push(args); return { code: 0 } },
    deleteManagedQuestion: async (...args) => { calls.remove.push(args); return { code: 0 } }
  }
  const wx = {
    showLoading() {},
    hideLoading() {},
    showToast(payload) { calls.toasts.push(payload) },
    showModal(payload) { payload.success({ confirm: true, cancel: false }) },
    navigateBack() {}
  }
  const page = instantiate(loadPage(cloudApi, wx))
  // 页面方法在调用时读取全局 wx；模块加载完成后补回测试运行时。
  global.wx = wx

  await page.initPage()
  assert.equal(page.data.authorized, true)
  assert.equal(page.data.courses.length, 1)
  assert.equal(page.data.questions[0]._id, 'q-1')

  page.openEditor({ currentTarget: { dataset: { id: 'q-1' } } })
  assert.equal(page.data.showEditor, true)
  page.onFormInput({ currentTarget: { dataset: { field: 'content' } }, detail: { value: '编辑后的题干' } })
  page.onFormInput({ currentTarget: { dataset: { field: 'optionsText' } }, detail: { value: '选项甲\n选项乙' } })
  page.onCorrectChange({ detail: { value: 1 } })
  await page.saveQuestion()
  assert.equal(calls.save.length, 1)
  assert.equal(calls.save[0].courseId, 'bank-1')
  assert.equal(calls.save[0].content, '编辑后的题干')
  assert.deepEqual(calls.save[0].options, ['选项甲', '选项乙'])
  assert.equal(calls.save[0].correctIndex, 1)
  assert.equal(page.data.showEditor, false, 'successful saves must close the editor')
  assert.equal(page.data.saving, false)

  await page.toggleQuestion({ currentTarget: { dataset: { id: 'q-1', enabled: false } } })
  assert.deepEqual(calls.toggle, [['q-1', 'bank-1', false]])

  await page.removeQuestion({ currentTarget: { dataset: { id: 'q-1' } } })
  assert.deepEqual(calls.remove, [['q-1', 'bank-1']])
  assert(calls.list.length >= 4, 'every successful write must reload the question list')
  console.log('question manager page regression checks passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
