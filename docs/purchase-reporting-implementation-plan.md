# Safe purchase reporting implementation plan

## Protected customer purchase path
The existing checkout, wallet, provider provisioning, renewal, refund, and customer Telegram delivery flow is treated as production-critical and must remain unchanged except for a best-effort reporting enqueue after successful delivery.

A report is eligible only when the order is paid from the wallet, is not a test or wallet top-up, has `fulfillmentStatus: FULFILLED`, and has `deliveryStatus: DELIVERED`. Fulfillment alone is not delivery success.

## Outbox architecture
- Persist a stable event keyed by order ID/version in Redis.
- Create the event and add its ID to the pending set atomically using Redis EVAL.
- Snapshot reseller attribution at order creation time.
- Track admin and reseller recipients independently.
- Process reports outside the purchase critical path; only mark a recipient sent after Telegram confirms acceptance.
- Retry transient failures with bounded backoff; never call wallet or provider APIs from reporting.
- A crash after Telegram accepts a message but before Redis acknowledgement can cause a duplicate; delivery is at-least-once, not exactly-once.

## Release gates
1. Test eligibility and atomic outbox creation.
2. Implement worker with per-recipient isolation, locking, retry limits, and observability.
3. Integrate only after successful customer delivery, using a non-awaited best-effort enqueue.
4. Run full `npm test` and failure-injection tests.
5. Verify deployment and controlled test purchases before enabling reporting.
6. Keep production reporting disabled until explicit operational verification.

## Invariants
- Reporting cannot debit/refund wallets or provision/modify provider accounts.
- Reporting cannot change fulfillment or delivery status.
- Failed customer delivery never creates a success report.
- Admin and reseller notification failures are isolated.
- Do not scan all users or wallet balances in the checkout path.

## Current implementation notes

- Reporting is feature-flagged by `PURCHASE_REPORTING_ENABLED=true`; it is off by default.
- After a successful customer Telegram delivery, fulfillment schedules a best-effort enqueue and a bounded initial worker pass. Reporting errors are logged and do not change order, wallet, or provider state.
- The worker runs within the existing bot serverless function; no additional API function or Vercel Cron schedule is added, to stay within the Hobby function-count limit.
- Admin recovery command: `/retryreports`. It also requeues recipients that exhausted their automatic retry attempts.
- Admin reseller assignment commands: `/assignreseller <customer_telegram_id> <reseller_telegram_id>` and `/unassignreseller <customer_telegram_id>`. The reseller must be listed in `resellerTelegramIds` or have a reseller flag. Each new order snapshots its assigned reseller so later reassignment does not change old order attribution.
- Retry queue uses a Redis sorted set keyed by next-attempt time; event payload and queue-index updates use atomic Redis scripts.
- Delivery is at-least-once. If Telegram accepts a report but Redis acknowledgement fails, a retry may send a duplicate.
