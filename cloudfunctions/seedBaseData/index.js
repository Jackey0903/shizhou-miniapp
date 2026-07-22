const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const REQUIRED_COLLECTIONS = [
  'courses',
  'subjects',
  'question_banks',
  'questions',
  'vip_plans',
  'punch_backgrounds',
  'punch_quotes',
  'materials',
  'audios',
  'messages',
  'ad_slots',
  'notification_settings',
  'study_reminders',
  'material_redemptions',
  'correction_reports',
  'help_config'
]

const SUBJECTS = [
  { name: '常识', sort: 1, color: '#FEF2F2' },
  { name: '言语理解', sort: 2, color: '#FFF7ED' },
  { name: '数量关系', sort: 3, color: '#FEFCE8' },
  { name: '判断推理', sort: 4, color: '#F0FDF4' },
  { name: '资料分析', sort: 5, color: '#ECFEFF' },
  { name: '申论', sort: 6, color: '#EFF6FF' },
  { name: '法律法规', sort: 7, color: '#F5F3FF' },
  { name: '时事政治', sort: 8, color: '#FDF2F8' }
]

const BANKS = [
  { key: 'common-a', subject: '常识', name: '题库A', series: '基础题库', sort: 1, preview: ['题库A'], description: '法律、历史、科技、生活常识基础题。' },
  { key: 'common-b', subject: '常识', name: '题库B', series: '高频真题', sort: 2, preview: ['题库B'], description: '国情地理、人文时政高频题。' },
  { key: 'common-c', subject: '常识', name: '题库C', series: '冲刺速刷', sort: 3, preview: ['题库C'], description: '法律、人文、科技常识冲刺练习。' },
  { key: 'language-a', subject: '言语理解', name: '题库A', series: '基础题库', sort: 4, preview: ['题库A'], description: '选词填空、病句、语句排序。' },
  { key: 'language-b', subject: '言语理解', name: '题库B', series: '专项提升', sort: 5, preview: ['题库B'], description: '阅读理解和逻辑填空训练。' },
  { key: 'language-c', subject: '言语理解', name: '题库C', series: '高频速刷', sort: 6, preview: ['题库C'], description: '高频成语、语义辨析速刷。' },
  { key: 'math-a', subject: '数量关系', name: '题库A', series: '基础题库', sort: 7, preview: ['题库A'], description: '工程、行程、比例等基础题。' },
  { key: 'logic-a', subject: '判断推理', name: '题库A', series: '基础题库', sort: 8, preview: ['题库A'], description: '图形、定义、类比、逻辑判断。' },
  { key: 'data-a', subject: '资料分析', name: '题库A', series: '基础题库', sort: 9, preview: ['题库A'], description: '增长率、比重、倍数专项。' },
  { key: 'essay-a', subject: '申论', name: '题库A', series: '专项训练', sort: 10, preview: ['题库A'], description: '归纳概括、综合分析、公文写作。' },
  { key: 'law-a', subject: '法律法规', name: '题库A', series: '基础题库', sort: 11, preview: ['题库A'], description: '宪法、民法、行政法常见考点。' },
  { key: 'current-a', subject: '时事政治', name: '题库A', series: '热点速刷', sort: 12, preview: ['题库A'], description: '近期热点政策和重要会议。' }
]

