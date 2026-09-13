#!/usr/bin/env node
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const automator = require('miniprogram-automator')

const root = path.resolve(__dirname, '..')
const cli = path.join(root, 'tmp/cloudbase-cli/node_modules/.bin/tcb')
const marker = `qa-config-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
const date = '2999-12-31'
const ids = { old: `${marker}-old`, current: `${marker}-current`, message: `${marker}-message` }
const reportPath = path.join(root, 'tmp/qa-background-config/report.json')

function database(commands) {
  const result = spawnSync(cli, ['db', 'nosql', 'execute', '--json', '--command', JSON.stringify(commands)], {
    cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' }
  })
  if (result.error || result.status !== 0) {
    throw new Error(String(result.error || `${result.stderr} ${result.stdout}`).slice(0, 1200))
  }
  const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')))
  assert(Array.isArray(parsed.data && parsed.data.results), 'Database did not return command results')
  return parsed.data.results
}

function command(table, type, body) {
  return { TableName: table, CommandType: type, Command: JSON.stringify(body) }
}

async function main() {
  const mini = await automator.connect({ wsEndpoint: process.env.MINIPROGRAM_WS_ENDPOINT || 'ws://127.0.0.1:9420' })
  const checks = []
  let inserted = false
  const report = { generatedAt: new Date().toISOString(), marker, checks, cleanup: false }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  const persist = () => fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  const call = (name, data) => mini.evaluate((name, data) => new Promise((resolve, reject) => {
    wx.cloud.callFunction({ name, data, success: (res) => resolve(res.result), fail: reject })
  }), name, data)
  const config = async (action, target, payload) => {
    const result = await call('adminConfigCenter', { action, target, payload })
    assert.equal(result.code, 0, result.msg)
    return result.data
  }
  const active = async () => (await config('publicList', 'punch_backgrounds'))
    .filter((item) => item.activeDate === date).map((item) => item._id).sort()
  const passed = (name) => { checks.push({ name, status: 'passed' }); console.log(`PASS ${name}`); persist() }

  try {
    await config('assertAdmin', 'punch_backgrounds')
    assert.deepEqual(await active(), [], 'Test date is already in use; will not modify it')
    inserted = true
    persist()
    database([
      command('punch_backgrounds', 'INSERT', { insert: 'punch_backgrounds', documents: [
        { _id: ids.old, title: marker, activeDate: date, enabled: false, sort: 1 },
        { _id: ids.current, title: marker, activeDate: date, enabled: true, sort: 2 }
      ] }),
      command('messages', 'INSERT', { insert: 'messages', documents: [
        { _id: ids.message, title: marker, content: 'QA', enabled: false, scope: 'all', sort: Date.now() }
      ] })
    ])

    await config('toggle', 'punch_backgrounds', { id: ids.old, enabled: true })
    assert.deepEqual(await active(), [ids.old])
    passed('重新启用旧背景后，同日期只剩选中的背景')

    await config('save', 'punch_backgrounds', { id: ids.current, title: marker, enabled: false })
    assert.deepEqual(await active(), [ids.old])
    passed('保存停用草稿不影响当前背景')

    await config('save', 'punch_backgrounds', { id: ids.old, title: `${marker}-renamed` })
    assert.deepEqual(await active(), [ids.old])
    await config('toggle', 'punch_backgrounds', { id: ids.current, enabled: true })
    assert.deepEqual(await active(), [ids.current])
    passed('背景局部编辑、切换与生效日期保留')

    for (const length of [500, 1000]) {
      await config('save', 'messages', { id: ids.message, title: marker, content: '测'.repeat(length), enabled: false, scope: 'all' })
      const list = await config('list', 'messages')
      const draft = list.find((item) => item._id === ids.message)
      assert(draft && draft.content.length === length && draft.enabled === false)
    }
    const rejected = await call('adminConfigCenter', {
      action: 'save', target: 'messages',
      payload: { id: ids.message, title: marker, content: '测'.repeat(1001), enabled: false, scope: 'all' }
    })
    assert.notEqual(rejected.code, 0)
    passed('消息500和1000字完整保存，1001字明确拒绝（未群发）')
  } catch (error) {
    checks.push({ name: '云端配置验收', status: 'failed', reason: error.message || String(error) })
    process.exitCode = 1
  } finally {
    try {
      if (inserted) {
        const fixtures = [
          ['punch_backgrounds', [ids.old, ids.current]], ['messages', [ids.message]]
        ]
        database(fixtures.map(([table, values]) => command(table, 'DELETE', {
          delete: table, deletes: [{ q: { _id: { $in: values } }, limit: 0 }]
        })))
        const left = database(fixtures.map(([table, values]) => command(table, 'QUERY', {
          find: table, filter: { _id: { $in: values } }, projection: { _id: 1 }, limit: 10
        })))
        assert(left.every((rows) => Array.isArray(rows) && rows.length === 0), 'Test fixtures remain')
      }
      report.cleanup = true
    } catch (error) {
      report.cleanupError = error.message
      process.exitCode = 1
    }
    persist()
    console.log(JSON.stringify({ checks, cleanup: report.cleanup, report: reportPath }))
    await mini.disconnect()
  }
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1 })
