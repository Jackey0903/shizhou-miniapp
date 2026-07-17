// utils/cloudApi.js — 封装所有云函数调用
// 说明：微信云开发数据库安全规则配置为"仅创建者可读写"时，
//       客户端查询 _openid 字段会自动按当前用户过滤，无需手动指定。

const db = wx.cloud.database()
const _ = db.command
const DEFAULT_COURSE_COVER = '/assets/images/default-course-cover.png'
const DEFAULT_CHECKIN_BG = '/assets/images/default-checkin-bg.png'
const DEFAULT_WALLPAPERS = [
    '/assets/images/default-wallpaper-1.png',
    '/assets/images/default-wallpaper-2.png',
    '/assets/images/default-wallpaper-3.png',
    '/assets/images/default-wallpaper-4.png'
]
const DEFAULT_IMAGE_MATERIAL = '/assets/images/default-wallpaper-3.png'
const MATERIAL_CDN_BASE = 'https://636c-cloud-2ge02vrucaf8a6ab-1398720138.tcb.qcloud.la/client-assets/20260514'
const MATERIAL_CLOUD_BASE = 'cloud://cloud-2ge02vrucaf8a6ab.636c-cloud-2ge02vrucaf8a6ab-1398720138/client-assets/20260514'
const DEFAULT_MATERIALS = [
    ['real-material-doc-001', '定义判断可能涉及常识141条', '定义判断可能涉及常识141条 PDF资料', '判断推理', 'document-001.pdf'],
    ['real-material-doc-002', '定义判断技巧知识点47式', '定义判断技巧知识点47式 PDF资料', '判断推理', 'document-002.pdf'],
    ['real-material-doc-003', '数量关系知识点185式', '数量关系知识点185式 PDF资料', '数量关系', 'document-003.pdf'],
    ['real-material-doc-004', '申论知识点57式', '申论知识点57式 PDF资料', '申论', 'document-004.pdf'],
    ['real-material-doc-005', '类比推理知识点技巧28式', '类比推理知识点技巧28式 PDF资料', '判断推理', 'document-005.pdf'],
    ['real-material-doc-006', '言语理解知识点37式', '言语理解知识点37式 PDF资料', '言语理解', 'document-006.pdf'],
    ['real-material-doc-007', '资料分析165式', '资料分析165式 PDF资料', '资料分析', 'document-007.pdf'],
    ['real-material-doc-008', '逻辑判断知识点42式', '逻辑判断知识点42式 PDF资料', '判断推理', 'document-008.pdf']
].map((item, index) => ({
    _id: item[0],
    name: item[1],
    description: item[2],
    type: 'document',
    category: item[3],
    accessType: 'coin',
    coinCost: 5,
    enabled: true,
    sort: index + 1,
    fileId: `${MATERIAL_CLOUD_BASE}/docs/${item[4]}`,
    fileUrl: `${MATERIAL_CDN_BASE}/docs/${item[4]}`
})).concat([
    {
        _id: '2e5b265c6a07fbe60067a00b6fcefb9a',
        name: '法律法学类常识音频试听',
        description: '真实音频资料测试，领取后可播放。',
        type: 'audio',
        category: 'audio',
        accessType: 'coin',
        coinCost: 5,
        enabled: true,
        sort: 9001,
        fileId: `${MATERIAL_CLOUD_BASE}/audio/audio-001.mp3`,
        fileUrl: `${MATERIAL_CDN_BASE}/audio/audio-001.mp3`
    },
    {
        _id: 'f24c8d6a6a07fbe60069a1bf3f6cc69e',
        name: '一举成公壁纸图片',
        description: '真实壁纸图片资料测试，领取后可查看。',
        type: 'image',
        category: 'image',
        accessType: 'coin',
        coinCost: 5,
        enabled: true,
        sort: 9002,
        fileId: `${MATERIAL_CLOUD_BASE}/wallpapers/wallpaper-001.jpg`,
        fileUrl: `${MATERIAL_CDN_BASE}/wallpapers/wallpaper-001.jpg`,
        imageUrl: `${MATERIAL_CDN_BASE}/wallpapers/wallpaper-001.jpg`
    }
])

