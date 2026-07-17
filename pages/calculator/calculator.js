const RESULT_DEFS = [
  { key: 'baseA', label: "基期A'", color: 'green', unitHint: '' },
  { key: 'growthA', label: '增长量x1', color: 'green', unitHint: '' },
  { key: 'baseB', label: "基期B'", color: 'gold', unitHint: '' },
  { key: 'growthB', label: '增长量x2', color: 'gold', unitHint: '' },
  { key: 'weightP', label: '现期比重P', color: 'blue', unitHint: '%' },
  { key: 'baseWeight', label: "基期比重P'", color: 'blue', unitHint: '%' },
  { key: 'weightDiff', label: '两期比重差d', color: 'blue', unitHint: '百分点' },
  { key: 'ratioGrowth', label: '比值增长率k', color: 'blue', unitHint: '%' },
  { key: 'sumBase', label: '基期和S', color: 'purple', unitHint: '' },
  { key: 'diffBase', label: '基期差D', color: 'purple', unitHint: '' },
  { key: 'yearGrowth', label: '隔年增长率r', color: 'purple', unitHint: '%' },
  { key: 'sumGrowth', label: 'AB和增长率r3', color: 'purple', unitHint: '%' },
  { key: 'diffGrowth', label: 'AB差增长率r4', color: 'purple', unitHint: '%' }
]

const FORMULA_MAP = {
  currentA: {
    title: '现期A',
    lines: ['现期A：材料给出的当前期数值。', '通常直接读取材料中的现期量。'],
    note: '随机模式由系统给题，自定义模式可手动输入。'
  },
  currentB: {
    title: '现期B',
    lines: ['现期B：材料给出的当前期对比量。', '通常作为分母、总量或另一指标使用。'],
    note: '随机模式由系统给题，自定义模式可手动输入。'
  },
  rate1: {
    title: '增长率r1',
    lines: ['增长率r1 = (现期A - 基期A) / 基期A', '输入时直接写百分数，如 12.5 表示 12.5%。'],
    note: '负值表示下降。'
  },
  rate2: {
    title: '增长率r2',
    lines: ['增长率r2 = (现期B - 基期B) / 基期B', '输入时直接写百分数，如 -8 表示 -8%。'],
    note: '负值表示下降。'
  },
  baseA: {
    title: "基期A'",
    lines: ["基期A = 现期A / (1 + r1)", "等价：基期A' = 现期A ÷ (1 + r1)"],
    note: 'r1 用小数参与计算，10% 要按 0.1 代入。'
  },
  growthA: {
    title: '增长量x1',
    lines: ['增长量x1 = 现期A - 基期A', '等价：增长量x1 = 现期A × r1 / (1 + r1)'],
    note: '结果可正可负。'
  },
  baseB: {
    title: "基期B'",
    lines: ["基期B = 现期B / (1 + r2)", "等价：基期B' = 现期B ÷ (1 + r2)"],
    note: 'r2 用小数参与计算。'
  },
  growthB: {
    title: '增长量x2',
    lines: ['增长量x2 = 现期B - 基期B', '等价：增长量x2 = 现期B × r2 / (1 + r2)'],
    note: '结果可正可负。'
  },
  weightP: {
    title: '现期比重P',
    lines: ['现期比重P = 现期A / 现期B', '百分数展示时：P = 现期A / 现期B × 100%'],
    note: '结果按百分数填写。'
  },
  baseWeight: {
    title: "基期比重P'",
    lines: ["基期比重P' = 基期A / 基期B", "等价：P' = (现期A / 现期B) × ((1 + r2) / (1 + r1))"],
    note: '结果按百分数填写。'
  },
  weightDiff: {
    title: '两期比重差d',
    lines: ['两期比重差d = 现期比重P - 基期比重P′', '等价：d = (现期A / 现期B) × ((r1 - r2) / (1 + r1))'],
    note: '单位是百分点，不是百分比。'
  },
  ratioGrowth: {
    title: '比值增长率k',
    lines: ['比值增长率k = (现期比重 / 基期比重) - 1', '等价：k = (r1 - r2) / (1 + r2)'],
    note: '适用于“A是B的几倍”这类比值增长率。'
  },
  sumBase: {
    title: '基期和S',
    lines: ['基期和S = 基期A + 基期B', "等价：S = 现期A/(1+r1) + 现期B/(1+r2)"],
    note: '结果为普通数值。'
  },
  diffBase: {
    title: '基期差D',
    lines: ['基期差D = 基期A - 基期B', "等价：D = 现期A/(1+r1) - 现期B/(1+r2)"],
    note: '按 A - B 的顺序，结果有正负。'
  },
  yearGrowth: {
    title: '隔年增长率r',
    lines: ['隔年增长率r = r1 + r2 + r1 × r2'],
    note: 'r1、r2 按小数代入，结果再转百分数。'
  },
  sumGrowth: {
    title: 'AB和增长率r3',
    lines: ['AB和增长率r3 = (现期A + 现期B) / (基期A + 基期B) - 1'],
    note: '按视频口径使用该公式。'
  },
  diffGrowth: {
    title: 'AB差增长率r4',
    lines: ['AB差增长率r4 = (现期A - 现期B) / (基期A - 基期B) - 1'],
    note: '按视频口径使用该公式，注意分母不可为 0。'
  }
}

