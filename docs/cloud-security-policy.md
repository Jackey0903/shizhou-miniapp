# Production Cloud Security Policy

Date: 2026-07-17

## Database

All production collections use `ADMINONLY`. Mini Program pages must not call `wx.cloud.database()` directly. Public data and user-owned data are exposed only through cloud functions that validate the current WeChat `OPENID` and return an explicit allowlist of fields.

This applies to user accounts, tokens, orders, payment plans, questions, study records, check-ins, materials, rewards, supervision, reminders, messages, configuration, and uploaded-content metadata.

## Storage

Production storage is public-read and creator-write:

```json
{
  "read": true,
  "write": "resource.openid == auth.openid || resource.openid == auth.uid"
}
```

Administrative upload pages call `adminConfigCenter` before uploading. Do not relax storage write access to `true`.

## Secrets

The repository must not contain production secret values. The following names are configured only on the deployed `createVipOrder` cloud function:

```text
VIRTUAL_PAY_ENV
VIRTUAL_PAY_OFFER_ID
VIRTUAL_PAY_PROD_APP_KEY
WECHAT_APP_SECRET
```

Production requires `VIRTUAL_PAY_ENV=0`. Never place the AppSecret or AppKey in Mini Program page code, repository documentation, screenshots, or issue descriptions.

## Protected Operations

Legacy reward and legacy payment cloud functions return a disabled response. Database initialization, seed, and migration functions reject calls unless the server-side operations credential is present. They must never be exposed as normal Mini Program page actions.

## Release Gate

Before every release:

1. Run `node scripts/verify-release-readiness.js`.
2. Confirm all production collections remain `ADMINONLY`.
3. Confirm storage write access remains creator-only.
4. Confirm the four payment environment variable names above are configured without printing their values.
5. Confirm the four published product IDs and prices match `vip_plans`.
6. Perform the real-device acceptance checklist in `release-1.0.18-verification.md`.
