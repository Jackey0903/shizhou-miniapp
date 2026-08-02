# 仕舟公考微信小程序

仕舟公考是一套基于微信原生小程序和腾讯云开发构建的公考学习应用，覆盖题库学习、错题复习、学习计划、打卡、资料领取、音频、壁纸、督学服务、会员、舟币和官方小程序虚拟支付，并提供管理员内容配置与 CSV 题库批量导入能力。账号登录必须通过微信官方能力授权并绑定手机号，手机号作为唯一业务标识。

## 当前状态

| 项目 | 状态 |
| --- | --- |
| 线上小程序版本 | `1.0.19` |
| 最新开发版本 | `1.0.22`（已上传，待提交审核） |
| 默认分支 | `main` |
| 云开发环境 | `cloud-2ge02vrucaf8a6ab` |
| 小程序 AppID | `wxca6ebd21699eca53` |
| 支付方式 | 微信官方小程序虚拟支付 |
| 订单中心路径 | `pages/order-center/order-center` |

`1.0.21` 新增客户可直接使用的零代码管理员工作台，支持批量内容管理、模块与题库管理、运营配置、用户权限赠送和正式小程序码。详细记录见 [1.0.21 发布与验收记录](docs/release-1.0.21-verification.md)。

`1.0.22` 强制所有登录账号绑定唯一手机号，并在本地会话恢复、云端登录和支付下单三层校验；历史账号补绑时保留原有用户 ID、管理员角色和业务记录。

## 主要功能

### 学习与题库

- 科目、题库和课程列表
- 选择题、填空题答题与答案解析
- 学习计划、日历、学习记录和艾宾浩斯复习
- 错题纠正、错题复习和学习统计
- 每日打卡及打卡海报生成

### 内容与服务

- 文档、音频和图片资料领取；每份资料首次领取固定消耗 10 舟币，重复打开不扣费
- 音频学习、后台播放和壁纸管理
- 督学匹配、督学计划和学习提醒
- 消息中心、互助问答、帮助与反馈
- 舟币明细、打卡海报分享奖励（每次 10 舟币、每天最多 20 舟币）和用户自定义壁纸

### 会员与支付

- 基础 VIP 和高级 VIP
- 督学试用、督学包月和督学包年权益
- `wx.requestVirtualPayment` 官方虚拟支付
- 支付查单、自动发放权益、发货确认和退款回收
- 支付结果幂等处理及定时补偿
- 用户订单中心

### 管理员后台

- 统一“管理员工作台”，客户日常运营不需要修改代码或数据库
- 单题录入和 CSV 题库批量导入
- 模块与题库新增、编辑、排序、安全上下线
- 资料、音频和壁纸批量上传及上下线
- 固定正式会员套餐、广告位、站内群发、提醒和帮助内容配置
- 打卡背景和打卡文案配置
- 指定用户检索、一键赠送 VIP/督学权限和审计记录
- 自动生成、预览和保存正式小程序码

客户和运营管理员的完整操作说明见 [仕舟小程序管理员运营操作手册](docs/仕舟小程序管理员运营操作手册.md)。

## 技术架构

- 前端：微信原生小程序 JavaScript、WXML、WXSS
- 后端：腾讯云开发 CloudBase 云函数
- 运行时：Node.js 16.13、`wx-server-sdk`
- 数据：CloudBase 文档数据库和云存储
- 支付：微信小程序虚拟支付短剧道具模式
- 测试：Node.js 回归脚本、页面运行时扫描和真机验收

```mermaid
flowchart LR
    U[小程序用户] --> P[微信小程序页面]
    A[管理员] --> M[管理页面]
    P --> F[CloudBase 云函数]
    M --> F
    F --> D[(云数据库)]
    F --> S[(云存储)]
    P --> W[微信虚拟支付]
    W --> C[支付回调与查单]
    C --> F
    F --> O[订单与权益发放]
```

## 项目结构