const QUESTION_BANK = {
  'common-a': [
    { type: 'choice', sort: 1, content: '中国现行宪法通过于哪一年？', options: ['1978年', '1982年', '1988年', '1993年'], correctIndex: 1, answer: 'B. 1982年', explanation: '我国现行宪法于1982年通过。' },
    { type: 'fill', sort: 2, content: '中国国歌的名称是《______》。', answer: '义勇军进行曲', explanation: '《义勇军进行曲》是中华人民共和国国歌。' },
    { type: 'choice', sort: 3, content: '下列哪一项不属于中国古代四大发明？', options: ['造纸术', '火药', '指南针', '地动仪'], correctIndex: 3, answer: 'D. 地动仪', explanation: '四大发明为造纸术、印刷术、火药、指南针。' }
  ],
  'common-b': [
    { type: 'choice', sort: 1, content: '我国领土最南端位于哪一群岛附近？', options: ['舟山群岛', '南沙群岛', '庙岛群岛', '崇明岛'], correctIndex: 1, answer: 'B. 南沙群岛', explanation: '我国最南端位于曾母暗沙附近。' },
    { type: 'fill', sort: 2, content: '被称为“世界屋脊”的高原是______。', answer: '青藏高原', explanation: '青藏高原平均海拔高。' },
    { type: 'choice', sort: 3, content: '下列节日中，属于法定节假日的是？', options: ['重阳节', '寒食节', '端午节', '上巳节'], correctIndex: 2, answer: 'C. 端午节', explanation: '端午节是我国法定节假日。' }
  ],
  'common-c': [
    { type: 'choice', sort: 1, content: '“一带一路”倡议提出于哪一年？', options: ['2012年', '2013年', '2014年', '2015年'], correctIndex: 1, answer: 'B. 2013年', explanation: '“一带一路”倡议于2013年提出。' },
    { type: 'fill', sort: 2, content: '中国的首都是______。', answer: '北京', explanation: '中华人民共和国首都是北京。' },
    { type: 'choice', sort: 3, content: '下列哪项属于新能源？', options: ['煤炭', '石油', '风能', '天然气'], correctIndex: 2, answer: 'C. 风能', explanation: '风能属于清洁新能源。' }
  ],
  'language-a': [
    { type: 'choice', sort: 1, content: '下列词语中，没有错别字的一项是？', options: ['再接再励', '迫不急待', '名副其实', '融会惯通'], correctIndex: 2, answer: 'C. 名副其实', explanation: '其余三项均有错别字。' },
    { type: 'fill', sort: 2, content: '“一举两得”比喻做一件事同时得到______。', answer: '两种好处', explanation: '表示一次行动得到双重收益。' },
    { type: 'choice', sort: 3, content: '“南辕北辙”最适合形容哪种情况？', options: ['目标一致', '行动与目标相反', '意见统一', '过程顺利'], correctIndex: 1, answer: 'B. 行动与目标相反', explanation: '比喻行动和目的正好相反。' }
  ],
  'language-b': [
    { type: 'choice', sort: 1, content: '“锲而不舍，金石可镂”强调做事要保持什么？', options: ['谨慎', '坚持', '低调', '宽容'], correctIndex: 1, answer: 'B. 坚持', explanation: '强调恒心和坚持不懈。' },
    { type: 'fill', sort: 2, content: '“推敲”一词最早与唐代诗人______有关。', answer: '贾岛', explanation: '“推敲”典故出自贾岛。' },
    { type: 'choice', sort: 3, content: '“画龙点睛”比喻写作或说话时怎样？', options: ['重复罗列', '抓住关键加以点明', '避重就轻', '空洞冗长'], correctIndex: 1, answer: 'B. 抓住关键加以点明', explanation: '比喻在关键处用精辟语句使内容生动有力。' }
  ],
  'language-c': [
    { type: 'choice', sort: 1, content: '下列句子中，语意最连贯的一项是？', options: ['先结果后原因', '前后重复表述', '逻辑顺序清晰自然', '主语频繁切换'], correctIndex: 2, answer: 'C. 逻辑顺序清晰自然', explanation: '语句衔接题要保证逻辑和语意连贯。' },
    { type: 'fill', sort: 2, content: '“不积跬步，无以至______。”', answer: '千里', explanation: '出自《荀子》。' },
    { type: 'choice', sort: 3, content: '“望洋兴叹”更适合形容哪种状态？', options: ['信心十足', '无能为力而感叹', '准备充分', '反复比较'], correctIndex: 1, answer: 'B. 无能为力而感叹', explanation: '比喻做事时因力量不够或条件不足而感到无可奈何。' }
  ],
  'math-a': [
    { type: 'fill', sort: 1, content: '某工程甲单独做10天完成，乙单独做15天完成，两人合作一天完成全工程的______。', answer: '1/6', explanation: '1/10 + 1/15 = 1/6。' },
    { type: 'choice', sort: 2, content: '甲乙两地相距120千米，汽车每小时60千米，行完全程需要多少小时？', options: ['1小时', '2小时', '3小时', '4小时'], correctIndex: 1, answer: 'B. 2小时', explanation: '120/60=2。' },
    { type: 'fill', sort: 3, content: '某商品原价80元，打九折后价格为______元。', answer: '72', explanation: '80×0.9=72。' }
  ],
  'logic-a': [
    { type: 'choice', sort: 1, content: '“书本：知识”与下列哪组关系最相近？', options: ['汽车：司机', '老师：课堂', '钥匙：门锁', '土壤：养分'], correctIndex: 3, answer: 'D. 土壤：养分', explanation: '书本承载知识，土壤蕴含养分。' },
    { type: 'choice', sort: 2, content: '如果所有A都是B，所有B都是C，那么可以推出？', options: ['所有C都是A', '所有A都是C', '部分A不是C', 'A与C无关'], correctIndex: 1, answer: 'B. 所有A都是C', explanation: '典型传递推理。' },
    { type: 'fill', sort: 3, content: '图形推理中，优先观察图形的数量、位置、方向和______。', answer: '样式', explanation: '图形推理常从数量、位置、方向、样式等角度观察。' }
  ],
  'data-a': [
    { type: 'fill', sort: 1, content: '若现期值为120，增长率为20%，则基期值为______。', answer: '100', explanation: '120 ÷ 1.2 = 100。' },
    { type: 'choice', sort: 2, content: '若A占B的25%，则B是A的多少倍？', options: ['2倍', '3倍', '4倍', '5倍'], correctIndex: 2, answer: 'C. 4倍', explanation: 'A/B=25%，所以B/A=4。' },
    { type: 'fill', sort: 3, content: '某项指标由80增长到100，增长量为______。', answer: '20', explanation: '增长量=100-80。' }
  ],
  'essay-a': [
    { type: 'fill', sort: 1, content: '申论归纳概括题作答时，应优先保证答案______。', answer: '要点全面', explanation: '归纳概括题重在全面、准确、简洁。' },
    { type: 'choice', sort: 2, content: '申论综合分析题最核心的要求是？', options: ['堆砌材料', '观点明确且分析充分', '字数越多越好', '只写对策'], correctIndex: 1, answer: 'B. 观点明确且分析充分', explanation: '综合分析强调观点鲜明、分析充分。' },
    { type: 'fill', sort: 3, content: '申论公文写作时，首先要明确写作对象和______。', answer: '文种', explanation: '公文写作要先明确对象、场景与文种。' }
  ],
  'law-a': [
    { type: 'choice', sort: 1, content: '中华人民共和国的根本法是？', options: ['民法典', '宪法', '刑法', '行政诉讼法'], correctIndex: 1, answer: 'B. 宪法', explanation: '宪法是国家的根本法。' },
    { type: 'fill', sort: 2, content: '民事主体从事民事活动，应当遵循自愿、公平、诚信和______原则。', answer: '公序良俗', explanation: '民法典规定民事活动应遵循公序良俗。' },
    { type: 'choice', sort: 3, content: '行政处罚中，罚款属于哪一类法律责任？', options: ['民事责任', '行政责任', '刑事责任', '违约责任'], correctIndex: 1, answer: 'B. 行政责任', explanation: '罚款属于行政处罚。' }
  ],
  'current-a': [
    { type: 'choice', sort: 1, content: '时政学习中，最重要的信息来源应优先参考？', options: ['娱乐八卦号', '官方权威媒体和政策文件', '匿名论坛', '二手转述'], correctIndex: 1, answer: 'B. 官方权威媒体和政策文件', explanation: '应优先参考权威官方来源。' },
    { type: 'fill', sort: 2, content: '学习时政时，建议从政策背景、核心内容和______三个角度梳理。', answer: '现实意义', explanation: '理解政策需兼顾背景、内容和现实意义。' },
    { type: 'choice', sort: 3, content: '时事政治备考中，热点整理更适合采用哪种方式？', options: ['只看标题', '随便截图', '按主题分类归纳', '临场发挥'], correctIndex: 2, answer: 'C. 按主题分类归纳', explanation: '按主题整理更有利于复习。' }
  ]
}

