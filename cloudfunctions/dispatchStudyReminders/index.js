const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function truncate(text, max = 20) {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

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

function formatSendTime(date) {
  const value = toChinaDate(date)
  const year = value.getUTCFullYear()
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${value.getUTCDate()}`.padStart(2, '0')
  const hour = `${value.getUTCHours()}`.padStart(2, '0')
  const minute = `${value.getUTCMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function buildNextRemindAt(time, baseDate = new Date()) {
  const [hour, minute] = String(time || '20:00').split(':').map((item) => Number(item || 0))
  const chinaBase = toChinaDate(baseDate)
  const nextChina = new Date(Date.UTC(
    chinaBase.getUTCFullYear(),
    chinaBase.getUTCMonth(),
    chinaBase.getUTCDate() + 1,
    hour,
    minute,
    0,
    0
  ))
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

async function getConfig() {
  await ensureCollection('notification_settings')
  const res = await db.collection('notification_settings').where({ key: 'study_reminder', enabled: true }).limit(1).get().catch(() => ({ data: [] }))
  return (res.data || [])[0] || null
}

async function writeRunLog(data) {
  await ensureCollection('reminder_dispatch_logs')
  return db.collection('reminder_dispatch_logs').add({
    data: {
      status: data.status || 'unknown',
      msg: data.msg || '',
      checked: Number(data.checked || 0),
      sent: Number(data.sent || 0),
      failed: Number(data.failed || 0),
      detail: data.detail || '',
      createdAt: db.serverDate()
    }
  })
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const limit = Math.max(1, Math.min(Number(event.limit || 50), 100))
  try {
    // 定时触发器没有 OPENID；小程序客户端调用始终带 OPENID，必须拒绝。
    if (OPENID) {
      return { code: 403, msg: '无权执行提醒派发', sent: 0, failed: 0, checked: 0 }
    }

    await ensureCollection('study_reminders')
    const config = await getConfig()
    if (!config || !config.templateId) {
      return { code: -1, msg: '请先配置并启用学习提醒模板' }
    }

    const now = new Date()
    const dueRes = await db.collection('study_reminders')
      .where({ active: true, nextRemindAt: _.lte(now) })
      .orderBy('nextRemindAt', 'asc')
      .limit(limit)
      .get()
    const dueList = dueRes.data || []
    if (!dueList.length) {
      const result = { code: 0, msg: '当前没有到期提醒', sent: 0, failed: 0, checked: 0 }
      await writeRunLog({ status: 'empty', ...result })
      return result
    }

    let sent = 0
    let failed = 0
    for (const reminder of dueList) {
      const userRes = await db.collection('users').where({ _openid: reminder._openid }).limit(1).get()
      const user = (userRes.data || [])[0]
      const supervisionActive = user && user.supervisionExpireDate && new Date(user.supervisionExpireDate).getTime() > now.getTime()
      if (!supervisionActive) {
        await db.collection('study_reminders').doc(reminder._id).update({
          data: {
            active: false,
            lastError: '督学服务已到期，提醒已停用',
            updatedAt: db.serverDate()
          }
        })
        failed += 1
        continue
      }

      const data = {}
      data[config.thingKey || 'thing1'] = { value: truncate((config.titlePrefix ? `${config.titlePrefix}：` : '') + reminder.title, 20) }
      data[config.timeKey || 'time2'] = { value: formatSendTime(reminder.nextRemindAt || now) }
      data[config.remarkKey || 'thing3'] = { value: truncate('点击进入小程序继续学习', 20) }

      try {
        await cloud.openapi.subscribeMessage.send({
          touser: reminder._openid,
          templateId: config.templateId,
          page: reminder.page || config.page || 'pages/supervision-plan/supervision-plan',
          data,
          lang: 'zh_CN',
          miniprogramState: config.miniprogramState || 'formal'
        })
        const nextRemindAt = buildNextRemindAt(reminder.time, new Date(reminder.nextRemindAt || now))
        await db.collection('study_reminders').doc(reminder._id).update({
          data: {
            lastSentAt: db.serverDate(),
            lastError: '',
            sentCount: _.inc(1),
            nextRemindAt,
            nextDateStr: formatDate(nextRemindAt),
            updatedAt: db.serverDate()
          }
        })
        sent += 1
      } catch (err) {
        const nextRemindAt = buildNextRemindAt(reminder.time, new Date(reminder.nextRemindAt || now))
        await db.collection('study_reminders').doc(reminder._id).update({
          data: {
            lastError: err.errMsg || err.message || JSON.stringify(err),
            failCount: _.inc(1),
            nextRemindAt,
            nextDateStr: formatDate(nextRemindAt),
            updatedAt: db.serverDate()
          }
        })
        failed += 1
      }
    }

    const result = { code: 0, msg: '提醒派发完成', sent, failed, checked: dueList.length }
    await writeRunLog({ status: failed ? 'partial' : 'success', ...result })
    return result
  } catch (err) {
    const result = { code: -1, msg: err.message, sent: 0, failed: 0, checked: 0 }
    await writeRunLog({ status: 'error', ...result, detail: err.stack || err.message || '' })
    return result
  }
}
