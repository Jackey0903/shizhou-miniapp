const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DIR = path.join(ROOT, '先发第一批')
const CONVERTED_DIR = path.join(ROOT, 'tmp/import_first_batch/converted')
const OUTPUT_JSON = path.join(ROOT, 'samples/first-batch-question-import.json')
const OUTPUT_REPORT = path.join(ROOT, 'samples/first-batch-import-report.json')

const SUBJECT_BY_FILE = new Map()

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  let files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files = files.concat(walk(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

function buildSourceIndex() {
  const files = walk(SOURCE_DIR).filter((file) => /\.(wps|doc|docx)$/i.test(file))
  files.forEach((file) => {
    const rel = path.relative(SOURCE_DIR, file)
    const parts = rel.split(path.sep)
    const subject = parts[0]
    const bank = path.basename(file).replace(/\.(wps|doc|docx)$/i, '')
    SUBJECT_BY_FILE.set(bank, {
      subject,
      bank,
      file: path.join('先发第一批', rel)
    })
  })
}

function cleanText(value = '') {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function stripJsonNoise(text = '') {
  return cleanText(text)
    .replace(/^```json\s*/i, '')
    .replace(/^json\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}

function normalizeType(value = '', hasOptions = false) {
  const text = String(value || '').trim()
  if (/选择/.test(text) || hasOptions) return 'choice'
  return 'fill'
}

function buildImportKey(subjectName, bankName, question) {
  return [subjectName, bankName, question['序号'], question['题型'], question['题目']]
    .map((item) => String(item || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('|')
}

function normalizeOptions(raw = '') {
  const text = cleanText(raw)
  if (!text) return []

  const matches = [...text.matchAll(/(?:^|[\n；;]|\s)([A-D])[\.．、]\s*([\s\S]*?)(?=(?:[\n；;]|\s)[A-D][\.．、]\s*|$)/g)]
  const options = matches.map((match) => cleanText(match[2])).filter(Boolean)
  if (options.length >= 2) return options

  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[A-D][\.．、]\s*/, '').trim())
    .filter(Boolean)
}

function pickAnswerLetter(rawAnswer = '', explanation = '') {
  const text = `${rawAnswer}\n${explanation}`
  const correction = text.match(/答案应为\s*([A-D])/i)
  if (correction) return correction[1].toUpperCase()
  const match = String(rawAnswer || '').trim().match(/^[（(]?\s*([A-D])\s*[）)]?/i)
  return match ? match[1].toUpperCase() : ''
}

function field(block, labels) {
  const names = Array.isArray(labels) ? labels : [labels]
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const stopLabels = '题型|题目|题干|母题|选项|答案|参考答案|正确答案|答案与解析|解析|解析思路|材料节选|知识点|勘误|母题来源|题型变体'
  const regex = new RegExp(`(?:^|\\n)\\s*(?:["“]?(${escaped})["”]?\\s*[:：]|【(${escaped})】)\\s*([\\s\\S]*?)(?=\\n\\s*(?:["“]?(?:${stopLabels})["”]?\\s*[:：]|【(?:${stopLabels})】)|$)`)
  const match = block.match(regex)
  return match ? cleanText(match[3]).replace(/[，,]$/, '').replace(/^"|"$/g, '').trim() : ''
}

function parseJsonObjects(text) {
  const questions = []
  const objectMatches = [...text.matchAll(/\{[\s\S]*?\}/g)]
  for (const match of objectMatches) {
    const raw = stripJsonNoise(match[0])
    try {
      const parsed = JSON.parse(raw)
      if (parsed && (parsed['题目'] || parsed['题干'] || parsed.content)) {
        questions.push(parsed)
      }
    } catch (err) {
      // Some source files only look like JSON. Field parsing handles them below.
    }
  }
  return questions
}

function splitBlocks(text) {
  const lines = cleanText(text).split('\n')
  const starts = []

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (/^第\s*\d+\s*题/.test(trimmed)) starts.push(index)
    if (/^第\s*\d+\s*张/.test(trimmed)) starts.push(index)
    if (/^知识点\s*\d+\s*[：:]/.test(trimmed)) starts.push(index)
    if (/^\d+\s*[\.、]\s*$/.test(trimmed)) starts.push(index)
    if (/^\d+\s*[\.、]\s*["“]?题型["”]?\s*[:：]/.test(trimmed)) starts.push(index)
    if (/^[一二三四五六七八九十]{1,3}、/.test(trimmed)) starts.push(index)
  })

  if (starts.length === 0) {
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (/^\s*["“]?题型["”]?\s*[:：]/.test(trimmed)) starts.push(index)
    })
  }

  const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b)
  const blocks = []
  uniqueStarts.forEach((start, index) => {
    const end = uniqueStarts[index + 1] || lines.length
    const block = cleanText(lines.slice(start, end).join('\n'))
    if (block) blocks.push(block)
  })

  return blocks.length ? blocks : [cleanText(text)].filter(Boolean)
}

function splitKnowledgeBlocks(text, bankName) {
  const lines = cleanText(text).split('\n')
  const starts = []
  if (bankName === '类比推理28式') {
    let lastNumber = 0
    lines.forEach((line, index) => {
      const match = line.trim().match(/^(\d+)\.\s+(.+)/)
      const number = match ? Number(match[1]) : 0
      if (number === lastNumber + 1 && number <= 28) {
        starts.push(index)
        lastNumber = number
      }
    })
  }
  if (bankName === '综应20式') {
    lines.forEach((line, index) => {
      if (/^[一二三四五六七八九十]{1,3}、/.test(line.trim())) starts.push(index)
    })
  }
  if (!starts.length) return null
  return [...new Set(starts)].sort((a, b) => a - b).map((start, index, arr) => {
    const end = arr[index + 1] || lines.length
    return cleanText(lines.slice(start, end).join('\n'))
  }).filter(Boolean)
}

function buildKnowledgeQuestion(block, sort) {
  const lines = cleanText(block).split('\n').filter(Boolean)
  const heading = lines[0] || `知识点${sort}`
  const body = cleanText(lines.slice(1).join('\n')) || heading
  return {
    '序号': sort,
    '题型': '填空题',
    '题目': `请学习并掌握：${heading}`,
    '答案': body,
    '解析': body
  }
}

function parseRawQuestion(raw, sort) {
  const block = typeof raw === 'string' ? stripJsonNoise(raw) : ''
  const rawType = typeof raw === 'string' ? field(block, '题型') : raw['题型'] || raw.type || ''
  let title = typeof raw === 'string'
    ? field(block, ['题目', '题干', '母题'])
    : raw['题目'] || raw['题干'] || raw['母题'] || raw.content || raw.title || ''
  const material = typeof raw === 'string' ? field(block, '材料节选') : raw['材料节选'] || ''
  const knowledge = typeof raw === 'string' ? field(block, '知识点') : raw['知识点'] || ''
  const explanationRaw = typeof raw === 'string' ? field(block, ['解析', '解析思路']) : raw['解析'] || raw['解析思路'] || raw.explanation || ''
  const optionsRaw = typeof raw === 'string' ? field(block, '选项') : raw['选项'] || raw.options || ''
  const answerRaw = typeof raw === 'string'
    ? field(block, ['答案', '参考答案', '正确答案', '答案与解析'])
    : raw['答案'] || raw['参考答案'] || raw['正确答案'] || raw['答案与解析'] || raw.answer || raw.correctAnswer || ''
  const correction = typeof raw === 'string' ? field(block, '勘误') : raw['勘误'] || ''
  let options = Array.isArray(optionsRaw) ? optionsRaw.map((item) => cleanText(item)).filter(Boolean) : normalizeOptions(optionsRaw)
  if (options.length < 2 && typeof raw === 'string') {
    options = normalizeOptions(title)
    if (options.length >= 2) {
      title = cleanText(title.replace(/\n\s*A[\.．、][\s\S]*$/i, ''))
    }
  }
  const type = normalizeType(rawType, options.length >= 2)
  const contentParts = [title]
  if (material) contentParts.push(`材料节选：${material}`)
  const content = cleanText(contentParts.join('\n\n'))

  if (!content) {
    if (typeof raw === 'string') return buildKnowledgeQuestion(block, sort)
    throw new Error('题干为空')
  }

  const explanationParts = []
  if (knowledge) explanationParts.push(`知识点：${knowledge}`)
  if (explanationRaw) explanationParts.push(explanationRaw)
  if (correction) explanationParts.push(`勘误：${correction}`)
  const explanation = cleanText(explanationParts.join('\n\n'))

  if (type === 'choice') {
    const letter = pickAnswerLetter(answerRaw, correction || explanationRaw)
    const correctIndex = letter ? letter.charCodeAt(0) - 65 : -1
    if (options.length < 2 || correctIndex < 0 || correctIndex >= options.length) {
      const answer = cleanText(answerRaw || knowledge || explanationRaw)
      if (!answer) return buildKnowledgeQuestion(block, sort)
      return {
        '序号': sort,
        '题型': '填空题',
        '题目': content,
        '答案': answer,
        '解析': explanation
      }
    }
    return {
      '序号': sort,
      '题型': '选择题',
      '题目': content,
      '选项': options,
      '答案': letter,
      '解析': explanation
    }
  }

  const answer = cleanText(answerRaw || knowledge || explanationRaw)
  if (!answer) {
    throw new Error('填空题答案为空')
  }

  return {
    '序号': sort,
    '题型': '填空题',
    '题目': content,
    '答案': answer,
    '解析': explanation
  }
}

function parseFile(txtPath) {
  const bankName = path.basename(txtPath, '.txt')
  const meta = SUBJECT_BY_FILE.get(bankName) || {
    subject: '综合题库',
    bank: bankName,
    file: path.relative(ROOT, txtPath)
  }
  const text = cleanText(fs.readFileSync(txtPath, 'utf8'))
  const jsonObjects = parseJsonObjects(text)
  const rawBlocks = splitKnowledgeBlocks(text, bankName) || (jsonObjects.length >= 5 ? jsonObjects : splitBlocks(text))
  const questions = []
  const failed = []

  rawBlocks.forEach((block, index) => {
    try {
      questions.push(parseRawQuestion(block, questions.length + 1))
    } catch (err) {
      failed.push({
        index: index + 1,
        reason: err.message,
        preview: cleanText(typeof block === 'string' ? block : JSON.stringify(block)).slice(0, 160)
      })
    }
  })

  return {
    meta,
    blocks: rawBlocks.length,
    questions,
    failed
  }
}

function main() {
  buildSourceIndex()
  const txtFiles = walk(CONVERTED_DIR).filter((file) => file.endsWith('.txt')).sort((a, b) => {
    const aMeta = SUBJECT_BY_FILE.get(path.basename(a, '.txt'))
    const bMeta = SUBJECT_BY_FILE.get(path.basename(b, '.txt'))
    return `${aMeta ? aMeta.file : a}`.localeCompare(`${bMeta ? bMeta.file : b}`, 'zh-Hans-CN')
  })

  const banks = txtFiles.map(parseFile)
  const importData = {
    '说明': '第一批题库导入包。管理员在题目录入页选择本 JSON，可按科目名称和题库名称自动创建并导入题目。',
    '题库列表': banks.map((item) => ({
      '科目名称': item.meta.subject,
      '题库名称': item.meta.bank,
      '题目列表': item.questions.map((question) => ({
        ...question,
        importKey: buildImportKey(item.meta.subject, item.meta.bank, question)
      }))
    }))
  }

  const report = {
    totalBanks: banks.length,
    totalQuestions: banks.reduce((sum, item) => sum + item.questions.length, 0),
    totalFailed: banks.reduce((sum, item) => sum + item.failed.length, 0),
    banks: banks.map((item) => ({
      file: item.meta.file,
      subject: item.meta.subject,
      bank: item.meta.bank,
      blocks: item.blocks,
      imported: item.questions.length,
      choiceCount: item.questions.filter((question) => question['题型'] === '选择题').length,
      fillCount: item.questions.filter((question) => question['题型'] === '填空题').length,
      failedCount: item.failed.length,
      failed: item.failed
    }))
  }

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true })
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(importData, null, 2)}\n`)
  fs.writeFileSync(OUTPUT_REPORT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote ${OUTPUT_JSON}`)
  console.log(`Wrote ${OUTPUT_REPORT}`)
  console.log(`Banks: ${report.totalBanks}, questions: ${report.totalQuestions}, failed: ${report.totalFailed}`)
}

main()