const EXTRA_TEST_QUESTIONS = {
  'common-a': [
    { type: 'choice', sort: 4, content: '“四书”不包括下列哪一项？', options: ['《大学》', '《中庸》', '《论语》', '《左传》'], correctIndex: 3, answer: 'D. 《左传》', explanation: '四书为《大学》《中庸》《论语》《孟子》。' },
    { type: 'fill', sort: 5, content: '我国面积最大的省级行政区是______。', answer: '新疆维吾尔自治区', explanation: '新疆是我国面积最大的省级行政区。' },
    { type: 'choice', sort: 6, content: '下列哪种能源属于可再生能源？', options: ['煤炭', '石油', '太阳能', '天然气'], correctIndex: 2, answer: 'C. 太阳能', explanation: '太阳能属于可再生能源。' },
    { type: 'fill', sort: 7, content: '人民法院是国家的______机关。', answer: '审判', explanation: '人民法院是国家审判机关。' }
  ],
  'common-b': [
    { type: 'choice', sort: 4, content: '我国最长的河流是？', options: ['黄河', '珠江', '长江', '黑龙江'], correctIndex: 2, answer: 'C. 长江', explanation: '长江是我国第一长河。' },
    { type: 'fill', sort: 5, content: '我国的国土面积约为______万平方千米。', answer: '960', explanation: '我国陆地国土面积约960万平方千米。' },
    { type: 'choice', sort: 6, content: '下列城市中，属于直辖市的是？', options: ['武汉', '南京', '天津', '杭州'], correctIndex: 2, answer: 'C. 天津', explanation: '天津是我国四个直辖市之一。' },
    { type: 'fill', sort: 7, content: '“五岳归来不看山，黄山归来不看岳”中的黄山位于______省。', answer: '安徽', explanation: '黄山位于安徽省南部。' }
  ],
  'common-c': [
    { type: 'choice', sort: 4, content: '下列哪一项属于新质生产力的重要特征？', options: ['低效率重复劳动', '科技创新驱动', '单一资源依赖', '粗放式增长'], correctIndex: 1, answer: 'B. 科技创新驱动', explanation: '新质生产力强调创新驱动。' },
    { type: 'fill', sort: 5, content: '我国的根本政治制度是______制度。', answer: '人民代表大会', explanation: '人民代表大会制度是我国根本政治制度。' },
    { type: 'choice', sort: 6, content: '下列哪项不属于生活中的低碳行为？', options: ['绿色出行', '随手关灯', '长时间空转空调', '循环利用纸张'], correctIndex: 2, answer: 'C. 长时间空转空调', explanation: '长时间空转空调不属于低碳行为。' },
    { type: 'fill', sort: 7, content: '中国共产党第二十次全国代表大会于______年召开。', answer: '2022', explanation: '党的二十大于2022年召开。' }
  ],
  'language-a': [
    { type: 'choice', sort: 4, content: '下列词语中，使用恰当的一项是？', options: ['这篇文章逻辑严紧', '他做事非常粗心大意', '现场秩序井然有序', '意见已经达成共鸣'], correctIndex: 1, answer: 'B. 他做事非常粗心大意', explanation: '其余选项搭配或表述不当。' },
    { type: 'fill', sort: 5, content: '“学而不思则罔，思而不学则______。”', answer: '殆', explanation: '出自《论语》。' },
    { type: 'choice', sort: 6, content: '句子排序最应优先关注哪一项？', options: ['字数长短', '修辞华丽程度', '逻辑衔接', '标点多少'], correctIndex: 2, answer: 'C. 逻辑衔接', explanation: '语句排序重在逻辑与语意衔接。' },
    { type: 'fill', sort: 7, content: '“按部就班”中的“部”本义是门类，“班”本义是______。', answer: '次序', explanation: '按部就班比喻按照一定步骤和次序进行。' }
  ],
  'language-b': [
    { type: 'choice', sort: 4, content: '“莫衷一是”常用来形容什么？', options: ['意见一致', '意见纷杂不能得出一致结论', '行动迅速', '态度鲜明'], correctIndex: 1, answer: 'B. 意见纷杂不能得出一致结论', explanation: '莫衷一是指不能得出一致结论。' },
    { type: 'fill', sort: 5, content: '“纸上得来终觉浅，绝知此事要______。”', answer: '躬行', explanation: '出自陆游诗句。' },
    { type: 'choice', sort: 6, content: '阅读理解题中，概括主旨最重要的是把握？', options: ['具体例子', '中心观点', '生僻词语', '作者生平'], correctIndex: 1, answer: 'B. 中心观点', explanation: '主旨题重点把握中心观点。' },
    { type: 'fill', sort: 7, content: '“鞭辟入里”多形容分析问题______。', answer: '深刻透彻', explanation: '表示分析问题切中要害、深刻透彻。' }
  ],
  'language-c': [
    { type: 'choice', sort: 4, content: '下列句子中，没有语病的一项是？', options: ['通过努力，使成绩显著提高', '学校开展了丰富多彩的阅读活动', '他大概肯定会准时到', '是否认真复习，是提高成绩的关键'], correctIndex: 1, answer: 'B. 学校开展了丰富多彩的阅读活动', explanation: '其余三项均有病句问题。' },
    { type: 'fill', sort: 5, content: '“青，取之于蓝而青于蓝”中的“蓝”指的是______。', answer: '蓝草', explanation: '该句出自《荀子》，蓝指蓝草。' },
    { type: 'choice', sort: 6, content: '“画蛇添足”最贴近哪种做法？', options: ['抓住重点', '多此一举', '未雨绸缪', '精益求精'], correctIndex: 1, answer: 'B. 多此一举', explanation: '画蛇添足比喻做了多余的事，反而不恰当。' },
    { type: 'fill', sort: 7, content: '“不言而喻”中的“喻”是______的意思。', answer: '明白', explanation: '不言而喻即不用说就能明白。' }
  ],
  'math-a': [
    { type: 'choice', sort: 4, content: '某班有男生20人、女生30人，男生占全班人数的多少？', options: ['20%', '30%', '40%', '50%'], correctIndex: 2, answer: 'C. 40%', explanation: '20÷50=40%。' },
    { type: 'fill', sort: 5, content: '一件商品原价100元，先涨价10%，再降价10%，现价为______元。', answer: '99', explanation: '100×1.1×0.9=99。' },
    { type: 'choice', sort: 6, content: '甲每小时行4千米，乙每小时行6千米，两人相向而行，2小时共行多少千米？', options: ['16', '18', '20', '24'], correctIndex: 2, answer: 'C. 20', explanation: '(4+6)×2=20。' },
    { type: 'fill', sort: 7, content: '某数的25%是40，则这个数是______。', answer: '160', explanation: '40÷25%=160。' }
  ],
  'logic-a': [
    { type: 'choice', sort: 4, content: '“医生：病人”与下列哪组关系最相近？', options: ['教师：学生', '司机：汽车', '钥匙：门', '农民：土地'], correctIndex: 0, answer: 'A. 教师：学生', explanation: '均为职业与服务对象的关系。' },
    { type: 'fill', sort: 5, content: '定义判断做题时，最关键的是抓住定义中的______。', answer: '关键信息', explanation: '定义判断重点在于提取关键信息。' },
    { type: 'choice', sort: 6, content: '若“有的A是B”为真，则下列哪项一定为真？', options: ['所有A都是B', '所有B都是A', '至少有一个A属于B', '没有A是B'], correctIndex: 2, answer: 'C. 至少有一个A属于B', explanation: '“有的”表示至少存在一个。' },
    { type: 'fill', sort: 7, content: '类比推理中，若两个词语间是“整体与部分”关系，备选项也应保持______。', answer: '相同关系', explanation: '类比推理要求关系一致。' }
  ],
  'data-a': [
    { type: 'choice', sort: 4, content: '某地区产值由200增加到260，增长率是多少？', options: ['20%', '25%', '30%', '35%'], correctIndex: 2, answer: 'C. 30%', explanation: '(260-200)÷200=30%。' },
    { type: 'fill', sort: 5, content: '若甲为80，乙为100，则甲比乙低______%。', answer: '20', explanation: '(100-80)÷100=20%。' },
    { type: 'choice', sort: 6, content: '某项支出占总支出的40%，若总支出为500，则该项支出为多少？', options: ['150', '180', '200', '220'], correctIndex: 2, answer: 'C. 200', explanation: '500×40%=200。' },
    { type: 'fill', sort: 7, content: '现期值为150，基期值为120，则增长量为______。', answer: '30', explanation: '增长量=150-120。' }
  ],
  'essay-a': [
    { type: 'choice', sort: 4, content: '申论贯彻执行题写作时，首先应明确哪一项？', options: ['字数越多越好', '写作身份和对象', '只抄材料', '多用口语'], correctIndex: 1, answer: 'B. 写作身份和对象', explanation: '贯彻执行题首先要明确身份、对象与文种。' },
    { type: 'fill', sort: 5, content: '申论大作文立意应做到准确、鲜明和______。', answer: '集中', explanation: '立意要准确鲜明、中心集中。' },
    { type: 'choice', sort: 6, content: '申论概括题中，作答语言应尽量做到？', options: ['冗长铺陈', '口语化表达', '简洁规范', '脱离材料自由发挥'], correctIndex: 2, answer: 'C. 简洁规范', explanation: '概括题强调简洁、准确、规范。' },
    { type: 'fill', sort: 7, content: '申论对策题常见作答结构是“问题—原因—______”。', answer: '对策', explanation: '对策题常按问题、原因、对策组织答案。' }
  ],
  'law-a': [
    { type: 'choice', sort: 4, content: '根据民法典，自然人的民事权利能力始于？', options: ['怀孕时', '出生时', '成年时', '上学时'], correctIndex: 1, answer: 'B. 出生时', explanation: '自然人民事权利能力始于出生，终于死亡。' },
    { type: 'fill', sort: 5, content: '行政机关作出行政处罚前，应当告知当事人作出处罚决定的事实、理由和______。', answer: '依据', explanation: '行政处罚法规定应告知事实、理由和依据。' },
    { type: 'choice', sort: 6, content: '下列哪项属于刑罚中的附加刑？', options: ['拘役', '有期徒刑', '罚金', '管制'], correctIndex: 2, answer: 'C. 罚金', explanation: '罚金属于附加刑。' },
    { type: 'fill', sort: 7, content: '宪法规定，中华人民共和国的一切权力属于______。', answer: '人民', explanation: '宪法明确规定国家一切权力属于人民。' }
  ],
  'current-a': [
    { type: 'choice', sort: 4, content: '备考时事政治时，下列哪种做法更合理？', options: ['只看短视频标题', '系统整理重要会议和政策', '完全不看官方报道', '只背零散热词'], correctIndex: 1, answer: 'B. 系统整理重要会议和政策', explanation: '时政备考应系统整理权威内容。' },
    { type: 'fill', sort: 5, content: '时政学习中，最应优先关注的来源是______媒体。', answer: '权威官方', explanation: '应优先关注权威官方媒体与文件。' },
    { type: 'choice', sort: 6, content: '学习时政热点时，以下哪项最有助于理解考点？', options: ['只记发布日期', '只看网友评论', '梳理背景、内容与意义', '背诵无关数字'], correctIndex: 2, answer: 'C. 梳理背景、内容与意义', explanation: '应从背景、内容、意义三个层面掌握时政。' },
    { type: 'fill', sort: 7, content: '时政备考中的热点，通常需要按照主题进行分类和______。', answer: '归纳', explanation: '主题分类归纳更利于记忆与复习。' }
  ]
}

