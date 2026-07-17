const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000

function toChinaDate(date) {
  return new Date(new Date(date).getTime() + CHINA_OFFSET_MS)
}

function fromChinaDate(date) {
  return new Date(new Date(date).getTime() - CHINA_OFFSET_MS)
}

function formatDate(date) {
  const value = toChinaDate(date)
  const year = value.getUTCFullYear()
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${value.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildNextRemindAt(time, now = new Date()) {
  const [hour, minute] = String(time || '20:00').split(':').map((item) => Number(item || 0))
  const chinaNow = toChinaDate(now)
  const nextChina = new Date(Date.UTC(
    chinaNow.getUTCFullYear(),
    chinaNow.getUTCMonth(),
    chinaNow.getUTCDate(),
    hour,
    minute,
    0,
    0
  ))
  if (nextChina <= chinaNow) {
    nextChina.setUTCDate(nextChina.getUTCDate() + 1)
  }
  return fromChinaDate(nextChina)
}

async function ensureCollection(name) {
  try {
    await db.collection(name).limit(1).get()
    return true
  } catch (err) {
    const msg = String((err && err.message) || err || '')
    if (!msg.includes('Db or Table not exist') && !msg.includes('COLLECTION_NOT_EXIST')) {
      throw err
    }
  }
  try {
    await db.createCollection(name)
  } catch (err) {
    const msg = String((err && err.message) || err || '')
    if (!msg.includes('Table exist') && !msg.includes('ResourceExist')) {
      throw err
    }
  }
  return true
}

async function getReminderConfig() {
  await ensureCollection('notification_settings')
  const enabled = await db.collection('notification_settings').where({ key: 'study_reminder', enabled: true }).limit(1).get().catch(() => ({ data: [] }))
  if (enabled.data && enabled.data.length) return enabled.data[0]
  const fallback = await db.collection('notification_settings').where({ key: 'study_reminder' }).limit(1).get().catch(() => ({ data: [] }))
  return (fallback.data || [])[0] || null
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const { action, payload = {} } = event

  try {
    await ensureCollection('study_reminders')

    if (action === 'getConfig') {
      const config = await getReminderConfig()
      return { code: 0, data: config }
    }

    if (action === 'list') {
      const where = { _openid: OPENID, active: true }
      if (payload.mode) where.mode = payload.mode
      const res = await db.collection('study_reminders').where(where).orderBy('nextRemindAt', 'asc').get()
      return { code: 0, data: res.data || [] }
    }

    if (action === 'save') {
      const mode = payload.mode || 'full'
      const title = String(payload.title || '').trim()
      const time = String(payload.time || '').trim()
      if (!title) return { code: -1, msg: '请填写提醒内容' }
      if (!/^\d{2}:\d{2}$/.test(time)) return { code: -1, msg: '提醒时间格式不正确' }

      const config = await getReminderConfig()
      const nextRemindAt = buildNextRemindAt(time)
      const data = {
        _openid: OPENID,
        mode,
        title,
        time,
        active: true,
        nextRemindAt,
        nextDateStr: formatDate(nextRemindAt),
        page: (config && config.page) || 'pages/supervision-plan/supervision-plan',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
        lastSentAt: null,
        lastError: '',
        sentCount: 0,
        failCount: 0
      }
      await db.collection('study_reminders').add({ data })
      const res = await db.collection('study_reminders').where({ _openid: OPENID, active: true, mode }).orderBy('nextRemindAt', 'asc').get()
      return { code: 0, msg: '提醒已保存', data: res.data || [] }
    }

    if (action === 'remove') {
      if (!payload.id) return { code: -1, msg: '缺少提醒ID' }
      const found = await db.collection('study_reminders').where({ _id: payload.id, _openid: OPENID }).limit(1).get()
      const reminder = (found.data || [])[0]
      if (!reminder) return { code: -1, msg: '提醒不存在' }
      await db.collection('study_reminders').doc(reminder._id).update({
        data: { active: false, updatedAt: db.serverDate() }
      })
      const res = await db.collection('study_reminders').where({ _openid: OPENID, active: true, mode: reminder.mode }).orderBy('nextRemindAt', 'asc').get()
      return { code: 0, msg: '提醒已删除', data: res.data || [] }
    }

    return { code: -1, msg: '不支持的操作' }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
