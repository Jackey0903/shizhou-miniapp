const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const {
  PLAN_GRANTS,
  CONTENT_TARGETS,
  text,
  integer,
  normalizeColor,
  isEnabled,
  addDaysFromCurrent,
  publicUser,
  publicAdminUser,
  isAdminUser,
  isSuperAdminUser,
  normalizeBinaryResponse
} = require('./adminCore')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureCollection(name) {
  try {
    await db.collection(name).limit(1).get()
  } catch (err) {
    const msg = String((err && (err.message || err.errMsg)) || '')
    if (!msg.includes('Db or Table not exist') && !msg.includes('database collection not') && !msg.includes('-502005')) {
      throw err
    }
    try {
      await db.createCollection(name)
    } catch (createErr) {
      const createMsg = String((createErr && (createErr.message || createErr.errMsg)) || '')
      if (!createMsg.includes('Table exist') && !createMsg.includes('ResourceExist') && !createMsg.includes('already exists')) {
        throw createErr
      }
    }
  }
}

async function readAll(collectionName, maxItems = 2000) {
  const list = []
  while (list.length < maxItems) {
    const res = await db.collection(collectionName)
      .skip(list.length)
      .limit(Math.min(100, maxItems - list.length))
      .get()
    const page = res.data || []
    list.push(...page)
    if (page.length < 100) break
  }
  return list
}

async function readAllWhere(collectionName, query, maxItems = 5000) {
  const list = []
  while (list.length < maxItems) {
    const res = await db.collection(collectionName)
      .where(query)
      .skip(list.length)
      .limit(Math.min(100, maxItems - list.length))
      .get()
    const page = res.data || []
    list.push(...page)
    if (page.length < 100) break
  }
  return list
}

async function getAdmin(openid) {
  const result = await db.collection('users').where({ _openid: openid }).limit(1).get()
  const user = (result.data || [])[0]
  return isAdminUser(user) ? user : null
}

async function audit(admin, action, detail = {}) {
  try {
    await ensureCollection('admin_audit_logs')
    await db.collection('admin_audit_logs').add({
      data: {
        adminUserId: admin._id || '',
        adminName: text(admin.nickName || '管理员', 40),
        action: text(action, 80),
        detail,
        createdAt: db.serverDate()
      }
    })
  } catch (err) {
    console.warn('[adminOperations] write audit failed', err)
  }
}

async function listCourseTree() {
  await Promise.all([ensureCollection('subjects'), ensureCollection('question_banks')])
  const [subjects, banks] = await Promise.all([
    readAll('subjects'),
    readAll('question_banks')
  ])
  const bankGroups = {}
  banks.forEach((bank) => {
    const key = bank.subjectId || `legacy:${bank.category || bank.subjectName || '未分类'}`
    if (!bankGroups[key]) bankGroups[key] = []
    bankGroups[key].push({
      ...bank,
      enabled: isEnabled(bank, 'question_banks')
    })
  })

  const known = new Set(subjects.map((subject) => subject._id))
  const legacySubjects = Object.keys(bankGroups)
    .filter((key) => !known.has(key))
    .map((key, index) => {
      const first = bankGroups[key][0] || {}
      return {
        _id: key,
        name: first.category || first.subjectName || '未分类',
        description: '',
        color: '',
        sort: 9000 + index,
        status: 'enabled',
        virtual: true
      }
    })

  return subjects.concat(legacySubjects)
    .map((subject) => ({
      ...subject,
      enabled: isEnabled(subject, 'subjects'),
      banks: (bankGroups[subject._id] || [])
        .sort((left, right) => integer(left.sort, 9999) - integer(right.sort, 9999))
    }))
    .sort((left, right) => integer(left.sort, 9999) - integer(right.sort, 9999))
}