function isLegacyExternalImage(url = '') {
    return typeof url === 'string' && (
        url.includes('images.unsplash.com')
        || url.includes('unsplash.com')
    )
}

function sanitizeImageUrl(url, fallback) {
    if (!url) return fallback
    return isLegacyExternalImage(url) ? fallback : url
}

function formatClientDate(value) {
    if (!value) return ''
    const date = value instanceof Date
        ? value
        : (value && typeof value.toDate === 'function' ? value.toDate() : new Date(value))
    if (!date || Number.isNaN(date.getTime())) return ''
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

// ============= 用户相关 =============

/**
 * 用户登录/注册（云函数）
 */
async function userLogin(params = {}) {
    return wx.cloud.callFunction({ name: 'userLogin', data: params })
}

/**
 * 获取当前用户信息
 * 安全规则："仅创建者可读写" → 自动按当前用户 openid 过滤
 */
async function getCurrentUser() {
    const res = await db.collection('users').get()
    return res.data[0] || null
}

/**
 * 更新用户信息
 */
async function updateUser(data) {
    const user = await getCurrentUser()
    if (!user) throw new Error('用户未登录')
    return db.collection('users').doc(user._id).update({ data })
}

/**
 * 赚取VIP天数（历史兼容）
 */
async function rewardVip(action) {
    return wx.cloud.callFunction({ name: 'rewardVip', data: { action } })
}

/**
 * 赚取舟币（朋友圈分享 / 激励广告）
 */
async function grantCoinReward(action) {
    try {
        return await wx.cloud.callFunction({ name: 'grantCoinReward', data: { action } })
    } catch (err) {
        return wx.cloud.callFunction({ name: 'rewardVip', data: { action, rewardMode: 'coin' } })
    }
}

// ============= 课程相关 =============

async function getSubjects() {
    try {
        const res = await db.collection('subjects').orderBy('sort', 'asc').get()
        return res.data || []
    } catch (err) {
        return []
    }
}

async function getQuestionBanks() {
    try {
        const res = await db.collection('question_banks').orderBy('sort', 'asc').get()
        return res.data || []
    } catch (err) {
        return []
    }
}

function mergeBanksWithSubjects(banks = [], subjects = []) {
    const subjectMap = {}
    subjects.forEach((item) => {
        subjectMap[item._id] = item
    })

    return banks.map((bank) => {
        const subject = subjectMap[bank.subjectId] || {}
        return {
            ...bank,
            category: bank.category || subject.name || '综合题库',
            subjectId: bank.subjectId || subject._id || '',
            subjectName: subject.name || bank.category || '综合题库',
            color: bank.color || subject.color || '',
            cover: sanitizeImageUrl(bank.cover, DEFAULT_COURSE_COVER)
        }
    })
}

/**
 * 获取所有题库列表
 * 通过云函数获取，绕过客户端安全规则限制
 */
async function getCourses() {
    try {
        const res = await wx.cloud.callFunction({ name: 'getCourses' })
        if (res.result && res.result.code === 0 && res.result.data) {
            const courses = res.result.data
            // 尝试合并 subjects
            try {
                const subjects = await getSubjects()
                if (subjects.length && res.result.source === 'question_banks') {
                    return mergeBanksWithSubjects(courses, subjects)
                }
            } catch (e) {}
            return courses.map((course) => ({
                ...course,
                cover: sanitizeImageUrl(course.cover, DEFAULT_COURSE_COVER)
            }))
        }
        return []
    } catch (err) {
        console.error('获取题库失败', err)
        // 降级：直接查询（可能受安全规则限制）
        const banks = await getQuestionBanks()
        if (banks.length) {
            const subjects = await getSubjects()
            return mergeBanksWithSubjects(banks, subjects)
        }
        try {
            const res = await db.collection('courses')
                .orderBy('sort', 'asc')
                .get()
            return (res.data || []).map((course) => ({
                ...course,
                cover: sanitizeImageUrl(course.cover, DEFAULT_COURSE_COVER)
            }))
        } catch (e) {
            return []
        }
    }
}

/**
 * 获取单个题库详情
 * 通过云函数获取，绕过客户端安全规则限制
 */
async function getCourse(courseId) {
    if (!courseId) return null
    
    try {
        const res = await wx.cloud.callFunction({
            name: 'getCourse',
            data: { courseId }
        })
        if (res.result && res.result.code === 0 && res.result.data) {
            return {
                ...res.result.data,
                cover: sanitizeImageUrl(res.result.data.cover, DEFAULT_COURSE_COVER)
            }
        }
    } catch (err) {
        console.error('获取题库详情失败', err)
    }

    // 降级：直接查询（可能受安全规则限制）
    try {
        const bankRes = await db.collection('question_banks').doc(courseId).get()
        const bank = bankRes.data
        if (bank) {
            let subject = {}
            if (bank.subjectId) {
                try {
                    const subjectRes = await db.collection('subjects').doc(bank.subjectId).get()
                    subject = subjectRes.data || {}
                } catch (err) {}
            }
            return {
                ...bank,
                category: bank.category || subject.name || '综合题库',
                subjectId: bank.subjectId || subject._id || '',
                subjectName: subject.name || bank.category || '综合题库',
                color: bank.color || subject.color || '',
                cover: sanitizeImageUrl(bank.cover, DEFAULT_COURSE_COVER)
            }
        }
    } catch (err) {}

    try {
        const res = await db.collection('courses').doc(courseId).get()
        return {
            ...res.data,
            cover: sanitizeImageUrl(res.data && res.data.cover, DEFAULT_COURSE_COVER)
        }
    } catch (e) {
        return null
    }
}

// ============= 题目相关 =============

/**
 * 获取某题库题目列表（分页）
 * 通过云函数获取，绕过客户端安全规则限制
 */
async function getQuestions(courseId, skip = 0, limit = 20) {
    try {
        const res = await wx.cloud.callFunction({
            name: 'getQuestions',
            data: { courseId, skip, limit }
        })
        if (res.result && res.result.code === 0 && res.result.data) {
            return res.result.data
        }
        return []
    } catch (err) {
        console.error('获取题目失败', err)
        // 降级：直接查询（可能受安全规则限制）
        try {
            const bankRes = await db.collection('questions')
                .where({ bankId: courseId })
                .orderBy('sort', 'asc')
                .skip(skip)
                .limit(limit)
                .get()
            if (bankRes.data && bankRes.data.length) return bankRes.data
        } catch (e) {}

        try {
            const res = await db.collection('questions')
                .where({ courseId })
                .orderBy('sort', 'asc')
                .skip(skip)
                .limit(limit)
                .get()
            return res.data
        } catch (e) {
            return []
        }
    }
}

/**
 * 获取题目总数
 */
async function getQuestionCount(courseId) {
    try {
        const bankCount = await db.collection('questions').where({ bankId: courseId }).count()
        if (bankCount.total > 0) return bankCount.total
    } catch (err) {}

    const res = await db.collection('questions').where({ courseId }).count()
    return res.total
}

/**
 * 批量上传题库
 */
async function uploadQuestions(questions) {
    return wx.cloud.callFunction({ name: 'uploadQuestions', data: { questions } })
}

/**
 * 管理员新增题库/科目
 */
async function createCourse(course) {
    return wx.cloud.callFunction({ name: 'createCourse', data: course })
}

// ============= 学习计划相关 =============

/**
 * 保存/更新学习计划（云函数处理，服务端写入 _openid）
 */
async function savePlan(planData) {
    return wx.cloud.callFunction({ name: 'savePlan', data: planData })
}

/**
 * 获取当前用户的所有学习计划
 * 安全规则"仅创建者可读写" → 自动过滤当前用户
 */
async function getPlans() {
    const res = await db.collection('plans').get()
    return res.data
}

/**
 * 删除学习计划
 */
async function deletePlan(planId) {
    return db.collection('plans').doc(planId).remove()
}

// ============= 学习记录相关 =============

/**
 * 提交答题结果（云函数处理艾宾浩斯调度）
 */
async function submitAnswer(params) {
    return wx.cloud.callFunction({ name: 'submitAnswer', data: params })
}

/**
 * 获取今日需要复习的题目记录
 */
async function getTodayReviews(courseId) {
    const now = new Date()
    const query = { nextReviewAt: _.lte(now) }
    if (courseId) query.courseId = courseId

    const res = await db.collection('study_records')
        .where(query)
        .orderBy('nextReviewAt', 'asc')
        .limit(100)
        .get()
    return res.data
}

/**
 * 获取学习记录（复习本数据）
 * 安全规则"仅创建者可读写" → 自动过滤当前用户
 */
async function getStudyRecords(courseId, result) {
    const query = {}
    if (courseId) query.courseId = courseId
    if (result) query.result = result

    const res = await db.collection('study_records')
        .where(query)
        .orderBy('updatedAt', 'desc')
        .limit(200)
        .get()
    return res.data
}

// ============= 打卡相关 =============

/**
 * 执行打卡（云函数处理连续天数和舟币）
 */
async function doCheckin() {
    return wx.cloud.callFunction({ name: 'checkin' })
}

/**
 * 获取打卡记录（月历用）
 */
async function getCheckins(year, month) {
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0, 23, 59, 59)

    const res = await db.collection('checkins')
        .where({ date: _.gte(startDate).and(_.lte(endDate)) })
        .get()
    return (res.data || []).map((item) => ({
        ...item,
        dateStr: formatClientDate(item.date || item.dateStr)
    }))
}

