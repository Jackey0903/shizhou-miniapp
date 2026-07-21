# Virtual Payment Deployment Checklist

This project uses WeChat Mini Program Virtual Payment for VIP and supervision services.

## Backend Products

Before submitting review, open WeChat Public Platform -> Virtual Payment -> Basic Configuration and confirm:

1. Mini Program Virtual Payment is enabled.
2. The Mini Program short name is configured. This is required for iOS Apple Pay display name.
3. Production virtual payment configuration is active.

Create and publish these virtual products in the Mini Program virtual payment console. The product IDs and prices must match both `PUBLISHED_PLAN_CONFIG` in `cloudfunctions/createVipOrder/index.js` and the corresponding `vip_plans` records. Do not replace a WeChat product ID with an internal business plan code.

| Business Plan Code | Published Product ID | Name | Price |
| --- | --- | --- | ---: |
| `basic_vip_year` | `sz_basic_vip_year` | 基础VIP包年 | 198 CNY |
| `supervision_trial_day` | `sz_supervision_1d` | 督学试用1日 | 8 CNY |
| `supervision_month` | `sz_supervision_mon` | 督学包月 | 198 CNY |
| `premium_vip_year` | `sz_premium_vip_year` | 高级VIP/督学包年 | 988 CNY |

## Cloud Function Environment Variables

Set these variables on `createVipOrder`.

```text
WECHAT_APP_SECRET=<Mini Program AppSecret>
VIRTUAL_PAY_OFFER_ID=<Virtual payment offerId>
VIRTUAL_PAY_PROD_APP_KEY=<Production AppKey>
VIRTUAL_PAY_ENV=0
```

For sandbox testing only:

```text
VIRTUAL_PAY_SANDBOX_APP_KEY=<Sandbox AppKey>
VIRTUAL_PAY_ENV=1
```

Do not submit review or publish production with `VIRTUAL_PAY_ENV=1`.

iOS Apple Pay only supports production virtual payment. Sandbox configuration will fail review and real-device payment on iOS.

## Cloud Functions To Deploy

Deploy these functions after every virtual payment code change.

```text
createVipOrder
vipPayCallback
adminConfigCenter
```

`createVipOrder` creates signed virtual payment parameters, lists and syncs the current user's orders, grants benefits, handles refunds, and calls `notify_provide_goods`.

`vipPayCallback` handles `xpay_goods_deliver_notify` callbacks if an HTTP trigger is configured for virtual payment delivery notification.

## Mini Program Pages

Order center path for WeChat review:

```text
pages/order-center/order-center
```

Purchase entry paths:

```text
pages/vip/vip
pages/supervision-pay/supervision-pay
```

## Review Description

Use this review description:

```text
接入官方小程序虚拟支付，会员/督学购买改用 wx.requestVirtualPayment；新增虚拟支付订单中心、查单发货和权益自动发放。
```

Use this review note:

```text
审核路径：进入小程序-我的-加入VIP/督学服务，选择套餐后调起官方小程序虚拟支付；我的订单页面可查看会员与督学虚拟支付订单。购买成功后自动发放免广告、资料领取和督学权益。
```

## Release Checks

Before uploading a new development version:

1. `VIRTUAL_PAY_ENV` is `0`.
2. Mini Program short name is configured in Virtual Payment -> Basic Configuration.
3. All products are published in the virtual payment console.
4. Product IDs match `PUBLISHED_PLAN_CONFIG` and `vip_plans.virtualProductId`.
5. `createVipOrder` has all production environment variables.
6. `createVipOrder`, `vipPayCallback`, and `adminConfigCenter` are deployed.
7. Test purchase can create an order and call `wx.requestVirtualPayment`.
8. Order center opens at `pages/order-center/order-center`.