```text
.
├── app.js                         小程序启动与云环境初始化
├── app.json                       页面、TabBar 和全局配置
├── pages/                         用户端与管理员页面
├── utils/                         登录、云函数、支付、CSV、分享等公共模块
├── cloudfunctions/                CloudBase 云函数
├── scripts/                       回归测试与发布检查
├── templates/                     客户题库导入模板
├── docs/                          部署、安全、验收和交付文档
├── cloudbaserc.json               云函数部署配置
└── project.config.json            微信开发者工具项目配置
```

## 本地运行

### 环境要求

- 微信开发者工具最新稳定版
- Node.js 16 或更高版本
- 已加入该小程序的开发者或管理员微信账号
- 对目标 CloudBase 环境具有开发权限

### 导入项目

```bash
git clone https://github.com/Jackey0903/shizhou-miniapp.git
cd shizhou-miniapp
```

1. 打开微信开发者工具。
2. 选择“导入项目”，项目目录选择仓库根目录。
3. 确认 AppID 为 `wxca6ebd21699eca53`。
4. 在云开发面板确认环境为 `cloud-2ge02vrucaf8a6ab`。
5. 编译并使用登录后的真实微信账号进行功能验证。

云环境同时配置在 `app.js` 和 `cloudbaserc.json`。如需部署到另一套环境，必须同步修改这两个文件，并重新配置数据库、存储权限、云函数环境变量和虚拟支付商品。

## 云函数部署

推荐在微信开发者工具中右键目标云函数，选择“上传并部署：云端安装依赖”。也可以使用 CloudBase CLI：

```bash
npx @cloudbase/cli login
npx @cloudbase/cli fn deploy createVipOrder -e cloud-2ge02vrucaf8a6ab --force
npx @cloudbase/cli fn deploy vipPayCallback -e cloud-2ge02vrucaf8a6ab --force
npx @cloudbase/cli fn deploy uploadQuestions -e cloud-2ge02vrucaf8a6ab --force
npx @cloudbase/cli fn deploy adminOperations -e cloud-2ge02vrucaf8a6ab --force
```

修改前端代码后需要重新上传小程序版本；只修改云函数时，部署对应云函数即可，不需要重新提交小程序审核。

不要在已经投入使用的正式环境随意运行初始化、种子或迁移函数。相关操作必须先备份数据库，并明确核对脚本用途。

## 数据与权限

主要集合包括：

| 范围 | 集合 |
| --- | --- |
| 用户与身份 | `users`、`phone_identities`、`tokens`、`manual_grants`、`admin_audit_logs` |
| 题库 | `subjects`、`question_banks`、`questions`、`courses` |
| 学习 | `plans`、`study_records`、`checkins`、`study_reminders` |
| 支付与权益 | `vip_plans`、`orders`、`coin_logs` |
| 资料与内容 | `materials`、`audios`、`wallpapers`、`user_wallpapers` |
| 消息与督学 | `messages`、`user_messages`、`supervision_profiles` |
| 运营配置 | `ad_slots`、`punch_backgrounds`、`punch_quotes`、`notification_settings`、`mini_program_codes` |

生产数据库集合使用 `ADMINONLY`。小程序页面不直接读写生产数据库，统一通过云函数校验当前微信 `OPENID`、管理员身份和字段白名单。云存储保持公开读取、创建者写入，不得将生产写权限放宽为所有用户可写。

用户登录必须先勾选用户协议和隐私政策，再通过 `getPhoneNumber` 获取一次性授权码，由 `userLogin` 云函数调用微信官方接口换取手机号。手机号是唯一业务标识，同一手机号只能绑定一个微信账号，已绑定账号不能在客户端自行换号；`phone_identities` 使用手机号哈希建立并发唯一锁，不重复保存明文手机号。`OPENID` 继续作为微信技术关联键，以保持历史答题、订单、学习记录和管理员权限不变。历史无手机号账号会在下次登录时强制补绑，补绑不会更改原用户 ID 或既有业务数据。

权限分为唯一“最高管理员”和普通“管理员”。最高管理员拥有全部后台权限，并可在“管理员工作台 -> 管理员管理”查看全部用户和管理员、按手机号/昵称/用户 ID 搜索用户、新增或取消普通管理员，以及移交最高权限；普通管理员只能维护日常运营内容，不能查看完整用户列表或管理管理员。

