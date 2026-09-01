const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_BATCH_SIZE = 9

function text(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

function isCloudUrl(value) {
  return /^cloud:\/\/[^\s]+$/i.test(value)
}

function isResourceUrl(value) {
  return !value || /^(cloud:\/\/|https:\/\/)[^\s]+$/i.test(value)
}

function stableId(source) {
  return `wallpaper_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 20)}`
}

function normalizeWallpaper(item, index) {
  if (!item || typeof item !== 'object') throw new Error(`第${index + 1}张壁纸格式错误`)
  const title = text(item.title || `壁纸${index + 1}`, 200)
  const type = text(item.type || 'default', 50)
  const fileId = text(item.fileId, 1000)
  const imageUrl = text(item.imageUrl, 2000)
  if (!isCloudUrl(fileId)) throw new Error(`第${index + 1}张壁纸云文件地址无效`)
  if (!isResourceUrl(imageUrl)) throw new Error(`第${index + 1}张壁纸外部链接必须使用HTTPS`)

  const rawSort = Number(item.sort)
  return {
    id: stableId(fileId),
    data: {
      title,
      type,
      fileId,
      imageUrl,
      enabled: true,
      sort: Number.isFinite(rawSort) ? rawSort : Date.now() + index,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  }
}

// 与管理后台共用同一套排序模式：管理员选过“按名称排序”后，
// 新上传的内容在用户端也会自动落到正确位置。
async function readContentOrdering(target) {
  try {
    const res = await db.collection('content_orderings').doc(target).get()
    const data = (res && res.data) || {}
    return {
      mode: data.mode === 'name' ? 'name' : 'manual',
      direction: data.direction === 'desc' ? 'desc' : 'asc'
    }
  } catch (err) {
    return { mode: 'manual', direction: 'asc' }
  }
}

function contentOrderComparator(ordering, labelOf) {
  if (ordering.mode === 'name') {
    const factor = ordering.direction === 'desc' ? -1 : 1
    return (left, right) => factor * String(labelOf(left) || '')
      .localeCompare(String(labelOf(right) || ''), 'zh-CN', { numeric: true })
  }
  return (left, right) => {
    const leftSort = Number(left.sort)
    const rightSort = Number(right.sort)
    const a = Number.isFinite(leftSort) ? leftSort : Number.MAX_SAFE_INTEGER
    const b = Number.isFinite(rightSort) ? rightSort : Number.MAX_SAFE_INTEGER
    return a - b || String(labelOf(left) || '')
      .localeCompare(String(labelOf(right) || ''), 'zh-CN', { numeric: true })
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (event.action === 'list') {
    try {
      const list = []
      while (list.length < 1000) {
        const res = await db.collection('wallpapers')
          .skip(list.length).limit(Math.min(100, 1000 - list.length)).get()
        const page = res.data || []
        list.push(...page)
        if (page.length < 100) break
      }
      const type = String(event.type || '')
      const ordering = await readContentOrdering('wallpapers')
      const data = list
        .filter((item) => item.enabled !== false && !['disabled', 'offline'].includes(item.status))
        .filter((item) => !type || item.type === type)
        .sort(contentOrderComparator(ordering, (item) => item.title || item.name))
      return { code: 0, data }
    } catch (err) {
      return { code: -1, msg: err.message || '壁纸加载失败' }
    }
  }

  const wallpapers = Array.isArray(event.wallpapers) ? event.wallpapers : []
  if (!wallpapers.length) return { code: -1, msg: '请先选择壁纸图片' }
  if (wallpapers.length > MAX_BATCH_SIZE) return { code: -1, msg: `单次最多上传${MAX_BATCH_SIZE}张壁纸` }

  try {
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const user = (userRes.data || [])[0]
    if (!user || (!user.isAdmin && user.role !== 'admin' && user.role !== 'super_admin')) {
      return { code: -1, msg: '仅管理员可上传壁纸' }
    }

    const normalized = wallpapers.map(normalizeWallpaper)
    for (const item of normalized) {
      await db.collection('wallpapers').doc(item.id).set({ data: item.data })
    }
    return { code: 0, msg: '壁纸上传成功', count: normalized.length }
  } catch (err) {
    return { code: -1, msg: err.message || '壁纸上传失败' }
  }
}
