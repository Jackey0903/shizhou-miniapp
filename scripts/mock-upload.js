#!/usr/bin/env node
/**
 * 模拟题库导入：读取 JSON 文件并按 uploadQuestions 规则校验
 * 用法：node scripts/mock-upload.js samples/questions-demo.json
 */
const fs = require('fs')
const path = require('path')

function validateQuestion(q, index) {
  const required = ['courseId', 'type', 'content', 'answer', 'sort']
  required.forEach((key) => {
    if (!q[key]) {
      throw new Error(`第 ${index + 1} 题缺少必填字段 ${key}`)
    }
  })
  if (q.type === 'choice' && (!Array.isArray(q.options) || q.options.length < 2)) {
    throw new Error(`第 ${index + 1} 题为选择题但未提供足够选项`)
  }
}

async function main(jsonPath) {
  if (!jsonPath) {
    console.error('请指定 JSON 文件路径')
    process.exit(1)
  }
  const resolved = path.resolve(jsonPath)
  const content = fs.readFileSync(resolved, 'utf-8')
  const data = JSON.parse(content)
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('文件内容需为非空数组')
  }
  data.forEach(validateQuestion)
  console.log(`模拟导入 ${data.length} 道题目：`)
  data.forEach((q, idx) => {
    console.log(
      `  [${idx + 1}] courseId=${q.courseId} type=${q.type} content=${q.content.slice(0, 20)}...`
    )
  })
  console.log('校验通过，可复制该 JSON 至云函数 uploadQuestions 云端测试执行。')
}

main(process.argv[2]).catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
