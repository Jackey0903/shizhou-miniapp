const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const audios = Array.isArray(event.audios) ? event.audios : []

  if (!audios.length) {
    return { code: -1, msg: '请先选择音频文件' }
  }

  try {
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const user = (userRes.data || [])[0]
    if (!user || (!user.isAdmin && user.role !== 'admin')) {
      return { code: -1, msg: '仅管理员可上传音频' }
    }

    let count = 0
    for (const item of audios) {
      if (!item.title || !item.fileId || !item.category) continue
      await db.collection('audios').add({
        data: {
          title: item.title,
          category: item.category,
          type: item.type || '音频',
          duration: item.duration || '',
          fileId: item.fileId,
          fileUrl: item.fileUrl || '',
          enabled: true,
          sort: Number(item.sort) || Date.now() + count,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      count += 1
    }

    return { code: 0, msg: '音频上传成功', count }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
