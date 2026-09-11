# 1.0.34 客户反馈修复记录

本轮客户共反馈 12 条问题。逐条核对代码后结论是：**6 条在未发布的 `1.0.33` 中已经修好、只差发版；6 条确实还坏着**，其中第 1 条是 `1.0.33` 改了一半引入的新问题。

## 一、结论速查

| # | 客户描述 | 状态 | 处理 |
| --- | --- | --- | --- |
| 1 | 上传上线整个模块却没上线成功，常识判断点上线没反应 | **本轮修复** | 上下线改为同时写 `enabled` 与 `status`；dataset 布尔安全读取 |
| 2 | 音频上传顺序混乱，希望按选中顺序 | 1.0.33 已修 | 上传页支持上移/下移，按选中顺序写 `sort` |
| 3 | 壁纸、资料、题目希望能单条编辑替换 | 1.0.33 已修 | `content-editor` 页 + `question-manager` 页 |
| 4 | 希望能按名称排序，后补的也能到正确位置 | **本轮修复** | 排序值不再被钳平；名称排序模式持久化 |
| 5 | 题目排版：答案出界 | **本轮修复** | 1.0.33 只修了选项，本轮修答案区 |
| 6 | 后台配了督学包月，前台不显示 | 部分已修 + **本轮修复** | 1.0.33 修了续费时隐藏套餐；本轮补上"为什么不显示"的诊断与一键修正 |
| 7 | 壁纸下方希望显示标题 | 1.0.33 已修 | `wp-item-title` |
| 8 | 打卡海报背景改了没反应，还会弹出旧海报 | **本轮修复** | 历史背景去重 + 最后保存的立即生效 + 恢复官方海报入口 |
| 9 | 舟币归零后领取资料，希望提示转发赚舟币 | 1.0.33 已修 | `showCoinShareGuide` |
| 10 | 消息提醒字数限制太少，至少 500 字 | 1.0.33 已修 | 上限已是 1000 字 |
| 11 | 用户权限赠送希望不止最高管理员 | 1.0.33 已修 | 普通管理员即可检索并赠送 |
| 12 | 领取资料里已传的资料找不到 | **本轮修复** | 与 #4 同源；并显示真实总条数与截断提示 |

> 重要：#2、#3、#7、#9、#10、#11 已在代码里，客户看不到是因为 **`1.0.33` 还没发版**。这批要生效必须重新上传小程序版本并提交审核。

## 二、本轮修复的根因与改动

### 1. 点"上线"没反应（#1）

`1.0.33` 把上线判定改成了"两个字段都不能表示下线"：

```js
// cloudfunctions/adminOperations/adminCore.js
return item.enabled !== false && !['disabled', 'offline'].includes(item.status)
```

但 `toggleContent` 没跟着改，仍然只写其中一个字段：模块/题库只写 `status`，资料/音频/壁纸只写 `enabled`。于是一个残留了 `enabled: false` 的模块，点"上线"后 `status` 变成 `enabled`、`enabled` 仍是 `false`，判定结果不变——按钮有反应、状态没变化。

改动：

- `adminCore.js` 新增 `publicationFields(enabled)`，统一返回 `{ enabled, status }`。
- `toggleContent`、`saveSubject`、`saveBank` 全部改用它，**顺带自动修复历史脏数据**：客户只要点一次上线，残留字段就被清干净。
- `createCourse`、`uploadQuestions` 创建模块/题库时也写全两个字段。
- 新增 `utils/dataset.js`：`data-enabled` 在部分基础库里会以字符串落到 dataset，`!"false"` 是 `false`，点"上线"反而发出下线请求。9 个后台开关统一改用 `toggledBoolean()`。

### 2. 排序错乱、后补的内容排最后、资料找不到（#4、#12）

展示顺序普遍用 `Date.now()` 生成（约 `1.7e12`），但后台列表排序用的是：

```js
integer(left.sort, 999999999)   // 上限写死 1e9
```

`integer()` 会把所有时间戳钳成同一个 `1000000000`。后果是：所有新上传的内容并列在最后（因为按名称排序后的内容 `sort` 是 10、20、30…），列表再截断到 500 条时就彻底看不见了。编辑任何一条内容也会把它的 `sort` 重写成 `1e9`，手动排的顺序当场作废。

