# 1.0.12 Submit And Acceptance Guide

Date: 2026-07-06

## Submit Review

Submit this version only:

```text
1.0.12
```

Do not submit `1.0.11` or older versions.

Version description:

```text
完整修复登录与虚拟支付稳定性；兼容新版手机号授权，购买前强制登录，支付云函数依赖与超时配置已统一加固，补齐全部云函数本地依赖。
```

Order center path:

```text
pages/order-center/order-center
```

Review test note:

```text
测试流程：进入小程序后可使用微信一键登录或手机号登录；登录后进入“加入VIP”或“督学开通”选择套餐，调用官方小程序虚拟支付。订单中心路径 pages/order-center/order-center 可查看订单状态和权益发放状态。
```

Recommended options:

```text
仅在企业微信中运行：否
用户隐私保护指引：采集用户隐私
审核加急：如客户急用可使用免费加急
```

## Release

After review passes:

1. Go to WeChat Public Platform.
2. Open version management.
3. Find approved version `1.0.12`.
4. Click release.
5. Wait a few minutes for WeChat cache propagation.

## Customer Acceptance Checklist

Ask the customer to test the production mini program after `1.0.12` is released.

### Login

- Open the mini program as a new user.
- Tap "我的".
- Tap login.
- Test "微信一键登录".
- Log out and test "手机号登录".
- Confirm the profile page shows a logged-in state.

### VIP Payment

- Open "我的" -> "加入VIP".
- If not logged in, verify the app prompts login before payment.
- Select a package.
- Confirm it opens official mini program virtual payment.
- Cancel once and verify the app shows "已取消支付", not a system error.
- Complete one real low-value purchase only if the customer agrees to spend money.

### Supervision Payment

- Open "督学匹配" -> paid flow.
- Select "督学试用".
- Confirm payment starts through virtual payment.
- After payment success, confirm it enters the study plan/supervision flow.

### Orders

- Open "我的订单".
- Confirm recent orders are listed.
- Confirm paid orders show paid/benefit status.
- Confirm pending/cancelled orders do not block later purchases.

### Regression Checks

- Open "领取资料".
- Open a document material.
- Open an audio material.
- Open wallpaper save/share flow.
- Open check-in share image flow.

## If A Customer Still Reports A Payment Error

Ask for:

1. Phone model and OS version.
2. WeChat version.
3. Screenshot of the exact error.
4. Whether the user was logged in before tapping purchase.
5. Package selected.
6. Approximate time of the failed purchase.

Then inspect:

```sh
node tmp/node-tools/node_modules/@cloudbase/cli/dist/standalone/cli.js fn log createVipOrder -e cloud-2ge02vrucaf8a6ab --limit 50 --order desc
node tmp/node-tools/node_modules/@cloudbase/cli/dist/standalone/cli.js fn log queryVipOrder -e cloud-2ge02vrucaf8a6ab --limit 50 --order desc
node tmp/node-tools/node_modules/@cloudbase/cli/dist/standalone/cli.js fn log vipPayCallback -e cloud-2ge02vrucaf8a6ab --limit 50 --order desc
```
