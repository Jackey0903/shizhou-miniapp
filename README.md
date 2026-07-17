# shizhou-miniapp

仕舟公考微信小程序，包含题库学习、复习与打卡、学习资料、督学服务、会员及微信小程序虚拟支付等功能。

## 项目结构

- `pages/`：小程序页面
- `utils/`：前端公共能力
- `cloudfunctions/`：微信云开发云函数
- `scripts/`：发布前回归与核验脚本
- `docs/`：部署及交付文档

## 本地检查

```bash
node scripts/regression-login-payment.js
node scripts/regression-customer-reported-issues.js
node scripts/regression-plan-separation.js
node scripts/verify-release-readiness.js
```

微信开发者工具导入本目录后，使用项目配置中的 AppID 和云环境进行编译。正式支付配置仅保存在云函数环境变量中，不提交到仓库。