改动：

- `adminCore.js` 新增 `sortValue()`，使用完整安全整数区间，不再钳平时间戳。
- `listContent`、`saveContent`、`saveSubject`、`saveBank` 全部改用 `sortValue`。
- 新增 `content_orderings` 集合，记录每类内容的排序模式（`manual` / `name` + 方向）。点"按名称排序"后模式会被记住，**之后补传的内容自动落到正确位置，不需要重新传一遍**。
- 用户端 `getMaterials`、`uploadAudios`、`uploadWallpapers` 读取同一模式，保证前后台顺序一致。
- 后台列表显示真实总条数；被截断时明确提示"已显示前 N 条，请用搜索定位"，不再让客户以为资料丢了。
- 三个上传页的"按名称排序"按钮变成模式开关，可随时切回手动顺序。

### 3. 答案出界（#5）

`1.0.33` 只给 `.option-text` 补了换行规则，答案区没动。`.q-answer-toggle` 是 flex 容器，子项 `.q-answer-reveal` 的 `min-width` 默认是 `auto`，长答案会把自己撑宽；而 `.q-card` 是 `overflow: visible`，撑出来的文字直接画到卡片外面。

改动：`.q-answer-reveal` 补 `min-width: 0` / `max-width: 100%` / `overflow: hidden`；答案、解析、用户答案补 `max-width` 与换行规则；题干、选项、解析容器补裁剪兜底。

### 4. 打卡海报背景改了没反应（#8）

两个独立原因：

1. 早期保存的背景文档没有 `activeDate` 字段。去重用的是 `where({ activeDate: 'default' })`，查不到这些历史记录，它们就一直是启用状态，和新背景一起被 `dayIndex % defaults.length` 按天轮播——所以"改了没反应，隔天还冒出前面的海报"。
2. 用户一旦在壁纸页点过"设为打卡背景"，官方海报就被永久覆盖，而页面上没有任何撤销入口。

改动：

- `adminConfigCenter` 按归一化后的日期比对（`item.activeDate || 'default'`），历史记录一并下线；保存时的复用查找同样归一化。
- `getPunchConfig` 的背景选择从"按天轮播"改为"最后保存的立即生效"。**励志文案保留按天轮播**（客户说文案本来就能改，这是运营玩法）。
- 打卡页新增"恢复官方海报"入口，并在返回页面时刷新配置（30 秒节流）。

### 5. 后台配了套餐前台不显示（#6）

`createVipOrder.isValidPlan()` 会把与正式发布配置对不上的套餐**静默过滤掉**：道具 ID 漏填、价格被改过、忘了上线，前台就是没有，而后台列表照常显示——客户无从判断。

注意：VIP 页与督学页的套餐分离是**有意为之**（`regression-plan-separation` 明确断言），督学套餐在"督学开通"页购买，不在"开通会员"页。所以不能简单放开过滤。

改动：

- `createVipOrder` 新增管理员专用的 `planDiagnostics`，对四个正式套餐逐一返回"前台是否可购买"和**具体原因**（缺道具 ID / 价格不符 / 未上线 / 尚未保存过）。
- 套餐配置页显示该状态与原因，并提供"修正并上线"按钮：一键把该套餐重写为锁定的正式配置并上线，权益文案保留。
- 数据库里还没有的套餐也会列出来，客户不会因为"列表里没有"而无从下手。

## 三、验证

新增 `scripts/regression-customer-issues-round2.js`，覆盖上述全部修复，并已用变异测试逐条验证（把修复改回原状后测试确实报红）：

```bash
node scripts/regression-customer-issues-round2.js
```

已挂入 `scripts/verify-release-readiness.js`。全量结果：

- 24 个回归脚本全部通过
- 15 个单元测试全部通过
- 全项目 JS 语法检查通过

`verify-release-readiness.js` 在干净检出上仍会失败，原因是环境而非代码：它要求每个云函数的 `node_modules` 已安装，且存在 `tmp/upload-<版本>.json` 打包体积报告，这两者都在 `.gitignore` 中。需要先安装云函数依赖并在开发者工具里出一次上传包。

