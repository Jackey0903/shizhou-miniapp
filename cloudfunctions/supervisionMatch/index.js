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

async function upsertProfile(openid, mode, profile) {
    await ensureCollection()
    const current = await db.collection('supervision_profiles')
        .where({ _openid: openid, mode })
        .limit(1)
        .get()

    const userBase = await getUserBase(openid)
    const payload = {
        _openid: openid,
        mode,
        status: 'active',
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

    return {
        mine: mineRes.data[0] || null,
        matches: listRes.data || []
    }
}

exports.main = async (event) => {
    const { OPENID } = cloud.getWXContext()
    const { action = 'list', mode = 'full', profile = {} } = event || {}

    try {
        if (!OPENID) {
            return { code: -1, msg: '未获取到用户身份' }
        }

        if (action === 'upsert') {
            if (!profile.contact) {
                return { code: -1, msg: '请先填写联系方式' }
            }
            await upsertProfile(OPENID, mode, profile)
        } else if (action === 'leave') {
            await leaveProfile(OPENID, mode)
        }

        const data = await listProfiles(OPENID, mode)
        return { code: 0, data }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
