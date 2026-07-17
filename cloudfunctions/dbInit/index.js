// 云函数：dbInit — 初始化数据库集合；可选重置并写入示例数据
// 默认 mode=collections，仅创建缺失集合，避免云端测试 3 秒超时。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function canRunOperations(event = {}) {
    const expected = process.env.OPS_ADMIN_TOKEN || ''
    return !!expected && typeof event.opsToken === 'string' && event.opsToken === expected
}

const COLLECTIONS = [
    'users', 'courses', 'subjects', 'question_banks', 'questions', 'plans',
    'study_records', 'checkins', 'mutual_questions',
    'audios', 'wallpapers', 'user_wallpapers', 'materials', 'material_redemptions', 'coin_logs', 'orders',
    'supervision', 'supervision_profiles', 'vip_plans', 'punch_backgrounds',
    'punch_quotes', 'ad_slots', 'messages', 'user_messages', 'correction_reports',
    'study_reminders', 'notification_settings', 'reminder_dispatch_logs', 'help_config'
]

const SAMPLE_COURSES = [
    {
        name: '一、常识', category: '公基', series: '基础题库', description: '政治、经济、文化、历史、自然等常识',
        totalCount: 50, isLocked: false, sort: 1,
        preview: ['1.冬天供暖的时间和热度', '2.过年回家的意义', '3.远嫁真的不好吗？', '4.每天一杯咖啡影响健康…'],
        cover: '/assets/images/default-course-cover.png', createdAt: new Date()
    },
    {
        name: '二、言语理解', category: '行测', series: '基础题库', description: '言语理解与表达专项练习',
        totalCount: 80, isLocked: false, sort: 2,
        preview: ['1.选词填空', '2.语句排序', '3.阅读理解'],
        cover: '/assets/images/default-course-cover.png', createdAt: new Date()
    },
    {
        name: '三、数量关系', category: '行测', series: '进阶提升', description: '数学运算、数字推理',
        totalCount: 60, isLocked: true, sort: 3,
        preview: ['1.行程问题', '2.工程问题', '3.排列组合'],
        cover: '/assets/images/default-course-cover.png', createdAt: new Date()
    },
    {
        name: '四、判断推理', category: '行测', series: '进阶提升', description: '图形推理、逻辑判断',
        totalCount: 70, isLocked: true, sort: 4,
        preview: ['1.图形推理', '2.定义判断', '3.类比推理'],
        cover: '/assets/images/default-course-cover.png', createdAt: new Date()
    },
    {
        name: '五、资料分析', category: '行测', series: '专项训练', description: '表格、图表资料的分析计算',
        totalCount: 40, isLocked: true, sort: 5,
        preview: ['1.增长率计算', '2.比重分析', '3.倍数问题'],
        cover: '/assets/images/default-course-cover.png', createdAt: new Date()
    },
    {
        name: '六、申论', category: '申论', series: '专项训练', description: '申论写作和分析',
        totalCount: 30, isLocked: true, sort: 6,
        preview: ['1.归纳概括', '2.综合分析', '3.公文写作'],
        cover: '/assets/images/default-course-cover.png', createdAt: new Date()
    },
    {
        name: '七、法律法规', category: '公基', series: '高频考点', description: '宪法、民法、刑法等常用法律',
        totalCount: 45, isLocked: true, sort: 7,
        preview: ['1.宪法知识', '2.民法原则', '3.行政法规'],
        cover: '/assets/images/default-course-cover.png', createdAt: new Date()
    },
    {
        name: '八、时事政治', category: '公基', series: '高频考点', description: '最新时政热点与党政方针',
        totalCount: 35, isLocked: true, sort: 8,
        preview: ['1.党的会议', '2.国家政策', '3.国际时事'],
        cover: '/assets/images/default-course-cover.png', createdAt: new Date()
    }
]

// 批量清除一个集合所有数据（云函数端无50条限制）
async function clearCollection(colName) {
    try {
        // 先尝试删除所有文档
        const countRes = await db.collection(colName).count()
        if (countRes.total === 0) return `⚠️ ${colName} 已是空集合`

        // 分批删除
        let deleted = 0
        while (true) {
            const res = await db.collection(colName).where({ _id: _.exists(true) }).limit(100).get()
            if (!res.data || res.data.length === 0) break
            const ids = res.data.map(d => d._id)
            for (const id of ids) {
                await db.collection(colName).doc(id).remove()
            }
            deleted += ids.length
        }
        return `🗑️ 已清除 ${colName} (${deleted}条旧数据)`
    } catch (e) {
        if (e.message && e.message.includes('does not exist')) {
            return `⚠️ ${colName} 不存在，跳过清除`
        }
        return `❌ 清除 ${colName} 出错: ${e.message}`
    }
}

// 确保集合存在
async function ensureCollection(colName) {
    try {
        await db.createCollection(colName)
        return `✅ 创建集合: ${colName}`
    } catch (e) {
        const msg = e && e.message ? e.message : ''
        if (
            msg.includes('existed')
            || msg.includes('ResourceExist')
            || msg.includes('Table exist')
        ) {
            return `✅ 集合已存在: ${colName}`
        }
        return `❌ 创建集合失败: ${colName} — ${msg}`
    }
}

