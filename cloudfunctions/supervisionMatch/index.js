const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function ensureCollection() {
    try {
        await db.createCollection('supervision_profiles')
    } catch (err) {
        const msg = err && err.message ? err.message : ''
        if (!msg.includes('ResourceExist') && !msg.includes('Table exist') && !msg.includes('existed')) {
            throw err
        }
    }
}

async function getUserBase(openid) {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    return res.data[0] || {}
}

function hasActiveSupervision(user = {}) {
    if (!user.supervisionExpireDate) return false
    const expireTime = new Date(user.supervisionExpireDate).getTime()
    return Number.isFinite(expireTime) && expireTime > Date.now()
}

async function upsertProfile(openid, mode, profile, status) {
    await ensureCollection()
    const current = await db.collection('supervision_profiles')
        .where({ _openid: openid, mode })
        .limit(1)
        .get()

    const userBase = await getUserBase(openid)
    const payload = {
        _openid: openid,
        mode,
        status,
        displayName: profile.displayName || userBase.nickName || '考友',
        contact: profile.contact || '',
        examType: profile.examType || '',
        goal: profile.goal || profile.examType || '',
        city: profile.city || profile.targetCityLabel || profile.targetCity || '',
        targetProvince: profile.targetProvince || '',
        targetCity: profile.targetCity || '',
        targetDistrict: profile.targetDistrict || '',
        targetCityLabel: profile.targetCityLabel || profile.city || profile.targetCity || '',
        examDate: profile.examDate || '',
        avgHours: profile.avgHours || profile.studyHours || '',
        studyHours: profile.studyHours || profile.avgHours || '',
        dailyPeriods: Array.isArray(profile.dailyPeriods) ? profile.dailyPeriods : [],
        modules: Array.isArray(profile.modules) ? profile.modules : [],
        candidateType: profile.candidateType || '',
        slogan: profile.slogan || '',
        avatarUrl: userBase.avatarUrl || '',
        updatedAt: db.serverDate()
    }

    if (current.data.length > 0) {
        await db.collection('supervision_profiles').doc(current.data[0]._id).update({ data: payload })
        return current.data[0]._id
    }

    const addRes = await db.collection('supervision_profiles').add({
        data: {
            ...payload,
            createdAt: db.serverDate()
        }
    })
    return addRes._id
}

async function leaveProfile(openid, mode) {
    await ensureCollection()
    const current = await db.collection('supervision_profiles')
        .where({ _openid: openid, mode })
        .limit(1)
        .get()

    if (current.data.length === 0) return

    await db.collection('supervision_profiles').doc(current.data[0]._id).update({
        data: {
            status: 'inactive',
            updatedAt: db.serverDate()
        }
    })
}

async function listProfiles(openid, mode) {
    await ensureCollection()

    const [mineRes, listRes] = await Promise.all([
        db.collection('supervision_profiles')
            .where({ _openid: openid, mode, status: 'active' })
            .limit(1)
            .get(),
        db.collection('supervision_profiles')
            .where({
                mode,
                status: 'active',
                _openid: _.neq(openid)
            })
            .orderBy('updatedAt', 'desc')
            .limit(20)
            .get()
    ])

    const matches = (listRes.data || []).map((item) => ({
        _id: item._id,
        mode: item.mode,
        displayName: item.displayName || '考友',
        examType: item.examType || '',
        goal: item.goal || '',
        city: item.city || '',
        targetCityLabel: item.targetCityLabel || '',
        examDate: item.examDate || '',
        avgHours: item.avgHours || '',
        dailyPeriods: Array.isArray(item.dailyPeriods) ? item.dailyPeriods : [],
        modules: Array.isArray(item.modules) ? item.modules : [],
        candidateType: item.candidateType || '',
        slogan: item.slogan || '',
        avatarUrl: item.avatarUrl || ''
    }))

    return {
        mine: mineRes.data[0] || null,
        matches,
        matchCount: matches.length
    }
}

async function getPrivateData(openid) {
    const res = await db.collection('supervision').where({ _openid: openid }).limit(1).get()
    return (res.data || [])[0] || null
}

async function savePrivateData(openid, input = {}) {
    const payload = {
        profiles: input.profiles && typeof input.profiles === 'object' ? input.profiles : {},
        reminders: input.reminders && typeof input.reminders === 'object' ? input.reminders : {},
        topics: input.topics && typeof input.topics === 'object' ? input.topics : {},
        updatedAt: db.serverDate()
    }
    if (JSON.stringify(payload).length > 100000) throw new Error('督学资料内容过大')
    const current = await getPrivateData(openid)
    if (current) {
        await db.collection('supervision').doc(current._id).update({ data: payload })
        return { ...current, ...payload }
    }
    const id = `supervision_${require('crypto').createHash('sha256').update(openid).digest('hex').slice(0, 32)}`
    await db.collection('supervision').doc(id).set({
        data: { _openid: openid, ...payload, createdAt: db.serverDate() }
    })
    return { _id: id, _openid: openid, ...payload }
}

exports.main = async (event) => {
    const { OPENID } = cloud.getWXContext()
    const { action = 'list', mode = 'full', profile = {} } = event || {}

    try {
        if (!OPENID) {
            return { code: -1, msg: '未获取到用户身份' }
        }

        if (action === 'getData') {
            return { code: 0, data: await getPrivateData(OPENID) }
        }
        if (action === 'saveData') {
            return { code: 0, data: await savePrivateData(OPENID, event.data || {}) }
        }

        if (action === 'upsert') {
            if (!profile.contact) {
                return { code: -1, msg: '请先填写联系方式' }
            }
            const user = await getUserBase(OPENID)
            const active = hasActiveSupervision(user)
            await upsertProfile(OPENID, mode, profile, active ? 'active' : 'pending_payment')
            if (!active) {
                return { code: 402, msg: '请先开通督学', data: { pendingPayment: true } }
            }
        } else if (action === 'leave') {
            await leaveProfile(OPENID, mode)
        }

        const data = await listProfiles(OPENID, mode)
        return { code: 0, data }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
