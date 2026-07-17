// utils/ebbinghaus.js — 艾宾浩斯遗忘曲线复习调度算法

const { EBBINGHAUS_INTERVALS, ANSWER_RESULT } = require('./constants')

/**
 * 根据答题结果和当前复习级别，计算下次复习时间
 * @param {string} result - 'none' | 'maybe' | 'know'
 * @param {number} reviewLevel - 当前复习级别（0~7，对应8个间隔）
 * @returns {{ nextReviewAt: Date, nextLevel: number }}
 */
function calcNextReview(result, reviewLevel = 0) {
    let nextLevel = reviewLevel

    if (result === ANSWER_RESULT.KNOW) {
        // 会：升一级别
        nextLevel = Math.min(reviewLevel + 1, EBBINGHAUS_INTERVALS.length - 1)
    } else if (result === ANSWER_RESULT.MAYBE) {
        // 不太会：保持当前级别（重新用当前间隔）
        nextLevel = reviewLevel
    } else {
        // 不会：回到第一个间隔（5分钟）
        nextLevel = 0
    }

    const interval = EBBINGHAUS_INTERVALS[nextLevel]
    const nextReviewAt = new Date(Date.now() + interval)

    return { nextReviewAt, nextLevel }
}

/**
 * 获取需要今天复习的题目的查询条件
 * @returns {Date} 截止时间（当前时间）
 */
function getTodayReviewDeadline() {
    return new Date()
}

/**
 * 格式化剩余复习时间显示
 * @param {Date} nextReviewAt
 * @returns {string}
 */
function formatNextReview(nextReviewAt) {
    if (!nextReviewAt) return ''
    const diff = new Date(nextReviewAt) - Date.now()
    if (diff <= 0) return '现在复习'

    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (days > 0) return `${days}天后`
    if (hours > 0) return `${hours}小时后`
    if (minutes > 0) return `${minutes}分钟后`
    return '即将复习'
}

/**
 * 判断题目是否已经"完全掌握"（到达最高级别）
 * @param {number} reviewLevel
 * @returns {boolean}
 */
function isMastered(reviewLevel) {
    return reviewLevel >= EBBINGHAUS_INTERVALS.length - 1
}

module.exports = {
    calcNextReview,
    getTodayReviewDeadline,
    formatNextReview,
    isMastered
}
