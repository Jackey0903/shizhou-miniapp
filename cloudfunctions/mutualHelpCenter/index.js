const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function ensureCollection() {
  try {
    await db.createCollection('mutual_questions')
  } catch (err) {
    const msg = err && err.message ? err.message : ''
    if (!msg.includes('ResourceExist') && !msg.includes('Table exist') && !msg.includes('existed')) {
      throw err
    }
  }
}

async function getCurrentUser(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || {}
}

function validateQuestion(payload = {}) {
  const title = (payload.title || '').trim()
  const content = (payload.content || '').trim()
  const answer = (payload.answer || '').trim()
  const category = (payload.category || '').trim()

  if (!title) throw new Error('请填写题目标题')
  if (!content) throw new Error('请填写题干')
  if (!answer) throw new Error('请填写参考答案')

  return {
    title: title.slice(0, 40),
    content: content.slice(0, 500),
    answer: answer.slice(0, 500),
    category: category.slice(0, 20)
  }
}

async function submitQuestion(openid, payload) {
  const user = await getCurrentUser(openid)
  const question = validateQuestion(payload)

  await db.collection('mutual_questions').add({
    data: {
      _openid: openid,
      ...question,
      status: 'pending',
      reviewerNote: '',
      submitterName: user.nickName || '匿名考友',
      avatarUrl: user.avatarUrl || '',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })
}

async function getDashboard(openid) {
  await ensureCollection()
  const user = await getCurrentUser(openid)
  const isAdmin = !!(user && (user.isAdmin === true || user.role === 'admin'))

  const tasks = [
    db.collection('mutual_questions')
      .where({ status: 'approved' })
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get(),
    db.collection('mutual_questions')
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
  ]

  if (isAdmin) {
    tasks.push(
      db.collection('mutual_questions')
        .where({ status: 'pending' })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
    )
  }

  const [approvedRes, mineRes, pendingRes] = await Promise.all(tasks)

  return {
    isAdmin,
    approved: approvedRes.data || [],
    mine: mineRes.data || [],
    pending: pendingRes ? pendingRes.data || [] : []
  }
}

async function reviewQuestion(openid, payload) {
  const user = await getCurrentUser(openid)
  const isAdmin = !!(user && (user.isAdmin === true || user.role === 'admin'))
  if (!isAdmin) {
    throw new Error('无审核权限')
  }

  const id = payload && payload.id
  const nextStatus = payload && payload.status
  const reviewerNote = ((payload && payload.reviewerNote) || '').trim().slice(0, 100)

  if (!id) throw new Error('缺少投稿ID')
  if (!['approved', 'rejected'].includes(nextStatus)) {
    throw new Error('审核状态无效')
  }

  await db.collection('mutual_questions').doc(id).update({
    data: {
      status: nextStatus,
      reviewerNote,
      reviewedAt: db.serverDate(),
      reviewedBy: openid,
      updatedAt: db.serverDate()
    }
  })
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action = 'dashboard', payload = {} } = event || {}

  if (!OPENID) {
    return { code: -1, msg: '未获取到用户身份' }
  }

  try {
    await ensureCollection()

    if (action === 'submit') {
      await submitQuestion(OPENID, payload)
    } else if (action === 'review') {
      await reviewQuestion(OPENID, payload)
    }

    const data = await getDashboard(OPENID)
    return { code: 0, data }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
