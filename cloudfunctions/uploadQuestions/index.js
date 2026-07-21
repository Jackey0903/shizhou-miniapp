const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_BATCH_SIZE = 50

async function getCurrentUser(openid) {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    return res.data[0] || {}
}

async function resolveBank(bankId) {
    try {
        const bankRes = await db.collection('question_banks').doc(bankId).get()
        if (bankRes.data) return bankRes.data
    } catch (err) {}

    try {
        const legacyRes = await db.collection('courses').doc(bankId).get()
        return legacyRes.data || null
    } catch (err) {
        return null
    }
}

function normalizeName(value = '') {
    return String(value || '').trim()
}

function boundedText(value, field, maxLength, required = false) {
    const text = normalizeName(value)
    if (required && !text) throw new Error(`${field}不能为空`)
    if (text.length > maxLength) throw new Error(`${field}不能超过 ${maxLength} 个字符`)
    return text
}

function normalizeKey(value = '') {
    return normalizeName(value).replace(/\s+/g, '')
}

const subjectCache = {}
const bankCache = {}

async function ensureSubject(subjectName) {
    const name = boundedText(subjectName || '综合题库', '科目名称', 100, true)
    const key = normalizeKey(name)
    if (subjectCache[key]) return subjectCache[key]

    const subjectRes = await db.collection('subjects').where({ name }).limit(1).get()
    if (subjectRes.data && subjectRes.data[0]) {
        subjectCache[key] = subjectRes.data[0]
        return subjectCache[key]
    }

    const addRes = await db.collection('subjects').add({
        data: {
            name,
            color: '',
            sort: Date.now(),
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
        }
    })
    subjectCache[key] = { _id: addRes._id, name, color: '' }
    return subjectCache[key]
}

async function ensureBank(subjectName, bankName) {
    const name = boundedText(bankName, '题库名称', 100, true)
    if (!name) {
        throw new Error('缺少题库名称')
    }
    const subject = await ensureSubject(subjectName)
    const key = `${normalizeKey(subject.name)}::${normalizeKey(name)}`
    if (bankCache[key]) return bankCache[key]

    const bankRes = await db.collection('question_banks')
        .where({
            subjectId: subject._id,
            name
        })
        .limit(1)
        .get()
    if (bankRes.data && bankRes.data[0]) {
        bankCache[key] = bankRes.data[0]
        return bankCache[key]
    }

    const legacyRes = await db.collection('courses')
        .where({
            name,
            category: subject.name
        })
        .limit(1)
        .get()
    if (legacyRes.data && legacyRes.data[0]) {
        bankCache[key] = legacyRes.data[0]
        return bankCache[key]
    }

    const addRes = await db.collection('question_banks').add({
        data: {
            subjectId: subject._id,
            subjectName: subject.name,
            category: subject.name,
            name,
            displayName: name,
            color: subject.color || '',
            sort: Date.now(),
            totalCount: 0,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
        }
    })
    bankCache[key] = {
        _id: addRes._id,
        subjectId: subject._id,
        subjectName: subject.name,
        category: subject.name,
        name
    }
    return bankCache[key]
}

async function resolveTargetBank(q = {}) {
    const targetId = q.bankId || q.courseId
    if (targetId) {
        const bank = await resolveBank(targetId)
        if (!bank) {
            throw new Error('题库不存在或已删除')
        }
        return {
            id: targetId,
            bank
        }
    }

    const subjectName = normalizeName(q.subjectName || q.categoryName || q['科目名称'] || q['分类名称'] || q['板块名称'] || '综合题库')
    const bankName = normalizeName(q.bankName || q.courseName || q['题库名称'] || q.name)
    const bank = await ensureBank(subjectName, bankName)
    return {
        id: bank._id,
        bank
    }
}

