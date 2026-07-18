// pages/question/question.js
const cloudApi = require('../../utils/cloudApi')
const { decodeRouteParam } = require('../../utils/routeParams')

function sameDate(value, target) {
    if (!value) return false
    if (value instanceof Date) {
        return value.getFullYear() === target.getFullYear()
            && value.getMonth() === target.getMonth()
            && value.getDate() === target.getDate()
    }
    if (value && typeof value.toDate === 'function') {
        const date = value.toDate()
        return date.getFullYear() === target.getFullYear()
            && date.getMonth() === target.getMonth()
            && date.getDate() === target.getDate()
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return false
    return date.getFullYear() === target.getFullYear()
        && date.getMonth() === target.getMonth()
        && date.getDate() === target.getDate()
}

function toHalfWidth(value = '') {
    return String(value).replace(/[\uFF01-\uFF5E]/g, (char) => {
        return String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
    }).replace(/\u3000/g, ' ')
}

function normalizeFillText(value = '') {
    return toHalfWidth(value)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[。．.,，!！?？;；:："'“”‘’()（）【】\[\]{}]/g, '')
}

function getCorrectIndex(question = {}) {
    const explicit = Number(question.correctIndex)
    if (Number.isInteger(explicit) && explicit >= 0) return explicit
    const match = String(question.answer || '').trim().match(/^([A-E])(?:[.、\s]|$)/i)
    return match ? match[1].toUpperCase().charCodeAt(0) - 65 : -1
}

function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shuffle(list = []) {
    const arr = [...list]
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        const temp = arr[i]
        arr[i] = arr[j]
        arr[j] = temp
    }
    return arr
}

Page({
    data: {
        courseId: '',
        courseName: '',
        planId: '',
        bannerAdUnitId: '',
        mode: 'new', // 'new' | 'review'
        questionIds: [],
        questions: [],
        currentQuestion: null,
        currentIndex: 0,
        total: 0,
        loading: true,
        showAnswer: false,
        answered: false,       // 选择题是否已选
        choiceState: {},       // { index: 'correct'|'wrong' }
        optionLabels: ['A', 'B', 'C', 'D', 'E'],
        progress: 0,
        fillAnswer: '',
        fillCorrect: false,
        fillCheckMode: 'auto',
        selectedOptionIndex: -1,
        submittingAnswer: false,
        dailyTarget: 0,
        todayDoneCount: 0,
        activePlan: null,
        sessionCompletesTarget: false,
        emptyState: {
            title: '',
            desc: '',
            actionText: '返回课程',
            actionType: 'back'
        }
    },

    onLoad(options = {}) {
        const { courseId, planId, mode = 'new', questionIds = '' } = options
        const courseName = decodeRouteParam(options.courseName)
        let ids = questionIds
            ? questionIds.split(',').filter(Boolean)
            : []
        if (options.reviewSessionKey) {
            const storageKey = `reviewQuestionIds:${options.reviewSessionKey}`
            const storedIds = wx.getStorageSync(storageKey)
            if (Array.isArray(storedIds) && storedIds.length) ids = storedIds.filter(Boolean)
            wx.removeStorageSync(storageKey)
        }
        this._answerSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        this.setData({ courseId, courseName, planId, mode, questionIds: ids })
        wx.setNavigationBarTitle({ title: courseName || '学习' })
        this._loadAdSlot()
        this._loadQuestions()
    },

    async _loadAdSlot() {
        try {
            const app = getApp()
            if (app.globalData.isVip) {
                this.setData({ bannerAdUnitId: '' })
                return
            }
            const slot = await cloudApi.getAdSlot('question-banner')
            this.setData({ bannerAdUnitId: slot ? (slot.unitId || slot.adUnitId || '') : '' })
        } catch (err) {}
    },

    onAdLoad() {},

    onAdError(err) {
        console.warn('题目页广告加载失败', err)
        this.setData({ bannerAdUnitId: '' })
    },

    async _loadQuestions() {
        this.setData({ loading: true })
        try {
            let questions = []
            let sessionCompletesTarget = false
            let emptyState = {
                title: '',
                desc: '',
                actionText: '返回课程',
                actionType: 'back'
            }

            if (this.data.mode === 'review') {
                let ids = this.data.questionIds
                if (!ids || ids.length === 0) {
                    const records = await cloudApi.getTodayReviews(this.data.courseId)
                    ids = records.map(r => r.questionId)
                }

                // 云端会校验当前访问权限，并为旧记录补齐题目快照。
                const records = await cloudApi.getStudyRecords(this.data.courseId)
                const recordMap = {}
                records.forEach(r => { recordMap[r.questionId] = r })

                const promises = ids.map(async id => {
                    const cached = recordMap[id]
                    if (cached && cached.questionContent) {
                        return {
                            _id: id,
                            type: cached.questionType || 'fill',
                            content: cached.questionContent,
                            options: cached.questionOptions || [],
                            answer: cached.questionAnswer || '',
                            explanation: cached.questionExplanation || '',
                            correctIndex: Number.isInteger(Number(cached.questionCorrectIndex))
                                ? Number(cached.questionCorrectIndex)
                                : getCorrectIndex({ answer: cached.questionAnswer }),
                            imageUrl: cached.questionImageUrl || '',
                            fromRecord: true
                        }
                    }
                    return null
                })
                questions = (await Promise.all(promises)).filter(Boolean)
                if (questions.length === 0) {
                    emptyState = {
                        title: '今天暂无复习题',
                        desc: '当前没有到期的复习题，先去新学或晚点再来。',
                        actionText: '返回课程',
                        actionType: 'back'
                    }
                }
            } else {
                const [plans, allQuestions, records] = await Promise.all([
                    cloudApi.getPlans().catch(() => []),
                    cloudApi.getQuestions(this.data.courseId, 0, 5000),
                    cloudApi.getStudyRecords(this.data.courseId).catch(() => [])
                ])
                const plan = plans.find((item) => (
                    (this.data.planId && item._id === this.data.planId) || item.courseId === this.data.courseId
                )) || {}
                const dailyCount = Math.max(1, Number(plan.dailyCount || 10))
                const today = new Date()
                const todayDoneCount = new Set(records
                    .filter((item) => sameDate(item.createdAt, today))
                    .map((item) => item.questionId)
                    .filter(Boolean)).size
                const remainingCount = Math.max(0, dailyCount - todayDoneCount)
                const mode = plan.mode || 'sequential'
                const learnedIds = new Set(records.map((item) => item.questionId).filter(Boolean))
                const newQuestions = (allQuestions || []).filter((item) => !learnedIds.has(item._id))
                const orderedQuestions = mode === 'random' ? shuffle(newQuestions) : newQuestions
                if (remainingCount > 0) {
                    questions = orderedQuestions.slice(0, remainingCount)
                    sessionCompletesTarget = questions.length > 0 && questions.length === remainingCount
                } else {
                    // 今日目标已达成后，仍允许继续新学，不再强制拦到打卡页。
                    questions = orderedQuestions.slice(0, Math.min(dailyCount, orderedQuestions.length))
                    sessionCompletesTarget = false
                }

                this.setData({
                    activePlan: plan,
                    dailyTarget: dailyCount,
                    todayDoneCount,
                    sessionCompletesTarget
                })

                if (questions.length === 0) {
                    if (todayDoneCount >= dailyCount && dailyCount > 0) {
                        emptyState = {
                            title: '今日任务已完成',
                            desc: '当前题库今天的学习目标已经完成。你可以去打卡，也可以继续切换到其他题库学习。',
                            actionText: '返回课程',
                            actionType: 'back'
                        }
                    } else if (newQuestions.length === 0) {
                        emptyState = {
                            title: '当前题库没有新题了',
                            desc: `今日目标 ${dailyCount} 题，当前已完成 ${todayDoneCount} 题。可以先去复习模式继续学习。`,
                            actionText: '去复习',
                            actionType: 'review'
                        }
                    } else {
                        emptyState = {
                            title: '当前没有可学题目',
                            desc: `今日目标 ${dailyCount} 题，当前已完成 ${todayDoneCount} 题。请返回后重新进入试试。`,
                            actionText: '返回课程',
                            actionType: 'back'
                        }
                    }
                }
            }

            this.setData({
                questions,
                currentQuestion: questions[0] || null,
                currentIndex: 0,
                total: questions.length,
                loading: false,
                progress: questions.length > 0 ? 0 : 100,
                fillAnswer: '',
                fillCorrect: false,
                fillCheckMode: 'auto',
                selectedOptionIndex: -1,
                submittingAnswer: false,
                showAnswer: false,
                answered: false,
                choiceState: {},
                sessionCompletesTarget,
                emptyState
            })
        } catch (err) {
            console.error('加载题目失败', err)
            this.setData({ loading: false })
            wx.showToast({ title: '加载失败', icon: 'none' })
        }
    },

    // 切换显示答案（填空/图片题）
    toggleAnswer() {
        if (!this.data.showAnswer) {
            this.setData({ showAnswer: true })
        }
    },

    onFillInput(e) {
        this.setData({ fillAnswer: e.detail.value || '' })
    },

    revealFillAnswer() {
        this.setData({
            showAnswer: true,
            fillCorrect: false,
            fillCheckMode: 'self'
        })
    },

    submitFillAnswer() {
        const value = (this.data.fillAnswer || '').trim()
        if (!value) {
            wx.showToast({ title: '请先输入答案', icon: 'none' })
            return
        }

        this.setData({
            showAnswer: true,
            fillCorrect: false,
            fillCheckMode: 'self'
        })
    },

    // 选择题：选项点击
    onSelectOption(e) {
        if (this.data.answered) return
        const index = Number(e.currentTarget.dataset.index)
        const question = this.data.questions[this.data.currentIndex]
        const correctIndex = getCorrectIndex(question)
        if (!Number.isInteger(index) || index < 0 || correctIndex < 0) {
            wx.showToast({ title: '题目答案配置异常，请提交纠错', icon: 'none' })
            return
        }

        const choiceState = {}
        if (index === correctIndex) {
            choiceState[index] = 'correct'
        } else {
            choiceState[index] = 'wrong'
            choiceState[correctIndex] = 'correct'
        }

        this.setData({ choiceState, answered: true, selectedOptionIndex: index })
    },

    // 三按钮结果
    async onResult(e) {
        if (this.data.submittingAnswer) return
        const { result } = e.currentTarget.dataset
        const question = this.data.questions[this.data.currentIndex]
        if (!question || !['none', 'maybe', 'know'].includes(result)) return

        const selectedOptionIndex = Number(this.data.selectedOptionIndex)
        const correctIndex = getCorrectIndex(question)
        const fillAnswer = (this.data.fillAnswer || '').trim()
        const extraPayload = question.type === 'choice'
            ? {
                userOptionIndex: selectedOptionIndex,
                userAnswer: question.options && question.options[selectedOptionIndex] || '',
                isCorrect: selectedOptionIndex >= 0 && selectedOptionIndex === correctIndex
            }
            : {
                userAnswer: fillAnswer,
                isCorrect: question.type === 'fill'
                    ? normalizeFillText(fillAnswer) === normalizeFillText(question.answer || '')
                    : result === 'know'
            }

        this.setData({ submittingAnswer: true })
        try {
            const response = await cloudApi.submitAnswer({
                questionId: question._id,
                courseId: this.data.courseId,
                planId: this.data.planId,
                result,
                submissionId: `${this._answerSessionId}:${this.data.currentIndex}:${question._id}`,
                ...extraPayload
            })
            const submitResult = response && response.result
            if (!submitResult || submitResult.code !== 0) {
                throw new Error((submitResult && (submitResult.msg || submitResult.error)) || '答题结果保存失败')
            }
            this._nextQuestion()
        } catch (err) {
            console.error('提交答题结果失败', err)
            wx.showToast({ title: err.message || '保存失败，请重试', icon: 'none' })
        } finally {
            this.setData({ submittingAnswer: false })
        }
    },

    _nextQuestion() {
        const nextIndex = this.data.currentIndex + 1
        const total = this.data.questions.length
        const progress = Math.round((nextIndex / total) * 100)

        if (nextIndex >= total) {
            // 全部完成
            this.setData({
                currentIndex: nextIndex,
                currentQuestion: null,
                progress: 100,
                showAnswer: false,
                answered: false,
                choiceState: {},
                fillAnswer: '',
                fillCorrect: false,
                fillCheckMode: 'auto',
                selectedOptionIndex: -1
            })
            // 检查是否可以打卡
            this._checkAndPromptCheckin(total)
        } else {
            this.setData({
                currentIndex: nextIndex,
                currentQuestion: this.data.questions[nextIndex] || null,
                progress,
                showAnswer: false,
                answered: false,
                choiceState: {},
                fillAnswer: '',
                fillCorrect: false,
                fillCheckMode: 'auto',
                selectedOptionIndex: -1
            })
        }
    },

    async _checkAndPromptCheckin(total) {
        try {
            // 检查今日是否已打卡
            const today = formatDateKey(new Date())
            const checkins = await cloudApi.getCheckins(new Date().getFullYear(), new Date().getMonth() + 1)
            const alreadyChecked = checkins.some((item) => item.dateStr === today)

            if (this.data.mode === 'new') {
                const finishedCount = Number(this.data.todayDoneCount || 0) + Number(total || 0)
                const dailyTarget = Number(this.data.dailyTarget || 0)
                const justReachedTarget = dailyTarget > 0
                    && Number(this.data.todayDoneCount || 0) < dailyTarget
                    && finishedCount >= dailyTarget

                if (justReachedTarget) {
                    wx.redirectTo({
                        url: `/pages/checkin/checkin?from=question&completed=${total}&courseId=${this.data.courseId || ''}${alreadyChecked ? '&alreadyChecked=1' : ''}`
                    })
                    return
                }

                if (dailyTarget > 0 && finishedCount > dailyTarget) {
                    wx.showModal({
                        title: '🎉 完成！',
                        content: `本轮 ${total} 道题已完成。\n\n今日目标已经达成，你还可以继续学习其他题库或继续本题库复习。`,
                        showCancel: false,
                        confirmText: '返回',
                        success: () => this.goBack()
                    })
                    return
                }

                wx.showModal({
                    title: '🎉 完成！',
                    content: `今日 ${total} 道题全部完成！\n\n当前已完成 ${finishedCount}/${dailyTarget || total} 题，当前这一轮还未补足今日目标。`,
                    showCancel: false,
                    confirmText: '返回',
                    success: () => this.goBack()
                })
                return
            }

            // 检查是否满足打卡条件（完成任一题库的今日任务）
            const [plans, records] = await Promise.all([
                cloudApi.getPlans(),
                cloudApi.getStudyRecords()
            ])

            const now = new Date()
            const todayRecords = records.filter((r) => {
                return sameDate(r.updatedAt || r.createdAt, now)
            })

            const doneMap = {}
            todayRecords.forEach((item) => {
                const key = item.courseId || item.bankId
                if (key) {
                    doneMap[key] = (doneMap[key] || 0) + 1
                }
            })

            const canCheckin = plans.some((plan) => {
                const key = plan.courseId
                const target = Number(plan.dailyCount || 0)
                return key && target > 0 && (doneMap[key] || 0) >= target
            })

            if (canCheckin) {
                wx.redirectTo({
                    url: `/pages/checkin/checkin?from=question&completed=${total}&courseId=${this.data.courseId || ''}`
                })
            } else {
                // 不能打卡，提示原因
                wx.showModal({
                    title: '🎉 完成！',
                    content: `今日 ${total} 道题全部完成！\n\n完成任一题库的今日学习任务后即可打卡。`,
                    showCancel: false,
                    confirmText: '返回',
                    success: () => this.goBack()
                })
            }
        } catch (err) {
            console.error('检查打卡状态失败', err)
            // 出错时显示基本完成提示
            wx.showModal({
                title: '🎉 完成！',
                content: `今日 ${total} 道题全部完成！`,
                showCancel: false,
                confirmText: '返回',
                success: () => this.goBack()
            })
        }
    },

    handleEmptyAction() {
        const actionType = this.data.emptyState && this.data.emptyState.actionType
        if (actionType === 'review') {
            wx.redirectTo({
                url: `/pages/question/question?courseId=${encodeURIComponent(this.data.courseId)}&courseName=${encodeURIComponent(this.data.courseName)}&planId=${encodeURIComponent(this.data.planId || '')}&mode=review`
            })
            return
        }
        if (actionType === 'checkin') {
            wx.redirectTo({
                url: `/pages/checkin/checkin?from=question&completed=${this.data.todayDoneCount || 0}&courseId=${this.data.courseId || ''}`
            })
            return
        }
        this.goBack()
    },

    goBack() {
        wx.navigateBack({ delta: 1 })
    },

    goReviewBook() {
        wx.navigateTo({ url: `/pages/review-book/review-book?courseId=${this.data.courseId}` })
    },

    async submitCorrection() {
        const question = this.data.currentQuestion || {}
        if (!question._id) {
            wx.showToast({ title: '当前题目不可提交', icon: 'none' })
            return
        }

        const typeOptions = ['题干错误', '答案错误', '解析错误', '图片错误', '其他问题']
        try {
            const action = await new Promise((resolve, reject) => {
                wx.showActionSheet({
                    itemList: typeOptions,
                    success: resolve,
                    fail: reject
                })
            })

            const reportType = typeOptions[action.tapIndex]
            const modal = await new Promise((resolve) => {
                wx.showModal({
                    title: '提交纠错',
                    editable: true,
                    placeholderText: '请简要说明哪里有问题，便于管理员核对',
                    success: resolve
                })
            })

            if (!modal.confirm) return
            const content = (modal.content || '').trim()
            if (!content) {
                wx.showToast({ title: '请填写纠错说明', icon: 'none' })
                return
            }

            wx.showLoading({ title: '提交中', mask: true })
            const res = await cloudApi.submitCorrectionReport({
                questionId: question._id,
                bankId: this.data.courseId,
                courseId: this.data.courseId,
                bankName: this.data.courseName,
                reportType,
                content,
                snapshot: {
                    content: question.content || '',
                    imageUrl: question.imageUrl || '',
                    options: question.options || [],
                    answer: question.answer || '',
                    explanation: question.explanation || ''
                }
            })
            wx.hideLoading()
            if (!res.result || res.result.code !== 0) {
                throw new Error((res.result && res.result.msg) || '提交失败')
            }
            wx.showToast({ title: '已提交审核', icon: 'success' })
        } catch (err) {
            wx.hideLoading()
            if (err && err.errMsg && err.errMsg.includes('cancel')) return
            console.error('提交纠错失败', err)
            wx.showToast({ title: '提交失败，请稍后重试', icon: 'none' })
        }
    },

    showSettings() {
        wx.showActionSheet({
            itemList: ['查看记忆本', '重新加载题目', '返回题库'],
            success: ({ tapIndex }) => {
                if (tapIndex === 0) {
                    this.goReviewBook()
                    return
                }
                if (tapIndex === 1) {
                    this._loadQuestions()
                    return
                }
                this.goBack()
            }
        })
    }
})
