const PLAN_GRANTS = Object.freeze({
  basic_vip_year: {
    label: '基础VIP包年',
    vipDays: 365,
    supervisionDays: 0
  },
  supervision_trial_day: {
    label: '督学试用1日',
    vipDays: 365,
    supervisionDays: 1
  },
  supervision_month: {
    label: '督学包月',
    vipDays: 365,
    supervisionDays: 30
  },
  premium_vip_year: {
    label: '高级VIP/督学包年',
    vipDays: 365,
    supervisionDays: 365
  }
})

const CONTENT_TARGETS = Object.freeze({
  audios: { enabledField: 'enabled' },
  materials: { enabledField: 'enabled' },
  wallpapers: { enabledField: 'enabled' },
  subjects: { enabledField: 'status' },
  question_banks: { enabledField: 'status' }
})

function text(value, maxLength = 200) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, maxLength)
}

function integer(value, fallback = 0, min = -1000000000, max = 1000000000) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function normalizeColor(value) {
  const color = text(value, 20)
  if (!color) return ''
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : ''
}

function isEnabled(item, target) {
  const config = CONTENT_TARGETS[target]
  if (!config) return false
  if (config.enabledField === 'status') {
    return !['disabled', 'offline'].includes(item.status)
  }
  return item.enabled !== false
}

function escapeRegExp(value) {
  return text(value, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function addDaysFromCurrent(currentValue, days, now = new Date()) {
  const parsed = currentValue ? new Date(currentValue) : null
  const base = parsed && Number.isFinite(parsed.getTime()) && parsed > now ? parsed : now
  return new Date(base.getTime() + integer(days, 0, 0, 3650) * 86400000)
}

function publicUser(user = {}) {
  return {
    _id: user._id || '',
    nickName: text(user.nickName || '未设置昵称', 40),
    phone: text(user.phone, 30),
    avatarUrl: text(user.avatarUrl, 1000),
    isVip: !!user.isVip,
    vipExpireDate: user.vipExpireDate || null,
    supervisionExpireDate: user.supervisionExpireDate || null,
    coins: integer(user.coins, 0, 0),
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null
  }
}

function isSuperAdminUser(user = {}) {
  return user.isSuperAdmin === true || user.role === 'super_admin'
}

function isAdminUser(user = {}) {
  return isSuperAdminUser(user) || user.isAdmin === true || user.role === 'admin'
}

function publicAdminUser(user = {}) {
  return {
    ...publicUser(user),
    isAdmin: isAdminUser(user),
    isSuperAdmin: isSuperAdminUser(user),
    role: isSuperAdminUser(user) ? 'super_admin' : (isAdminUser(user) ? 'admin' : 'user')
  }
}

function normalizeBinaryResponse(response) {
  const value = response && (response.buffer || response.data || response)
  if (!value) return null
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

module.exports = {
  PLAN_GRANTS,
  CONTENT_TARGETS,
  text,
  integer,
  normalizeColor,
  isEnabled,
  escapeRegExp,
  addDaysFromCurrent,
  publicUser,
  publicAdminUser,
  isAdminUser,
  isSuperAdminUser,
  normalizeBinaryResponse
}
