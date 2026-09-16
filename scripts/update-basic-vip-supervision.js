const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const automator = require('miniprogram-automator')

async function main() {
  const apply = process.argv.includes('--apply')
  const mini = await automator.connect({ wsEndpoint: process.env.MINIPROGRAM_WS_ENDPOINT || 'ws://127.0.0.1:9420' })
  const call = (name, data) => mini.evaluate((functionName, payload) => new Promise((resolve, reject) => {
    wx.cloud.callFunction({ name: functionName, data: payload, success: (res) => resolve(res.result), fail: reject })
  }), name, data)
  try {
    const account = await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.appId)
    assert.equal(account, 'wxca6ebd21699eca53', 'Wrong mini program')
    const response = await call('adminConfigCenter', { action: 'list', target: 'vip_plans' })
    assert.equal(response.code, 0, response.msg)
    const matches = response.data.filter((plan) => plan.code === 'basic_vip_year')
    assert.equal(matches.length, 1, 'Expected exactly one basic VIP plan')
    const before = matches[0]
    assert.equal(before.price, 19800)
    assert.equal(before.days, 365)
    assert.equal(before.virtualProductId, 'sz_basic_vip_year')
    assert([0, 30].includes(before.supervisionDays), 'Unexpected supervision duration; inspect before changing')
    const benefits = (before.benefits || []).filter((text) => !/免费领取学习资料|督学/.test(text))
    benefits.push('督学包月服务（30天）')
    const payload = { id: before._id, supervisionDays: 30, benefits }
    if (!apply) {
      console.log(JSON.stringify({ apply: false, before, proposed: payload }, null, 2))
      return
    }

    const output = path.resolve(__dirname, '../tmp/basic-vip-supervision-update')
    fs.mkdirSync(output, { recursive: true })
    const reportPath = path.join(output, `${Date.now()}.json`)
    const report = { startedAt: new Date().toISOString(), before, payload, completed: false }
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
    const result = await call('adminConfigCenter', { action: 'save', target: 'vip_plans', payload })
    assert.equal(result.code, 0, result.msg)
    const updated = await call('adminConfigCenter', { action: 'list', target: 'vip_plans' })
    assert.equal(updated.code, 0, updated.msg)
    const after = updated.data.find((plan) => plan._id === before._id)
    assert.deepEqual(after, { ...before, supervisionDays: 30, benefits, updatedAt: after.updatedAt })
    assert.deepEqual(updated.data.filter((plan) => plan.code !== 'basic_vip_year'), response.data.filter((plan) => plan.code !== 'basic_vip_year'))
    const publicResult = await call('createVipOrder', { action: 'plans' })
    assert.equal(publicResult.code, 0, publicResult.msg)
    const publicPlan = publicResult.data.find((plan) => plan.code === 'basic_vip_year')
    assert.equal(publicPlan.supervisionDays, 30)
    assert(publicPlan.benefits.includes('督学包月服务（30天）'))
    Object.assign(report, { completed: true, after, finishedAt: new Date().toISOString() })
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ ok: true, plan: publicPlan, backup: reportPath }, null, 2))
  } finally {
    await mini.disconnect()
  }
}

main().catch((error) => { console.error(error.message || error.errMsg); process.exitCode = 1 })