async function saveSubject(payload, admin) {
  const id = text(payload.id, 100)
  const name = text(payload.name, 50)
  if (!name) return { code: -1, msg: '请填写模块名称' }

  const duplicateRes = await db.collection('subjects').where({ name }).limit(5).get()
  const duplicate = (duplicateRes.data || []).find((item) => item._id !== id)
  if (duplicate) return { code: -1, msg: '已存在同名模块' }

  const data = {
    name,
    description: text(payload.description, 300),
    color: normalizeColor(payload.color),
    sort: integer(payload.sort, Date.now(), 0),
    status: payload.enabled === false ? 'disabled' : 'enabled',
    updatedAt: db.serverDate()
  }
  if (id && !id.startsWith('legacy:')) {
    await db.collection('subjects').doc(id).update({ data })
    await db.collection('question_banks').where({ subjectId: id }).update({
      data: {
        subjectName: name,
        category: name,
        updatedAt: db.serverDate()
      }
    })
    await audit(admin, 'update_subject', { id, name })
    return { code: 0, msg: '模块已更新', id }
  }

  const result = await db.collection('subjects').add({
    data: {
      ...data,
      createdAt: db.serverDate()
    }
  })
  await audit(admin, 'create_subject', { id: result._id, name })
  return { code: 0, msg: '模块已新增', id: result._id }
}

async function saveBank(payload, admin) {
  const id = text(payload.id, 100)
  const subjectId = text(payload.subjectId, 100)
  const name = text(payload.name, 100)
  if (!subjectId) return { code: -1, msg: '请选择所属模块' }
  if (!name) return { code: -1, msg: '请填写题库名称' }

  const subjectRes = await db.collection('subjects').doc(subjectId).get().catch(() => ({ data: null }))
  const subject = subjectRes.data
  if (!subject) return { code: -1, msg: '所属模块不存在，请刷新后重试' }

  const duplicateRes = await db.collection('question_banks').where({ subjectId, name }).limit(5).get()
  const duplicate = (duplicateRes.data || []).find((item) => item._id !== id)
  if (duplicate) return { code: -1, msg: '该模块下已存在同名题库' }

  const data = {
    subjectId,
    subjectName: subject.name,
    category: subject.name,
    name,
    series: text(payload.series || '基础题库', 100),
    description: text(payload.description, 500),
    isLocked: !!payload.isLocked,
    sort: integer(payload.sort, Date.now(), 0),
    status: payload.enabled === false ? 'disabled' : 'enabled',
    updatedAt: db.serverDate()
  }
  if (id) {
    await db.collection('question_banks').doc(id).update({ data })
    await audit(admin, 'update_question_bank', { id, name, subjectId })
    return { code: 0, msg: '题库已更新', id }
  }

  const result = await db.collection('question_banks').add({
    data: {
      ...data,
      cover: '',
      preview: [],
      totalCount: 0,
      createdAt: db.serverDate()
    }
  })
  await audit(admin, 'create_question_bank', { id: result._id, name, subjectId })
  return { code: 0, msg: '题库已新增', id: result._id }
}

async function listContent(payload) {
  const target = text(payload.target, 50)
  if (!CONTENT_TARGETS[target]) return { code: -1, msg: '不支持的内容类型' }
  await ensureCollection(target)
  const keyword = text(payload.keyword, 80).toLowerCase()
  const items = (await readAll(target))
    .map((item) => ({ ...item, enabled: isEnabled(item, target) }))
    .filter((item) => {
      if (!keyword) return true
      return [item.title, item.name, item.category, item.type]
        .some((value) => String(value || '').toLowerCase().includes(keyword))
    })
    .sort((left, right) => integer(left.sort, 999999999) - integer(right.sort, 999999999)
      || contentLabel(left).localeCompare(contentLabel(right), 'zh-CN', { numeric: true }))
    .slice(0, integer(payload.limit, 300, 1, 500))
  return { code: 0, data: items }
}

async function toggleContent(payload, admin) {
  const target = text(payload.target, 50)
  const id = text(payload.id, 100)
  const enabled = !!payload.enabled
  const config = CONTENT_TARGETS[target]
  if (!config || !id) return { code: -1, msg: '内容参数无效' }
  const update = config.enabledField === 'status'
    ? { status: enabled ? 'enabled' : 'disabled', updatedAt: db.serverDate() }
    : { enabled, updatedAt: db.serverDate() }
  await db.collection(target).doc(id).update({ data: update })
  await audit(admin, 'toggle_content', { target, id, enabled })
  return { code: 0, msg: enabled ? '已上线' : '已下线' }
}

function contentString(payload, current, field, maxLength = 200) {
  const value = payload[field] === undefined ? current[field] : payload[field]
  return text(value, maxLength)
}