exports.main = async (event, context) => {
    if (!canRunOperations(event)) {
        return { code: 403, msg: '该运维函数已锁定，仅允许携带服务器运维凭证调用' }
    }
    const mode = event && event.mode ? event.mode : 'collections'
    const results = []

    // 默认模式：只创建集合，适合空环境快速初始化
    if (mode === 'collections') {
        results.push('=== 创建集合 ===')
        for (const col of COLLECTIONS) {
            results.push(await ensureCollection(col))
        }
        return {
            code: 0,
            msg: '✅ 集合初始化完成',
            mode,
            results
        }
    }

    // reset 模式：清空旧数据并重建集合
    results.push('=== 第一步：清除旧数据 ===')
    for (const col of COLLECTIONS) {
        results.push(await clearCollection(col))
    }

    results.push('=== 第二步：创建集合 ===')
    for (const col of COLLECTIONS) {
        results.push(await ensureCollection(col))
    }

    if (mode !== 'reset-with-samples') {
        return {
            code: 0,
            msg: '✅ 重置完成',
            mode,
            results
        }
    }

    // reset-with-samples 模式：额外写入示例数据
    results.push('=== 第三步：写入示例数据 ===')
    try {
        // 写入8门课程
        for (const course of SAMPLE_COURSES) {
            const addRes = await db.collection('courses').add({ data: course })

            // 为"常识"课程写入示例题目
            if (course.sort === 1) {
                const questions = [
                    {
                        courseId: addRes._id, type: 'fill', sort: 1,
                        content: '我国实行九年义务教育制度，小学阶段为（）年，初中阶段为（）年。',
                        answer: '小学6年，初中3年',
                        explanation: '义务教育法规定：义务教育年限9年，小学6年，初中3年。',
                        imageUrl: '', createdAt: new Date()
                    },
                    {
                        courseId: addRes._id, type: 'choice', sort: 2,
                        content: '下列哪个选项是中国的首都？',
                        options: ['上海', '北京', '广州', '深圳'], correctIndex: 1,
                        answer: 'B. 北京',
                        explanation: '北京是中华人民共和国首都，是全国政治、文化中心。',
                        imageUrl: '', createdAt: new Date()
                    },
                    {
                        courseId: addRes._id, type: 'fill', sort: 3,
                        content: '中国正式建立学位制度是哪一年？',
                        answer: '1981年',
                        explanation: '1981年1月1日，《中华人民共和国学位条例》正式实施。',
                        imageUrl: '', createdAt: new Date()
                    },
                    {
                        courseId: addRes._id, type: 'choice', sort: 4,
                        content: '《中华人民共和国宪法》规定，我国的根本制度是？',
                        options: ['社会主义制度', '人民代表大会制度', '共产党领导制度', '民主集中制'],
                        correctIndex: 0, answer: 'A. 社会主义制度',
                        explanation: '宪法第一条：社会主义制度是中华人民共和国的根本制度。',
                        imageUrl: '', createdAt: new Date()
                    },
                    {
                        courseId: addRes._id, type: 'fill', sort: 5,
                        content: '我国现行《宪法》颁布于哪一年？',
                        answer: '1982年',
                        explanation: '1982年12月4日，第五届全国人民代表大会第五次会议通过现行《宪法》。',
                        imageUrl: '', createdAt: new Date()
                    }
                ]
                for (const q of questions) {
                    await db.collection('questions').add({ data: q })
                }
                results.push(`✅ 常识课程写入 ${questions.length} 道示例题目`)
            }

            // 为"言语理解"写入示例题目
            if (course.sort === 2) {
                const questions = [
                    {
                        courseId: addRes._id, type: 'choice', sort: 1,
                        content: '下列句子中，语义最完整的是？',
                        options: ['他认真地学习', '她今天去市场买了很多新鲜蔬菜', '天气好', '我走'],
                        correctIndex: 1, answer: 'B',
                        explanation: '完整句子包含主谓宾等成分，B选项最完整。',
                        imageUrl: '', createdAt: new Date()
                    },
                    {
                        courseId: addRes._id, type: 'fill', sort: 2,
                        content: '"一石二鸟"这个成语比喻（）。',
                        answer: '一举两得，做一件事同时得到两个好处',
                        explanation: '原指一块石头打下两只鸟，比喻做一件事情得到两种好处。',
                        imageUrl: '', createdAt: new Date()
                    }
                ]
                for (const q of questions) {
                    await db.collection('questions').add({ data: q })
                }
                results.push(`✅ 言语理解课程写入 ${questions.length} 道示例题目`)
            }
        }
        results.push(`✅ 共写入 ${SAMPLE_COURSES.length} 门课程`)
    } catch (e) {
        results.push(`❌ 写入示例数据失败: ${e.message}`)
    }

    return { code: 0, msg: '✅ 初始化完成！', mode, results }
}
