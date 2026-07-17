const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  try {
    const res = await db.collection('materials')
      .where({ enabled: true })
      .orderBy('sort', 'asc')
      .get()
    return {
      code: 0,
      data: res.data || []
    }
  } catch (err) {
    return {
      code: -1,
      msg: err.message || '资料加载失败',
      data: []
    }
  }
}
