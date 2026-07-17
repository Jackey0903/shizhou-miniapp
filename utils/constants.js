// utils/constants.js — 全局常量

// 云开发环境 ID
const CLOUD_ENV = 'cloud-2ge02vrucaf8a6ab'

// 题目类型
const QUESTION_TYPE = {
    FILL: 'fill',       // 填空题
    CHOICE: 'choice',   // 选择题
    IMAGE: 'image'      // 图片题
}

// 答题结果
const ANSWER_RESULT = {
    NONE: 'none',     // 不会
    MAYBE: 'maybe',   // 不太会
    KNOW: 'know'      // 会
}

// 学习模式
const STUDY_MODE = {
    FRONT: 'front',   // 正面学习（题→答）
    BACK: 'back'      // 反面学习（答→题）
}

// 艾宾浩斯复习间隔（毫秒）
const EBBINGHAUS_INTERVALS = [
    5 * 60 * 1000,         // 5分钟
    30 * 60 * 1000,        // 30分钟
    12 * 60 * 60 * 1000,   // 12小时
    1 * 24 * 60 * 60 * 1000, // 1天
    2 * 24 * 60 * 60 * 1000, // 2天
    4 * 24 * 60 * 60 * 1000, // 4天
    7 * 24 * 60 * 60 * 1000, // 7天
    15 * 24 * 60 * 60 * 1000 // 15天
]

// VIP 套餐（价格单位：分）
const VIP_PLANS = [
    { id: 'basic_vip_year', label: '基础VIP包年', price: 19800, days: 365, supervisionDays: 0, virtualProductId: 'basic_vip_year' },
    { id: 'supervision_trial_day', label: '督学试用1日', price: 800, days: 365, supervisionDays: 1, virtualProductId: 'supervision_trial_day' },
    { id: 'supervision_month', label: '督学包月', price: 19800, days: 365, supervisionDays: 30, virtualProductId: 'supervision_month' },
    { id: 'premium_vip_year', label: '高级VIP包年', price: 98800, days: 365, supervisionDays: 365, virtualProductId: 'premium_vip_year' }
]

// 打卡签到奖励（舟币）
const CHECKIN_COINS = 10
// 分享朋友圈奖励（舟币）
const SHARE_COINS_REWARD = 10
// 看广告奖励（舟币）
const AD_COINS_REWARD = 1

// 督学类型
const SUPERVISION_TYPE = {
    FULL: 'full',     // 全职备考
    PART: 'part'      // 在职备考
}

module.exports = {
    CLOUD_ENV,
    QUESTION_TYPE,
    ANSWER_RESULT,
    STUDY_MODE,
    EBBINGHAUS_INTERVALS,
    VIP_PLANS,
    CHECKIN_COINS,
    SHARE_COINS_REWARD,
    AD_COINS_REWARD,
    SUPERVISION_TYPE
}
