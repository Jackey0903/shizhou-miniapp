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
  const remainCount = Math.max(0, fallbackTotal - learnedCount)
  return remainCount > 0 ? Math.max(1, Math.ceil(remainCount / Math.max(1, dailyCount))) : 0
}

module.exports = {
  calcRemainDays,
  toDateKey
}
