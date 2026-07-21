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
  return `audio_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 20)}`
}

function normalizeAudio(item, index) {
  if (!item || typeof item !== 'object') throw new Error(`第${index + 1}个音频格式错误`)
  const title = text(item.title, 200)
  const category = text(item.category, 50)
  const type = text(item.type || '音频', 50)
  const duration = text(item.duration, 50)
  const fileId = text(item.fileId, 1000)
  const fileUrl = text(item.fileUrl, 2000)
  if (!title) throw new Error(`第${index + 1}个音频缺少标题`)
  if (!category) throw new Error(`第${index + 1}个音频缺少分类`)
  if (!isCloudUrl(fileId)) throw new Error(`第${index + 1}个音频云文件地址无效`)
  if (!isResourceUrl(fileUrl)) throw new Error(`第${index + 1}个音频外部链接必须使用HTTPS`)

  const rawSort = Number(item.sort)
  return {
    id: stableId(fileId),
    data: {
      title,
      category,
      type,
      duration,
      fileId,
      fileUrl,
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
      while (list.length < 2000) {
        const res = await db.collection('audios').where({ enabled: true })
          .skip(list.length).limit(Math.min(100, 2000 - list.length)).get()
        const page = res.data || []
        list.push(...page)
        if (page.length < 100) break
      }
      const category = String(event.category || '')
      const data = list
        .filter((item) => !category || item.category === category)
        .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
      return { code: 0, data }
    } catch (err) {
      return { code: -1, msg: err.message || '音频加载失败' }
    }
  }

  const audios = Array.isArray(event.audios) ? event.audios : []
  if (!audios.length) return { code: -1, msg: '请先选择音频文件' }
  if (audios.length > MAX_BATCH_SIZE) return { code: -1, msg: `单次最多上传${MAX_BATCH_SIZE}个音频` }

  try {
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const user = (userRes.data || [])[0]
    if (!user || (!user.isAdmin && user.role !== 'admin')) {
      return { code: -1, msg: '仅管理员可上传音频' }
    }

    const normalized = audios.map(normalizeAudio)
    for (const item of normalized) {
      await db.collection('audios').doc(item.id).set({ data: item.data })
    }
    return { code: 0, msg: '音频上传成功', count: normalized.length }
  } catch (err) {
    return { code: -1, msg: err.message || '音频上传失败' }
  }
}
