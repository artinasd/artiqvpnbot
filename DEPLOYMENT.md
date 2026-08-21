# AtiqVPN Telegram bot — PasarGuard automation

## What changed

The production entrypoint is `api/index.js` for Vercel. `bot.local.js` remains only as a local polling runner. The old manual fulfillment flow has been replaced by persistent orders, receipt-audit records, automatic PasarGuard provisioning, subscription delivery, idempotency locks, and admin invalidation.

The business rule is deliberate: submitting a receipt does **not** mark payment as verified. It changes the order to `RECEIPT_SUBMITTED` and starts provisioning immediately. The administrator receives the receipt and can later invalidate the payment and disable the PasarGuard user.

## Repository audit

The original repository contains only three application files: `api/index.js`, `bot.local.js`, and `package.json`. Both bot implementations used transient JavaScript state. The Vercel implementation also had a hard-coded bank card and manual `approve_buy_*` / `approve_test_*` callbacks. The local runner had no persistence and duplicated the manual workflow. The new `lib/app.js` is the shared implementation; the local runner and Vercel function are thin wrappers.

## PasarGuard API verified against current source/docs

The current PasarGuard API exposes:

- `POST /api/admin/token` for username/password authentication.
- `POST /api/user/from_template` for creating a user from a user template.
- `GET /api/user/by-id/{user_id}` for authoritative user retrieval.
- `PUT /api/user/by-id/{user_id}` for modification/renewal.
- `PUT /api/user/by-id/{user_id}/disabled` for disabling an account.
- `DELETE /api/user/by-id/{user_id}` for deletion.
- User responses contain `subscription_url`.
- User-template application preserves the username and applies template groups, data limits, expiry, reset strategy, and other template settings.

The bot therefore uses templates for standard/custom/test plans and ID-based APIs for later modifications. Username lookup is used only for collision detection because creation must be checked before the authoritative create request.

### Important current PasarGuard compatibility issue

The current PasarGuard username validator in the inspected source accepts `a-z`, `A-Z`, `0-9`, `-`, `_`, `@`, and `.`, but it also rejects consecutive special characters. Therefore the exact requested fallback `TG_@AtiqVPN_X7k2` is rejected because `_@` is a consecutive-special sequence. The bot generator implements the requested business format and tests it, but a live PasarGuard installation using that validator will reject the fallback. Do **not** claim that exact fallback is deployable until the PasarGuard username validation policy is changed or a server version that permits `_@` is confirmed. This is the one genuine incompatibility discovered during API verification.

## Environment

Copy `.env.example` to your deployment settings. Never commit real credentials.

Required values:

- `BOT_TOKEN`
- `ADMIN_ID`
- `WEBHOOK_SECRET`
- `SUPPORT_USERNAME`
- `BANK_DETAILS`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `PASARGUARD_BASE_URL`
- `PASARGUARD_USERNAME`
- `PASARGUARD_PASSWORD`
- `PASARGUARD_TEMPLATE_TEST`
- `PASARGUARD_TEMPLATE_CUSTOM`
- commercial template IDs: `PASARGUARD_TEMPLATE_1MO`, `..._2MO`, `..._10GB`, `..._20GB`, `..._50GB`, `..._200GB`, `..._300GB`, `..._500GB`, `..._1000GB`

`@AtiqVPN` is hard-coded in the generator by design and is not configurable.

## Storage model

Redis keys are:

- `user:{telegram_user_id}` — persisted customer profile and PasarGuard IDs.
- `order:{order_id}` — complete order/provisioning/audit record.
- `orders` — set of order IDs.
- `bot_users` — active Telegram user IDs.
- `order_sequence` — monotonic internal order sequence.
- `lock:fulfill:{order_id}` — short-lived fulfillment lock.

Order fields include order ID, Telegram ID, plan, bytes, duration, price, currency, requested name, generated PasarGuard username, payment/fulfillment state, receipt file ID, PasarGuard user ID, subscription URL, timestamps, and failure reason.

## Username rules

