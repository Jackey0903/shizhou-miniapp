const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const RESOURCE_FIELDS = ['fileId', 'fileUrl', 'linkUrl', 'imageUrl', 'audioUrl', 'url']

function isPublished(item = {}) {
  return item.enabled !== false && !['disabled', 'offline'].includes(item.status)
}

function hideResource(material) {
  const safe = { ...material, owned: false }
  RESOURCE_FIELDS.forEach((field) => {
    delete safe[field]
  })
  return safe
}

async function readAll(collectionName, where, maxItems = 2000) {
  const list = []
  while (list.length < maxItems) {
    let query = db.collection(collectionName)
    if (where && Object.keys(where).length) query = query.where(where)
    const res = await query.skip(list.length).limit(Math.min(100, maxItems - list.length)).get()
    const page = res.data || []
    list.push(...page)
    if (page.length < 100) break
  }
  return list
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

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    const [materials, redemptions] = await Promise.all([
      readAll('materials', {}),
      OPENID
        ? readAll('material_redemptions', { _openid: OPENID }).catch(() => [])
        : Promise.resolve([])
    ])
    const ordering = await readContentOrdering('materials')
    const publishedMaterials = materials.filter(isPublished)
    publishedMaterials.sort(contentOrderComparator(ordering, (item) => item.name || item.title))
    const ownedIds = new Set(redemptions.map((item) => item.materialId))
    return {
      code: 0,
      data: publishedMaterials.map((material) => (
        ownedIds.has(material._id)
          ? { ...material, owned: true }
          : hideResource(material)
      ))
    }
  } catch (err) {
    return {
      code: -1,
      msg: err.message || '资料加载失败',
      data: []
    }
  }
}