function validResourceUrl(value, allowCloud = true) {
  if (!value) return true
  return /^(https:\/\/|cloud:\/\/)/i.test(value) && (allowCloud || /^https:\/\//i.test(value))
}

function contentLabel(item = {}) {
  return text(item.title || item.name, 200)
}

function normalizeEditableContent(target, payload, current) {
  const sort = integer(
    payload.sort === undefined ? current.sort : payload.sort,
    integer(current.sort, Date.now(), 0),
    0
  )

  if (target === 'audios') {
    const title = contentString(payload, current, 'title', 200)
    const category = contentString(payload, current, 'category', 50)
    const type = contentString(payload, current, 'type', 50) || '音频'
    const duration = contentString(payload, current, 'duration', 50)
    const fileId = contentString(payload, current, 'fileId', 1000)
    const fileUrl = contentString(payload, current, 'fileUrl', 2000)
    if (!title || !category) throw new Error('请填写音频标题和所属模块')
    if (!fileId && !fileUrl) throw new Error('请先上传或替换音频文件')
    if (!validResourceUrl(fileId) || !validResourceUrl(fileUrl, false)) throw new Error('音频文件地址无效')
    return { title, category, type, duration, fileId, fileUrl, sort }
  }

  if (target === 'materials') {
    const name = contentString(payload, current, 'name', 200)
    const description = contentString(payload, current, 'description', 2000)
    const type = contentString(payload, current, 'type', 20)
    const fileId = contentString(payload, current, 'fileId', 1000)
    const fileUrl = contentString(payload, current, 'fileUrl', 2000)
    const linkUrl = contentString(payload, current, 'linkUrl', 2000)
    const coverFileId = contentString(payload, current, 'coverFileId', 1000)
    const coverUrl = contentString(payload, current, 'coverUrl', 2000)
    const imageUrl = contentString(payload, current, 'imageUrl', 2000)
    if (!name) throw new Error('请填写资料名称')
    if (!['document', 'audio', 'image'].includes(type)) throw new Error('资料类型无效')
    if (!fileId && !fileUrl && !linkUrl) throw new Error('请先上传或替换资料文件')
    if (!validResourceUrl(fileId) || !validResourceUrl(coverFileId)
      || !validResourceUrl(fileUrl, false) || !validResourceUrl(linkUrl, false)
      || !validResourceUrl(coverUrl, false) || !validResourceUrl(imageUrl, false)) {
      throw new Error('资料地址必须使用 cloud:// 或 HTTPS')
    }
    return {
      name,
      description,
      type,
      category: type,
      accessType: 'coin',
      coinCost: 10,
      fileId,
      fileUrl,
      linkUrl,
      coverFileId,
      coverUrl,
      imageUrl,
      sort
    }
  }

  if (target === 'wallpapers') {
    const title = contentString(payload, current, 'title', 200)
    const fileId = contentString(payload, current, 'fileId', 1000)
    const imageUrl = contentString(payload, current, 'imageUrl', 2000)
    const type = contentString(payload, current, 'type', 50) || 'default'
    if (!title) throw new Error('请填写壁纸标题')
    if (!fileId && !imageUrl) throw new Error('请先上传或替换壁纸图片')
    if (!validResourceUrl(fileId) || !validResourceUrl(imageUrl, false)) throw new Error('壁纸地址无效')
    return { title, type, fileId, imageUrl, sort }
  }

  throw new Error('不支持的内容类型')
}

async function getContent(payload) {
  const target = text(payload.target, 50)
  const id = text(payload.id, 100)
  if (!CONTENT_TARGETS[target] || !id) return { code: -1, msg: '内容参数无效' }
  const result = await db.collection(target).doc(id).get().catch(() => ({ data: null }))
  if (!result.data) return { code: 404, msg: '内容不存在或已删除' }
  return { code: 0, data: { ...result.data, enabled: isEnabled(result.data, target) } }
}

async function saveContent(payload, admin) {
  const target = text(payload.target, 50)
  const id = text(payload.id, 100)
  if (!CONTENT_TARGETS[target] || !id) return { code: -1, msg: '内容参数无效' }
  const result = await db.collection(target).doc(id).get().catch(() => ({ data: null }))
  const current = result.data
  if (!current) return { code: 404, msg: '内容不存在或已删除' }
  const data = normalizeEditableContent(target, payload, current)
  await db.collection(target).doc(id).update({
    data: { ...data, updatedAt: db.serverDate() }
  })
  await audit(admin, 'update_content', { target, id, title: contentLabel(data), sort: data.sort })
  return { code: 0, msg: '内容已保存', data: { ...current, ...data, enabled: isEnabled(current, target) } }
}

async function reorderContentByName(payload, admin) {
  const target = text(payload.target, 50)
  const direction = text(payload.direction || 'asc', 10).toLowerCase()
  if (!CONTENT_TARGETS[target]) return { code: -1, msg: '不支持的内容类型' }
  if (!['asc', 'desc'].includes(direction)) return { code: -1, msg: '排序方向无效' }
  const items = (await readAll(target, 5000)).sort((left, right) => {
    const comparison = contentLabel(left).localeCompare(contentLabel(right), 'zh-CN', { numeric: true })
    return direction === 'asc' ? comparison : -comparison
  })
  // Batch writes keep a full name sort usable for libraries with hundreds of records.
  const batchSize = 20
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize)
    await Promise.all(batch.map((item, index) => db.collection(target).doc(item._id).update({
      data: { sort: (offset + index + 1) * 10, updatedAt: db.serverDate() }
    })))
  }
  await audit(admin, 'reorder_content_by_name', { target, direction, count: items.length })
  return { code: 0, msg: `已按名称${direction === 'asc' ? '升序' : '降序'}排序`, data: { count: items.length } }
}