// ============= 互助题目相关 =============

/**
 * 上传互助题目
 */
async function uploadMutualQuestion(data) {
    return wx.cloud.callFunction({
        name: 'mutualHelpCenter',
        data: { action: 'submit', payload: data }
    })
}

/**
 * 获取已审核的互助题目（公开）
 */
async function getMutualQuestions(skip = 0, limit = 20) {
    const res = await wx.cloud.callFunction({
        name: 'mutualHelpCenter',
        data: { action: 'dashboard' }
    })
    const list = (res.result && res.result.data && res.result.data.approved) || []
    return list.slice(skip, skip + limit)
}

/**
 * 获取互助板块仪表盘（公开题目 / 我的投稿 / 待审核）
 */
async function getMutualHelpDashboard() {
    return wx.cloud.callFunction({
        name: 'mutualHelpCenter',
        data: { action: 'dashboard' }
    })
}

/**
 * 审核互助投稿
 */
async function reviewMutualQuestion(id, status, reviewerNote = '') {
    return wx.cloud.callFunction({
        name: 'mutualHelpCenter',
        data: { action: 'review', payload: { id, status, reviewerNote } }
    })
}

/**
 * 提交题目纠错
 */
async function submitCorrectionReport(payload) {
    return wx.cloud.callFunction({
        name: 'submitCorrectionReport',
        data: payload
    })
}