Object.keys(EXTRA_TEST_QUESTIONS).forEach((key) => {
  QUESTION_BANK[key] = (QUESTION_BANK[key] || []).concat(EXTRA_TEST_QUESTIONS[key])
})

const VIP_PLANS = [
  { code: 'basic_vip_year', tag: '基础VIP', name: '基础VIP包年', price: 19800, days: 365, supervisionDays: 0, virtualProductId: 'basic_vip_year', sort: 1, enabled: true, benefits: ['免广告学习'] },
  { code: 'supervision_trial_day', tag: '督学试用', name: '督学试用1日', price: 800, days: 365, supervisionDays: 1, virtualProductId: 'supervision_trial_day', sort: 2, enabled: true, benefits: ['督学试用1天', '赠送1年免广告学习'] },
  { code: 'supervision_month', tag: '督学包月', name: '督学包月', price: 19800, days: 365, supervisionDays: 30, virtualProductId: 'supervision_month', sort: 3, enabled: true, benefits: ['督学包月服务', '赠送1年免广告学习'] },
  { code: 'premium_vip_year', tag: '高级VIP', name: '高级VIP包年', price: 98800, days: 365, supervisionDays: 365, virtualProductId: 'premium_vip_year', sort: 4, enabled: true, benefits: ['免广告学习', '督学包年服务'] }
]