function isQuestionEnabled(question = {}) {
  return question.enabled !== false && !['disabled', 'offline'].includes(question.status)
}

function questionBankId(question = {}) {
  return text(question.bankId || question.courseId, 100)
}

async function findQuestionBank(id) {
  const bankId = text(id, 100)
  if (!bankId) return null
  const bankRes = await db.collection('question_banks').doc(bankId).get().catch(() => ({ data: null }))
  if (bankRes.data) return { ...bankRes.data, _collection: 'question_banks' }
  const legacyRes = await db.collection('courses').doc(bankId).get().catch(() => ({ data: null }))
  return legacyRes.data ? { ...legacyRes.data, _collection: 'courses' } : null
}

async function listQuestionsForBank(bankId) {
  const [bankQuestions, courseQuestions] = await Promise.all([
    readAllWhere('questions', { bankId }),
    readAllWhere('questions', { courseId: bankId })
  ])
  const questions = new Map()
  bankQuestions.concat(courseQuestions).forEach((question) => {
    if (question && question._id) questions.set(question._id, question)
  })
  return Array.from(questions.values())
}

function toManagedQuestion(question = {}) {
  const options = Array.isArray(question.options) ? question.options.map((item) => text(item, 1000)) : []
  const enabled = isQuestionEnabled(question)
  return {
    _id: question._id || '',
    courseId: questionBankId(question),
    type: question.type === 'fill' ? 'fill' : 'choice',
    sort: integer(question.sort, 0, 0),
    content: text(question.content, 5000),
    imageUrl: text(question.imageUrl, 1000),
    options,
    correctIndex: integer(question.correctIndex, 0, 0),
    answer: text(question.answer, 5000),
    explanation: text(question.explanation, 10000),
    enabled,
    status: enabled ? 'enabled' : 'disabled',
    updatedAt: question.updatedAt || null
  }
}

function matchesQuestionKeyword(question, keyword) {
  if (!keyword) return true
  const values = [
    question.content,
    question.answer,
    question.explanation,
    ...(Array.isArray(question.options) ? question.options : [])
  ]
  return values.some((value) => String(value || '').toLowerCase().includes(keyword))
}

function requiredQuestionText(value, label, maxLength, required = false) {
  const result = String(value === undefined || value === null ? '' : value).trim()
  if (required && !result) throw new Error(`${label}不能为空`)
  if (result.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  return result
}

function questionSignature(bankId, type, content) {
  return `${bankId}|${type}|${String(content || '').replace(/\s+/g, ' ')}`
}

function validateManagedQuestion(payload = {}) {
  const type = text(payload.type, 20)
  if (!['choice', 'fill'].includes(type)) throw new Error('题型只能是选择题或填空题')
  const content = requiredQuestionText(payload.content, '题干', 5000, true)
  const explanation = requiredQuestionText(payload.explanation, '解析', 10000)
  const imageUrl = requiredQuestionText(payload.imageUrl, '题目图片地址', 1000)
  if (imageUrl && !/^(https:\/\/|cloud:\/\/)/i.test(imageUrl)) {
    throw new Error('题目图片地址只支持 https:// 或 cloud://')
  }
  const sort = integer(payload.sort, 0, 1)
  if (!sort) throw new Error('序号必须是正整数')

  if (type === 'choice') {
    if (!Array.isArray(payload.options)) throw new Error('请选择或填写选项')
    const options = payload.options.map((item) => requiredQuestionText(item, '选项', 1000))
    while (options.length && !options[options.length - 1]) options.pop()
    if (options.length < 2) throw new Error('选择题至少需要两个选项')
    if (options.length > 10) throw new Error('选择题最多支持十个选项')
    if (options.some((item) => !item)) throw new Error('选择题选项不能留空')
    const correctIndex = Number(payload.correctIndex)
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      throw new Error('请选择正确答案')
    }
    return {
      type,
      sort,
      content,
      imageUrl,
      options,
      correctIndex,
      answer: `${String.fromCharCode(65 + correctIndex)}. ${options[correctIndex]}`,
      explanation
    }
  }

  return {
    type,
    sort,
    content,
    imageUrl,
    options: [],
    correctIndex: 0,
    answer: requiredQuestionText(payload.answer, '参考答案', 5000, true),
    explanation
  }
}

