const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const RESOURCE_FIELDS = ['fileId', 'fileUrl', 'linkUrl', 'imageUrl', 'audioUrl', 'url']

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
    const query = db.collection(collectionName).where(where)
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
      readAll('materials', { enabled: true }),
      OPENID
        ? readAll('material_redemptions', { _openid: OPENID }).catch(() => [])
        : Promise.resolve([])
    ])
    materials.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
    const ownedIds = new Set(redemptions.map((item) => item.materialId))
    return {
      code: 0,
      data: materials.map((material) => (
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