const PUNCH_QUOTES = [
  '今日完成一点点，未来上岸一大步。'
]

const MATERIALS = [
  { name: '定义判断可能涉及常识141条', type: 'document', category: '判断推理', description: '定义判断可能涉及常识141条 PDF资料。', accessType: 'coin', coinCost: 10, sort: 1, fileUrl: 'https://636c-cloud-2ge02vrucaf8a6ab-1398720138.tcb.qcloud.la/client-assets/20260514/docs/document-001.pdf' },
  { name: '数量关系知识点185式', type: 'document', category: '数量关系', description: '数量关系知识点185式 PDF资料。', accessType: 'coin', coinCost: 10, sort: 2, fileUrl: 'https://636c-cloud-2ge02vrucaf8a6ab-1398720138.tcb.qcloud.la/client-assets/20260514/docs/document-003.pdf' },
  { name: '言语理解知识点37式', type: 'document', category: '言语理解', description: '言语理解知识点37式 PDF资料。', accessType: 'coin', coinCost: 10, sort: 3, fileUrl: 'https://636c-cloud-2ge02vrucaf8a6ab-1398720138.tcb.qcloud.la/client-assets/20260514/docs/document-006.pdf' }
]

const AUDIOS = [
  { title: '法律法学类常识', category: '常识', duration: '', type: '磨耳朵', sort: 1, fileUrl: 'https://636c-cloud-2ge02vrucaf8a6ab-1398720138.tcb.qcloud.la/client-assets/20260514/audio/audio-001.mp3' },
  { title: '资料分析常见陷阱大全', category: '资料', duration: '', type: '磨耳朵', sort: 2, fileUrl: 'https://636c-cloud-2ge02vrucaf8a6ab-1398720138.tcb.qcloud.la/client-assets/20260514/audio/audio-003.mp3' },
  { title: '公考数量关系 方程法', category: '数量', duration: '', type: '磨耳朵', sort: 3, fileUrl: 'https://636c-cloud-2ge02vrucaf8a6ab-1398720138.tcb.qcloud.la/client-assets/20260514/audio/audio-013.mp3' }
]