// ============= 音频相关 =============

/**
 * 获取音频列表（磨耳朵）—— 公开数据
 */
async function getAudios(category) {
    const query = {}
    if (category) query.category = category
    const res = await db.collection('audios')
        .where(query)
        .orderBy('sort', 'asc')
        .get()
    return res.data
}

async function uploadAudios(audios) {
    return wx.cloud.callFunction({
        name: 'uploadAudios',
        data: { audios }
    })
}

async function uploadMaterials(materials) {
    return wx.cloud.callFunction({
        name: 'uploadMaterials',
        data: { materials }
    })
}

// ============= 壁纸相关 =============

/**
 * 获取壁纸列表 —— 公开数据
 */
async function getWallpapers(type) {
    const query = {}
    if (type) query.type = type
    const res = await db.collection('wallpapers')
        .where(query)
        .orderBy('sort', 'asc')
        .get()
    return (res.data || []).map((item, index) => ({
        ...item,
        imageUrl: sanitizeImageUrl(item.imageUrl, DEFAULT_WALLPAPERS[index % DEFAULT_WALLPAPERS.length])
    }))
}

/**
 * 获取当前用户上传的壁纸
 */
async function getMyWallpapers() {
    return wx.cloud.callFunction({
        name: 'userWallpaperManager',
        data: { action: 'list' }
    })
}

