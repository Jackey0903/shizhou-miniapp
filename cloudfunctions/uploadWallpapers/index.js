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

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (event.action === 'list') {
    try {
      const list = []
      while (list.length < 1000) {
        const res = await db.collection('wallpapers').where({ enabled: true })
          .skip(list.length).limit(Math.min(100, 1000 - list.length)).get()
        const page = res.data || []
        list.push(...page)
        if (page.length < 100) break
      }
      const type = String(event.type || '')
      const data = list
        .filter((item) => !type || item.type === type)
        .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
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
    if (!user || (!user.isAdmin && user.role !== 'admin')) {
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
