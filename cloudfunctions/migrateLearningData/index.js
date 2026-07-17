const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {}
}

exports.main = async () => {
  const results = []

  await ensureCollection('subjects')
  await ensureCollection('question_banks')

  const subjectMap = {}
  const bankMap = {}

  try {
    const oldCourses = await db.collection('courses').orderBy('sort', 'asc').get()
    if (!oldCourses.data.length) {
      return { code: 0, msg: '没有旧课程数据需要迁移', results }
    }

    for (const course of oldCourses.data) {
      let subjectId = subjectMap[course.category || '综合题库']
      if (!subjectId) {
        const found = await db.collection('subjects').where({ name: course.category || '综合题库' }).limit(1).get()
        if (found.data.length) {
          subjectId = found.data[0]._id
        } else {
          const addSubject = await db.collection('subjects').add({
            data: {
              name: course.category || '综合题库',
              description: '',
              color: '',
              status: 'enabled',
              sort: course.sort || 999,
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          })
          subjectId = addSubject._id
          results.push(`创建科目：${course.category || '综合题库'}`)
        }
        subjectMap[course.category || '综合题库'] = subjectId
      }

      const existedBank = await db.collection('question_banks').where({ legacyCourseId: course._id }).limit(1).get()
      let bankId = ''
      if (existedBank.data.length) {
        bankId = existedBank.data[0]._id
      } else {
        const addBank = await db.collection('question_banks').add({
          data: {
            subjectId,
            subjectName: course.category || '综合题库',
            category: course.category || '综合题库',
            name: course.name || '未命名题库',
            series: course.series || '基础题库',
            description: course.description || '',
            cover: course.cover || '',
            preview: course.preview || [],
            totalCount: course.totalCount || 0,
            isLocked: !!course.isLocked,
            status: 'enabled',
            sort: course.sort || 999,
            legacyCourseId: course._id,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
        bankId = addBank._id
        results.push(`迁移题库：${course.name}`)
      }
      bankMap[course._id] = bankId
    }

    let migratedCount = 0
    let skip = 0
    while (true) {
      const questions = await db.collection('questions').where({}).skip(skip).limit(100).get()
      if (!questions.data.length) break
      for (const item of questions.data) {
        if (!item.bankId && item.courseId && bankMap[item.courseId]) {
          await db.collection('questions').doc(item._id).update({
            data: {
              bankId: bankMap[item.courseId],
              updatedAt: db.serverDate()
            }
          })
          migratedCount += 1
        }
      }
      skip += questions.data.length
    }

    results.push(`题目 bankId 字段迁移完成（共更新 ${migratedCount} 条）`)
    return {
      code: 0,
      msg: '学习数据迁移完成',
      results
    }
  } catch (err) {
    return {
      code: -1,
      msg: err.message,
      results
    }
  }
}