async function getManagedQuestion(payload) {
  const id = text(payload.id, 100)
  const courseId = text(payload.courseId, 100)
  if (!id || !courseId) throw new Error('题目或题库参数无效')
  const result = await db.collection('questions').doc(id).get().catch(() => ({ data: null }))
  const question = result.data
  if (!question) throw new Error('题目不存在或已删除')
  if (questionBankId(question) !== courseId) throw new Error('题目不属于当前题库')
  return question
}

async function syncQuestionBankTotal(bankId) {
  const questions = await listQuestionsForBank(bankId)
  const totalCount = questions.filter(isQuestionEnabled).length
  const bank = await findQuestionBank(bankId)
  if (bank) {
    await db.collection(bank._collection).doc(bankId).update({
      data: { totalCount, updatedAt: db.serverDate() }
    })
  }
  return totalCount
}

async function listManagedQuestions(payload) {
  const courseId = text(payload.courseId, 100)
  if (!courseId) return { code: -1, msg: '请选择题库' }
  const bank = await findQuestionBank(courseId)
  if (!bank) return { code: 404, msg: '题库不存在或已删除' }
  const keyword = text(payload.keyword, 80).toLowerCase()
  const page = integer(payload.page, 1, 1, 100000)
  const pageSize = integer(payload.pageSize, 20, 1, 50)
  const items = (await listQuestionsForBank(courseId))
    .filter((question) => matchesQuestionKeyword(question, keyword))
    .sort((left, right) => integer(left.sort, 999999999) - integer(right.sort, 999999999)
      || String(left._id || '').localeCompare(String(right._id || '')))
    .map(toManagedQuestion)
  const offset = (page - 1) * pageSize
  return {
    code: 0,
    data: {
      bank: { _id: bank._id, name: text(bank.name, 100) },
      items: items.slice(offset, offset + pageSize),
      total: items.length,
      page,
      pageSize,
      hasMore: offset + pageSize < items.length
    }
  }
}

async function saveManagedQuestion(payload, admin) {
  const question = await getManagedQuestion(payload)
  const normalized = validateManagedQuestion(payload)
  const bankId = questionBankId(question)
  const importKey = crypto.createHash('sha256')
    .update(questionSignature(bankId, normalized.type, normalized.content))
    .digest('hex')
  const duplicateRes = await db.collection('questions').where({ importKey }).limit(5).get()
  let duplicate = (duplicateRes.data || []).find((item) => item._id !== question._id)
  // 早期导入的题目可能没有 importKey，编辑时仍不能制造同题重复。
  if (!duplicate) {
    const signature = questionSignature(bankId, normalized.type, normalized.content)
    duplicate = (await listQuestionsForBank(bankId)).find((item) => (
      item._id !== question._id
      && questionSignature(bankId, item.type, item.content) === signature
    ))
  }
  if (duplicate) return { code: -1, msg: '题库中已存在题干和题型相同的题目' }

  await db.collection('questions').doc(question._id).update({
    data: {
      ...normalized,
      importKey,
      updatedAt: db.serverDate()
    }
  })
  await audit(admin, 'update_question', { id: question._id, courseId: bankId, type: normalized.type })
  return { code: 0, msg: '题目已保存', data: toManagedQuestion({ ...question, ...normalized, importKey }) }
}