## 五、09-10 复查：问题 #1 的最终根因与二次修复

### 审计日志给出的证据

`admin_audit_logs` 显示 09-10 07:00–07:24 管理员「微信用户」共触发 38 次 `toggle_content`，其中 34 次 `enabled=false`、4 次 `enabled=true`。关键片段：

```text
07:00:34  subjects:93544355  enabled=false
07:00:58  subjects:93544355  enabled=false
07:01:11  subjects:93544355  enabled=false
07:01:51  subjects:93544355  enabled=true
07:01:05  question_banks:148caf50  enabled=false
07:01:25  question_banks:148caf50  enabled=false
```

同一条内容被连续多次发出"下线"——这是**按钮显示"上线"、实际发出"下线"**的典型表现。客户越点越糟，最终 22 个题库 / 11 个模块被点成下线，用户端只剩「常识判断」。这与客户最初反馈的"点上线但是没反应"完全吻合。

根因：旧前端 `!e.currentTarget.dataset.enabled` 在 dataset 值为字符串 `"false"` 时得到 `false`。`1.0.34` 已加 `toggledBoolean()` 解析字符串，但 **1.0.34 未发布**，客户手里仍是坏按钮。

### 二次修复（本次）

- `utils/dataset.js` 新增 `nextEnabled(list, id, datasetValue)`：目标状态改为**按 id 从页面数据里取当前项的 `enabled`（云函数 `isEnabled` 算出的真布尔）再取反**，找不到才退回 dataset。彻底不依赖 dataset 类型。9 个后台开关全部改用；成功提示也改用目标状态。
- 单元验证覆盖扁平列表、模块树、dataset 字符串/布尔/错误值 7 种情形。
- 生产数据已恢复到 09-01 状态：9 个有题库的模块 + 23 个题库上线，`getCourses` 返回 23 / 3022 题。4 个空模块（判断推理、常识、时事政治、法律法规）保持下线。

### 长答案出界的真机兼容性根因

`1.0.33`/`1.0.34` 的换行规则只写了 `word-break: break-word` + `overflow-wrap: anywhere`，全项目**没有一处 `word-wrap` 兜底**：

- `overflow-wrap: anywhere` 在 iOS 15.4 以下 WKWebView 和部分安卓 WebView 不生效；
- `word-break: break-word` 是非标准值，Safari 在 flex 子项里表现不一致。

所以开发者工具里看着正常，客户真机上长答案照样出界。本次给 6 处规则补上 `word-wrap: break-word` + `word-break: break-all`（全引擎可断，中英混排/URL 都能断），保留 `anywhere` 给新引擎。题目页头部超长题库名补省略号，图标区 `flex-shrink: 0`。回归断言同步收紧为必须带兜底。

### 其他视觉修正

- 壁纸卡片「用于打卡」按钮原为灰绿字配绿底、几乎不可读，补 `color: #fff`。

### 后台"模块与题库"页排版崩坏（真实渲染发现）

用开发者工具自动化在 iPhone 12/13 模拟器真实渲染后台页，发现客户点上下线的那一页整体是坏的：标题、模块名、"0个题库·排序1·已下线"被挤成一列一个字，编辑/上线按钮撑满整行并压在文字上；「题目管理」页每条题目的"上线/下线"按钮被挤出屏幕右侧。

用 `createSelectorQuery` 量到的真实值：`.cu-mini` 声明 `width: 112rpx` 且同批的 flex 规则均已生效，但 `<button>` 宿主用宽仍为 184px（两个按钮正好平分 374px，比容器还宽）。微信 `<button>` 宿主在 flex 行内对作者 `width` 的处理不可依赖。

改动：这些只用 `bindtap` 的小操作按钮（course-upload 7 个、question-manager 2 个）改为 `<view>`，宽度完全受控；文本容器加 `flex:1; min-width:0`，按钮容器 `flex-shrink:0`；三个上传页的 `.manage-actions button` 同步给定宽。

修复后量测（同一模拟器）：

