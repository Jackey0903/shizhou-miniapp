const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const wallpapers = Array.isArray(event.wallpapers) ? event.wallpapers : []

  if (!wallpapers.length) {
    return { code: -1, msg: '请先选择壁纸图片' }
  }

  try {
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const user = (userRes.data || [])[0]
    if (!user || (!user.isAdmin && user.role !== 'admin')) {
      return { code: -1, msg: '仅管理员可上传壁纸' }
    }

    let count = 0
    for (const item of wallpapers) {
      if (!item.fileId) continue
      await db.collection('wallpapers').add({
        data: {
          title: item.title || `壁纸${count + 1}`,
          type: item.type || 'default',
          fileId: item.fileId,
          imageUrl: item.imageUrl || '',
          enabled: true,
          sort: Number(item.sort) || Date.now() + count,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      count += 1
    }

    return { code: 0, msg: '壁纸上传成功', count }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
