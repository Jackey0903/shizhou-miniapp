const PLAN_GRANTS = Object.freeze({
  basic_vip_year: {
    label: '基础VIP包年',
    vipDays: 365,
    supervisionDays: 30
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

// 展示顺序普遍用 Date.now() 生成（约 1.7e12），远超 integer() 的 1e9 上限。
// 用 integer() 处理会把所有新内容钳到同一个 1e9，导致后台列表顺序错乱、
// 新上传的内容永远排在最后甚至被列表条数截断。排序值必须用完整安全整数区间。
const MAX_SORT = Number.MAX_SAFE_INTEGER

function sortValue(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return sortValue(fallback, 0)
  const rounded = Math.round(number)
  return Math.min(MAX_SORT, Math.max(0, rounded))
}

// 早期数据有的只写 enabled，有的只写 status。上下线必须同时写两个字段，
// 否则残留的 enabled:false / status:'disabled' 会让"点上线没反应"。
function publicationFields(enabled) {
  return {
    enabled: !!enabled,
    status: enabled ? 'enabled' : 'disabled'
  }
}

function normalizeColor(value) {
  const color = text(value, 20)
  if (!color) return ''
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : ''
}

function isEnabled(item, target) {
  const config = CONTENT_TARGETS[target]
  if (!config) return false
  // 早期内容有的只写了 enabled，有的只写了 status。两个字段只要任一
  // 明确表示下线，就不能再暴露到前台，避免后台显示“已下线”而用户端仍可见。
  return item.enabled !== false && !['disabled', 'offline'].includes(item.status)
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
  MAX_SORT,
  text,
  integer,
  sortValue,
  publicationFields,
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