- Every generated name starts with `TG_`.
- Only ASCII letters, digits, `_`, and `@` are accepted by the bot input validator.
- Arabic/Persian letters, spaces, emoji, dots, slashes, colons, and hyphens are rejected.
- A customer-supplied `TG_` prefix is stripped before the bot adds its own prefix.
- The suffix is four cryptographically random alphanumeric characters.
- Username creation is checked for collisions and the create response remains authoritative.

## Automatic fulfillment

`RECEIPT_SUBMITTED` -> `PROVISIONING` -> `PASARGUARD_USER_CREATED` -> `SUBSCRIPTION_RETRIEVED` -> `FULFILLED`.

If a webhook is duplicated, the persisted order and Redis lock prevent a second fulfillment. If PasarGuard creation succeeds but Redis is updated later, retry first checks the stored username/user ID. If Telegram delivery fails, no second PasarGuard account is created.

The Vercel function uses `@vercel/functions` `waitUntil()` so the webhook can acknowledge Telegram while the fulfillment promise remains attached to the function lifecycle. `vercel.json` allows up to 120 seconds; Vercel Hobby currently permits substantially longer Node.js function durations than the old default limits.

## Test accounts

Test accounts are fully automated and persist `test_used`. They use `PASARGUARD_TEMPLATE_TEST`, the same username generator, collision checks, and PasarGuard subscription URL delivery. There is no admin approval step.

## Renewals

The data model and PasarGuard ID-based modification layer are prepared for renewal, but the current lightweight UI intentionally does not expose a renewal checkout button until the exact commercial renewal semantics are confirmed. Do not represent renewal as live automation yet.

## Admin controls

Preserved:

- `/pingdb`
- `/users`
- `/broadcast`

Added:

- `/status`
- `/orders`
- `/failed`
- receipt audit callback to invalidate payment and disable the corresponding PasarGuard user

All admin callbacks verify `ADMIN_ID` before destructive action.

## Vercel deployment

1. Import the GitHub repository into Vercel.
2. Add all variables from `.env.example` in Project Settings → Environment Variables.
3. Deploy.
4. Use the deployed `https://YOUR_PROJECT.vercel.app/api/index` endpoint as the Telegram webhook target.
5. Configure the webhook with the same `WEBHOOK_SECRET` value used by Vercel.
6. Ensure the PasarGuard base URL is public HTTPS from the Vercel runtime. Do not disable TLS verification.
7. Configure the PasarGuard user templates and put their IDs in the environment variables.
8. Send `/start`, buy a plan, submit a test receipt, and verify the order and PasarGuard user.

PasarGuard must be reachable over HTTPS from Vercel. If it is private behind a LAN/VPN, the free Vercel function cannot directly reach it; provide a publicly routable HTTPS endpoint or an appropriate network path. Do not solve this by adding a paid VPS or by disabling TLS verification.

## PasarGuard template setup

Create one user template per commercial plan, plus test and custom. The template should contain the desired group IDs, traffic limit, expiration duration, reset strategy, and protocol settings. The bot supplies only the immutable username and audit note. This keeps VPN configuration in PasarGuard rather than duplicating it in Telegram code.

## Testing

Run:

```bash
npm install
npm test
```

The included tests cover safe username generation, custom-name validation, reserved prefix handling, invalid Unicode/symbol input, and automatic attribution generation.

A real end-to-end test additionally requires live Telegram, Redis, PasarGuard credentials, and template IDs. Those external systems cannot be honestly tested from the repository alone.

## What is intentionally not automated

- Receipt OCR/verification: explicitly not implemented.
- Payment verification: not claimed by the bot; receipt submission is an audit event.
- PasarGuard reachability: infrastructure responsibility.
- Renewal UI: not exposed until renewal pricing/semantics are confirmed.
- The exact `TG_@AtiqVPN_XXXX` fallback on a PasarGuard version that rejects consecutive special characters: blocked by the verified validator and must be resolved at the PasarGuard side before that exact format can be live.