const MESSAGES = [
  { title: '系统提醒', content: '新用户登录可获3天考点记忆卡部分免广告浏览。', icon: '🔔', scope: 'all', enabled: true, sort: 1 },
  { title: '推荐消息', content: '完成今天任一题库任务即可生成打卡海报。', icon: '📢', scope: 'all', enabled: true, sort: 2 }
]

const AD_SLOTS = [
  { name: '学习计划横幅', position: 'study-plan-banner', unitId: '', adUnitId: '', enabled: false, sort: 1, remark: '学习计划页顶部横幅广告' },
  { name: '题目页横幅', position: 'question-banner', unitId: '', adUnitId: '', enabled: false, sort: 2, remark: '题目解析区横幅广告' }
]

const NOTIFICATION_SETTINGS = [
  {
    key: 'study_reminder',
    name: '学习提醒模板',
    templateId: 'Jtg_v3OpDQxTi1hInK9LkHNpTnbMd4joPGJgDtuMkpw',
    page: 'pages/supervision-plan/supervision-plan',
    thingKey: 'thing2',
    timeKey: 'time3',
    remarkKey: 'thing4',
    titlePrefix: '学习提醒',
    miniprogramState: 'formal',
    enabled: true,
    sort: 1,
    remark: '默认使用自习完成通知模板作为学习提醒'
  }
]


async function clearCollection(colName) {
  try {
    while (true) {
      const res = await db.collection(colName).where({ _id: _.exists(true) }).limit(100).get()
      if (!res.data.length) break
      await Promise.all(res.data.map((item) => db.collection(colName).doc(item._id).remove()))
    }
  } catch (err) {
    const msg = err && err.message ? err.message : ''
    if (msg.includes('Db or Table not exist') || msg.includes('does not exist')) {
      await db.createCollection(colName)
      return
    }
    throw err
  }
}

async function ensureCollections() {
  for (const col of REQUIRED_COLLECTIONS) {
    try {
      await db.createCollection(col)
    } catch (err) {
      const msg = err && err.message ? err.message : ''
      if (
        !msg.includes('ResourceExist')
        && !msg.includes('Table exist')
        && !msg.includes('existed')
      ) {
        throw err
      }
    }
  }
}