| 元素 | 修复前 | 修复后 |
| --- | ---: | ---: |
| `.cu-mini`（编辑/上线） | 184px | 58px |
| `.cu-action`（新增模块/题库） | 184px | 104px |
| `.cu-inline-actions` | 374px | 122px |
| `.cu-toolbar-text`（页标题） | 0px | 138px |
| `.cu-subject-text`（模块名+元信息） | 0px | 199px |
| `.qm-action`（题目管理 上线/下线） | 溢出屏幕 | 58px |

### 其它真实渲染发现并修正

- 题目页"不会写，查看答案"按钮文字被截成"…查看答"：微信 button 默认左右 padding 约 56rpx，8 个字放不进半宽按钮。收窄 padding 并加省略号兜底。
- 资料卡片类型标签显示英文 `document`：`category` 字段存的是 type 原值，改为先按 type 映射中文。

### 真实渲染验收（开发者工具自动化，iPhone 12/13 模拟器，SDK 3.17.2）

已截图核对：首页（9 模块卡片，含长名称）、题库列表、题目页真实题、题目页最坏情况（超长中文/英文/URL 的填空答案与选择题选项、超长题库名头部）、壁纸页（标题 + 用于打卡按钮）、资料页（0 舟币 → 转发获取）、磨耳朵、打卡海报（单一背景）、VIP、督学开通、我的、消息、复习本、后台工作台、音频/资料/壁纸上传列表、用户与管理员、正式套餐管理（4 个套餐"前台可购买"）、打卡背景管理、站内群发（最多 1000 字）、CSV 导入。

course-upload / question-manager 两页在改为 `<view>` 后以 `createSelectorQuery` 数值量测验证（见上表）；此时 IDE 截图能力在一次编译缓存清理后失效，自动化协议本身正常。

## 六、上线前全系统检查（09-10）

| 层 | 方法 | 结果 |
| --- | --- | --- |
| 云函数 | 32 次真实调用（含需登录/墓碑函数），检查返回码与数据形状 | 全部干净返回，无崩溃；线上代码与仓库一致 |
| 数据库 | totalCount 与实际题数、孤儿题库、模块遮蔽、题干/答案为空、选择题选项、资源缺失、背景唯一、最高管理员唯一 | 0 项异常 |
| 页面 | `e2e-devtools-pages`：44 页真实加载，捕获 console/exception | 43 通过 + 1 预期门禁跳转，0 运行时错误 |
| 页面 | `content-editor`（原 e2e 未覆盖）壁纸/资料/音频三种真实 id | 3/3 |
| 交互 | `e2e-devtools-interactions` 13 项控件操作 | 13/13 |
| 云调用 | `e2e-cloud-readonly` 模拟器内 38 项只读调用 | 38/38 |
| 图片 | `e2e-devtools-images` 8 项素材解码与海报/分享图生成 | 8/8（修复前 7/8） |
| 静态 | 24 回归脚本、15 单测、285 个 JS 语法、JSON、发布检查 | 全部通过 |

### 全系统检查捕获的线上缺陷：云端背景下海报生成必然失败

`wx.downloadFile` 返回的是 `DownloadTask`，不是 Promise。`await wx.downloadFile({ url })` 拿到的是 Task 对象，`res.tempFilePath` 为 `undefined`，随后 `getImageInfo` 报 `parameter.src should be String instead of Undefined`。包内背景（`/assets/...`）不走这条分支，所以历史验收都通过；**客户在后台上传云端打卡背景后，"分享图片（+10 舟币）"每次都失败**——这与反馈 #8 直接相关。

修复：`utils/imageSharing.downloadFile()` 统一封装；打卡、壁纸、资料三处改用；打卡背景下载失败时回退包内默认背景，海报功能不再整体失效。回归断言禁止 `await wx.downloadFile(` 再次出现。

### 已知但未在本轮处理

- 音频 13/94、壁纸 33/60、资料 124/139 在线，其余为管理员手动下线，未动。
- 「常识判断」161 题在 4 个题库中各存一份，疑似重复导入。
- 资料页文档打开路径（`openDocument`）为机械替换为文件内已有的 `wxPromise` 用法，无法在模拟器无头验证。

## 四、发布清单

### 1. 必须重新部署的云函数

本轮改了云端逻辑，**只发小程序版本不够**。需要重新部署这 8 个：

