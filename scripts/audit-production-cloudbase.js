#!/usr/bin/env node
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const envId = process.env.TCB_ENV_ID || 'cloud-2ge02vrucaf8a6ab'
const bundledCli = path.join(root, 'tmp', 'cloudbase-cli', 'node_modules', '.bin', 'tcb')
const cli = process.env.TCB_CLI || (fs.existsSync(bundledCli) ? bundledCli : 'tcb')
const outputDir = path.join(root, 'tmp', 'qa-production-cloudbase')

function parseJson(output) {
  const indexes = [output.indexOf('{'), output.indexOf('[')].filter((item) => item >= 0)
  if (!indexes.length) throw new Error('命令未返回 JSON')
  return JSON.parse(output.slice(Math.min(...indexes)))
}

function runJson(args) {
  const result = childProcess.spawnSync(cli, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' }
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || `命令退出码 ${result.status}`)
      .replace(/\s+/g, ' ')
      .slice(0, 1200)
    throw new Error(message)
  }
  return parseJson(result.stdout)
}

function unwrap(value) {
  if (Array.isArray(value)) return value.map(unwrap)
  if (!value || typeof value !== 'object') return value
  if ('$numberInt' in value) return Number(value.$numberInt)
  if ('$numberLong' in value) return Number(value.$numberLong)
  if ('$numberDouble' in value) return Number(value.$numberDouble)
  if ('$date' in value) return unwrap(value.$date)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrap(item)]))
}

function executeDatabase(commands) {
  const response = runJson([
    'db', 'nosql', 'execute', '--json', '--command', JSON.stringify(commands)
  ])
  return unwrap(response.data && response.data.results)
}

function query(table, filter, projection, limit = 500) {
  const command = {
    find: table,
    filter,
    projection,
    limit
  }
  const results = executeDatabase([{
    TableName: table,
    CommandType: 'QUERY',
    Command: JSON.stringify(command)
  }])
  return (results && results[0]) || []
}

function countCollections(names) {
  const commands = names.map((name) => ({
    TableName: name,
    CommandType: 'COMMAND',
    Command: JSON.stringify({ count: name, query: {} })
  }))
  const results = executeDatabase(commands)
  return Object.fromEntries(names.map((name, index) => [name, Number(results[index][0].n || 0)]))
}

