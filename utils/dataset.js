// utils/dataset.js — 安全读取 WXML dataset 上的布尔值
//
// data-enabled="{{item.enabled}}" 在不同基础库/渲染引擎下既可能拿到布尔值，
// 也可能拿到字符串 "false"。直接写 !dataset.enabled 时，"false" 会被当成真值，
// 取反后变成 false —— 表现就是"点上线没反应，反而又下线了一次"。
// 所有上下线开关统一走这里，避免再次踩到。

function readBoolean(value, fallback = false) {
  if (value === true || value === false) return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  if (value === undefined || value === null || value === '') return fallback
  return !!value
}

/**
 * 读取当前状态并返回点击后应该切换到的目标状态。
 */
function toggledBoolean(value, fallback = false) {
  return !readBoolean(value, fallback)
}

/**
 * 优先按 id 从页面数据里找当前项，用它的 enabled（云函数 isEnabled 算出的真布尔）
 * 决定点击后的目标状态；找不到再退回 dataset。彻底绕开 dataset 布尔/字符串歧义。
 * list 可以是扁平数组，也可以是带 banks 子数组的模块树。
 */
function nextEnabled(list, id, datasetValue, fallback = false) {
  const target = String(id || '')
  const stack = Array.isArray(list) ? list.slice() : []
  while (stack.length) {
    const item = stack.shift()
    if (!item || typeof item !== 'object') continue
    if (String(item._id || item.id || '') === target) return !readBoolean(item.enabled, fallback)
    if (Array.isArray(item.banks)) stack.push(...item.banks)
  }
  return toggledBoolean(datasetValue, fallback)
}

module.exports = {
  readBoolean,
  toggledBoolean,
  nextEnabled
}
