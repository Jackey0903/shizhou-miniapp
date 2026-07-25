// utils/cloudApi.js — 封装所有云函数调用
const DEFAULT_COURSE_COVER = '/assets/images/default-course-cover.png'
const DEFAULT_CHECKIN_BG = '/assets/images/default-checkin-bg.png'
const DEFAULT_WALLPAPERS = [
    '/assets/images/default-wallpaper-1.png',
    '/assets/images/default-wallpaper-2.png',
    '/assets/images/default-wallpaper-3.png',
    '/assets/images/default-wallpaper-4.png'
]
const DEFAULT_IMAGE_MATERIAL = '/assets/images/default-wallpaper-3.png'

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
    const res = await wx.cloud.callFunction({ name: 'userLogin', data: { action: 'getCurrentUser' } })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.msg) || '用户信息加载失败')
    return res.result.data || null
}

/**
 * 更新用户信息
 */
async function updateUser(data) {
    const allowed = {}
    if (typeof data.nickName === 'string') allowed.nickName = data.nickName
    if (typeof data.avatarUrl === 'string') allowed.avatarUrl = data.avatarUrl
    if (!Object.keys(allowed).length) throw new Error('不允许从客户端修改该用户字段')
    return wx.cloud.callFunction({
        name: 'userLogin',
        data: { action: 'updateProfile', ...allowed }
    })
}

/**
 * 赚取舟币（朋友圈分享 / 激励广告）
 */
async function grantCoinReward(action, claimId = '') {
    const safeClaimId = String(claimId || '').trim()
        || `${action}:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`
    return wx.cloud.callFunction({ name: 'grantCoinReward', data: { action, claimId: safeClaimId } })
}

/**
 * 成功分享或保存打卡海报后奖励 10 舟币。同一 claimId 重试不会重复发放。
 */
async function grantCheckinShareReward(claimId) {
    const safeClaimId = String(claimId || '').trim()
    if (!safeClaimId) throw new Error('缺少分享凭证')
    let lastError = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            return await grantCoinReward('checkinShareReward', safeClaimId)
        } catch (error) {
            lastError = error
        }
    }
    throw lastError || new Error('舟币奖励发放失败')
}

// ============= 课程相关 =============

/**
 * 获取所有题库列表
 * 通过云函数获取，绕过客户端安全规则限制
 */
async function getCourses() {
    try {
        const res = await wx.cloud.callFunction({ name: 'getCourses' })
        if (res.result && res.result.code === 0 && res.result.data) {
            return res.result.data.map((course) => ({
                ...course,
                cover: sanitizeImageUrl(course.cover, DEFAULT_COURSE_COVER)
            }))
        }
        throw new Error((res.result && res.result.msg) || '题库加载失败')
    } catch (err) {
        console.error('获取题库失败', err)
        throw err
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
        throw new Error((res.result && res.result.msg) || '题库不存在')
    } catch (err) {
        console.error('获取题库详情失败', err)
        return null
    }
}

// ============= 题目相关 =============

/**
 * 获取某题库题目列表（分页）
 * 通过云函数获取，绕过客户端安全规则限制
 */
async function getQuestions(courseId, skip = 0, limit = 20) {
    const requestedLimit = Math.max(1, Math.min(5000, Number(limit) || 20))
    try {
        const questions = []
        while (questions.length < requestedLimit) {
            const pageLimit = Math.min(100, requestedLimit - questions.length)
            const res = await wx.cloud.callFunction({
                name: 'getQuestions',
                data: { courseId, skip: Number(skip || 0) + questions.length, limit: pageLimit }
            })
            if (!res.result || res.result.code !== 0) {
                const err = new Error((res.result && (res.result.msg || res.result.error)) || '获取题目失败')
                err.businessError = true
                throw err
            }
            const page = res.result.data || []
            questions.push(...page)
            if (page.length < pageLimit) break
        }
        return questions
    } catch (err) {
        console.error('获取题目失败', err)
        throw err
    }
}

/**
 * 获取题目总数
 */
async function getQuestionCount(courseId) {
    const res = await wx.cloud.callFunction({ name: 'getQuestions', data: { action: 'count', courseId } })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.msg) || '题目数量加载失败')
    return Number(res.result.data && res.result.data.total || 0)
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
    const res = await wx.cloud.callFunction({ name: 'savePlan', data: { action: 'list' } })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.error) || '学习计划加载失败')
    return res.result.data || []
}