/**
 * 记录当前用户上传的壁纸
 */
async function saveMyWallpaper(fileId) {
    return wx.cloud.callFunction({
        name: 'userWallpaperManager',
        data: { action: 'add', payload: { fileId } }
    })
}

async function uploadWallpapers(wallpapers) {
    return wx.cloud.callFunction({
        name: 'uploadWallpapers',
        data: { wallpapers }
    })
}

// ============= 资料相关 =============

/**
 * 获取资料列表 —— 公开数据
 */
async function getMaterials() {
    let list = []
    try {
        const res = await wx.cloud.callFunction({ name: 'getMaterials' })
        if (res.result && res.result.code === 0) {
            list = res.result.data || []
        }
    } catch (err) {}

    if (!list.length) {
        try {
            const res = await db.collection('materials').where({ enabled: true }).orderBy('sort', 'asc').get()
            list = res.data || []
        } catch (err) {
            list = DEFAULT_MATERIALS
        }
    }

    if (!list.length) list = DEFAULT_MATERIALS

    return list.map((item) => {
        if ((item.type || item.categoryType || item.category) !== 'image') return item
        return {
            ...item,
            fileUrl: sanitizeImageUrl(item.fileUrl, DEFAULT_IMAGE_MATERIAL),
            imageUrl: sanitizeImageUrl(item.imageUrl, DEFAULT_IMAGE_MATERIAL)
        }
    })
}

async function getMyMaterialRedemptions() {
    const res = await db.collection('material_redemptions')
        .orderBy('createdAt', 'desc')
        .get()
        .catch(() => ({ data: [] }))
    return res.data || []
}

async function exchangeMaterial(materialId) {
    return wx.cloud.callFunction({
        name: 'exchangeMaterial',
        data: { materialId }
    })
}

async function getPunchConfig(dateStr = '') {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10)
    const [backgroundRes, quoteRes] = await Promise.all([
        db.collection('punch_backgrounds').where({ enabled: true }).orderBy('updatedAt', 'desc').get().catch(() => ({ data: [] })),
        db.collection('punch_quotes').where({ enabled: true }).orderBy('updatedAt', 'desc').get().catch(() => ({ data: [] }))
    ])

    const backgrounds = backgroundRes.data || []
    const quotes = quoteRes.data || []
    const dayIndex = Math.max(0, Math.floor(new Date(targetDate).getTime() / 86400000))

    const chooseDaily = (list, fallbackKey) => {
        const exact = list.filter((item) => item.activeDate === targetDate)
        if (exact.length) return exact[0]
        const defaults = list.filter((item) => !item.activeDate || item.activeDate === 'default' || item.activeDate === fallbackKey)
        if (!defaults.length) return null
        return defaults[dayIndex % defaults.length]
    }

    let background = chooseDaily(backgrounds, 'default')
    if (background && background.fileId && !background.imageUrl) {
        try {
            const tempRes = await wx.cloud.getTempFileURL({ fileList: [background.fileId] })
            const first = (tempRes.fileList || [])[0]
            if (first && first.tempFileURL) {
                background = { ...background, imageUrl: first.tempFileURL }
            }
        } catch (err) {}
    }
    if (background) {
        background = {
            ...background,
            imageUrl: sanitizeImageUrl(background.imageUrl, DEFAULT_CHECKIN_BG)
        }
    }

    return {
        background,
        quote: chooseDaily(quotes, 'default')
    }
}

