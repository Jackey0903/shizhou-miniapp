const DAY_MS = 86400000

function pad(value) {
  return String(value).padStart(2, '0')
}

function parseDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const stamp = Date.UTC(year, month - 1, day)
  const date = new Date(stamp)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return { year, month, day, stamp }
}

function toDateKey(value) {
  if (!value) return ''
  const raw = typeof value === 'string' ? value.trim() : ''
  if (parseDateKey(raw)) return raw

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const isUtcDateOnly = date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0
  const year = isUtcDateOnly ? date.getUTCFullYear() : date.getFullYear()
  const month = (isUtcDateOnly ? date.getUTCMonth() : date.getMonth()) + 1
  const day = isUtcDateOnly ? date.getUTCDate() : date.getDate()
  return `${year}-${pad(month)}-${pad(day)}`
}

function calcRemainDays(deadline, fallbackTotal = 0, dailyCount = 10, learnedCount = 0, now = new Date()) {
  const deadlineParts = parseDateKey(toDateKey(deadline))
  if (deadlineParts) {
    const todayStamp = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    return Math.max(0, Math.round((deadlineParts.stamp - todayStamp) / DAY_MS))
  }
  return calcStudySchedule(fallbackTotal, dailyCount, learnedCount, now).remainDays
}

function calcStudySchedule(totalCount = 0, dailyCount = 10, learnedCount = 0, now = new Date()) {
  const total = Math.max(0, Math.floor(Number(totalCount) || 0))
  const learned = Math.max(0, Math.floor(Number(learnedCount) || 0))
  const daily = Math.max(1, Math.floor(Number(dailyCount) || 10))
  const remainingCount = Math.max(0, total - learned)
  const remainDays = remainingCount > 0 ? Math.ceil(remainingCount / daily) : 0

  let deadline = ''
  if (remainDays > 0) {
    const completionDate = new Date(now)
    completionDate.setHours(12, 0, 0, 0)
    // Today is the first study day, so N study days finish on today + (N - 1).
    completionDate.setDate(completionDate.getDate() + remainDays - 1)
    deadline = toDateKey(completionDate)
  }

  return {
    remainingCount,
    remainDays,
    deadline,
    deadlineLabel: deadline
  }
}

module.exports = {
  calcRemainDays,
  calcStudySchedule,
  toDateKey
}
