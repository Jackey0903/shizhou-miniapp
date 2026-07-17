const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function normalizeAccessType(value) {
  return ['free', 'vip', 'coin'].includes(value) ? value : 'coin'
}

function normalizeCoinCost(value, accessType) {
  if (accessType !== 'coin') return 0
  const cost = Number(value)
  return Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : 5
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const materials = Array.isArray(event.materials) ? event.materials : []

  if (!materials.length) {
    return { code: -1, msg: '请先选择资料文件' }
  }

  try {
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const user = (userRes.data || [])[0]
    if (!user || (!user.isAdmin && user.role !== 'admin')) {
      return { code: -1, msg: '仅管理员可上传资料' }
    }

    let count = 0
    for (const item of materials) {
      if (!item.name || !item.type || (!item.fileId && !item.fileUrl && !item.linkUrl)) continue
      const accessType = normalizeAccessType(item.accessType)
      await db.collection('materials').add({
        data: {
          name: item.name,
          description: item.description || '',
          type: item.type,
          category: item.type,
          accessType,
          coinCost: normalizeCoinCost(item.coinCost, accessType),
          fileId: item.fileId || '',
          fileUrl: item.fileUrl || '',
          linkUrl: item.linkUrl || '',
          coverFileId: item.coverFileId || '',
          coverUrl: item.coverUrl || '',
          imageUrl: item.imageUrl || '',
          enabled: true,
          sort: Number(item.sort) || Date.now() + count,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      count += 1
    }

    return { code: 0, msg: '资料上传成功', count }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