“管理员管理”提供“全部用户”和“管理员”两个视图。全部用户按稳定用户 ID 分页加载，确保没有登录时间字段的历史账号也不会遗漏；页面同时显示每个账号现有的最近登录时间，并且只返回授权所需的公开账号字段。用户列表、管理员列表、用户搜索和角色变更均由 `adminOperations` 云函数再次校验最高管理员身份，不能依赖隐藏页面入口作为权限边界。

首个最高管理员由软件服务商在交付时通过受保护的 `bootstrapSuperAdmin` 云端操作初始化。完成初始化后的用户字段为：

```json
{
  "isAdmin": true,
  "isSuperAdmin": true,
  "role": "super_admin"
}
```

普通管理员由最高管理员在小程序内设置，对应字段为：

```json
{
  "isAdmin": true,
  "isSuperAdmin": false,
  "role": "admin"
}
```

微信不会向小程序提供用户的私人微信号，因此不能按微信号直接授权。目标用户必须先登录小程序，最高管理员再用已绑定手机号、昵称或用户 ID 查找；涉及同名用户时必须通过手机号或用户 ID 核对。

## 虚拟支付

### 正式商品

| 业务套餐 | 微信道具 ID | 价格 |
| --- | --- | ---: |
| 基础 VIP 包年 | `sz_basic_vip_year` | ¥198 |
| 督学试用 1 日 | `sz_supervision_1d` | ¥8 |
| 督学包月 | `sz_supervision_mon` | ¥198 |
| 高级 VIP / 督学包年 | `sz_premium_vip_year` | ¥988 |

正式环境必须在微信公众平台“虚拟支付”中发布上述道具，并确保 ID 和价格与 `cloudfunctions/createVipOrder/index.js` 一致。

### 云函数环境变量

以下变量只配置在正式环境的 `createVipOrder` 云函数中：

```text
WECHAT_APP_SECRET
VIRTUAL_PAY_OFFER_ID
VIRTUAL_PAY_PROD_APP_KEY
VIRTUAL_PAY_ENV=0
```

禁止将 AppSecret、AppKey 或访问令牌写入页面代码、Git 仓库、截图、日志和问题单。正式环境不得使用 `VIRTUAL_PAY_ENV=1`。

支付流程为：创建本地订单、生成官方支付签名、调用收银台、查询微信订单、事务发放权益、通知微信发货。`vipPayCallback` 每 5 分钟补偿近 3 天待处理订单，失败订单采用指数退避和候选轮转，避免漏单、重复发放和无效重复查询。

完整配置见 [虚拟支付部署检查](docs/virtual-payment-deploy.md) 和 [虚拟支付现网配置](docs/虚拟支付现网配置.md)。

## 客户题库导入

### 规定文件格式

客户只提交一个 `.csv` 文件，不直接接收 `.xlsx`、`.xls`、Word 或 PDF。必须使用 [仕舟题库导入模板](templates/仕舟题库导入模板.csv)，编码为 UTF-8，分隔符为英文逗号。

固定表头不得删除、改名或换序：

```text
科目名称,题库名称,序号,题型,题目,选项A,选项B,选项C,选项D,答案,解析,图片URL
```

- 每题一行，科目名称、题库名称、题型、题目和答案必填。
- 题型填写“选择题”或“填空题”。
- 选择题至少填写 A、B 两个连续选项，答案只写 `A`、`B`、`C` 或 `D`。
- 填空题不填写选项，答案填写完整参考答案。
- 图片 URL 可留空；填写时只支持 `https://` 或 `cloud://`。
- 单个文件最大 5 MB、最多 5000 题；前端自动按每批 50 题上传。
- 重复题自动跳过，不会重复创建。

### 管理员导入流程

1. 进入“小程序 -> 我的 -> 题目录入”。
2. 点击“发送 CSV 模板”把固定模板发给客户。
3. 收到文件后点击“选择 CSV 文件”。
4. 检查整批校验结果、错误行号和前 5 题预览。
5. 校验通过后点击“确认导入”。系统自动创建缺少的科目和题库，并跳过重复题。
6. 导入完成后分别抽查一题选择题和一题填空题。

