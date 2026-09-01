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

module.exports = {
  readBoolean,
  toggledBoolean
}
