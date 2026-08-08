#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'tmp', 'qa-cloud-readonly')
const wsEndpoint = process.env.MINIPROGRAM_WS_ENDPOINT || 'ws://127.0.0.1:9420'

function withTimeout(label, promise, timeout = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超过 ${timeout}ms 未完成`)), timeout))
  ])
}

async function callCloud(miniProgram, name, data = {}) {
  return withTimeout(`${name} 云函数`, miniProgram.evaluate((functionName, payload) => new Promise((resolve) => {
    wx.cloud.callFunction({
      name: functionName,
      data: payload,
      success: (res) => resolve({ ok: true, result: res.result }),
      fail: (err) => resolve({ ok: false, errMsg: err.errMsg || err.message || String(err) })
    })
  }), name, data))
}

function countOf(data) {
  if (Array.isArray(data)) return data.length
  if (data && Array.isArray(data.items)) return data.items.length
  return null
}

function compact(value) {
  if (Array.isArray(value)) return { count: value.length }
  if (!value || typeof value !== 'object') return value
  const summary = {}
  const keys = [
    'code', 'msg', 'name', 'phone', 'role', 'isAdmin', 'isSuperAdmin', 'hasSuperAdmin',
    'total', 'page', 'pageSize', 'hasMore', 'coins', 'status', 'enabled', 'fileId'
  ]
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) summary[key] = value[key]
  })
  Object.entries(value).forEach(([key, item]) => {
    if (Array.isArray(item)) summary[`${key}Count`] = item.length
  })
  return summary
}

function assertCodeZero(result) {
  if (!result || Number(result.code) !== 0) {
    throw new Error((result && result.msg) || `业务返回异常：${JSON.stringify(result)}`)
  }
}

async function main() {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  const miniProgram = await automator.connect({ wsEndpoint })
  const results = []
  let course = null

  async function test(name, functionName, data, validate, options = {}) {
    const startedAt = Date.now()
    let record = { name, functionName, data, status: 'passed' }
    try {
      const response = await callCloud(miniProgram, functionName, data)
      if (!response.ok) throw new Error(response.errMsg || '云函数调用失败')
      const result = response.result
      if (options.allowedCodes && options.allowedCodes.includes(Number(result && result.code))) {
        record.status = options.statusForCode && options.statusForCode[Number(result.code)]
          ? options.statusForCode[Number(result.code)]
          : 'passed_access_gate'
        record.reason = result.msg || ''
      } else {
        assertCodeZero(result)
        if (validate) validate(result.data, result)
      }
      record.summary = compact(result && result.data)
    } catch (error) {
      record.status = 'failed'
      record.reason = String(error && (error.stack || error.message || error)).replace(/\s+/g, ' ').slice(0, 1200)
    }
    record.durationMs = Date.now() - startedAt
    results.push(record)
    console.log(`[${results.length}] ${name}: ${record.status}${record.reason ? ` - ${record.reason}` : ''}`)
    return record
  }

  try {
    const coursesTest = await test('公开题库列表', 'getCourses', {}, (data) => {
      if (!Array.isArray(data) || !data.length) throw new Error('正式环境题库列表为空')
      const ids = data.map((item) => item && item._id).filter(Boolean)
      if (new Set(ids).size !== ids.length) throw new Error('题库 ID 存在重复')
      course = data.find((item) => !item.isLocked && Number(item.totalCount || 0) > 0) || data[0]
      if (!course || !course._id) throw new Error('未找到可用于验收的题库')
    })

    if (coursesTest.status === 'passed' && course) {
      await test('题库详情', 'getCourse', { courseId: course._id }, (data) => {
        if (!data || data._id !== course._id) throw new Error('题库详情与列表 ID 不一致')
      })
      await test('题目数量', 'getQuestions', { action: 'count', courseId: course._id }, (data) => {
        if (!data || !Number.isFinite(Number(data.total))) throw new Error('题目数量不是有效数字')
        if (Number(course.totalCount || 0) > 0 && Number(data.total) <= 0) throw new Error('列表显示有题，但实际题目数量为 0')
      })
      await test('题目读取', 'getQuestions', { courseId: course._id, skip: 0, limit: 5 }, (data) => {
        if (!Array.isArray(data) || !data.length) throw new Error('可用题库未返回题目')
        data.forEach((item, index) => {
          if (!item || !item._id || !(item.question || item.content || item.stem)) {
            throw new Error(`第 ${index + 1} 道题缺少 ID 或题干`)
          }
          const type = String(item.type || '').toLowerCase()
          if (['single', 'multiple', 'choice'].includes(type)
            && (!Array.isArray(item.options) || item.options.length < 2)) {
            throw new Error(`第 ${index + 1} 道选择题选项不足`)
          }
        })
      })
    }

    const now = new Date()
    const calls = [
      ['当前用户', 'userLogin', { action: 'getCurrentUser' }, null, { allowedCodes: [404], statusForCode: { 404: 'blocked_login' } }],
      ['学习计划列表', 'savePlan', { action: 'list' }],
      ['答题记录列表', 'submitAnswer', { action: 'list' }],
      ['当月打卡记录', 'checkin', { action: 'list', year: now.getFullYear(), month: now.getMonth() + 1 }],
      ['互助中心', 'mutualHelpCenter', { action: 'dashboard' }, (data) => {
        if (!data || !Array.isArray(data.approved) || !Array.isArray(data.mine)) throw new Error('互助中心返回结构不完整')
      }],
      ['磨耳朵音频', 'uploadAudios', { action: 'list' }],
      ['公共壁纸', 'uploadWallpapers', { action: 'list' }],
      ['我的壁纸', 'userWallpaperManager', { action: 'list' }],
      ['领取资料', 'getMaterials', {}, (data) => {
        if (!Array.isArray(data) || !data.length) throw new Error('正式环境资料列表为空')
        data.forEach((item, index) => {
          if (!item || !item._id || !(item.title || item.name)) throw new Error(`第 ${index + 1} 个资料缺少 ID 或标题`)
        })
      }],
      ['消息中心', 'messageCenter', { action: 'list' }],
      ['督学资料', 'supervisionMatch', { action: 'getData' }],
      ['督学全量匹配', 'supervisionMatch', { action: 'list', mode: 'full' }],
      ['督学局部匹配', 'supervisionMatch', { action: 'list', mode: 'part' }],
      ['提醒公共配置', 'studyReminderCenter', { action: 'getConfig' }],
      ['个人提醒列表', 'studyReminderCenter', { action: 'list', payload: { mode: 'full' } }],
      ['舟币流水', 'grantCoinReward', { action: 'list' }],
      ['虚拟支付套餐', 'createVipOrder', { action: 'plans' }, (data) => {
        const expected = {
          basic_vip_year: { price: 19800, days: 365, supervisionDays: 0 },
          supervision_trial_day: { price: 800, days: 365, supervisionDays: 1 },
          supervision_month: { price: 19800, days: 365, supervisionDays: 30 },
          premium_vip_year: { price: 98800, days: 365, supervisionDays: 365 }
        }
        if (!Array.isArray(data)) throw new Error('套餐数据不是数组')
        const plans = new Map(data.map((item) => [item.code, item]))
        const missing = Object.keys(expected).filter((code) => !plans.has(code))
        if (missing.length) throw new Error(`缺少已启用套餐：${missing.join('、')}`)
        Object.entries(expected).forEach(([code, published]) => {
          const item = plans.get(code)
          if (!item.name || item.enabled === false) throw new Error(`套餐 ${code} 未启用或名称为空`)
          for (const [field, value] of Object.entries(published)) {
            const actual = Number(item[field])
            if (actual !== value) {
              throw new Error(`套餐 ${code} 的 ${field} 错误：期望 ${value}，实际 ${actual}`)
            }
          }
        })
      }],
      ['我的订单', 'createVipOrder', { action: 'list', limit: 20 }],
      ['打卡背景配置', 'adminConfigCenter', { action: 'publicList', target: 'punch_backgrounds' }],
      ['打卡文案配置', 'adminConfigCenter', { action: 'publicList', target: 'punch_quotes' }],
      ['广告位配置', 'adminConfigCenter', { action: 'publicList', target: 'ad_slots' }],
      ['帮助反馈配置', 'adminConfigCenter', { action: 'publicHelp', target: 'help_config' }]
    ]

    for (const [name, functionName, data, validate, options] of calls) {
      await test(name, functionName, data, validate, options)
    }

    const adminTest = await test('管理员身份', 'adminOperations', { action: 'getAdminIdentity', payload: {} }, (data) => {
      if (!data || !data.current || !data.current.isAdmin) throw new Error('当前开发者工具身份不是管理员')
      if (!data.hasSuperAdmin) throw new Error('正式环境尚未设置最高管理员')
    }, { allowedCodes: [403], statusForCode: { 403: 'blocked_permission' } })

    if (adminTest.status === 'passed') {
      const adminCalls = [
        ['管理员题库树', 'listCourseTree', {}],
        ['人工授权记录', 'listGrants', {}],
        ['正式小程序码记录', 'getMiniProgramCode', {}]
      ]
      for (const [name, action, payload] of adminCalls) {
        await test(name, 'adminOperations', { action, payload })
      }

      await test(
        '最高管理员用户分页',
        'adminOperations',
        { action: 'listUsers', payload: { page: 1, pageSize: 20 } },
        null,
        { allowedCodes: [403], statusForCode: { 403: 'blocked_permission' } }
      )

      const configTargets = [
        'help_config', 'notification_settings', 'vip_plans', 'ad_slots',
        'punch_quotes', 'punch_backgrounds', 'messages'
      ]
      for (const target of configTargets) {
        await test(`管理员配置：${target}`, 'adminConfigCenter', { action: 'list', target })
      }
    }

    const counts = results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1
      return acc
    }, {})
    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        cloudEnv: 'cloud-2ge02vrucaf8a6ab',
        courseFixture: course ? { id: course._id, name: course.name || '' } : null
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

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
