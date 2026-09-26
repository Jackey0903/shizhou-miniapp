const cloud = require('wx-server-sdk')
const crypto = require('node:crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PUBLIC_STATUSES = ['published', 'active', 'pending_payment']

async function ensureCollection(name = 'supervision_profiles') {
    try {
        await db.createCollection(name)
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
        status: 'published',
        displayName: String(profile.displayName || userBase.nickName || '考友').trim().slice(0, 24),
        contact: String(profile.contact || '').trim().slice(0, 100),
        examType: String(profile.examType || '').trim().slice(0, 30),
        goal: profile.goal || profile.examType || '',
        city: String(profile.city || profile.targetCityLabel || profile.targetCity || '').trim().slice(0, 80),
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
        slogan: String(profile.slogan || '').trim().slice(0, 140),
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
    await ensureCollection('supervision_match_interests')
    for (const field of ['fromOpenid', 'toOpenid']) {
        while (true) {
            const res = await db.collection('supervision_match_interests').where({ [field]: openid }).limit(100).get()
            if (!res.data.length) break
            await Promise.all(res.data.map((item) => db.collection('supervision_match_interests').doc(item._id).remove()))
        }
    }
}

function interestId(from, to) {
    return `match_${crypto.createHash('sha256').update(`${from}:${to}`).digest('hex').slice(0, 40)}`
}

async function setInterest(openid, targetId, remove = false) {
    await ensureCollection()
    await ensureCollection('supervision_match_interests')
    const own = await db.collection('supervision_profiles')
        .where({ _openid: openid, status: _.in(PUBLIC_STATUSES) }).limit(1).get()
    if (!own.data.length) return { code: -1, msg: '请先发布自己的备考帖子' }
    const targetRes = await db.collection('supervision_profiles').doc(targetId).get().catch(() => null)
    const target = targetRes && targetRes.data
    if (!target || !PUBLIC_STATUSES.includes(target.status) || target._openid === openid) {
        return { code: -1, msg: '该帖子已不可匹配' }
    }
    const ref = db.collection('supervision_match_interests').doc(interestId(openid, target._openid))
    if (remove) {
        await ref.remove().catch((err) => {
            if (!/not found|does not exist/i.test(err.message || '')) throw err
        })
    } else {
        await ref.set({ data: {
            fromOpenid: openid,
            toOpenid: target._openid,
            createdAt: db.serverDate()
        } })
    }
    return { code: 0 }
}

async function listProfiles(openid, mode, page = 0) {
    await ensureCollection()
    await ensureCollection('supervision_match_interests')
    const pageNumber = Math.max(0, Math.min(500, Math.floor(Number(page) || 0)))

    const [mineRes, anyMineRes, listRes, outgoingRes, incomingRes] = await Promise.all([
        db.collection('supervision_profiles')
            .where({ _openid: openid, mode, status: _.in(PUBLIC_STATUSES) })
            .limit(1)
            .get(),
        db.collection('supervision_profiles')
            .where({ _openid: openid, status: _.in(PUBLIC_STATUSES) })
            .limit(1)
            .get(),
        db.collection('supervision_profiles')
            .where({ status: _.in(PUBLIC_STATUSES) })
            .orderBy('updatedAt', 'desc')
            .skip(pageNumber * 20)
            .limit(21)
            .get(),
        db.collection('supervision_match_interests').where({ fromOpenid: openid }).limit(100).get(),
        db.collection('supervision_match_interests').where({ toOpenid: openid }).limit(100).get()
    ])

    const outgoing = new Set(outgoingRes.data.map((item) => item.toOpenid))
    const incoming = new Set(incomingRes.data.map((item) => item.fromOpenid))
    const mine = mineRes.data[0] || null
    const hasPublishedPost = anyMineRes.data.length > 0
    const matches = (listRes.data || []).slice(0, 20).filter((item) => item._openid !== openid).map((item) => ({
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
        interestedByMe: outgoing.has(item._openid),
        interestedInMe: incoming.has(item._openid),
        mutual: hasPublishedPost && outgoing.has(item._openid) && incoming.has(item._openid),
        ...((hasPublishedPost && outgoing.has(item._openid) && incoming.has(item._openid)) ? { contact: item.contact || '' } : {})
    }))

    return {
        mine,
        matches,
        matchCount: matches.length,
        hasMore: listRes.data.length > 20
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
    const { action = 'list', mode = 'full', profile = {}, targetId = '', page = 0 } = event || {}

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

        if (!['full', 'part'].includes(mode)) return { code: -1, msg: '备考类型无效' }

        if (action === 'interest' || action === 'withdrawInterest') {
            if (!targetId || typeof targetId !== 'string') return { code: -1, msg: '请选择有效帖子' }
            return setInterest(OPENID, targetId, action === 'withdrawInterest')
        }

        if (action === 'upsert') {
            if (!String(profile.contact || '').trim()) {
                return { code: -1, msg: '请先填写联系方式' }
            }
            await upsertProfile(OPENID, mode, profile)
        } else if (action === 'leave') {
            await leaveProfile(OPENID, mode)
        }

        const data = await listProfiles(OPENID, mode, page)
        return { code: 0, data }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
