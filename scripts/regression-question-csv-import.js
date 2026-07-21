const assert = require('assert')
const questionCsv = require('../utils/questionCsv')

function testTemplateRoundTrip() {
  const result = questionCsv.parseQuestionCsv(questionCsv.buildTemplateCsv())
  assert.deepStrictEqual(result.errors, [])
  assert.strictEqual(result.questions.length, 2)
  assert.strictEqual(result.totalRows, 2)
  assert.strictEqual(result.questions[0].type, 'choice')
  assert.strictEqual(result.questions[0].correctAnswer, 'A')
  assert.strictEqual(result.questions[1].type, 'fill')
}

function testQuotedCommaAndNewline() {
  const csv = [
    questionCsv.CSV_HEADERS.join(','),
    '行测,言语理解,1,选择题,"题干包含逗号,和换行\n第二行",A项,B项,,,B,"解析,也有逗号",'
  ].join('\r\n')
  const result = questionCsv.parseQuestionCsv(csv)
  assert.deepStrictEqual(result.errors, [])
  assert.strictEqual(result.questions.length, 1)
  assert(result.questions[0].content.includes('\n第二行'))
  assert.strictEqual(result.questions[0].options.length, 2)
  assert.strictEqual(result.questions[0].correctAnswer, 'B')
}

function testValidationReportsRowNumbers() {
  const csv = [
    questionCsv.CSV_HEADERS.join(','),
    '行测,判断推理,1,选择题,测试题,A项,,C项,,D,,',
    '行测,判断推理,2,选择题,测试题,A项,B项,,,A,,'
  ].join('\r\n')
  const result = questionCsv.parseQuestionCsv(csv)
  assert.strictEqual(result.questions.length, 1)
  assert(result.errors.some((message) => message.includes('第 2 行')))
  assert(result.errors.some((message) => message.includes('选项不能跳列')))
}

function testMissingFixedHeaderIsRejected() {
  const csv = '科目名称,题库名称,题型,题目,答案\n行测,判断,填空题,题干,答案'
  const result = questionCsv.parseQuestionCsv(csv)
  assert.strictEqual(result.questions.length, 0)
  assert(result.errors[0].includes('缺少列'))
}

function testDuplicateQuestionIsRejected() {
  const csv = [
    questionCsv.CSV_HEADERS.join(','),
    '申论,概括,1,填空题,同一题干,,,,,答案一,,',
    '申论,概括,2,填空题,同一题干,,,,,答案二,,'
  ].join('\r\n')
  const result = questionCsv.parseQuestionCsv(csv)
  assert.strictEqual(result.questions.length, 1)
  assert(result.errors.some((message) => message.includes('重复')))
}

function testUnquotedOverflowColumnIsRejected() {
  const csv = [
    questionCsv.CSV_HEADERS.join(','),
    ['行测', '判断推理', '1', '填空题', '题干', '', '', '', '', '答案', '', '', '多余内容'].join(',')
  ].join('\r\n')
  const result = questionCsv.parseQuestionCsv(csv)
  assert.strictEqual(result.questions.length, 0)
  assert(result.errors.some((message) => message.includes('列数超过固定模板')))
}

function main() {
  testTemplateRoundTrip()
  testQuotedCommaAndNewline()
  testValidationReportsRowNumbers()
  testMissingFixedHeaderIsRejected()
  testDuplicateQuestionIsRejected()
  testUnquotedOverflowColumnIsRejected()
  console.log('question CSV import regression checks passed')
}

main()
