# Automated Telegram → PasarGuard deployment

Production entrypoint: `api/index.js` (Vercel serverless webhook).

## Flow

1. Customer selects a configured plan.
2. Customer chooses a subscription name or automatic naming.
3. Bot creates a persistent order in Upstash Redis.
4. Bot displays payment instructions.
5. Customer submits a receipt photo/document.
6. Receipt file_id/metadata is persisted and forwarded to the administrator.
7. **No manual approval is required.** Fulfillment starts immediately.
8. PasarGuard creates the user from the configured template.
9. The bot reads the actual PasarGuard user and subscription URL.
10. Order is marked `FULFILLED` and the subscription is delivered to Telegram.

A receipt is audit evidence, not payment verification. Administrators can later invalidate a fraudulent order; the bot then disables the associated PasarGuard user by ID.

## Username rules

- Custom: `TG_<custom>_<random4>`
- Telegram username: `TG_<telegram_username>_<random4>`
- No Telegram username/no custom name: `TG@AtiqVPN_<random4>` (the requested `_@` sequence is intentionally avoided)
- Allowed generated characters: ASCII letters, digits, `_`, `@`.
- Persian/Arabic, spaces, emoji and unsupported punctuation are rejected.
- `TG_` is reserved.
- Username is finalized before creation and is never changed on renewal.
- PasarGuard collisions are retried with a fresh 4-character cryptographic suffix.

## Order states

`AWAITING_PAYMENT` → `RECEIPT_SUBMITTED` → `PROVISIONING` → `FULFILLED`

Recoverable failures use `FAILED_RECOVERABLE`. Fraud discovered later uses `PAYMENT_LATER_REJECTED`.

## PasarGuard API

The client authenticates against the current V5 admin token endpoint:

`POST /api/admin/token`

New users use:

`POST /api/user/from_template`

Existing users are read/modified with the current ID-based APIs where available (`/api/user/by-id/{id}`); template renewal uses the documented `/api/user/{username}/from_template` operation because the current template API exposes that operation and preserves the username. PasarGuard's current documentation states that template application controls groups, data limit, expiry, status and reset strategy, and `reset_usages` defaults to false.

PasarGuard has announced that username-based APIs are being deprecated in favor of ID-based APIs, so the bot stores the numeric PasarGuard user ID immediately after creation and uses it for subsequent reads, modifications, disablement and deletion.

## Plans/templates

Every standard plan requires a PasarGuard template environment variable. Custom plans use `PASARGUARD_TEMPLATE_CUSTOM` for protocol/group defaults, then set the customer's exact traffic limit and expiry with the ID-based user modification endpoint.

Do not put real template IDs or payment information in Git.

## Environment variables

Copy `.env.example` into your deployment settings and configure:

- `BOT_TOKEN`
- `ADMIN_ID`
- `WEBHOOK_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `PASARGUARD_BASE_URL`
- `PASARGUARD_USERNAME`
- `PASARGUARD_PASSWORD` (or `PASARGUARD_ACCESS_TOKEN` if you already manage a valid access token)
- `PASARGUARD_TEMPLATE_TEST`
- all plan template IDs
- `SUPPORT_USERNAME`
- `BANK_DETAILS`

`@AtiqVPN` is intentionally not configurable.

## Vercel

1. Import the GitHub repository into Vercel.
2. Select the Node.js project defaults; no paid runtime is required.
3. Add all variables from `.env.example`.
4. Deploy.
5. Set the Telegram webhook to the deployed function URL and include the same `WEBHOOK_SECRET` as Telegram's secret token.
6. Verify `/status` from the admin account.

PasarGuard must be publicly reachable from Vercel over valid HTTPS. Do not disable TLS verification. If PasarGuard is private behind a firewall, it needs a secure public HTTPS/API exposure or another network path reachable from Vercel; this repository does not add a paid proxy/VPS.

## PasarGuard setup

Create templates/groups in PasarGuard first. Each template must have the intended group access, data limit, expiry duration and reset strategy. Keep PasarGuard template username prefix/suffix empty because the bot generates the complete username itself.

Use a dedicated PasarGuard admin account with only the permissions required for user/template operations. The bot must never use a node API key as a substitute for panel authentication.

## Testing

Run:

```bash
npm ci
npm test
npm run check
```

The included username tests cover Telegram usernames, custom names, missing usernames, Persian input, invalid punctuation, reserved `TG_`, and the `TG@AtiqVPN` fallback.

For live testing, configure a test template and run the exact flow:

`/start` → `🛒 خرید اشتراک` → plan → name → payment → receipt → automatic PasarGuard creation → subscription delivery.

Do not use a real payment during initial testing. A receipt submission is intentionally sufficient to trigger provisioning in this business workflow.
