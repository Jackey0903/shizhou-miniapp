// 云函数：userLogin — 用户登录/注册
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PHONE_REQUIRED_CODE = 428
const PHONE_CONFLICT_CODE = 409

const ONBOARDING_MESSAGE = {
    title: '仕舟公考小程序使用指南',
    icon: '📘',
    content: [
        '1. 先领取资料，熟悉仕舟公考的1324个考点；',
        '2. 通过考点记忆卡检验掌握程度；',
        '3. 通过每个考点对应的母题巩固考点的实战运用；',
        '4. 大量刷真题，提高考点的准确度及答题速度，同时结合一些猜题技巧，提升难点的正确率。'
    ].join('\n')
}

async function ensureCollection(name) {
    try {
        await db.collection(name).limit(1).get()
        return
    } catch (err) {
        const msg = String((err && (err.message || err.errMsg)) || '')
        if (!msg.includes('Db or Table not exist') && !msg.includes('database collection not') && !msg.includes('-502005')) {
            throw err
        }
    }

    try {
        await db.createCollection(name)
    } catch (err) {
        const msg = String((err && (err.message || err.errMsg)) || '')
        if (!msg.includes('Table exist') && !msg.includes('ResourceExist') && !msg.includes('already exists')) {
            throw err
        }
    }
}

async function issueToken(openid) {
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    try {
        await db.collection('tokens').where({ _openid: openid }).remove()
    } catch (err) {
        console.warn('[issueToken] remove old tokens failed', err)
    }
    await db.collection('tokens').add({
        data: {
            _openid: openid,
            token,
            expiresAt,
            createdAt: db.serverDate()
        }
    })
    return { token, expiresAt }
}

function buildUserId(openid) {
    return `user_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`
}

function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '')
    if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2)
    return /^\d{6,20}$/.test(digits) ? digits : ''
}

function buildPhoneIdentityId(phone) {
    return `phone_${crypto.createHash('sha256').update(phone).digest('hex')}`
}

async function reservePhoneIdentity(userId, phone) {
    await ensureCollection('phone_identities')
    const identityId = buildPhoneIdentityId(phone)
    await db.runTransaction(async (transaction) => {
        const identityRef = transaction.collection('phone_identities').doc(identityId)
        const identityRes = await identityRef.get().catch(() => ({ data: null }))
        const identity = identityRes.data
        if (identity && identity.userId && identity.userId !== userId) {
            const err = new Error('该手机号已绑定其他账号，请使用原微信登录或联系客服')
            err.errorCode = 'PHONE_ALREADY_BOUND'
            throw err
        }
        await identityRef.set({
            data: {
                userId,
                phoneHash: identityId.slice('phone_'.length),
                verifiedAt: db.serverDate(),
                updatedAt: db.serverDate()
            }
        })
    })
}

async function createOnboardingMessage(openid) {
    try {
        await ensureCollection('user_messages')
        const existed = await db.collection('user_messages')
            .where({ _openid: openid, type: 'onboarding_guide' })
            .limit(1)
            .get()
        if (existed.data && existed.data.length) return

        await db.collection('user_messages').add({
            data: {
                _openid: openid,
                type: 'onboarding_guide',
                title: ONBOARDING_MESSAGE.title,
                icon: ONBOARDING_MESSAGE.icon,
                content: ONBOARDING_MESSAGE.content,
                enabled: true,
                readAt: null,
                createdAt: db.serverDate(),
                updatedAt: db.serverDate()
            }
        })
    } catch (err) {
        console.warn('[userLogin] create onboarding message failed', err)
    }
}

function readPhoneNumber(res = {}) {
    const info = res.phone_info || res.phoneInfo || {}
    return normalizePhone(res.purePhoneNumber || info.purePhoneNumber || res.phoneNumber || info.phoneNumber || '')
}