async function getMessages() {
    const readGlobalIds = wx.getStorageSync('readMessageIds') || []
    const localGuideId = 'local-onboarding-guide'
    const localGuide = {
        _id: localGuideId,
        source: 'local',
        type: 'onboarding_guide',
        title: '仕舟公考小程序使用指南',
        icon: '📘',
        content: [
            '1. 先领取资料，熟悉仕舟公考的1324个考点；',
            '2. 通过考点记忆卡检验掌握程度；',
            '3. 通过每个考点对应的母题巩固考点的实战运用；',
            '4. 大量刷真题，提高考点的准确度及答题速度，同时结合一些猜题技巧，提升难点的正确率。'
        ].join('\n'),
        unread: !readGlobalIds.includes(localGuideId),
        createdAt: Date.now()
    }
    const [globalRes, userRes] = await Promise.all([
        db.collection('messages')
        .where({ enabled: true })
        .orderBy('sort', 'asc')
        .get()
        .catch(() => ({ data: [] })),
        db.collection('user_messages')
            .where({ enabled: true })
            .orderBy('createdAt', 'desc')
            .get()
            .catch(() => ({ data: [] }))
    ])

    const userMessages = (userRes.data || []).map((item) => ({
        ...item,
        source: 'user',
        unread: !item.readAt
    }))
    const globalMessages = (globalRes.data || []).map((item) => ({
        ...item,
        source: 'global',
        unread: !readGlobalIds.includes(item._id)
    }))

    const app = typeof getApp === 'function' ? getApp() : null
    const hasGuide = userMessages.some((item) => item.type === 'onboarding_guide')
    const list = userMessages.concat(globalMessages)
    if (app && app.globalData && app.globalData.isLogin && !hasGuide) {
        return [localGuide].concat(list)
    }
    return list
}

async function markMessageRead(message) {
    if (!message || !message._id) return
    if (message.source === 'user') {
        await db.collection('user_messages').doc(message._id).update({
            data: { readAt: db.serverDate() }
        }).catch(() => null)
        return
    }

    const ids = wx.getStorageSync('readMessageIds') || []
    if (!ids.includes(message._id)) {
        ids.push(message._id)
        wx.setStorageSync('readMessageIds', ids)
    }
}

async function getAdSlot(position) {
    if (!position) return null
    const res = await db.collection('ad_slots')
        .where({ enabled: true, position })
        .orderBy('sort', 'asc')
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
    return (res.data || [])[0] || null
}

// ============= 督学相关 =============

/**
 * 获取当前用户的督学数据
 */
async function getSupervisionData() {
    const res = await db.collection('supervision').limit(1).get()
    return res.data[0] || null
}

/**
 * 保存当前用户的督学数据
 */
async function saveSupervisionData(data) {
    const current = await getSupervisionData()
    const payload = {
        profiles: data.profiles || {},
        reminders: data.reminders || {},
        topics: data.topics || {},
        updatedAt: db.serverDate()
    }

    if (current && current._id) {
        return db.collection('supervision').doc(current._id).update({ data: payload })
    }

    return db.collection('supervision').add({
        data: {
            ...payload,
            createdAt: db.serverDate()
        }
    })
}

/**
 * 获取督学匹配列表和当前用户状态
 */
async function getSupervisionMatches(mode) {
    return wx.cloud.callFunction({
        name: 'supervisionMatch',
        data: { action: 'list', mode }
    })
}