```text
adminOperations  adminConfigCenter  createVipOrder  getMaterials
uploadAudios     uploadWallpapers   createCourse    uploadQuestions
```

| 云函数 | 本轮改了什么 |
| --- | --- |
| `adminOperations` | 上下线写全 `enabled`/`status`；排序值不再钳平；排序模式持久化 |
| `adminConfigCenter` | 打卡背景按归一化日期去重，历史记录一并下线 |
| `createVipOrder` | 新增管理员套餐可见性诊断 `planDiagnostics` |
| `getMaterials` / `uploadAudios` / `uploadWallpapers` | 用户端读取遵循后台排序模式 |
| `createCourse` / `uploadQuestions` | 新建模块/题库写全上线字段 |

**推荐方式：微信开发者工具。** 用你的微信开发者身份，不需要密钥：

1. 导入本仓库目录，确认 AppID 为 `wxca6ebd21699eca53`。
2. 确认云函数根目录的环境是 `cloud-2ge02vrucaf8a6ab`。
3. 对上述 8 个逐个右键 -> **上传并部署：云端安装依赖**。

**备选方式：CloudBase CLI。** 需要腾讯云账号已与该小程序环境关联：

```bash
npx @cloudbase/cli login
for fn in adminOperations adminConfigCenter createVipOrder getMaterials uploadAudios uploadWallpapers createCourse uploadQuestions; do
  npx @cloudbase/cli fn deploy $fn -e cloud-2ge02vrucaf8a6ab --force
done
```

微信云开发环境本身运行在腾讯云 CloudBase 上，`cloud-2ge02vrucaf8a6ab` 就是 CloudBase 环境 ID。两种方式操作的是同一套云函数，区别只在认证身份：开发者工具用微信身份，CLI 用腾讯云账号身份。

`content_orderings` 集合由云函数在首次使用时自动创建，不需要手工建表；建好后请确认它和其他生产集合一样是 `ADMINONLY`。

### 2. 部署顺序

**先部署云函数，再上传小程序版本。** 反过来会有一段窗口期：新页面调用旧云函数拿不到 `ordering` / `total` 字段。页面已做兜底不会报错，但排序模式开关会显示为"手动"。

### 3. 真机验收（建议按客户原话逐条走）

1. 后台"模块与题库"里把常识判断点上线 → 刷新后显示"已上线" → 用户端首页能进去。
2. 后台上传 3 个音频，用上移/下移调顺序 → 用户端"磨耳朵"顺序一致。
3. 后台任选一条资料/音频/壁纸点"编辑"，改名并替换文件 → 用户端立即生效。
4. 点"按名称排序" → 再传一份名字排中间的资料 → 不重新排序，它自动落在正确位置。
5. 找一道答案很长的题，在窄屏真机上看答案不出界。
6. 后台"VIP套餐"页确认四个套餐都显示"前台可购买"；若有"前台不显示"，按提示点"修正并上线"。督学包月在"督学开通"页购买。
7. 用户端壁纸页确认标题显示。
8. 后台换打卡海报背景 → 用户端打卡页立即是新背景；若显示"当前使用的是你自己设置的壁纸"，点"恢复官方海报"。
9. 把测试账号舟币清零 → 领取资料 → 弹出"转发获取舟币"引导。
10. 后台发一条 600 字左右的站内消息，确认能保存并完整显示。
11. 用普通管理员账号进入"用户权限赠送"，确认能搜索用户并赠送。
12. 后台资料列表确认显示真实总条数，搜索能定位到任意一条已传资料。

### 4. 提交审核

前端有改动，需要上传新版本并提交审核。交易类小程序订单中心路径仍为 `pages/order-center/order-center`。

### 待提交审核的版本：`1.0.37`（09-11）

`1.0.36`（09-10 13:33）与 downloadFile 修复提交只相差 3 分钟，无法从记录确认上传时主仓库已合并；09-11 从已验证的主仓库 `f2878ac` 重新上传为 `1.0.37`，包体 777188 字节，与 `1.0.36` 逐字节一致，说明 `1.0.36` 本已包含全部修复。以 `1.0.37` 为准提交审核。

云函数自 09-01 部署后无任何改动，线上即仓库版本，不需要重新部署。