exports.main = async (event = {}, context) => {
    const { OPENID, APPID } = cloud.getWXContext()
    const { action, nickName, avatarUrl, loginType, phoneCode, code } = event
    const safeNickName = typeof nickName === 'string' ? nickName.trim().slice(0, 40) : ''
    const safeAvatarUrl = typeof avatarUrl === 'string' ? avatarUrl.slice(0, 1000) : ''
    let phoneNumber = ''

    try {
        if (!OPENID) return { code: -1, msg: '未获取到用户身份' }
        await ensureCollection('users')
        await ensureCollection('tokens')

        if (action === 'getCurrentUser') {
            const existing = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
            const current = (existing.data || [])[0] || null
            if (current && !normalizePhone(current.phone)) {
                return { code: PHONE_REQUIRED_CODE, errorCode: 'PHONE_REQUIRED', msg: '请授权手机号后重新登录', data: null }
            }
            return { code: 0, data: current }
        }

        if (action === 'updateProfile') {
            const existing = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
            const user = existing.data[0]
            if (!user) return { code: -1, msg: '请先登录' }
            if (!normalizePhone(user.phone)) {
                return { code: PHONE_REQUIRED_CODE, errorCode: 'PHONE_REQUIRED', msg: '请先授权手机号登录' }
            }
            const updates = {}
            if (typeof nickName === 'string' && nickName.trim()) updates.nickName = nickName.trim().slice(0, 40)
            if (typeof avatarUrl === 'string') updates.avatarUrl = avatarUrl.slice(0, 1000)
            if (!Object.keys(updates).length) return { code: -1, msg: '没有可更新的资料' }
            await db.collection('users').doc(user._id).update({
                data: { ...updates, updatedAt: db.serverDate() }
            })
            return { code: 0, data: { ...user, ...updates } }
        }

        if (loginType !== 'phone' || !(phoneCode || code)) {
            return { code: PHONE_REQUIRED_CODE, errorCode: 'PHONE_REQUIRED', msg: '登录必须授权并绑定手机号' }
        }
        try {
            const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({ code: phoneCode || code })
            phoneNumber = readPhoneNumber(phoneRes)
        } catch (err) {
            console.warn('[userLogin] get phone by code fail', err)
        }
        if (!phoneNumber) {
            return { code: PHONE_REQUIRED_CODE, errorCode: 'PHONE_REQUIRED', msg: '手机号授权失败，请重新授权后再试' }
        }

        // 查找是否已有用户
        const [existing, phoneOwners] = await Promise.all([
            db.collection('users').where({ _openid: OPENID }).limit(2).get(),
            db.collection('users').where({ phone: phoneNumber }).limit(2).get()
        ])
        const currentUser = (existing.data || [])[0] || null
        const currentUserId = currentUser ? currentUser._id : buildUserId(OPENID)
        const conflictingOwner = (phoneOwners.data || []).find((item) => item._id !== currentUserId)
        if (conflictingOwner) {
            return { code: PHONE_CONFLICT_CODE, errorCode: 'PHONE_ALREADY_BOUND', msg: '该手机号已绑定其他账号，请使用原微信登录或联系客服' }
        }
        const boundPhone = currentUser ? normalizePhone(currentUser.phone) : ''
        if (boundPhone && boundPhone !== phoneNumber) {
            return { code: PHONE_CONFLICT_CODE, errorCode: 'PHONE_CHANGE_FORBIDDEN', msg: '当前账号已绑定其他手机号，如需更换请联系客服' }
        }
        await reservePhoneIdentity(currentUserId, phoneNumber)

        if (currentUser) {
            // 已存在，更新登录信息
            await db.collection('users').doc(currentUser._id).update({
                data: {
                    lastLoginAt: db.serverDate(),
                    ...(safeNickName && { nickName: safeNickName }),
                    ...(safeAvatarUrl && { avatarUrl: safeAvatarUrl }),
                    phone: phoneNumber,
                    phoneVerifiedAt: db.serverDate()
                }
            })
            await createOnboardingMessage(OPENID)
        } else {
            // 新用户，创建记录（前7天免费）
            const vipExpireDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            const newUser = {
                _openid: OPENID,
                appid: APPID,
                nickName: safeNickName || ('学员' + Math.floor(Math.random() * 9000 + 1000)),
                avatarUrl: safeAvatarUrl || '',
                phone: phoneNumber,
                phoneVerifiedAt: db.serverDate(),
                coins: 0,
                isVip: true,
                vipExpireDate,
                isFreeTrial: true,
                streak: 0,
                totalCheckins: 0,
                createdAt: db.serverDate(),
                lastLoginAt: db.serverDate()
            }
            await db.collection('users').doc(currentUserId).set({ data: newUser })
            await createOnboardingMessage(OPENID)
        }

        const latest = await db.collection('users').where({ _openid: OPENID }).get()
        const latestUser = latest.data[0]
        const { token, expiresAt: tokenExpiresAt } = await issueToken(OPENID)
        return { code: 0, data: { ...latestUser, token, tokenExpiresAt } }
    } catch (err) {
        console.error('[userLogin] login failed', err)
        if (err && err.errorCode === 'PHONE_ALREADY_BOUND') {
            return { code: PHONE_CONFLICT_CODE, errorCode: 'PHONE_ALREADY_BOUND', msg: err.message }
        }
        return { code: -1, msg: err.message || '登录失败', error: err.message }
    }
}