async function upsertLearningData() {
  const [subjectsRes, banksRes, legacyCoursesRes] = await Promise.all([
    db.collection('subjects').get(),
    db.collection('question_banks').get(),
    db.collection('courses').get()
  ])

  const subjectByName = new Map(subjectsRes.data.map((item) => [item.name, item]))
  const bankByKey = new Map(
    banksRes.data.map((item) => [`${item.subjectName || item.category}::${item.name}`, item])
  )
  const courseByKey = new Map(
    legacyCoursesRes.data.map((item) => [`${item.category}::${item.name}`, item])
  )

  const subjectMap = {}
  for (const subject of SUBJECTS) {
    const existing = subjectByName.get(subject.name)
    const payload = {
      ...subject,
      description: '',
      status: 'enabled',
      updatedAt: db.serverDate()
    }

    if (existing) {
      await db.collection('subjects').doc(existing._id).update({ data: payload })
      subjectMap[subject.name] = { ...existing, ...payload, _id: existing._id }
    } else {
      const res = await db.collection('subjects').add({
        data: {
          ...payload,
          createdAt: db.serverDate()
        }
      })
      subjectMap[subject.name] = { ...payload, _id: res._id }
    }
  }

  const bankMap = {}
  for (const bank of BANKS) {
    const subject = subjectMap[bank.subject]
    const questionList = QUESTION_BANK[bank.key] || []
    const lookupKey = `${bank.subject}::${bank.name}`
    const payload = {
      subjectId: subject._id,
      subjectName: subject.name,
      category: subject.name,
      name: bank.name,
      series: bank.series,
      description: bank.description,
      preview: bank.preview,
      totalCount: questionList.length,
      isLocked: false,
      sort: bank.sort,
      status: 'enabled',
      updatedAt: db.serverDate()
    }

    const existing = bankByKey.get(lookupKey)
    if (existing) {
      await db.collection('question_banks').doc(existing._id).update({ data: payload })
      bankMap[bank.key] = { ...existing, ...payload, _id: existing._id, subjectId: subject._id }
    } else {
      const res = await db.collection('question_banks').add({
        data: {
          ...payload,
          createdAt: db.serverDate()
        }
      })
      bankMap[bank.key] = { ...payload, _id: res._id, subjectId: subject._id }
    }

    const legacyPayload = {
      category: subject.name,
      name: bank.name,
      series: bank.series,
      description: bank.description,
      preview: bank.preview,
      totalCount: questionList.length,
      sort: bank.sort,
      updatedAt: db.serverDate()
    }
    const existingCourse = courseByKey.get(lookupKey)
    if (existingCourse) {
      await db.collection('courses').doc(existingCourse._id).update({ data: legacyPayload })
    } else {
      await db.collection('courses').add({
        data: {
          ...legacyPayload,
          createdAt: db.serverDate()
        }
      })
    }
  }

  let totalQuestions = 0
  for (const key of Object.keys(bankMap)) {
    const bank = bankMap[key]
    const questionList = QUESTION_BANK[key] || []
    totalQuestions += questionList.length

    const existingRes = await db.collection('questions').where({ bankId: bank._id }).get()
    const existingBySort = new Map(existingRes.data.map((item) => [item.sort, item]))

    for (const q of questionList) {
      const payload = {
        ...q,
        bankId: bank._id,
        courseId: bank._id,
        imageUrl: q.imageUrl || '',
        updatedAt: db.serverDate()
      }
      const existing = existingBySort.get(q.sort)
      if (existing) {
        await db.collection('questions').doc(existing._id).update({ data: payload })
      } else {
        await db.collection('questions').add({
          data: {
            ...payload,
            createdAt: db.serverDate()
          }
        })
      }
    }
  }

  return {
    subjects: SUBJECTS.length,
    banks: BANKS.length,
    questions: totalQuestions
  }
}

