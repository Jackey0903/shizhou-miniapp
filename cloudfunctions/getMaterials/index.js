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

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    const [materials, redemptions] = await Promise.all([
      readAll('materials', {}),
      OPENID
        ? readAll('material_redemptions', { _openid: OPENID }).catch(() => [])
        : Promise.resolve([])
    ])
    const publishedMaterials = materials.filter(isPublished)
    publishedMaterials.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
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
