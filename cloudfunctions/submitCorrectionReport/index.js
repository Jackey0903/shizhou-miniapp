const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const COLLECTION_NAME = 'correction_reports'

async function ensureReportCollection() {
  try {
    await db.createCollection(COLLECTION_NAME)
  } catch (err) {
    const message = err && (err.message || err.errMsg || '')
    if (
      !message.includes('ResourceExist')
      && !message.includes('Table exist')
      && !message.includes('already exists')
      && !message.includes('existed')
    ) {
      throw err
    }
  }
}

function isMissingCollectionError(err) {
  const message = err && (err.message || err.errMsg || '')
  return message.includes('-502005')
    || message.includes('database collection not')
    || message.includes('Db or Table not exist')
    || message.includes('does not exist')
}

async function addReport(data) {
  try {
    return await db.collection(COLLECTION_NAME).add({ data })
  } catch (err) {
    if (!isMissingCollectionError(err)) throw err
    await ensureReportCollection()
    return db.collection(COLLECTION_NAME).add({ data })
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const {
    questionId,
    bankId = '',
    courseId = '',
    bankName = '',
    reportType = '',
    content = '',
    snapshot = {}
  } = event || {}

  if (!OPENID) return { code: -1, msg: '未获取到用户身份' }
  if (!questionId) return { code: -1, msg: '缺少题目ID' }
  if (!reportType) return { code: -1, msg: '请选择纠错类型' }
  if (!(content || '').trim()) return { code: -1, msg: '请填写纠错说明' }

  try {
    const res = await addReport({
      _openid: OPENID,
      questionId,
      bankId: bankId || courseId || '',
      courseId: courseId || bankId || '',
      bankName,
      reportType,
      content: content.trim(),
      status: 'pending',
      snapshot: {
        content: snapshot.content || '',
        imageUrl: snapshot.imageUrl || '',
        options: snapshot.options || [],
        answer: snapshot.answer || '',
        explanation: snapshot.explanation || ''
      },
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    })
    return { code: 0, data: { id: res._id } }
  } catch (err) {
    console.error('[submitCorrectionReport] submit failed', err)
    return { code: -1, msg: '提交失败，请稍后重试' }
  }
}
