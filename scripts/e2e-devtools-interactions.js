#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const automator = require('miniprogram-automator')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'tmp', 'qa-devtools-interactions')
const wsEndpoint = process.env.MINIPROGRAM_WS_ENDPOINT || 'ws://127.0.0.1:9420'

function withTimeout(label, promise, timeout = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超过 ${timeout}ms 未完成`)), timeout))
  ])
}

async function callCloud(miniProgram, name, data = {}) {
  return miniProgram.evaluate((functionName, payload) => new Promise((resolve) => {
    wx.cloud.callFunction({
      name: functionName,
      data: payload,
      success: (res) => resolve({ ok: true, result: res.result }),
      fail: (err) => resolve({ ok: false, errMsg: err.errMsg || err.message || String(err) })
    })
  }), name, data)
}

async function main() {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const miniProgram = await automator.connect({ wsEndpoint })
  const results = []
  const runtimeErrors = []
  let activeTest = ''

  miniProgram.on('exception', (entry) => {
    runtimeErrors.push({
      test: activeTest,
      type: 'exception',
      detail: entry && typeof entry === 'object' ? JSON.stringify(entry) : String(entry)
    })
  })
  miniProgram.on('console', (entry) => {
    const text = String(entry)
    if (/\b(error|fail|失败|异常)\b/i.test(text)) {
      runtimeErrors.push({ test: activeTest, type: 'console', detail: text.slice(0, 1200) })
    }
  })

  async function open(url, wait = 1200) {
    const separator = url.includes('?') ? '&' : '?'
    const expectedPath = url.split('?')[0].replace(/^\//, '')
    let page = null
    let lastError = null
    for (let attempt = 0; attempt < 2 && !page; attempt += 1) {
      const freshUrl = `${url}${separator}__qa=${Date.now()}-${attempt}`
      try {
        page = await withTimeout(`打开 ${url}`, miniProgram.reLaunch(freshUrl))
      } catch (error) {
        lastError = error
        const current = await withTimeout('核对超时后的当前页面', miniProgram.currentPage(), 5000).catch(() => null)
        if (current && current.path === expectedPath) page = current
        else if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600))
      }
    }
    if (!page) throw lastError || new Error(`无法打开 ${url}`)
    await page.waitFor(wait)
    page = await miniProgram.currentPage()
    let data = await page.data()
    if (data.loading === true) {
      await page.waitFor(2500)
      data = await page.data()
    }
    return { page, data }
  }

  async function waitForData(page, predicate, timeout = 8000) {
    const startedAt = Date.now()
    let data = await page.data()
    while (!predicate(data) && Date.now() - startedAt < timeout) {
      await page.waitFor(300)
      data = await page.data()
    }
    return data
  }

  async function test(name, run) {
    activeTest = name
    const errorStart = runtimeErrors.length
    const startedAt = Date.now()
    const record = { name, status: 'passed' }
    try {
      record.detail = await run()
      const newErrors = runtimeErrors.slice(errorStart)
      if (newErrors.length) {
        record.status = 'failed'
        record.reason = '交互期间出现运行时错误'
        record.runtimeErrors = newErrors
      }
    } catch (error) {
      record.status = 'failed'
      record.reason = String(error && (error.stack || error.message || error)).replace(/\s+/g, ' ').slice(0, 1600)
    }
    record.durationMs = Date.now() - startedAt
    results.push(record)
    console.log(`[${results.length}] ${name}: ${record.status}${record.reason ? ` - ${record.reason}` : ''}`)
  }

  try {
    const coursesRes = await callCloud(miniProgram, 'getCourses')
    const courses = coursesRes.ok && coursesRes.result && coursesRes.result.code === 0
      ? coursesRes.result.data || []
      : []
    const course = courses.find((item) => !item.isLocked && Number(item.totalCount || 0) > 0) || courses[0]
    assert(course && course._id, '正式环境没有可供交互测试的题库')
    const courseName = course.name || '测试题库'
    const query = `courseId=${encodeURIComponent(course._id)}&courseName=${encodeURIComponent(courseName)}`

    await test('学习计划日期、数量、顺序控件', async () => {
      const { page } = await open(`/pages/study-plan/study-plan?${query}`)
      const data = await waitForData(page, (value) => value.course && value.course._id === course._id)
      assert(data.course && data.course._id === course._id, '学习计划未加载目标题库')
      const pickers = await page.$$('picker')
      assert(pickers.length === 3, `学习计划应有 3 个选择器，实际 ${pickers.length}`)
      const deadline = '2026-12-31'
      await pickers[0].trigger('change', { value: deadline })
      await page.waitFor(150)
      await pickers[1].trigger('change', { value: 1 })
      await page.waitFor(150)
      await pickers[2].trigger('change', { value: 1 })
      await page.waitFor(150)
      const updated = await page.data()
      assert(updated.plan.deadline === deadline, '截止日期没有同步')
      assert(updated.dailyCountIndex === 1 && updated.plan.dailyCount === updated.dailyCountOptions[1], '每日数量没有同步')
      assert(updated.modeIndex === 1 && updated.plan.mode === 'random', '学习顺序没有同步')
      assert(Number.isFinite(Number(updated.remainDays)) && Number(updated.remainDays) >= 0, '剩余天数没有重新计算')
      return { deadline: updated.plan.deadline, dailyCount: updated.plan.dailyCount, mode: updated.plan.mode, remainDays: updated.remainDays }
    })

    await test('题目输入与查看答案', async () => {
      const { page, data } = await open(`/pages/question/question?${query}&mode=new`, 1700)
      assert(Array.isArray(data.questions) && data.questions.length > 0, '题目页没有加载题目')
      const textareas = await page.$$('textarea')
      if (textareas.length) {
        await textareas[0].input('真实交互验收答案')
        const buttons = await page.$$('.q-fill-btn-secondary')
        assert(buttons.length === 1, '填空题缺少查看答案按钮')
        await buttons[0].tap()
        const updated = await page.data()
        assert(updated.fillAnswer === '真实交互验收答案', '题目输入没有同步')
        assert(updated.showAnswer === true && updated.fillCheckMode === 'self', '查看答案状态没有同步')
        return { type: 'fill', showAnswer: updated.showAnswer }
      }
      const options = await page.$$('.q-option')
      assert(options.length >= 2, '题目既不是可输入题，也没有有效选项')
      await options[0].tap()
      const updated = await page.data()
      assert(updated.answered === true && updated.selectedOptionIndex === 0, '选择题点击没有同步')
      return { type: 'choice', optionCount: options.length }
    })

    await test('互助中心切换与投稿弹窗', async () => {
      const { page } = await open('/pages/mutual-help/mutual-help')
      const tabs = await page.$$('.mh-tab')
      assert(tabs.length >= 2, '互助中心标签不足')
      await tabs[1].tap()
      let data = await page.data()
      assert(data.activeTab === 'mine', '我的投稿标签切换失败')
      const fab = await page.$('.mh-fab')
      assert(fab, '互助投稿入口不存在')
      await fab.tap()
      data = await page.data()
      assert(data.showComposer === true, '投稿弹窗没有打开')
      const inputs = await page.$$('.composer-input')
      assert(inputs.length >= 1, '投稿标题输入框不存在')
      await inputs[0].input('仅测试本地输入，不提交')
      const close = await page.$('.composer-close')
      await close.tap()
      data = await page.data()
      assert(data.showComposer === false && data.form.title === '', '投稿弹窗关闭后未清空')
      return { tabs: tabs.length }
    })

    await test('督学资料本地编辑与标签切换', async () => {
      const { page } = await open('/pages/supervision/supervision')
      const inputs = await page.$$('.form-input')
      assert(inputs.length >= 2, '督学资料输入框不完整')
      await inputs[0].input('验收昵称')
      await page.waitFor(400)
      let data = await page.data()
      assert(data.currentProfile.displayName === '验收昵称', '督学昵称输入没有同步')
      const tabs = await page.$$('.tab-item')
      assert(tabs.length >= 2, '督学模式标签不足')
      await tabs[1].tap()
      await page.waitFor(500)
      data = await page.data()
      assert(data.activeTab === 'part', '督学局部匹配标签切换失败')
      return { activeTab: data.activeTab }
    })

    await test('VIP 套餐选择', async () => {
      const { page, data } = await open('/pages/vip/vip')
      assert(Array.isArray(data.plans) && data.plans.length === 2, `VIP 页面应显示 2 个套餐，实际 ${data.plans && data.plans.length}`)
      const cards = await page.$$('.plan-card')
      await cards[1].tap()
      const updated = await page.data()
      assert(updated.sel === 1 && updated.currentPlan.code === 'premium_vip_year', '高级 VIP 套餐选择失败')
      return { codes: updated.plans.map((item) => item.code), selected: updated.currentPlan.code }
    })

    await test('督学套餐选择', async () => {
      const { page, data } = await open('/pages/supervision-pay/supervision-pay?mode=full')
      assert(Array.isArray(data.plans) && data.plans.length === 3, `督学页面应显示 3 个套餐，实际 ${data.plans && data.plans.length}`)
      const cards = await page.$$('.plan-card')
      await cards[2].tap()
      const updated = await page.data()
      assert(updated.sel === 2 && updated.currentPlan.code === 'premium_vip_year', '督学包年套餐选择失败')
      assert(updated.currentPlan.title === '督学包年', '督学包年名称错误')
      return { codes: updated.plans.map((item) => item.code), selected: updated.currentPlan.code }
    })

    await test('磨耳朵分类、模式、定时与播放', async () => {
      const { page, data } = await open('/pages/audio-ear/audio-ear')
      assert(Array.isArray(data.audios), '音频数据结构异常')
      const target = data.audios[0]
      assert(target && target._id && target.category, '正式环境没有可播放音频')
      await page.callMethod('switchCategory', { currentTarget: { dataset: { category: target.category } } })
      let updated = await page.data()
      assert(updated.activeCategory === target.category && updated.filteredAudios.length > 0, '音频分类筛选失败')
      const mode = await page.$('.ae-control-pill')
      await mode.tap()
      updated = await page.data()
      assert(updated.playMode === 'list', '连续播放模式切换失败')
      const picker = await page.$('picker')
      await picker.trigger('change', { value: [0, 1] })
      await page.waitFor(300)
      updated = await page.data()
      assert(updated.timerLabel === '0小时5分钟', '定时关闭设置失败')
      const items = await page.$$('.ae-item')
      assert(items.length > 0, '筛选后没有音频条目')
      await items[0].trigger('tap')
      await page.waitFor(2500)
      updated = await page.data()
      if (updated.playingId !== target._id) {
        await page.callMethod('startByIndex', 0, true)
        await page.waitFor(2000)
        updated = await page.data()
      }
      assert(updated.playingId === target._id && updated.currentTitle, '音频点击后没有进入播放状态')
      await page.callMethod('pauseCurrent')
      await page.waitFor(200)
      return { category: target.category, playingId: updated.playingId, timerLabel: updated.timerLabel }
    })

    await test('资料分类切换', async () => {
      const { page, data } = await open('/pages/material/material')
      assert(Array.isArray(data.materials) && data.materials.length > 0, '资料列表为空')
      const tabs = await page.$$('.mat-tab')
      assert(tabs.length === 3, `资料分类应为 3 个，实际 ${tabs.length}`)
      const keys = ['document', 'audio', 'image']
      for (let index = 0; index < tabs.length; index += 1) {
        await tabs[index].tap()
        const updated = await page.data()
        assert(updated.activeTab === keys[index], `资料分类 ${keys[index]} 切换失败`)
        assert((updated.filteredMaterials || []).every((item) => item.type === keys[index]), `资料分类 ${keys[index]} 混入其他类型`)
      }
      return { total: data.materials.length, categories: keys }
    })

    await test('资料分析计算器输入与提交', async () => {
      const { page } = await open('/pages/calculator/calculator')
      const modes = await page.$$('.mode-item')
      assert(modes.length === 2, '计算器模式按钮不完整')
      await modes[1].tap()
      await page.waitFor(200)
      assert((await page.data()).mode === 'random', '取消切换模式后不应清空现有随机题')
      await page.callMethod('resetForMode', 'custom', false)
      await page.waitFor(300)
      let inputs = await page.$$('.top-input')
      assert(inputs.length === 4, `自定义模式应有 4 个原始数据输入框，实际 ${inputs.length}`)
      for (const [index, value] of ['100', '200', '10', '5'].entries()) await inputs[index].input(value)
      const answerInputs = await page.$$('.answer-input')
      assert(answerInputs.length > 0, '计算器答案输入框不存在')
      await answerInputs[0].input('90.91')
      const submit = await page.$('.action-submit')
      await submit.tap()
      const data = await page.data()
      assert(data.submitted === true && data.scoreText, '计算器提交后没有评分结果')
      const labels = await page.$$('.result-label')
      await labels[0].tap()
      const formula = await page.data()
      assert(formula.formulaVisible === true && formula.formulaTitle, '公式说明没有打开')
      await page.callMethod('hideFormula')
      return { score: data.scoreText, formula: formula.formulaTitle }
    })

    await test('日历月份切换', async () => {
      const { page, data } = await open('/pages/calendar/calendar')
      const initial = `${data.year}-${data.month}`
      const buttons = await page.$$('.cal-nav-btn')
      assert(buttons.length === 2, '日历月份切换按钮不完整')
      await buttons[0].tap()
      const previous = await page.data()
      assert(`${previous.year}-${previous.month}` !== initial, '上个月按钮无效')
      await buttons[1].tap()
      const restored = await page.data()
      assert(`${restored.year}-${restored.month}` === initial, '下个月按钮没有恢复原月份')
      return { initial, restored: `${restored.year}-${restored.month}` }
    })

    await test('复习本搜索与标签筛选', async () => {
      const { page, data } = await open('/pages/review-book/review-book')
      const input = await page.$('input')
      assert(input, '复习本搜索框不存在')
      await input.input('定义')
      let updated = await page.data()
      assert(updated.keyword === '定义', '复习本搜索词没有同步')
      const tabs = await page.$$('.rb-tab')
      assert(tabs.length >= 2, '复习本标签不足')
      await tabs[1].tap()
      updated = await page.data()
      assert(updated.activeTab !== data.activeTab, '复习本标签没有切换')
      const clear = await page.$('.search-clear')
      assert(clear, '输入搜索词后没有清空按钮')
      await clear.tap()
      updated = await page.data()
      assert(updated.keyword === '', '复习本搜索没有清空')
      return { records: (data.records || []).length, activeTab: updated.activeTab }
    })

    await test('壁纸编辑文字、题目开关与题目选择', async () => {
      const src = encodeURIComponent('/assets/images/default-wallpaper-1.webp')
      const { page } = await open(`/pages/wallpaper-editor/wallpaper-editor?src=${src}&text=${encodeURIComponent('初始文字')}&question=${encodeURIComponent('初始题目')}`)
      const textarea = await page.$('textarea')
      assert(textarea, '壁纸文字输入框不存在')
      await textarea.input('真实壁纸交互验收')
      const toggle = await page.$('switch')
      assert(toggle, '题目开关不存在')
      await toggle.tap()
      let data = await page.data()
      assert(data.customText === '真实壁纸交互验收', '壁纸文字没有同步')
      assert(data.includeQuestion === true, '题目开关没有打开')
      const picker = await page.$('picker')
      assert(picker, '打开题目后没有题目选择器')
      await picker.trigger('change', { value: 0 })
      data = await page.data()
      assert(data.selectedQuestionIndex === 0 && data.selectedQuestionText, '题目选择没有同步')
      return { includeQuestion: data.includeQuestion, questionCount: data.questionOptions.length }
    })

    await test('首页进入分类并展示题库', async () => {
      const { page } = await open('/pages/home/home')
      const cards = await page.$$('.category-card')
      assert(cards.length > 0, '首页没有分类卡')
      await cards[0].tap()
      await page.waitFor(1000)
      const current = await miniProgram.currentPage()
      assert(current.path === 'pages/course-list/course-list', `首页分类跳转到异常页面 ${current.path}`)
      const filtered = await current.data()
      assert(filtered.showCategories === false && filtered.courses.length > 0, '首页分类点击后未展示对应题库')
      return { homeCards: cards.length, selected: filtered.category, courses: filtered.courses.length }
    })

    const counts = results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1
      return acc
    }, {})
    const report = {
      generatedAt: new Date().toISOString(),
      environment: { cloudEnv: 'cloud-2ge02vrucaf8a6ab', courseFixture: { id: course._id, name: courseName } },
      counts,
      results
    }
    fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ counts, report: path.join(outputDir, 'report.json') }, null, 2))
    if (counts.failed) process.exitCode = 1
  } finally {
    miniProgram.disconnect()
  }
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