详细交付标准见 [客户题库交付与导入](docs/客户题库交付与导入.md) 和 [题库 CSV 导入说明](docs/题库CSV导入说明.md)。

## 测试

提交代码或发布前必须运行完整检查：

```bash
node scripts/verify-release-readiness.js
```

该命令覆盖 JavaScript 语法、手机号强制绑定与唯一性、登录、虚拟支付、支付补偿、VIP/督学套餐隔离、分享权限、打卡舟币、题库 CSV、管理员上传与授权、管理员工作台结构、学习流程、顺选/随机复习、全部页面控件、路由资源和关键安全规则。

需要单独定位问题时，可执行：

```bash
node scripts/regression-login-payment.js
node scripts/regression-vip-reconcile.js
node scripts/regression-question-csv-import.js
node scripts/regression-question-upload-cloud.js
node scripts/regression-admin-uploads.js
node scripts/regression-image-share-permission.js
node scripts/regression-learning-flow.js
node scripts/regression-review-navigation.js
node scripts/regression-control-inventory.js
node scripts/regression-control-handlers.js
node scripts/regression-security-critical.js
```

自动化测试通过后仍需用真机完成登录、答题、打卡分享、资料领取、管理员上传和至少一笔真实支付验收。

## 发布流程

1. 确认工作区干净，代码已提交并推送到 `main`。
2. 运行 `node scripts/verify-release-readiness.js`，结果必须为 `ok: true`。
3. 确认正式支付环境变量、四个微信道具和生产云函数均已配置。
4. 在微信开发者工具真机验证关键流程。
5. 上传新的开发版本，版本号必须递增。
6. 在微信公众平台提交审核，交易类小程序填写订单中心路径 `pages/order-center/order-center`。
7. 审核通过后发布，并在微信中重新进入小程序确认线上版本和支付。

版本说明、审核备注和验收证据参考 [1.0.20 发布与验收记录](docs/release-1.0.20-verification.md)。

## 常见问题

### 当前套餐尚未发布到微信支付

检查微信虚拟支付后台的道具是否已发布，并确认道具 ID、价格和正式 AppKey 与代码及云函数环境一致。

### 缺少 wx.login code

退出当前付款页后重新进入并发起支付。登录 code 只能使用一次，客户端不能缓存后重复使用。

### 已付款但权益暂未显示

先进入“我的 -> 我的订单”触发主动查单。服务端同时通过支付回调和定时任务补偿，禁止手工重复增加权益或重复写入支付流水。

### CSV 文件无法导入

确认文件扩展名为 `.csv`、编码为 UTF-8、表头完全一致，且没有合并单元格、缺失必填列或使用中文逗号。页面会显示具体错误行号。

### 管理页面不可见

确认当前微信对应的 `users` 文档具有 `isAdmin: true` 或 `role: "admin"`，重新登录后再进入“我的”。

## 文档索引

- [1.0.18 发布与验收记录](docs/release-1.0.18-verification.md)
- [1.0.20 发布与验收记录](docs/release-1.0.20-verification.md)
- [1.0.21 发布与验收记录](docs/release-1.0.21-verification.md)
- [虚拟支付部署检查](docs/virtual-payment-deploy.md)
- [虚拟支付现网配置](docs/虚拟支付现网配置.md)
- [客户题库交付与导入](docs/客户题库交付与导入.md)
- [题库 CSV 导入说明](docs/题库CSV导入说明.md)
- [生产云安全策略](docs/cloud-security-policy.md)

## 安全要求

- 不提交 `project.private.config.json`、生产密钥、访问令牌、数据库导出或客户原始资料。
- 不在客户端信任用户提交的管理员、支付状态、手机号或权益字段。
- 登录、恢复本地会话和创建支付订单都必须验证已绑定手机号；手机号冲突或换号只能由服务端拒绝并交由客服核验。
- 支付和权益发放必须以微信服务端订单状态为准，并保持幂等。
- 修改数据库或存储权限前先备份并执行安全回归。
- 正式发布前必须完成自动化检查和真机验收。