/**
 * 删除学习计划
 */
async function deletePlan(planId) {
    return wx.cloud.callFunction({
        name: 'savePlan',
        data: { action: 'delete', planId }
    })
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
    const res = await wx.cloud.callFunction({
        name: 'submitAnswer',
        data: { action: 'list', courseId: courseId || '', dueBefore: new Date().toISOString() }
    })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.error) || '复习记录加载失败')
    return res.result.data || []
}

/**
 * 获取学习记录（复习本数据）
 * 安全规则"仅创建者可读写" → 自动过滤当前用户
 */
async function getStudyRecords(courseId, result) {
    const res = await wx.cloud.callFunction({
        name: 'submitAnswer',
        data: { action: 'list', courseId: courseId || '', result: result || '' }
    })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.error) || '学习记录加载失败')
    return res.result.data || []
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
    const res = await wx.cloud.callFunction({ name: 'checkin', data: { action: 'list', year, month } })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.msg) || '打卡记录加载失败')
    const checkins = res.result.data || []
    return checkins.map((item) => ({
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
    const res = await wx.cloud.callFunction({
        name: 'uploadAudios',
        data: { action: 'list', category: category || '' }
    })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.msg) || '音频加载失败')
    return res.result.data || []
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
    const res = await wx.cloud.callFunction({
        name: 'uploadWallpapers',
        data: { action: 'list', type: type || '' }
    })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.msg) || '壁纸加载失败')
    return (res.result.data || []).map((item, index) => ({
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
    const res = await wx.cloud.callFunction({ name: 'getMaterials' })
    if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.msg) || '资料加载失败')
    }
    return (res.result.data || []).map((item) => {
        if ((item.type || item.categoryType || item.category) !== 'image') return item
        return {
            ...item,
            fileUrl: sanitizeImageUrl(item.fileUrl, DEFAULT_IMAGE_MATERIAL),
            imageUrl: sanitizeImageUrl(item.imageUrl, DEFAULT_IMAGE_MATERIAL)
        }
    })
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
        wx.cloud.callFunction({ name: 'adminConfigCenter', data: { action: 'publicList', target: 'punch_backgrounds' } }),
        wx.cloud.callFunction({ name: 'adminConfigCenter', data: { action: 'publicList', target: 'punch_quotes' } })
    ])

    const backgrounds = (backgroundRes.result && backgroundRes.result.code === 0 ? backgroundRes.result.data : []) || []
    const quotes = (quoteRes.result && quoteRes.result.code === 0 ? quoteRes.result.data : []) || []
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
    const res = await wx.cloud.callFunction({ name: 'messageCenter', data: { action: 'list' } })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.msg) || '消息加载失败')
    const remoteMessages = (res.result.data || []).map((item) => ({
        ...item,
        unread: item.source === 'global' ? !readGlobalIds.includes(item._id) : !!item.unread
    }))

    const app = typeof getApp === 'function' ? getApp() : null
    const hasGuide = remoteMessages.some((item) => item.type === 'onboarding_guide')
    const list = remoteMessages
    if (app && app.globalData && app.globalData.isLogin && !hasGuide) {
        return [localGuide].concat(list)
    }
    return list
}

async function markMessageRead(message) {
    if (!message || !message._id) return
    if (message.source === 'user') {
        await wx.cloud.callFunction({
            name: 'messageCenter',
            data: { action: 'read', messageId: message._id }
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
    const res = await wx.cloud.callFunction({
        name: 'adminConfigCenter',
        data: { action: 'publicList', target: 'ad_slots' }
    }).catch(() => null)
    const list = res && res.result && res.result.code === 0 ? res.result.data || [] : []
    return list.find((item) => item.position === position) || null
}

// ============= 督学相关 =============

/**
 * 获取当前用户的督学数据
 */
async function getSupervisionData() {
    const res = await wx.cloud.callFunction({ name: 'supervisionMatch', data: { action: 'getData' } })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.msg) || '督学数据加载失败')
    return res.result.data || null
}

/**
 * 保存当前用户的督学数据
 */
async function saveSupervisionData(data) {
    return wx.cloud.callFunction({
        name: 'supervisionMatch',
        data: { action: 'saveData', data: {
            profiles: data.profiles || {},
            reminders: data.reminders || {},
            topics: data.topics || {}
        } }
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
    const res = await wx.cloud.callFunction({ name: 'grantCoinReward', data: { action: 'list' } })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.msg) || '舟币记录加载失败')
    return res.result.data || []
}

/**
 * 获取VIP套餐配置
 */
async function getVipPlans() {
    const res = await wx.cloud.callFunction({
        name: 'createVipOrder',
        data: { action: 'plans' }
    })
    if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.msg) || '套餐加载失败')
    }
    return res.result.data || []
}

