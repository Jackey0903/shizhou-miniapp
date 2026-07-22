const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_BATCH_SIZE = 20
const MATERIAL_TYPES = new Set(['document', 'audio', 'image'])
const MATERIAL_COST = 10

function text(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

function isCloudUrl(value) {
  return !value || /^cloud:\/\/[^\s]+$/i.test(value)
}

function isResourceUrl(value) {
  return !value || /^(cloud:\/\/|https:\/\/)[^\s]+$/i.test(value)
}

function stableId(prefix, source) {
  return `${prefix}_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 20)}`
}

function normalizeMaterial(item, index) {
  if (!item || typeof item !== 'object') throw new Error(`第${index + 1}条资料格式错误`)
  const name = text(item.name, 200)
  const description = text(item.description, 2000)
  const type = text(item.type, 20)
  const fileId = text(item.fileId, 1000)
  const fileUrl = text(item.fileUrl, 2000)
  const linkUrl = text(item.linkUrl, 2000)
  const coverFileId = text(item.coverFileId, 1000)
  const coverUrl = text(item.coverUrl, 2000)
  const imageUrl = text(item.imageUrl, 2000)

  if (!name) throw new Error(`第${index + 1}条资料缺少名称`)
  if (!MATERIAL_TYPES.has(type)) throw new Error(`第${index + 1}条资料类型无效`)
  if (!fileId && !fileUrl && !linkUrl) throw new Error(`第${index + 1}条资料缺少文件或链接`)
  if (!isCloudUrl(fileId) || !isCloudUrl(coverFileId)) throw new Error(`第${index + 1}条资料云文件地址无效`)
  if (!isResourceUrl(fileUrl) || !isResourceUrl(linkUrl) || !isResourceUrl(coverUrl) || !isResourceUrl(imageUrl)) {
    throw new Error(`第${index + 1}条资料外部链接必须使用HTTPS`)
  }

  const source = fileId || fileUrl || linkUrl
  const rawSort = Number(item.sort)
  return {
    id: stableId('material', `${type}:${source}`),
    data: {
      name,
      description,
      type,
      category: type,
      accessType: 'coin',
      coinCost: MATERIAL_COST,
      fileId,
      fileUrl,
      linkUrl,
      coverFileId,
      coverUrl,
      imageUrl,
      enabled: true,
      sort: Number.isFinite(rawSort) ? rawSort : Date.now() + index,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const materials = Array.isArray(event.materials) ? event.materials : []

  if (!materials.length) return { code: -1, msg: '请先选择资料文件' }
  if (materials.length > MAX_BATCH_SIZE) return { code: -1, msg: `单次最多上传${MAX_BATCH_SIZE}条资料` }

  try {
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const user = (userRes.data || [])[0]
    if (!user || (!user.isAdmin && user.role !== 'admin')) {
      return { code: -1, msg: '仅管理员可上传资料' }
    }

    const normalized = materials.map(normalizeMaterial)
    for (const item of normalized) {
      await db.collection('materials').doc(item.id).set({ data: item.data })
    }
    return { code: 0, msg: '资料上传成功', count: normalized.length }
  } catch (err) {
    return { code: -1, msg: err.message || '资料上传失败' }
  }
}