async function toggleManagedQuestion(payload, admin) {
  const question = await getManagedQuestion(payload)
  const enabled = payload.enabled === true
  const bankId = questionBankId(question)
  await db.collection('questions').doc(question._id).update({
    data: {
      enabled,
      status: enabled ? 'enabled' : 'disabled',
      updatedAt: db.serverDate()
    }
  })
  const totalCount = await syncQuestionBankTotal(bankId)
  await audit(admin, 'toggle_question', { id: question._id, courseId: bankId, enabled })
  return { code: 0, msg: enabled ? '题目已上线' : '题目已下线', data: { id: question._id, enabled, totalCount } }
}

async function deleteManagedQuestion(payload, admin) {
  const question = await getManagedQuestion(payload)
  const bankId = questionBankId(question)
  await db.collection('questions').doc(question._id).remove()
  const totalCount = await syncQuestionBankTotal(bankId)
  await audit(admin, 'delete_question', { id: question._id, courseId: bankId })
  return { code: 0, msg: '题目已永久删除', data: { id: question._id, totalCount } }
}

async function listUsers(payload, admin) {
  if (!isSuperAdminUser(admin)) return { code: 403, msg: '仅最高管理员可查看全部用户' }
  const page = integer(payload.page, 1, 1, 100000)
  const pageSize = integer(payload.pageSize, 20, 1, 50)
  const offset = (page - 1) * pageSize
  const [countRes, usersRes] = await Promise.all([
    db.collection('users').count(),
    db.collection('users')
      .orderBy('_id', 'desc')
      .skip(offset)
      .limit(pageSize)
      .get()
  ])
  const items = (usersRes.data || []).map(publicAdminUser)
  const total = integer(countRes.total, 0, 0)
  return {
    code: 0,
    data: {
      items,
      page,
      pageSize,
      total,
      hasMore: offset + items.length < total
    }
  }
}

async function searchUsers(payload, admin) {
  const keyword = text(payload.keyword, 80).toLowerCase()
  if (!keyword) return { code: -1, msg: '请输入手机号或昵称' }
  const users = await readAll('users', 5000)
  const matched = users
    .filter((user) => (
      String(user.phone || '').includes(keyword)
      || String(user.nickName || '').toLowerCase().includes(keyword)
      || String(user._id || '').toLowerCase() === keyword
    ))
    .sort((left, right) => {
      const leftTime = new Date(left.lastLoginAt || left.createdAt || 0).getTime()
      const rightTime = new Date(right.lastLoginAt || right.createdAt || 0).getTime()
      return rightTime - leftTime
    })
    .slice(0, 50)
    .map(publicAdminUser)
  return { code: 0, data: matched }
}

async function getAdminIdentity(admin) {
  const users = await readAll('users', 5000)
  return {
    code: 0,
    data: {
      current: publicAdminUser(admin),
      hasSuperAdmin: users.some(isSuperAdminUser)
    }
  }
}

async function listAdministrators(admin) {
  if (!isSuperAdminUser(admin)) return { code: 403, msg: '仅最高管理员可查看管理员列表' }
  const users = await readAll('users', 5000)
  const administrators = users
    .filter(isAdminUser)
    .sort((left, right) => {
      if (isSuperAdminUser(left) !== isSuperAdminUser(right)) return isSuperAdminUser(left) ? -1 : 1
      return String(left.nickName || '').localeCompare(String(right.nickName || ''), 'zh-CN')
    })
    .map(publicAdminUser)
  return { code: 0, data: administrators }
}

async function bootstrapSuperAdmin(payload, admin) {
  const userId = text(payload.userId, 100)
  if (!userId) return { code: -1, msg: '请选择最高管理员账号' }

  const users = await readAll('users', 5000)
  const existing = users.find(isSuperAdminUser)
  if (existing) return { code: -1, msg: '最高管理员已存在，不能重复初始化' }

  const target = users.find((user) => user._id === userId)
  if (!target) return { code: -1, msg: '目标用户不存在' }

  await db.collection('users').doc(userId).update({
    data: {
      isAdmin: true,
      isSuperAdmin: true,
      role: 'super_admin',
      updatedAt: db.serverDate()
    }
  })
  await audit(admin, 'bootstrap_super_admin', {
    userId,
    userName: text(target.nickName || '未设置昵称', 40),
    userPhone: text(target.phone || '', 30)
  })
  return {
    code: 0,
    msg: '最高管理员已初始化',
    data: publicAdminUser({ ...target, isAdmin: true, isSuperAdmin: true, role: 'super_admin' })
  }
}