function environmentMap(detail) {
  const environment = detail && detail.data && detail.data.Environment
  const variables = environment && Array.isArray(environment.Variables) ? environment.Variables : []
  return Object.fromEntries(variables.map((item) => [item.Key, item.Value]))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const checks = []
  const warnings = []

  function check(name, fn) {
    const startedAt = Date.now()
    try {
      const detail = fn() || null
      checks.push({ name, status: 'passed', detail, durationMs: Date.now() - startedAt })
      console.log(`PASS ${name}`)
      return detail
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        reason: String(error && (error.message || error)).replace(/\s+/g, ' ').slice(0, 1200),
        durationMs: Date.now() - startedAt
      })
      console.log(`FAIL ${name}`)
      return null
    }
  }

  check('正式云环境可用', () => {
    const response = runJson(['env', 'list', '--json'])
    const environments = response.data || []
    const current = environments.find((item) => item.envId === envId)
    assert(current, `未找到云环境 ${envId}`)
    assert(String(current.status).toUpperCase() === 'NORMAL', `云环境状态异常：${current.status}`)
    return { envId: current.envId, packageName: current.packageName, status: current.status }
  })

  check('核心云函数全部部署', () => {
    const response = runJson(['fn', 'list', '-l', '200', '--json'])
    const functions = response.data || []
    const required = [
      'userLogin', 'getCourses', 'getCourse', 'getQuestions', 'submitAnswer', 'savePlan', 'checkin',
      'grantCoinReward', 'exchangeMaterial', 'getMaterials', 'uploadQuestions', 'uploadMaterials',
      'uploadAudios', 'uploadWallpapers', 'createVipOrder', 'queryVipOrder', 'vipPayCallback',
      'adminOperations', 'adminConfigCenter', 'messageCenter', 'studyReminderCenter', 'supervisionMatch'
    ]
    const byName = new Map(functions.map((item) => [item.name, item]))
    const missing = required.filter((name) => !byName.has(name))
    assert(!missing.length, `缺少云函数：${missing.join('、')}`)
    const incomplete = required.filter((name) => !/completed/i.test(String(byName.get(name).status || '')))
    assert(!incomplete.length, `云函数尚未部署完成：${incomplete.join('、')}`)
    return { deployed: functions.length, required: required.length }
  })

  check('正式虚拟支付环境变量', () => {
    const detail = runJson(['fn', 'detail', 'createVipOrder', '--json'])
    const variables = environmentMap(detail)
    const required = ['VIRTUAL_PAY_ENV', 'VIRTUAL_PAY_OFFER_ID', 'VIRTUAL_PAY_PROD_APP_KEY', 'WECHAT_APP_SECRET']
    const missing = required.filter((key) => !String(variables[key] || '').trim())
    assert(!missing.length, `缺少支付环境变量：${missing.join('、')}`)
    assert(String(variables.VIRTUAL_PAY_ENV) === '0', 'VIRTUAL_PAY_ENV 必须为正式环境 0')
    return { env: '0', requiredVariablesPresent: true }
  })

  check('虚拟支付套餐与已发布道具一致', () => {
    const plans = query('vip_plans', {}, {
      _id: 1,
      code: 1,
      name: 1,
      price: 1,
      days: 1,
      supervisionDays: 1,
      virtualProductId: 1,
      enabled: 1
    }, 20)
    const expected = {
      basic_vip_year: { price: 19800, days: 365, supervisionDays: 0, virtualProductId: 'sz_basic_vip_year' },
      supervision_trial_day: { price: 800, days: 365, supervisionDays: 1, virtualProductId: 'sz_supervision_1d' },
      supervision_month: { price: 19800, days: 365, supervisionDays: 30, virtualProductId: 'sz_supervision_mon' },
      premium_vip_year: { price: 98800, days: 365, supervisionDays: 365, virtualProductId: 'sz_premium_vip_year' }
    }
    const byCode = new Map(plans.map((item) => [item.code, item]))
    assert(plans.length === 4, `vip_plans 应为 4 条，实际 ${plans.length} 条`)
    for (const [code, fields] of Object.entries(expected)) {
      const plan = byCode.get(code)
      assert(plan, `缺少套餐 ${code}`)
      assert(plan.enabled === true, `套餐 ${code} 未启用`)
      for (const [field, expectedValue] of Object.entries(fields)) {
        assert(plan[field] === expectedValue, `套餐 ${code} 的 ${field} 错误`)
      }
    }
    return { plans: Object.keys(expected) }
  })

  check('订单号、正式环境与权益发放一致', () => {
    const orders = query('orders', {}, {
      _id: 1,
      outTradeNo: 1,
      planCode: 1,
      status: 1,
      virtualPayEnv: 1,
      benefitsGranted: 1,
      deliveryStatus: 1,
      createdAt: 1
    })
    const tradeNos = orders.map((item) => item.outTradeNo).filter(Boolean)
    const duplicates = tradeNos.filter((value, index) => tradeNos.indexOf(value) !== index)
    assert(!duplicates.length, '订单库存在重复商户订单号')
    const officialOrders = orders.filter((item) => item.virtualPayEnv !== undefined && item.virtualPayEnv !== null)
    assert(officialOrders.length > 0, '未找到官方虚拟支付订单')
    assert(officialOrders.every((item) => Number(item.virtualPayEnv) === 0), '订单库仍存在沙箱支付订单')
    const paidOrders = orders.filter((item) => item.status === 'paid')
    assert(paidOrders.length > 0, '正式库尚无支付成功订单')
    const missingBenefits = paidOrders.filter((item) => item.benefitsGranted !== true)
    assert(!missingBenefits.length, `有 ${missingBenefits.length} 笔已支付订单未发放权益`)
    return {
      total: orders.length,
      official: officialOrders.length,
      paid: paidOrders.length,
      pending: orders.filter((item) => item.status === 'pending').length,
      legacy: orders.length - officialOrders.length
    }
  })

  check('管理员角色与最高管理员', () => {
    const users = query('users', {}, {
      _id: 1,
      phone: 1,
      role: 1,
      isAdmin: 1,
      isSuperAdmin: 1
    })
    const superAdmins = users.filter((item) => item.isSuperAdmin === true || item.role === 'super_admin')
    const admins = users.filter((item) => item.isAdmin === true || item.role === 'admin' || item.role === 'super_admin')
    assert(superAdmins.length === 1, `最高管理员应为 1 人，实际 ${superAdmins.length} 人`)
    assert(superAdmins[0].phone === '15058073343', '最高管理员手机号不是 15058073343')
    for (const phone of ['13950786351', '18396005105']) {
      assert(admins.some((item) => item.phone === phone), `普通管理员 ${phone} 未生效`)
    }
    const boundUsers = users.filter((item) => /^\d{6,20}$/.test(String(item.phone || '')))
    const unboundUsers = users.length - boundUsers.length
    return {
      totalUsers: users.length,
      boundUsers: boundUsers.length,
      unboundUsers,
      superAdminPhone: superAdmins[0].phone,
      adminPhones: admins.map((item) => item.phone).filter(Boolean).sort()
    }
  })

  check('手机号唯一性保护', () => {
    const users = query('users', {}, { _id: 1, phone: 1 })
    const boundUsers = users.filter((item) => /^\d{6,20}$/.test(String(item.phone || '')))
    const phones = boundUsers.map((item) => String(item.phone))
    const duplicates = phones.filter((phone, index) => phones.indexOf(phone) !== index)
    assert(!duplicates.length, `正式库存在重复手机号：${[...new Set(duplicates)].join('、')}`)
    const counts = countCollections(['phone_identities'])
    if (counts.phone_identities < boundUsers.length) {
      warnings.push({
        name: '历史手机号锁待补齐',
        detail: `已绑定 ${boundUsers.length} 个手机号，唯一锁 ${counts.phone_identities} 条；用户下次登录时会自动补齐`
      })
    }
    return { boundUsers: boundUsers.length, identityLocks: counts.phone_identities, duplicates: 0 }
  })

  check('正式内容数据可用', () => {
    const counts = countCollections([
      'subjects', 'question_banks', 'questions', 'materials', 'audios', 'wallpapers',
      'plans', 'checkins', 'orders', 'ad_slots'
    ])
    for (const name of ['subjects', 'question_banks', 'questions', 'materials', 'audios', 'wallpapers']) {
      assert(counts[name] > 0, `正式集合 ${name} 为空`)
    }
    return counts
  })

  const failed = checks.filter((item) => item.status === 'failed')
  const report = {
    generatedAt: new Date().toISOString(),
    environmentId: envId,
    mode: 'read-only',
    counts: { passed: checks.length - failed.length, failed: failed.length, warnings: warnings.length },
    checks,
    warnings
  }
  fs.mkdirSync(outputDir, { recursive: true })
  const reportPath = path.join(outputDir, 'report.json')
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ counts: report.counts, report: reportPath }, null, 2))
  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
