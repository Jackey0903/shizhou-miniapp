const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function getCurrentUser(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || {}
}

function keyOf(item = {}) {
  const subject = String(item.subjectName || item.category || item['科目名称'] || '').trim()
  const name = String(item.name || item.bankName || item.courseName || item['题库名称'] || '').trim()
  return `${subject}::${name}`
}

async function listAll(collection) {
  const all = []
  let skip = 0
  const limit = 100
  while (true) {
    const res = await db.collection(collection).skip(skip).limit(limit).get()
    const data = res.data || []
    all.push(...data)
    if (data.length < limit) break
    skip += limit
  }
  return all
}

async function removeByWhere(collection, where) {
  let removed = 0
  while (true) {
    const res = await db.collection(collection).where(where).limit(100).get()
    const rows = res.data || []
    if (!rows.length) break
    for (const row of rows) {
      await db.collection(collection).doc(row._id).remove()
      removed += 1
    }
    if (rows.length < 100) break
  }
  return removed
}

async function countByWhere(collection, where) {
  const res = await db.collection(collection).where(where).count()
  return res.total || 0
}

async function removeDoc(collection, id) {
  try {
    await db.collection(collection).doc(id).remove()
    return 1
  } catch (err) {
    return 0
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const keepBanks = event.keepBanks || []
  const keepImportKeys = event.keepImportKeys || []
  const dryRun = event.dryRun === true

  if (!Array.isArray(keepBanks) || keepBanks.length === 0) {
    return { code: -1, msg: '缺少保留题库列表' }
  }

  try {
    const user = await getCurrentUser(OPENID)
    const isAdmin = !!(user && (user.isAdmin === true || user.role === 'admin'))
    if (!isAdmin) {
      return { code: -1, msg: '无清理权限' }
    }

    const keepKeySet = {}
    keepBanks.forEach((item) => {
      keepKeySet[keyOf(item)] = true
    })
    const keepImportKeySet = {}
    keepImportKeys.forEach((item) => {
      keepImportKeySet[String(item || '')] = true
    })

    const questionBanks = await listAll('question_banks')
    const courses = await listAll('courses').catch(() => [])
    const keepBankIds = {}
    const removeBanks = []

    questionBanks.forEach((bank) => {
      if (keepKeySet[keyOf(bank)]) {
        keepBankIds[bank._id] = bank
      } else {
        removeBanks.push({ collection: 'question_banks', item: bank })
      }
    })

    courses.forEach((course) => {
      if (keepKeySet[keyOf(course)]) {
        keepBankIds[course._id] = course
      } else {
        removeBanks.push({ collection: 'courses', item: course })
      }
    })

    const result = {
      dryRun,
      keepBankCount: Object.keys(keepBankIds).length,
      removeBankCount: removeBanks.length,
      removedBanks: [],
      removedQuestions: 0,
      removedStrayQuestions: 0,
      updatedKeepBanks: 0
    }

    const selectedRemoveBanks = event.limitRemoveBanks
      ? removeBanks.slice(0, Number(event.limitRemoveBanks) || 1)
      : removeBanks
    result.selectedRemoveBankCount = selectedRemoveBanks.length

    for (const target of selectedRemoveBanks) {
      const id = target.item._id
      const bankName = target.item.name
      const subjectName = target.item.subjectName || target.item.category
      const questionCount = dryRun
        ? (await countByWhere('questions', { bankId: id })) + (await countByWhere('questions', { courseId: id }))
        : (await removeByWhere('questions', { bankId: id })) + (await removeByWhere('questions', { courseId: id }))
      if (!dryRun) await removeDoc(target.collection, id)
      result.removedQuestions += questionCount
      result.removedBanks.push({
        collection: target.collection,
        id,
        subjectName,
        bankName,
        questionCount
      })
    }

    return { code: 0, data: result }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