async function setAdministrator(payload, admin) {
  if (!isSuperAdminUser(admin)) return { code: 403, msg: '仅最高管理员可设置管理员' }
  const userId = text(payload.userId, 100)
  const enabled = payload.enabled === true
  if (!userId) return { code: -1, msg: '请选择用户' }

  const userRes = await db.collection('users').doc(userId).get().catch(() => ({ data: null }))
  const user = userRes.data
  if (!user) return { code: -1, msg: '用户不存在' }
  if (isSuperAdminUser(user)) return { code: -1, msg: '最高管理员不能在这里取消权限' }

  const update = enabled
    ? { isAdmin: true, isSuperAdmin: false, role: 'admin', updatedAt: db.serverDate() }
    : { isAdmin: false, isSuperAdmin: false, role: 'user', updatedAt: db.serverDate() }
  await db.collection('users').doc(userId).update({ data: update })
  await audit(admin, enabled ? 'grant_admin' : 'revoke_admin', {
    userId,
    userName: text(user.nickName || '未设置昵称', 40)
  })
  return {
    code: 0,
    msg: enabled ? '已设为管理员' : '已取消管理员',
    data: publicAdminUser({ ...user, ...update })
  }
}

async function transferSuperAdmin(payload, admin) {
  if (!isSuperAdminUser(admin)) return { code: 403, msg: '仅最高管理员可移交权限' }
  const userId = text(payload.userId, 100)
  if (!userId) return { code: -1, msg: '请选择接收用户' }
  if (userId === admin._id) return { code: -1, msg: '当前用户已经是最高管理员' }

  const targetRes = await db.collection('users').doc(userId).get().catch(() => ({ data: null }))
  const target = targetRes.data
  if (!target) return { code: -1, msg: '接收用户不存在' }

  await db.runTransaction(async (transaction) => {
    const currentRes = await transaction.collection('users').doc(admin._id).get()
    const latestTargetRes = await transaction.collection('users').doc(userId).get()
    if (!isSuperAdminUser(currentRes.data)) throw new Error('最高管理员身份已变化，请刷新后重试')
    if (!latestTargetRes.data) throw new Error('接收用户不存在')

    await transaction.collection('users').doc(admin._id).update({
      data: {
        isAdmin: true,
        isSuperAdmin: false,
        role: 'admin',
        updatedAt: db.serverDate()
      }
    })
    await transaction.collection('users').doc(userId).update({
      data: {
        isAdmin: true,
        isSuperAdmin: true,
        role: 'super_admin',
        updatedAt: db.serverDate()
      }
    })
  })

  await audit(admin, 'transfer_super_admin', {
    fromUserId: admin._id,
    toUserId: userId,
    toUserName: text(target.nickName || '未设置昵称', 40)
  })
  return {
    code: 0,
    msg: '最高管理员已移交',
    data: publicAdminUser({ ...target, isAdmin: true, isSuperAdmin: true, role: 'super_admin' })
  }
}

async function grantAccess(payload, admin) {
  const userId = text(payload.userId, 100)
  const planCode = text(payload.planCode, 80)
  const reason = text(payload.reason, 200)
  const plan = PLAN_GRANTS[planCode]
  if (!userId || !plan) return { code: -1, msg: '请选择用户和赠送套餐' }
  if (!reason) return { code: -1, msg: '请填写赠送原因，便于审计' }

  const userRes = await db.collection('users').doc(userId).get().catch(() => ({ data: null }))
  const user = userRes.data
  if (!user) return { code: -1, msg: '用户不存在' }

  const now = new Date()
  const vipExpireDate = addDaysFromCurrent(user.vipExpireDate, plan.vipDays, now)
  const supervisionExpireDate = plan.supervisionDays > 0
    ? addDaysFromCurrent(user.supervisionExpireDate, plan.supervisionDays, now)
    : (user.supervisionExpireDate || null)

  await db.collection('users').doc(userId).update({
    data: {
      isVip: true,
      isFreeTrial: false,
      vipExpireDate,
      supervisionExpireDate,
      lastVipPlanCode: planCode,
      lastVipPlanLabel: `管理员赠送${plan.label}`,
      updatedAt: db.serverDate()
    }
  })

  await ensureCollection('manual_grants')
  const grantResult = await db.collection('manual_grants').add({
    data: {
      userId,
      userNickName: text(user.nickName || '未设置昵称', 40),
      userPhone: text(user.phone, 30),
      planCode,
      planLabel: plan.label,
      vipDays: plan.vipDays,
      supervisionDays: plan.supervisionDays,
      reason,
      adminUserId: admin._id || '',
      adminName: text(admin.nickName || '管理员', 40),
      createdAt: db.serverDate()
    }
  })
  await audit(admin, 'grant_user_access', { userId, planCode, reason, grantId: grantResult._id })
  return {
    code: 0,
    msg: '权限已开通',
    data: publicUser({ ...user, isVip: true, isFreeTrial: false, vipExpireDate, supervisionExpireDate })
  }
}

