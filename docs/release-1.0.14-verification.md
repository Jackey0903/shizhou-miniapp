# 1.0.14 Release Verification

Date: 2026-07-17

## Customer Issues Covered

- Restore the customer-service QR image on Share Gift and the supervision guide.
- Replace the failed `wx.login` payment path with retried login-code acquisition.
- Keep VIP and supervision purchase pages separate.
- VIP page contains only Basic VIP and Premium VIP.
- Supervision page contains Trial, Monthly, and Annual supervision. The annual plan shares the published Premium VIP product and price.
- Harden login, answer submission, review records, check-in eligibility, materials, rewards, messages, supervision, reminders, orders, payment delivery, and refund handling.

## Production Product Mapping

| Product ID | Purchase page | Price | VIP days | Supervision days |
| --- | --- | ---: | ---: | ---: |
| `basic_vip_year` | VIP | CNY 198 | 365 | 0 |
| `supervision_trial_day` | Supervision | CNY 8 | 365 | 1 |
| `supervision_month` | Supervision | CNY 198 | 365 | 30 |
| `premium_vip_year` | VIP and Supervision Annual | CNY 988 | 365 | 365 |

The client does not contain a price fallback. Purchasable plans and prices are returned by the production `vip_plans` collection and revalidated by `createVipOrder`.

## Automated Verification

`node scripts/verify-release-readiness.js` covers:

- JavaScript syntax for Mini Program pages, shared utilities, and cloud functions.
- Deprecated login/payment API scan.
- Login and official virtual-payment regression tests.
- Customer-reported QR and payment regression tests.
- VIP/supervision plan separation.
- Answer, review, plan, and check-in regression tests.
- Page route, WXML handler, asset, cloud-function, and package-integrity checks.
- Critical authorization and business-rule invariants.

## Production Smoke Verification

- The four server plans are enabled and return the expected prices and benefits.
- Question banks, materials, audios, wallpapers, and public configuration return successfully.
- Unowned material resources are hidden from anonymous responses.
- Anonymous user, order, message, study-plan, and check-in requests are rejected.
- Legacy reward/payment functions are disabled.
- Initialization, seed, and migration functions are protected.
- Payment production mode and required secret names are configured.
- All production collections are admin-only and storage writes are creator-only.

## Manual Real-Device Acceptance

Automated tests cannot consent to phone-number authorization or charge a real WeChat account. Before final customer sign-off, perform these checks on the released build:

1. New-user WeChat login, logout, and phone-number login.
2. Open a free question bank, answer correct and incorrect choices, complete a fill question, leave and reopen the review book, and verify progress remains.
3. Open a VIP bank as a non-VIP user and confirm purchase guidance appears.
4. Open Share Gift and supervision guide; confirm the QR is visible, can be enlarged, and can be recognized by long press.
5. Start the CNY 8 supervision trial, cancel once, and confirm the page says payment was cancelled without granting rights.
6. With customer approval, complete one CNY 8 payment. Confirm the order is paid, rights are granted once, the supervision page opens, and the order center shows delivery complete.
7. Confirm pull-to-refresh and reopening the Mini Program do not duplicate rights.

Order center path for review:

```text
pages/order-center/order-center
```

Submit only development version `1.0.14` for review.
