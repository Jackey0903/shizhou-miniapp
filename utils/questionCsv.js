const CSV_HEADERS = [
  '科目名称', '题库名称', '序号', '题型', '题目',
  '选项A', '选项B', '选项C', '选项D', '答案', '解析', '图片URL'
]

const MAX_QUESTIONS_PER_FILE = 5000
const MAX_FILE_CHARS = 5 * 1024 * 1024

function csvEscape(value) {
  const text = String(value === undefined || value === null ? '' : value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')
}

function buildTemplateCsv() {
  const rows = [
    CSV_HEADERS,
    ['行测', '判断推理', '1', '选择题', '下列哪一项符合题意？', '选项一', '选项二', '选项三', '选项四', 'A', '填写本题解析', ''],
    ['申论', '归纳概括', '2', '填空题', '请概括材料反映的主要问题。', '', '', '', '', '填写参考答案', '填写评分要点', '']
  ]
  return `\uFEFF${rowsToCsv(rows)}\r\n`
}

function parseCsvRows(content) {
  const source = String(content || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"' && cell === '') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (quoted) throw new Error('CSV 存在未闭合的双引号')
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((item) => item.some((value) => String(value || '').trim()))
}

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim()
}

function parseQuestionCsv(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return { questions: [], errors: ['文件内容为空'], totalRows: 0 }
  }
  if (content.length > MAX_FILE_CHARS) {
    return { questions: [], errors: ['CSV 文件过大，单个文件不能超过 5MB'], totalRows: 0 }
  }

  let rows
  try {
    rows = parseCsvRows(content)
  } catch (err) {
    return { questions: [], errors: [err.message || 'CSV 解析失败'], totalRows: 0 }
  }
  if (!rows.length) return { questions: [], errors: ['CSV 文件没有表头'], totalRows: 0 }

  const headers = rows[0].map(normalizeHeader)
  const missingHeaders = CSV_HEADERS.filter((name) => !headers.includes(name))
  const duplicateHeaders = headers.filter((name, index) => name && headers.indexOf(name) !== index)
  if (missingHeaders.length || duplicateHeaders.length) {
    const errors = []
    if (missingHeaders.length) errors.push(`缺少列：${missingHeaders.join('、')}`)
    if (duplicateHeaders.length) errors.push(`重复列：${[...new Set(duplicateHeaders)].join('、')}`)
    return { questions: [], errors, totalRows: Math.max(rows.length - 1, 0) }
  }

  const columnIndex = Object.fromEntries(CSV_HEADERS.map((name) => [name, headers.indexOf(name)]))
  const questions = []
  const errors = []
  const seen = new Set()
  const dataRows = rows.slice(1)
  if (dataRows.length > MAX_QUESTIONS_PER_FILE) {
    return { questions: [], errors: [`单个文件最多 ${MAX_QUESTIONS_PER_FILE} 道题`], totalRows: dataRows.length }
  }

  dataRows.forEach((row, dataIndex) => {
    const rowNumber = dataIndex + 2
    const get = (name) => String(row[columnIndex[name]] || '').trim()
    const subjectName = get('科目名称')
    const bankName = get('题库名称')
    const sortText = get('序号')
    const typeText = get('题型')
    const contentText = get('题目')
    const answerText = get('答案')
    const explanation = get('解析')
    const imageUrl = get('图片URL')
    const rowErrors = []

    if (!subjectName) rowErrors.push('科目名称为空')
    if (subjectName.length > 100) rowErrors.push('科目名称不能超过100个字符')
    if (!bankName) rowErrors.push('题库名称为空')
    if (bankName.length > 100) rowErrors.push('题库名称不能超过100个字符')
    if (!contentText) rowErrors.push('题目为空')
    if (contentText.length > 5000) rowErrors.push('题目不能超过5000个字符')
    if (!['选择题', '填空题'].includes(typeText)) rowErrors.push('题型只能填“选择题”或“填空题”')
    if (!answerText) rowErrors.push('答案为空')
    if (answerText.length > 5000) rowErrors.push('答案不能超过5000个字符')
    if (explanation.length > 10000) rowErrors.push('解析不能超过10000个字符')
    if (imageUrl.length > 1000) rowErrors.push('图片URL不能超过1000个字符')
    if (sortText && (!/^\d+$/.test(sortText) || Number(sortText) < 1)) rowErrors.push('序号必须是正整数')
    if (imageUrl && !/^(https:\/\/|cloud:\/\/)/i.test(imageUrl)) rowErrors.push('图片URL只支持 https:// 或 cloud://')
    if (row.slice(headers.length).some((value) => String(value || '').trim())) {
      rowErrors.push('列数超过固定模板，请检查未加双引号的逗号')
    }

    let options = []
    let correctAnswer = answerText
    if (typeText === '选择题') {
      const optionCells = ['选项A', '选项B', '选项C', '选项D'].map(get)
      if (optionCells.some((value) => value.length > 1000)) rowErrors.push('单个选项不能超过1000个字符')
      let lastOptionIndex = -1
      optionCells.forEach((value, index) => {
        if (value) lastOptionIndex = index
      })
      if (lastOptionIndex < 1) {
        rowErrors.push('选择题至少填写选项A和选项B')
      } else {
        options = optionCells.slice(0, lastOptionIndex + 1)
        if (options.some((value) => !value)) rowErrors.push('选项不能跳列填写')
      }
      correctAnswer = answerText.toUpperCase()
      if (!/^[A-D]$/.test(correctAnswer)) {
        rowErrors.push('选择题答案必须填 A、B、C 或 D')
      } else if (correctAnswer.charCodeAt(0) - 65 >= options.length) {
        rowErrors.push('答案对应的选项未填写')
      }
    }

    const duplicateKey = [subjectName, bankName, typeText, contentText]
      .map((value) => value.replace(/\s+/g, ' '))
      .join('|')
    if (seen.has(duplicateKey)) rowErrors.push('与文件内前面的题目重复')

    if (rowErrors.length) {
      errors.push(`第 ${rowNumber} 行：${rowErrors.join('；')}`)
      return
    }
    seen.add(duplicateKey)
    questions.push({
      _rowNumber: rowNumber,
      subjectName,
      bankName,
      sort: sortText ? Number(sortText) : dataIndex + 1,
      type: typeText === '填空题' ? 'fill' : 'choice',
      content: contentText,
      options,
      correctAnswer,
      answer: typeText === '填空题' ? answerText : '',
      explanation,
      imageUrl
    })
  })

  return { questions, errors, totalRows: dataRows.length }
}

module.exports = {
  CSV_HEADERS,
  MAX_QUESTIONS_PER_FILE,
  buildTemplateCsv,
  parseCsvRows,
  parseQuestionCsv,
  rowsToCsv
}
