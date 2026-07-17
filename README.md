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
node scripts/regression-learning-flow.js
node scripts/regression-release-integrity.js
node scripts/regression-security-critical.js
node scripts/verify-release-readiness.js
```

微信开发者工具导入本目录后，使用项目配置中的 AppID 和云环境进行编译。正式支付配置仅保存在云函数环境变量中，不提交到仓库。

## 交付资料

- `docs/virtual-payment-deploy.md`：官方小程序虚拟支付配置与发布核对
- `docs/cloud-security-policy.md`：云数据库、云存储与高危云函数的生产权限策略
- `docs/release-1.0.14-verification.md`：本次客户问题修复、测试结果与真机验收清单

交易类审核订单中心路径：`pages/order-center/order-center`。
