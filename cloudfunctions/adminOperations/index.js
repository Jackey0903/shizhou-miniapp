const cloud = require('wx-server-sdk')
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
    .sort((left, right) => integer(right.sort, 0) - integer(left.sort, 0))
    .slice(0, integer(payload.limit, 100, 1, 300))
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
  if (!isSuperAdminUser(admin)) return { code: 403, msg: '仅最高管理员可搜索用户' }
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
    if (action === 'saveSubject') return saveSubject(payload, admin)
    if (action === 'saveBank') return saveBank(payload, admin)
    if (action === 'listContent') return listContent(payload)
    if (action === 'toggleContent') return toggleContent(payload, admin)
    if (action === 'listUsers') return listUsers(payload, admin)
    if (action === 'searchUsers') return searchUsers(payload, admin)
    if (action === 'getAdminIdentity') return getAdminIdentity(admin)
    if (action === 'listAdministrators') return listAdministrators(admin)
    if (action === 'bootstrapSuperAdmin') return bootstrapSuperAdmin(payload, admin)
    if (action === 'setAdministrator') return setAdministrator(payload, admin)
    if (action === 'transferSuperAdmin') return transferSuperAdmin(payload, admin)
    if (action === 'grantAccess') return grantAccess(payload, admin)
    if (action === 'listGrants') return listGrants()
    if (action === 'getMiniProgramCode') return getMiniProgramCode()
    if (action === 'generateMiniProgramCode') return generateMiniProgramCode(payload, admin)
    return { code: -1, msg: '不支持的管理员操作' }
  } catch (err) {
    console.error('[adminOperations] failed', err)
    return { code: -1, msg: err.message || '管理员操作失败' }
  }
}