/**
 * 加入或更新督学匹配
 */
async function joinSupervisionMatch(mode, profile) {
    return wx.cloud.callFunction({
        name: 'supervisionMatch',
        data: { action: 'upsert', mode, profile }
    })
}

/**
 * 退出督学匹配
 */
async function leaveSupervisionMatch(mode) {
    return wx.cloud.callFunction({
        name: 'supervisionMatch',
        data: { action: 'leave', mode }
    })
}

async function getReminderConfig() {
    return wx.cloud.callFunction({
        name: 'studyReminderCenter',
        data: { action: 'getConfig' }
    })
}

async function getStudyReminders(mode) {
    return wx.cloud.callFunction({
        name: 'studyReminderCenter',
        data: { action: 'list', payload: { mode } }
    })
}

async function saveStudyReminder(mode, title, time) {
    return wx.cloud.callFunction({
        name: 'studyReminderCenter',
        data: { action: 'save', payload: { mode, title, time } }
    })
}

async function removeStudyReminder(id) {
    return wx.cloud.callFunction({
        name: 'studyReminderCenter',
        data: { action: 'remove', payload: { id } }
    })
}

async function dispatchStudyReminders(limit = 20) {
    return wx.cloud.callFunction({
        name: 'dispatchStudyReminders',
        data: { limit }
    })
}

// ============= 积分/舟币相关 =============

/**
 * 获取舟币记录
 */
async function getCoinLogs() {
    const res = await db.collection('coin_logs')
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get()
    return res.data
}

/**
 * 获取VIP套餐配置
 */
async function getVipPlans() {
    try {
        const res = await db.collection('vip_plans').where({ enabled: true }).orderBy('sort', 'asc').get()
        return res.data || []
    } catch (err) {
        return []
    }
}

async function getMyOrders(limit = 50) {
    return wx.cloud.callFunction({
        name: 'queryVipOrder',
        data: { action: 'list', limit }
    })
}

async function listAdminConfigs(target) {
    return wx.cloud.callFunction({
        name: 'adminConfigCenter',
        data: { action: 'list', target }
    })
}

async function saveAdminConfig(target, payload) {
    return wx.cloud.callFunction({
        name: 'adminConfigCenter',
        data: { action: 'save', target, payload }
    })
}

async function toggleAdminConfig(target, id, enabled) {
    return wx.cloud.callFunction({
        name: 'adminConfigCenter',
        data: { action: 'toggle', target, payload: { id, enabled } }
    })
}

async function getHelpConfig() {
    return wx.cloud.callFunction({
        name: 'adminConfigCenter',
        data: { action: 'publicHelp', target: 'help_config' }
    })
}

module.exports = {
    db, _,
    userLogin, getCurrentUser, updateUser, rewardVip, grantCoinReward,
    getCourses, getCourse,
    getQuestions, getQuestionCount, uploadQuestions, createCourse,
    savePlan, getPlans, deletePlan,
    submitAnswer, getTodayReviews, getStudyRecords,
    doCheckin, getCheckins,
    uploadMutualQuestion, getMutualQuestions, getMutualHelpDashboard, reviewMutualQuestion, submitCorrectionReport,
    getAudios, uploadAudios, uploadMaterials,
    getWallpapers, getMyWallpapers, saveMyWallpaper, uploadWallpapers,
    getMaterials, getMyMaterialRedemptions, exchangeMaterial, getPunchConfig, getMessages, markMessageRead, getAdSlot,
    getSupervisionData, saveSupervisionData,
    getSupervisionMatches, joinSupervisionMatch, leaveSupervisionMatch,
    getReminderConfig, getStudyReminders, saveStudyReminder, removeStudyReminder, dispatchStudyReminders,
    getCoinLogs, getVipPlans, getMyOrders,
    listAdminConfigs, saveAdminConfig, toggleAdminConfig, getHelpConfig
}
