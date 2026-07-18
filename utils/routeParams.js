function decodeRouteParam(value = '') {
  let decoded = String(value || '')
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch (err) {
      break
    }
  }
  return decoded
}

module.exports = {
  decodeRouteParam
}