async function patchHomeCards() {
  const targets = BANKS.filter((bank) => bank.key === 'common-c' || bank.key === 'language-c')
  const subjectsRes = await db.collection('subjects').where({
    name: _.in(['常识', '言语理解'])
  }).get()
  const subjectByName = new Map(subjectsRes.data.map((item) => [item.name, item]))

  const banksRes = await db.collection('question_banks').where({
    subjectName: _.in(['常识', '言语理解'])
  }).get()
  const bankByKey = new Map(
    banksRes.data.map((item) => [`${item.subjectName || item.category}::${item.name}`, item])
  )

  let addedBanks = 0
  let addedQuestions = 0

  for (const bank of targets) {
    let subject = subjectByName.get(bank.subject)
    if (!subject) {
      const subjectSeed = SUBJECTS.find((item) => item.name === bank.subject)
      const subjectRes = await db.collection('subjects').add({
        data: {
          ...subjectSeed,
          description: '',
          status: 'enabled',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      subject = { ...subjectSeed, _id: subjectRes._id }
      subjectByName.set(subject.name, subject)
    }

    const lookupKey = `${bank.subject}::${bank.name}`
    let bankDoc = bankByKey.get(lookupKey)
    if (!bankDoc) {
      const bankRes = await db.collection('question_banks').add({
        data: {
          subjectId: subject._id,
          subjectName: subject.name,
          category: subject.name,
          name: bank.name,
          series: bank.series,
          description: bank.description,
          preview: bank.preview,
          totalCount: (QUESTION_BANK[bank.key] || []).length,
          isLocked: false,
          sort: bank.sort,
          status: 'enabled',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      bankDoc = {
        ...bank,
        _id: bankRes._id,
        subjectId: subject._id,
        subjectName: subject.name
      }
      bankByKey.set(lookupKey, bankDoc)
      addedBanks += 1
    }

    const existingQuestionsRes = await db.collection('questions').where({ bankId: bankDoc._id }).get()
    const existingSorts = new Set(existingQuestionsRes.data.map((item) => item.sort))
    const questionList = QUESTION_BANK[bank.key] || []

    for (const question of questionList) {
      if (existingSorts.has(question.sort)) continue
      await db.collection('questions').add({
        data: {
          ...question,
          bankId: bankDoc._id,
          courseId: bankDoc._id,
          imageUrl: question.imageUrl || '',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      addedQuestions += 1
    }

    await db.collection('question_banks').doc(bankDoc._id).update({
      data: {
        totalCount: questionList.length,
        preview: bank.preview,
        updatedAt: db.serverDate()
      }
    })
  }

  return {
    subjects: subjectByName.size,
    banks: addedBanks,
    questions: addedQuestions
  }
}

exports.main = async (event = {}) => {
  const opsToken = process.env.OPS_ADMIN_TOKEN || ''
  if (!opsToken || event.opsToken !== opsToken) {
    return { code: 403, msg: '该运维函数已锁定，仅允许携带服务器运维凭证调用' }
  }
  try {
    const mode = event.mode || 'home-patch'
    await ensureCollections()
    let totalQuestions = 0
    let stats = null

    if (mode === 'home-patch') {
      stats = await patchHomeCards()
      totalQuestions = stats.questions
    } else if (mode === 'patch') {
      stats = await upsertLearningData()
      totalQuestions = stats.questions
    } else {
      const collectionsToReset = mode === 'full'
        ? ['questions', 'question_banks', 'subjects', 'vip_plans', 'punch_backgrounds', 'punch_quotes', 'materials', 'audios', 'messages', 'ad_slots', 'notification_settings', 'study_reminders', 'material_redemptions', 'courses']
        : ['questions', 'question_banks', 'subjects', 'courses']
      await Promise.all(collectionsToReset.map((col) => clearCollection(col)))

      const subjectEntries = await Promise.all(SUBJECTS.map(async (subject) => {
        const res = await db.collection('subjects').add({
          data: {
            ...subject,
            description: '',
            status: 'enabled',
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
        return [subject.name, { ...subject, _id: res._id }]
      }))
      const subjectMap = Object.fromEntries(subjectEntries)

      const bankEntries = await Promise.all(BANKS.map(async (bank) => {
        const subject = subjectMap[bank.subject]
        const questionList = QUESTION_BANK[bank.key] || []
        const res = await db.collection('question_banks').add({
          data: {
            subjectId: subject._id,
            subjectName: subject.name,
            category: subject.name,
            name: bank.name,
            series: bank.series,
            description: bank.description,
            preview: bank.preview,
            totalCount: questionList.length,
            isLocked: false,
            sort: bank.sort,
            status: 'enabled',
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
        return [bank.key, { ...bank, _id: res._id, subjectId: subject._id }]
      }))
      const bankMap = Object.fromEntries(bankEntries)

      const questionTasks = []
      for (const key of Object.keys(bankMap)) {
        const bank = bankMap[key]
        const questions = QUESTION_BANK[key] || []
        totalQuestions += questions.length
        questionTasks.push(...questions.map((q) => db.collection('questions').add({
          data: {
            ...q,
            bankId: bank._id,
            courseId: bank._id,
            imageUrl: q.imageUrl || '',
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })))
      }
      await Promise.all(questionTasks)
      stats = {
        subjects: SUBJECTS.length,
        banks: BANKS.length,
        questions: totalQuestions
      }
    }

    if (mode === 'full') {
      await Promise.all(VIP_PLANS.map((plan) => db.collection('vip_plans').add({
        data: {
          ...plan,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })))

      await db.collection('punch_backgrounds').add({
        data: {
          title: '默认打卡背景',
          imageUrl: '/assets/images/default-checkin-bg.png',
          activeDate: 'default',
          enabled: true,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })

      await Promise.all(PUNCH_QUOTES.map((quote) => db.collection('punch_quotes').add({
        data: {
          content: quote,
          activeDate: 'default',
          enabled: true,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })))

      await Promise.all(MATERIALS.map((item) => db.collection('materials').add({
        data: {
          ...item,
          enabled: true,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })))

      await Promise.all(AUDIOS.map((item) => db.collection('audios').add({
        data: {
          ...item,
          enabled: true,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })))

      await Promise.all(MESSAGES.map((item) => db.collection('messages').add({
        data: {
          ...item,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })))

      await Promise.all(AD_SLOTS.map((item) => db.collection('ad_slots').add({
        data: {
          ...item,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })))

      await Promise.all(NOTIFICATION_SETTINGS.map((item) => db.collection('notification_settings').add({
        data: {
          ...item,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })))
    }

    return {
      code: 0,
      msg: mode === 'full'
        ? '基础科目、题库、题目、套餐与内容素材已写入'
        : mode === 'home-patch'
          ? '首页题库补丁已写入'
        : mode === 'patch'
          ? '首页学习数据已补齐'
          : '基础科目、题库、题目已写入',
      subjects: stats.subjects,
      banks: stats.banks,
      questions: stats.questions,
      mode,
      vipPlans: mode === 'full' ? VIP_PLANS.length : 0,
      materials: mode === 'full' ? MATERIALS.length : 0,
      audios: mode === 'full' ? AUDIOS.length : 0,
      notificationSettings: mode === 'full' ? NOTIFICATION_SETTINGS.length : 0
    }
  } catch (err) {
    return {
      code: -1,
      msg: err.message
    }
  }
}
