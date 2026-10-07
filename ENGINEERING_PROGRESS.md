# Engineering Progress

## Completed Milestones
- **P0**: Wallet state separation, atomic RMW protection, financial mutations migrated.
- **P1**: Reseller debt repayment, `FAILED_RETRYABLE` recovery, durable broadcasts.
- **P2.1**: Unlimited renewal downgrade bug fixed.
- **P2.2**: Account-list pagination implemented.
- **P2.3**: Reseller CMS pagination implemented.
- **P2.4**: Subscription upgrades (additive traffic/duration, ownership checks, full fulfillment).
- **P2.5**: Expiration reminders (3-day, 1-day, 0-day intervals, duplicate prevention, verification with provider).
- **P2.6**: Customer dashboard UX improvements (live traffic/expiration from provider, deduplication, QR code generation).
- **P2.7**: Provider/device/HWID management (reset HWID/revoke_sub via dashboard safely).
- **P2.8**: Provider health / reconciliation (cron health checks, auto-disable checkout if provider is down).
- **P3.2 / P3.3**: Order state machine & Subscription lifecycle audit completed. State machine properly handles failures asynchronously, does not duplicate provider profiles, and securely locks fulfillment against race conditions.
- **P3.4**: Reporting/Analytics (implemented /stats command).

## Current Test Suite Status
- **111/111 passing.**

## Next Priorities / Blockers
- **P3.1**: Payment system audit / additional gateways if needed. (BLOCKED: Requires explicit specification, credentials, or API semantics for a target gateway such as Zarinpal or NowPayments).

## Known Limitations / Decisions
- The `bot_users` or `orders:ids` scans could become expensive long-term, but they are bounded by Redis performance and are not presently material issues.
- Reminders update local cache with the latest provider expiration date to skip redundant queries.
