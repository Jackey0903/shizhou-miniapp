function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2)
  return /^\d{6,20}$/.test(digits) ? digits : ''
}

function hasBoundPhone(userInfo) {
  return !!(userInfo && normalizePhone(userInfo.phone))
}

module.exports = {
  normalizePhone,
  hasBoundPhone
}
