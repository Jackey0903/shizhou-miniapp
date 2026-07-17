// 云函数：userLogin — 用户登录/注册
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
    return token
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
    return res.phoneNumber || info.phoneNumber || info.purePhoneNumber || ''
}

exports.main = async (event = {}, context) => {
    const { OPENID, APPID } = cloud.getWXContext()
    const { nickName, avatarUrl, loginType, phoneData, phoneCode, code, encryptedData, iv } = event
    let phoneNumber = ''
    if (loginType === 'phone') {
        if (phoneData && phoneData.data && phoneData.data.phoneNumber) {
            phoneNumber = phoneData.data.phoneNumber
        } else if (phoneCode || code) {
            try {
                const res = await cloud.openapi.phonenumber.getPhoneNumber({
                    code: phoneCode || code
                })
                phoneNumber = readPhoneNumber(res)
            } catch (err) {
                console.warn('[userLogin] get phone by code fail', err)
            }
        } else if (encryptedData && iv) {
            try {
                const res = await cloud.openapi.phonenumber.decryptPhoneNumber({
                    encryptedData,
                    iv
                })
                phoneNumber = readPhoneNumber(res)
            } catch (err) {
                console.warn('[userLogin] decrypt phone fail', err)
            }
        }
    }

    try {
        if (!OPENID) return { code: -1, msg: '未获取到用户身份' }
        await ensureCollection('users')
        await ensureCollection('tokens')

        // 查找是否已有用户
        const existing = await db.collection('users').where({ _openid: OPENID }).get()

        if (existing.data.length > 0) {
            // 已存在，更新登录信息
            const user = existing.data[0]
            await db.collection('users').doc(user._id).update({
                data: {
                    lastLoginAt: db.serverDate(),
                    ...(nickName && { nickName }),
                    ...(avatarUrl && { avatarUrl }),
                    ...(phoneNumber && { phone: phoneNumber })
                }
            })
            await createOnboardingMessage(OPENID)
        } else {
            // 新用户，创建记录（前7天免费）
            const vipExpireDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            const newUser = {
                _openid: OPENID,
                appid: APPID,
                nickName: nickName || ('学员' + Math.floor(Math.random() * 9000 + 1000)),
                avatarUrl: avatarUrl || '',
                phone: phoneNumber || '',
                coins: 0,
                isVip: true,
                vipExpireDate,
                isFreeTrial: true,
                streak: 0,
                totalCheckins: 0,
                createdAt: db.serverDate(),
                lastLoginAt: db.serverDate()
            }
            const addRes = await db.collection('users').add({ data: newUser })
            await createOnboardingMessage(OPENID)
        }

        const latest = await db.collection('users').where({ _openid: OPENID }).get()
        const currentUser = latest.data[0]
        const token = await issueToken(OPENID)
        return { code: 0, data: { ...currentUser, token } }
    } catch (err) {
        console.error('[userLogin] login failed', err)
        return { code: -1, msg: err.message || '登录失败', error: err.message }
    }
}
