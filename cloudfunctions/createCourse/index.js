const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function getCurrentUser(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || null
}

async function ensureSubject(category, sortHint) {
  const name = (category || '').trim()
  const exists = await db.collection('subjects').where({ name }).limit(1).get()
  if (exists.data.length) {
    return exists.data[0]
  }

  const latest = await db.collection('subjects').orderBy('sort', 'desc').limit(1).get()
  const nextSort = sortHint || (latest.data.length ? (latest.data[0].sort || 0) + 1 : 1)
  const res = await db.collection('subjects').add({
    data: {
      name,
      description: '',
      color: '',
      status: 'enabled',
      sort: nextSort,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })
  return {
    _id: res._id,
    name,
    sort: nextSort
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const name = (event.name || '').trim()
  const category = (event.category || '').trim()
  const series = (event.series || '').trim() || '基础题库'
  const description = (event.description || '').trim()
  const cover = (event.cover || '').trim()
  const isLocked = !!event.isLocked

  if (!category) return { code: -1, msg: '科目不能为空' }
  if (!name) return { code: -1, msg: '题库名称不能为空' }

  try {
    const user = await getCurrentUser(OPENID)
    const isAdmin = !!(user && (user.isAdmin === true || user.role === 'admin'))
    if (!isAdmin) {
      return { code: -1, msg: '无新增题库权限' }
    }

    const subject = await ensureSubject(category)
    const duplicate = await db.collection('question_banks').where({ subjectId: subject._id, name }).limit(1).get()
    if (duplicate.data.length) {
      return { code: -1, msg: '该科目下已存在同名题库' }
    }

    const latest = await db.collection('question_banks').orderBy('sort', 'desc').limit(1).get()
    const nextSort = latest.data.length ? (latest.data[0].sort || 0) + 1 : 1

    const res = await db.collection('question_banks').add({
      data: {
        subjectId: subject._id,
        subjectName: subject.name,
        category: subject.name,
        name,
        series,
        description,
        cover,
        preview: [],
        totalCount: 0,
        isLocked,
        status: 'enabled',
        sort: nextSort,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    return { code: 0, msg: '题库创建成功', courseId: res._id, subjectId: subject._id }
  } catch (err) {
    return { code: -1, msg: err.message || '题库创建失败' }
  }
}
