const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureCollection() {
  try {
    await db.createCollection('user_wallpapers')
  } catch (err) {
    const msg = err && err.message ? err.message : ''
    if (!msg.includes('ResourceExist') && !msg.includes('Table exist') && !msg.includes('existed')) {
      throw err
    }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action = 'list', payload = {} } = event || {}

  if (!OPENID) {
    return { code: -1, msg: '未获取到用户身份' }
  }

  try {
    await ensureCollection()

    if (action === 'add') {
      const fileId = (payload.fileId || '').trim()
      if (!fileId) {
        return { code: -1, msg: '缺少图片文件' }
      }
      await db.collection('user_wallpapers').add({
        data: {
          _openid: OPENID,
          fileId,
          sort: Date.now(),
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
    }

    const res = await db.collection('user_wallpapers')
      .where({ _openid: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()

    return { code: 0, data: res.data || [] }
  } catch (err) {
    console.error('[userWallpaperManager] error', err)
    return { code: -1, msg: err.message || '壁纸处理失败' }
  }
}