function createEmptyRows() {
  return RESULT_DEFS.map((item) => ({
    ...item,
    answer: '',
    valueText: '',
    feedbackText: '',
    statusClass: ''
  }))
}

function parseInputNumber(value) {
  if (value === null || value === undefined) return NaN
  const text = String(value)
    .replace(/个百分点/g, '')
    .replace(/%/g, '')
    .replace(/，/g, ',')
    .replace(/,/g, '')
    .trim()
  if (!text) return NaN
  return Number(text)
}

function formatPlain(value) {
  if (!Number.isFinite(value)) return '无法计算'
  return Number(value).toFixed(2)
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '无法计算'
  return `${Number(value).toFixed(2)}%`
}

function formatPoint(value) {
  if (!Number.isFinite(value)) return '无法计算'
  return `${Number(value).toFixed(2)}个百分点`
}

function formatTopValue(value) {
  if (!Number.isFinite(value)) return ''
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function compareWithTolerance(expected, actual) {
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false
  const base = Math.max(Math.abs(expected), 1)
  return Math.abs(actual - expected) <= base * 0.05
}

function randomBetween(min, max, step) {
  const count = Math.round((max - min) / step)
  const index = Math.floor(Math.random() * (count + 1))
  return Number((min + index * step).toFixed(1))
}

function generateRandomSource() {
  for (let i = 0; i < 200; i += 1) {
    const a = Math.floor(Math.random() * 700) + 180
    const b = Math.floor(Math.random() * 700) + 180
    const r1 = randomBetween(-45, 65, 0.1)
    const r2 = randomBetween(-30, 45, 0.1)
    const d1 = 1 + r1 / 100
    const d2 = 1 + r2 / 100
    if (d1 <= 0.1 || d2 <= 0.1 || b === 0) continue
    const baseA = a / d1
    const baseB = b / d2
    if (!Number.isFinite(baseA) || !Number.isFinite(baseB)) continue
    if (Math.abs(baseA - baseB) < 18) continue
    return {
      a: formatTopValue(a),
      b: formatTopValue(b),
      r1: formatTopValue(r1),
      r2: formatTopValue(r2)
    }
  }
  return { a: '360', b: '520', r1: '12.5', r2: '8.4' }
}

function computeMetrics(source) {
  const A = parseInputNumber(source.a)
  const B = parseInputNumber(source.b)
  const r1Pct = parseInputNumber(source.r1)
  const r2Pct = parseInputNumber(source.r2)

  if (![A, B, r1Pct, r2Pct].every(Number.isFinite)) {
    return { ok: false, message: '请先填写现期A、现期B、增长率r1、增长率r2' }
  }

  if (B === 0) {
    return { ok: false, message: '现期B不能为0' }
  }

  const r1 = r1Pct / 100
  const r2 = r2Pct / 100
  if (1 + r1 === 0 || 1 + r2 === 0) {
    return { ok: false, message: '增长率不能为 -100%' }
  }

  const baseA = A / (1 + r1)
  const baseB = B / (1 + r2)
  const sumBase = baseA + baseB
  const diffBase = baseA - baseB
  if (sumBase === 0) {
    return { ok: false, message: '基期和为0，当前数据无法计算' }
  }
  if (diffBase === 0) {
    return { ok: false, message: '基期差为0，当前数据无法计算AB差增长率' }
  }

  const growthA = A - baseA
  const growthB = B - baseB
  const weightP = (A / B) * 100
  const baseWeight = (baseA / baseB) * 100
  const weightDiff = weightP - baseWeight
  const ratioGrowth = ((r1 - r2) / (1 + r2)) * 100
  const yearGrowth = (r1 + r2 + r1 * r2) * 100
  const sumGrowth = (((A + B) / sumBase) - 1) * 100
  const diffGrowth = (((A - B) / diffBase) - 1) * 100

  return {
    ok: true,
    values: {
      baseA,
      growthA,
      baseB,
      growthB,
      weightP,
      baseWeight,
      weightDiff,
      ratioGrowth,
      sumBase,
      diffBase,
      yearGrowth,
      sumGrowth,
      diffGrowth
    }
  }
}

Page({
  data: {
    mode: 'random',
    a: '',
    b: '',
    r1: '',
    r2: '',
    rows: createEmptyRows(),
    scoreText: '',
    formulaVisible: false,
    formulaTitle: '',
    formulaLines: [],
    formulaNote: '',
    submitted: false
  },

  noop() {},

  onLoad() {
    this.resetForMode('random', false)
  },

  buildRowsAfterSubmit(values) {
    const rows = this.data.rows.map((row) => {
      const expected = values[row.key]
      const answerNum = parseInputNumber(row.answer)
      const answered = String(row.answer || '').trim() !== ''
      let feedbackText = '未作答'
      let statusClass = 'pending'
      if (answered) {
        feedbackText = `你: ${String(row.answer).trim()}`
        statusClass = compareWithTolerance(expected, answerNum) ? 'correct' : 'wrong'
      }

      let valueText = formatPlain(expected)
      if (row.key === 'weightP' || row.key === 'baseWeight' || row.key === 'ratioGrowth' || row.key === 'yearGrowth' || row.key === 'sumGrowth' || row.key === 'diffGrowth') {
        valueText = formatPercent(expected)
      } else if (row.key === 'weightDiff') {
        valueText = formatPoint(expected)
      }

      return {
        ...row,
        valueText,
        feedbackText,
        statusClass
      }
    })

    const answeredRows = rows.filter((row) => String(row.answer || '').trim() !== '')
    const score = answeredRows.filter((row) => row.statusClass === 'correct').length
    return {
      rows,
      scoreText: `得分：${score}/${answeredRows.length}`
    }
  },

  hasDraft() {
    const sourceDirty = ['a', 'b', 'r1', 'r2'].some((key) => String(this.data[key] || '').trim() !== '')
    const answerDirty = this.data.rows.some((row) => String(row.answer || '').trim() !== '')
    return sourceDirty || answerDirty || this.data.submitted
  },

  resetForMode(mode, withConfirm = true) {
    const doReset = () => {
      const nextSource = mode === 'random' ? generateRandomSource() : { a: '', b: '', r1: '', r2: '' }
      this.setData({
        mode,
        ...nextSource,
        rows: createEmptyRows(),
        submitted: false,
        scoreText: '',
        formulaVisible: false
      })
    }

    if (!withConfirm || !this.hasDraft()) {
      doReset()
      return
    }

    wx.showModal({
      title: '确认',
      content: '确定要刷新数据吗？这将清空所有已输入的答案。',
      success: (res) => {
        if (res.confirm) doReset()
      }
    })
  },

  setMode(e) {
    const nextMode = e.currentTarget.dataset.mode
    if (!nextMode || nextMode === this.data.mode) return
    this.resetForMode(nextMode)
  },

  refreshData() {
    this.resetForMode(this.data.mode)
  },

  onSourceInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({
      [field]: e.detail.value,
      submitted: false,
      scoreText: ''
    })
  },

  onAnswerInput(e) {
    const { key } = e.currentTarget.dataset
    const index = this.data.rows.findIndex((row) => row.key === key)
    if (index < 0) return
    this.setData({
      [`rows[${index}].answer`]: e.detail.value
    })
  },

  showFormula(e) {
    const { key } = e.currentTarget.dataset
    const formula = FORMULA_MAP[key]
    if (!formula) return
    this.setData({
      formulaVisible: true,
      formulaTitle: formula.title,
      formulaLines: formula.lines,
      formulaNote: formula.note || ''
    })
  },

  hideFormula() {
    this.setData({ formulaVisible: false })
  },

  submitAnswer() {
    const computed = computeMetrics(this.data)
    if (!computed.ok) {
      wx.showToast({ title: computed.message, icon: 'none' })
      return
    }

    const answeredCount = this.data.rows.filter((row) => String(row.answer || '').trim() !== '').length
    if (!answeredCount) {
      wx.showToast({ title: '请至少填写1项答案', icon: 'none' })
      return
    }

    const result = this.buildRowsAfterSubmit(computed.values)
    this.setData({
      rows: result.rows,
      scoreText: result.scoreText,
      submitted: true
    })

    wx.showToast({
      title: result.scoreText,
      icon: 'none'
    })
  }
})