async function normalizeQuestion(q = {}) {
    const type = q.type === 'fill' ? 'fill' : 'choice'
    const content = boundedText(q.content, '题干', 5000, true)
    const explanation = boundedText(q.explanation, '解析', 10000)
    const target = await resolveTargetBank(q)
    const targetId = target.id
    const importKey = crypto.createHash('sha256')
        .update(`${targetId}|${type}|${content.replace(/\s+/g, ' ')}`)
        .digest('hex')
    const documentId = `q_${importKey.slice(0, 30)}`
    const imageUrl = boundedText(q.imageUrl, '图片URL', 1000)
    if (imageUrl && !/^(https:\/\/|cloud:\/\/)/i.test(imageUrl)) {
        throw new Error('图片URL只支持 https:// 或 cloud://')
    }

    if (type === 'choice') {
        const options = Array.isArray(q.options)
            ? q.options.map(item => boundedText(item, '选项', 1000)).filter(Boolean)
            : []
        const correctIndex = Number(q.correctIndex)
        if (options.length < 2) {
            throw new Error('选择题至少填写两个选项')
        }
        if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
            throw new Error('请选择正确答案')
        }
        return {
            bankId: targetId,
            courseId: targetId,
            type,
            sort: Number(q.sort) || Date.now(),
            content,
            imageUrl,
            options,
            correctIndex,
            answer: `${String.fromCharCode(65 + correctIndex)}. ${options[correctIndex]}`,
            explanation,
            importKey,
            documentId
        }
    }

    const answer = boundedText(q.answer, '填空题答案', 5000, true)

    return {
        bankId: targetId,
        courseId: targetId,
        type,
        sort: Number(q.sort) || Date.now(),
        content,
        imageUrl,
        options: [],
        answer,
        explanation,
        importKey,
        documentId
    }
}

exports.main = async (event, context) => {
    const { OPENID } = cloud.getWXContext()
    const { questions } = event

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return { code: -1, msg: '上传失败：请至少提供一道格式正确的题目' }
    }
    if (questions.length > MAX_BATCH_SIZE) {
        return { code: -1, msg: `单次最多上传 ${MAX_BATCH_SIZE} 道题` }
    }

    try {
        const user = await getCurrentUser(OPENID)
        const isAdmin = !!(user && (user.isAdmin === true || user.role === 'admin'))
        if (!isAdmin) {
            return { code: -1, msg: '无录题权限' }
        }

        const normalizedQuestions = []
        for (const question of questions) {
            normalizedQuestions.push(await normalizeQuestion(question))
        }
        const bankCounter = {}
        for (const item of normalizedQuestions) {
            bankCounter[item.bankId] = (bankCounter[item.bankId] || 0) + 1
        }

        let insertedCount = 0
        let skippedCount = 0
        for (const q of normalizedQuestions) {
            if (q.importKey) {
                const existed = await db.collection('questions')
                    .where({ importKey: q.importKey })
                    .limit(1)
                    .get()
                let isDuplicate = !!(existed.data && existed.data.length)
                if (!isDuplicate) {
                    const legacy = await db.collection('questions')
                        .where({ bankId: q.bankId, type: q.type, content: q.content })
                        .limit(1)
                        .get()
                    isDuplicate = !!(legacy.data && legacy.data.length)
                }
                if (isDuplicate) {
                    bankCounter[q.bankId] = Math.max((bankCounter[q.bankId] || 0) - 1, 0)
                    skippedCount += 1
                    continue
                }
            }
            const { documentId, ...questionData } = q
            await db.collection('questions').doc(documentId).set({
                data: {
                    ...questionData,
                    createdAt: db.serverDate(),
                    updatedAt: db.serverDate()
                }
            })
            insertedCount += 1
        }

        const updateTasks = Object.keys(bankCounter).map(async (bankId) => {
            const countRes = await db.collection('questions').where({ bankId }).count()
            try {
                await db.collection('question_banks').doc(bankId).update({
                    data: {
                        totalCount: countRes.total,
                        updatedAt: db.serverDate(),
                    }
                })
            } catch (err) {
                try {
                    await db.collection('courses').doc(bankId).update({
                        data: {
                            totalCount: countRes.total,
                            updatedAt: db.serverDate(),
                        }
                    })
                } catch (innerErr) {}
            }
        })
        await Promise.all(updateTasks)

        return {
            code: 0,
            msg: `成功导入 ${insertedCount} 道题目`,
            data: {
                totalCount: normalizedQuestions.length,
                insertedCount,
                skippedCount,
                bankCount: Object.keys(bankCounter).length
            }
        }

    } catch (err) {
        return { code: -1, msg: err.message }
    }
}
