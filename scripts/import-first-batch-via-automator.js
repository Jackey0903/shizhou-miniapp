#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const ROOT = path.resolve(__dirname, '..')
const CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const JSON_PATH = path.join(ROOT, 'samples/first-batch-question-import.json')

function toPayload(data) {
  const list = []
  data['题库列表'].forEach((bank) => {
    const subjectName = bank['科目名称']
    const bankName = bank['题库名称']
    bank['题目列表'].forEach((question) => {
      const type = question['题型'] === '选择题' ? 'choice' : 'fill'
      const item = {
        subjectName,
        categoryName: subjectName,
        bankName,
        courseName: bankName,
        importKey: question.importKey,
        type,
        sort: Number(question['序号']) || 1,
        content: question['题目'],
        explanation: question['解析'] || ''
      }
      if (type === 'choice') {
        const answer = String(question['答案'] || '').trim().toUpperCase()
        item.options = question['选项'] || []
        item.correctIndex = answer.charCodeAt(0) - 65
      } else {
        item.answer = question['答案']
      }
      list.push(item)
    })
  })
  return list
}

async function callCloud(miniProgram, name, data) {
  return miniProgram.evaluate((functionName, payload) => new Promise((resolve) => {
    wx.cloud.callFunction({
      name: functionName,
      data: payload,
      success: (res) => resolve({ ok: true, result: res.result }),
      fail: (err) => resolve({ ok: false, errMsg: err.errMsg || err.message || String(err) })
    })
  }), name, data)
}

function isTimeout(message = '') {
  return /time limit|TIME_LIMIT|timed out|超时/i.test(message)
}

async function uploadBatch(miniProgram, batch, offset, total) {
  const res = await callCloud(miniProgram, 'uploadQuestions', { questions: batch })
  if (res.ok && res.result && res.result.code === 0) {
    return res.result
  }
  const msg = (res.result && res.result.msg) || res.errMsg || '导入失败'
  if (batch.length > 1 && isTimeout(msg)) {
    const mid = Math.ceil(batch.length / 2)
    await uploadBatch(miniProgram, batch.slice(0, mid), offset, total)
    return uploadBatch(miniProgram, batch.slice(mid), offset + mid, total)
  }
  throw new Error(`第 ${offset + 1}-${offset + batch.length} 题失败：${msg}`)
}

async function main() {
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
  const questions = toPayload(data)
  const total = questions.length
  console.log(`准备导入 ${data['题库列表'].length} 个题库、${total} 道题`)

  const miniProgram = await automator.connect({
    wsEndpoint: 'ws://127.0.0.1:9420'
  }).catch(async () => automator.launch({
    cliPath: CLI_PATH,
    projectPath: ROOT,
    port: 9420,
    trustProject: true
  }))

  try {
    const batchSize = 5
    for (let index = 0; index < total; index += batchSize) {
      const batch = questions.slice(index, index + batchSize)
      await uploadBatch(miniProgram, batch, index, total)
      if ((index + batch.length) % 50 === 0 || index + batch.length === total) {
        console.log(`已导入/校验 ${index + batch.length}/${total}`)
      }
    }

    const coursesRes = await callCloud(miniProgram, 'getCourses', {})
    const courses = (coursesRes.result && coursesRes.result.data) || []
    const missing = []
    data['题库列表'].forEach((bank) => {
      const expected = bank['题目列表'].length
      const matched = courses.find((item) => item.name === bank['题库名称'] && (item.subjectName || item.category) === bank['科目名称'])
      if (!matched || Number(matched.totalCount || 0) < expected) {
        missing.push({
          subject: bank['科目名称'],
          bank: bank['题库名称'],
          expected,
          actual: matched ? Number(matched.totalCount || 0) : 0
        })
      }
    })

    if (missing.length) {
      throw new Error(`导入后校验未通过：${JSON.stringify(missing.slice(0, 10))}`)
    }
    console.log('导入完成并通过题库数量校验')
  } finally {
    if (miniProgram.disconnect) miniProgram.disconnect()
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