async function getMyOrders(limit = 50) {
    return wx.cloud.callFunction({
        name: 'createVipOrder',
        data: { action: 'list', limit }
    })
}

async function listAdminConfigs(target) {
    return wx.cloud.callFunction({
        name: 'adminConfigCenter',
        data: { action: 'list', target }
    })
}

async function assertAdmin() {
    const res = await wx.cloud.callFunction({
        name: 'adminConfigCenter',
        data: { action: 'assertAdmin' }
    })
    if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.msg) || '仅管理员可操作')
    return true
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

async function callAdminOperation(action, payload = {}) {
    const res = await wx.cloud.callFunction({
        name: 'adminOperations',
        data: { action, payload }
    })
    if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.msg) || '管理员操作失败')
    }
    return res.result
}

async function getAdminCourseTree() {
    const result = await callAdminOperation('listCourseTree')
    return result.data || []
}

async function saveAdminSubject(payload) {
    return callAdminOperation('saveSubject', payload)
}

async function saveAdminQuestionBank(payload) {
    return callAdminOperation('saveBank', payload)
}

async function listAdminContent(target, keyword = '', limit = 100) {
    const result = await callAdminOperation('listContent', { target, keyword, limit })
    return result.data || []
}

async function toggleAdminContent(target, id, enabled) {
    return callAdminOperation('toggleContent', { target, id, enabled })
}

async function searchAdminUsers(keyword) {
    const result = await callAdminOperation('searchUsers', { keyword })
    return result.data || []
}

async function grantAdminUserAccess(payload) {
    return callAdminOperation('grantAccess', payload)
}

async function getAdminGrantLogs() {
    const result = await callAdminOperation('listGrants')
    return result.data || []
}

async function getAdminMiniProgramCode() {
    const result = await callAdminOperation('getMiniProgramCode')
    return result.data || null
}

async function generateAdminMiniProgramCode(payload = {}) {
    const result = await callAdminOperation('generateMiniProgramCode', payload)
    return result.data || null
}

module.exports = {
    userLogin, getCurrentUser, updateUser, grantCoinReward, grantCheckinShareReward,
    getCourses, getCourse,
    getQuestions, getQuestionCount, uploadQuestions, createCourse,
    savePlan, getPlans, deletePlan,
    submitAnswer, getTodayReviews, getStudyRecords,
    doCheckin, getCheckins,
    uploadMutualQuestion, getMutualQuestions, getMutualHelpDashboard, reviewMutualQuestion, submitCorrectionReport,
    getAudios, uploadAudios, uploadMaterials,
    getWallpapers, getMyWallpapers, saveMyWallpaper, uploadWallpapers,
    getMaterials, exchangeMaterial, getPunchConfig, getMessages, markMessageRead, getAdSlot,
    getSupervisionData, saveSupervisionData,
    getSupervisionMatches, joinSupervisionMatch, leaveSupervisionMatch,
    getReminderConfig, getStudyReminders, saveStudyReminder, removeStudyReminder, dispatchStudyReminders,
    getCoinLogs, getVipPlans, getMyOrders,
    assertAdmin, listAdminConfigs, saveAdminConfig, toggleAdminConfig, getHelpConfig,
    callAdminOperation, getAdminCourseTree, saveAdminSubject, saveAdminQuestionBank,
    listAdminContent, toggleAdminContent,
    searchAdminUsers, grantAdminUserAccess, getAdminGrantLogs,
    getAdminMiniProgramCode, generateAdminMiniProgramCode
}
