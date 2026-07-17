# 1.0.12 Login And Payment Audit

> Historical record only. Do not submit this version. The current release checklist is `release-1.0.14-verification.md`.

Date: 2026-07-06

## Scope

This audit covers the reported production issues:

- Users could not log in reliably.
- VIP/supervision virtual payment produced many errors.
- Cloud functions could fail after redeploy because dependencies were missing locally.

## Fixes

- Replaced deprecated `open-type="getUserInfo"` login flow with openid-based account creation.
- Added support for the modern `getPhoneNumber` `code` flow in `userLogin`.
- Added purchase-time login guard in VIP and supervision payment pages.
- Added defensive user creation in `createVipOrder` when a payment request reaches the backend before a user document exists.
- Increased payment result polling and changed timeout UX from "payment failed" to "order confirming".
- Unified login/payment cloud functions on `wx-server-sdk@4.0.2`.
- Added explicit `ws` dependency for cloud functions using `wx-server-sdk@4.0.2`.
- Increased critical cloud function timeout/memory:
  - `userLogin`: 10s / 256MB
  - `createVipOrder`: 15s / 512MB
  - `queryVipOrder`: 10s / 256MB
  - `vipPayCallback`: 10s / 256MB
  - `wxpayFunctions`: 20s / 512MB
- Added `cloudfunctions` to `project.config.json` upload ignore list so local cloud function dependencies do not inflate the mini program frontend package.

## Local Verification

Commands run successfully:

```sh
node scripts/verify-release-readiness.js
```

```sh
node scripts/regression-login-payment.js
```

```sh
rg --files -g '*.js' -g '!**/node_modules/**' -g '!tmp/node-tools/**' |
while IFS= read -r f; do node --check "$f" || exit 1; done
```

Runtime-code scan found no active old login/payment entrypoints in `pages`, `utils`, `cloudfunctions`, `app.js`, or `app.json`:

- `open-type="getUserInfo"`
- `bindgetuserinfo`
- `wx.getUserProfile`
- `wx.requestPayment`
- `cloudPay`
- `unifiedOrder`
- `prepay_id`

All cloud function package dependencies are installed locally.

Latest readiness verifier output:

```json
{
  "ok": true,
  "checkedJsFiles": 84,
  "uploadVersion": "1.0.12",
  "uploadSize": 864058,
  "checks": [
    "syntax",
    "legacy-login-payment-scan",
    "login-payment-fix-invariants",
    "cloud-function-dependencies",
    "upload-size",
    "login-payment-regression"
  ]
}
```

## Remote Verification

Remote cloud functions were deployed and checked:

```text
userLogin       MODULE_OK  EXPECTED_NO_OPENID
createVipOrder  MODULE_OK  EXPECTED_NO_OPENID
queryVipOrder   MODULE_OK  EXPECTED_NO_OPENID
vipPayCallback  MODULE_OK  EXPECTED_MISSING_ORDER
wxpayFunctions  MODULE_OK  EXPECTED_DISABLED
```

`createVipOrder` production environment variables are set:

- `VIRTUAL_PAY_ENV`
- `VIRTUAL_PAY_OFFER_ID`
- `VIRTUAL_PAY_PROD_APP_KEY`
- `WECHAT_APP_SECRET`

## Upload

Latest uploaded development version:

```text
Version: 1.0.12
Package size: 843.8 KB
```

Use version `1.0.12` for review submission and release.
