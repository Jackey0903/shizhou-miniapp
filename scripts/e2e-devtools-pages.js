#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'tmp', 'qa-devtools-pages')
const wsEndpoint = process.env.MINIPROGRAM_WS_ENDPOINT || 'ws://127.0.0.1:9420'

const pagePaths = [
  'pages/home/home',
  'pages/course-list/course-list',
  'pages/study-plan/study-plan',
  'pages/study-book/study-book',
  'pages/question/question',
  'pages/review-book/review-book',
  'pages/calendar/calendar',
  'pages/checkin/checkin',
  'pages/mutual-help/mutual-help',
  'pages/supervision/supervision',
  'pages/share-gift/share-gift',
  'pages/message/message',
  'pages/help-feedback/help-feedback',
  'pages/profile/profile',
  'pages/login/login',
  'pages/agreement/agreement',
  'pages/privacy/privacy',
  'pages/supervision-pay/supervision-pay',
  'pages/supervision-plan/supervision-plan',
  'pages/vip/vip',
  'pages/order-center/order-center',
  'pages/wallpaper/wallpaper',
  'pages/audio-ear/audio-ear',
  'pages/calculator/calculator',
  'pages/material/material',
  'pages/coin-log/coin-log',
  'pages/admin-center/admin-center',
  'pages/admin-role-manager/admin-role-manager',
  'pages/user-access-admin/user-access-admin',
  'pages/miniapp-code/miniapp-code',
  'pages/question-upload/question-upload',
  'pages/course-upload/course-upload',
  'pages/audio-upload/audio-upload',
  'pages/material-upload/material-upload',
  'pages/wallpaper-upload/wallpaper-upload',
  'pages/reminder-config/reminder-config',
  'pages/message-config/message-config',
  'pages/ad-config/ad-config',
  'pages/help-config/help-config',
  'pages/vip-plan-config/vip-plan-config',
  'pages/punch-background-config/punch-background-config',
  'pages/punch-quote-config/punch-quote-config',
  'pages/wallpaper-editor/wallpaper-editor'
]

function encodeQuery(query = {}) {
  const entries = Object.entries(query).filter(([, value]) => value !== undefined && value !== '')
  return entries.length
    ? `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
    : ''
}

function cleanLog(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return String(text || '').replace(/\s+/g, ' ').slice(0, 1000)
}

function summarizeData(data = {}) {
  const summary = {}
  ;['loading', 'saving', 'authorized', 'loadError', 'error', 'errorMessage', 'emptyText'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) summary[key] = data[key]
  })
  Object.entries(data).forEach(([key, value]) => {
    if (Array.isArray(value)) summary[`${key}Count`] = value.length
  })
  return summary
}

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
  const runtimeLogs = []
  let activePage = ''
  miniProgram.on('console', (entry) => {
    const text = cleanLog(entry)
    if (/\b(error|fail|失败|异常)\b/i.test(text)) runtimeLogs.push({ page: activePage, type: 'console', text })
  })
  miniProgram.on('exception', (entry) => {
    runtimeLogs.push({ page: activePage, type: 'exception', text: cleanLog(entry) })
  })

  try {
    const systemInfo = await miniProgram.systemInfo()
    const loginState = await miniProgram.evaluate(() => {
      const app = getApp()
      const user = app.globalData.userInfo || {}
      return {
        isLogin: !!app.globalData.isLogin,
        isAdmin: !!app.globalData.isAdmin,
        isVip: !!app.globalData.isVip,
        hasBoundPhone: !!(user.phoneNumber || user.phone),
        role: user.role || ''
      }
    })
    const coursesRes = await callCloud(miniProgram, 'getCourses')
    const courses = coursesRes.ok && coursesRes.result && coursesRes.result.code === 0
      ? (coursesRes.result.data || [])
      : []
    const course = courses.find((item) => !item.isLocked && Number(item.totalCount || 0) > 0) || courses[0] || {}
    const courseName = course.name || '测试题库'

    const queries = {
      'pages/course-list/course-list': { category: course.category || course.subjectName || '' },
      'pages/study-plan/study-plan': { courseId: course._id || '', courseName },
      'pages/question/question': { courseId: course._id || '', courseName, mode: 'new' },
      'pages/review-book/review-book': { courseId: course._id || '' },
      'pages/supervision-pay/supervision-pay': { mode: 'full' },
      'pages/supervision-plan/supervision-plan': { mode: 'full' },
      'pages/vip/vip': { mode: 'full' },
      'pages/wallpaper-editor/wallpaper-editor': {
        src: '/assets/default-wallpaper.webp',
        text: '真实运行时验收',
        question: '测试题目'
      }
    }

    const results = []
    for (let index = 0; index < pagePaths.length; index += 1) {
      const expectedPath = pagePaths[index]
      activePage = expectedPath
      const logStart = runtimeLogs.length
      const url = `/${expectedPath}${encodeQuery(queries[expectedPath])}`
      let result = { expectedPath, url, status: 'passed' }
      try {
        let page = await withTimeout('打开页面', miniProgram.reLaunch(url))
        await withTimeout('等待页面首屏', page.waitFor(1200))
        page = await withTimeout('读取当前页面', miniProgram.currentPage())
        let data = await withTimeout('读取页面数据', page.data())
        if (data.loading === true) {
          await withTimeout('等待异步加载', page.waitFor(2500))
          data = await withTimeout('重新读取页面数据', page.data())
        }
        const controls = await withTimeout('查询页面控件', page.$$('button,input,textarea,picker,switch,slider,ad,image,navigator'))
        const renderedNodes = await withTimeout('查询页面渲染节点', page.$$('view,text,button,input,textarea,picker,switch,slider,ad,image,navigator'))
        result = {
          ...result,
          actualPath: page.path,
          renderedControls: controls.length,
          renderedNodes: renderedNodes.length,
          data: summarizeData(data),
          redirected: page.path !== expectedPath
        }
        if (data.loading === true) {
          result.status = 'failed'
          result.reason = '页面异步加载超过验收等待时间后仍为 loading'
        } else if (!result.redirected && renderedNodes.length === 0) {
          result.status = 'failed'
          result.reason = '页面未渲染任何可见节点'
        } else if (data.authorized === false && expectedPath.startsWith('pages/admin-')) {
          result.status = 'blocked_permission'
          result.reason = '当前开发者工具账号不是最高管理员，页面按权限拒绝访问'
        } else if (result.redirected) {
          const expectedAccessGate = expectedPath === 'pages/supervision-plan/supervision-plan'
            && page.path === 'pages/supervision-pay/supervision-pay'
          result.status = page.path === 'pages/login/login'
            ? 'blocked_login'
            : expectedAccessGate ? 'passed_access_gate' : 'redirected'
          result.reason = `页面跳转到 ${page.path}`
        }
      } catch (err) {
        result.status = 'failed'
        result.reason = cleanLog(err && (err.stack || err.message || err))
      }

      result.runtimeErrors = runtimeLogs.slice(logStart)
      if (result.runtimeErrors.length && result.status === 'passed') {
        result.status = 'failed'
        result.reason = '页面运行时输出错误'
      }
      results.push(result)
      console.log(`[${index + 1}/${pagePaths.length}] ${expectedPath}: ${result.status}${result.reason ? ` - ${result.reason}` : ''}`)
    }

    const counts = results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1
      return acc
    }, {})
    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        platform: systemInfo.platform,
        SDKVersion: systemInfo.SDKVersion,
        cloudEnv: 'cloud-2ge02vrucaf8a6ab',
        courseFixture: { id: course._id || '', name: courseName },
        loginState
      },
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

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
