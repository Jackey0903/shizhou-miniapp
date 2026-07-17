const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