async function listGrants() {
  await ensureCollection('manual_grants')
  const result = await db.collection('manual_grants').orderBy('createdAt', 'desc').limit(50).get()
  return { code: 0, data: result.data || [] }
}

async function getMiniProgramCode() {
  await ensureCollection('mini_program_codes')
  const result = await db.collection('mini_program_codes').doc('release-home').get().catch(() => ({ data: null }))
  return { code: 0, data: result.data || null }
}

async function generateMiniProgramCode(payload, admin) {
  const page = text(payload.page || 'pages/home/home', 128)
  const scene = text(payload.scene || 'share', 32)
  const response = await cloud.openapi.wxacode.getUnlimited({
    scene,
    page,
    checkPath: true,
    envVersion: 'release',
    width: 430,
    autoColor: false,
    lineColor: { r: 15, g: 23, b: 42 },
    isHyaline: false
  })
  const buffer = normalizeBinaryResponse(response)
  if (!buffer || !buffer.length) throw new Error('微信未返回有效小程序码，请确认小程序已发布')

  const cloudPath = `admin/mini-program-code/release-home-${Date.now()}.png`
  const upload = await cloud.uploadFile({ cloudPath, fileContent: buffer })
  await ensureCollection('mini_program_codes')
  const data = {
    fileId: upload.fileID,
    page,
    scene,
    envVersion: 'release',
    updatedBy: admin._id || '',
    updatedAt: db.serverDate()
  }
  await db.collection('mini_program_codes').doc('release-home').set({ data })
  await audit(admin, 'generate_mini_program_code', { page, scene, fileId: upload.fileID })
  return { code: 0, msg: '正式小程序码已生成', data }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { code: 401, msg: '请先登录' }
  try {
    const admin = await getAdmin(OPENID)
    if (!admin) return { code: 403, msg: '仅管理员可操作' }
    const action = text(event.action, 80)
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}

    if (action === 'listCourseTree') return { code: 0, data: await listCourseTree() }
    if (action === 'saveSubject') return await saveSubject(payload, admin)
    if (action === 'saveBank') return await saveBank(payload, admin)
    if (action === 'listContent') return await listContent(payload)
    if (action === 'toggleContent') return await toggleContent(payload, admin)
    if (action === 'getContent') return await getContent(payload)
    if (action === 'saveContent') return await saveContent(payload, admin)
    if (action === 'reorderContentByName') return await reorderContentByName(payload, admin)
    if (action === 'listManagedQuestions') return await listManagedQuestions(payload)
    if (action === 'saveManagedQuestion') return await saveManagedQuestion(payload, admin)
    if (action === 'toggleManagedQuestion') return await toggleManagedQuestion(payload, admin)
    if (action === 'deleteManagedQuestion') return await deleteManagedQuestion(payload, admin)
    if (action === 'listUsers') return await listUsers(payload, admin)
    if (action === 'searchUsers') return await searchUsers(payload, admin)
    if (action === 'getAdminIdentity') return await getAdminIdentity(admin)
    if (action === 'listAdministrators') return await listAdministrators(admin)
    if (action === 'bootstrapSuperAdmin') return await bootstrapSuperAdmin(payload, admin)
    if (action === 'setAdministrator') return await setAdministrator(payload, admin)
    if (action === 'transferSuperAdmin') return await transferSuperAdmin(payload, admin)
    if (action === 'grantAccess') return await grantAccess(payload, admin)
    if (action === 'listGrants') return await listGrants()
    if (action === 'getMiniProgramCode') return await getMiniProgramCode()
    if (action === 'generateMiniProgramCode') return await generateMiniProgramCode(payload, admin)
    return { code: -1, msg: '不支持的管理员操作' }
  } catch (err) {
    console.error('[adminOperations] failed', err)
    return { code: -1, msg: err.message || '管理员操作失败' }
  }
}
