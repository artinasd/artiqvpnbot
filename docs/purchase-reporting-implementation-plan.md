# Safe purchase reporting implementation plan

## Protected customer purchase path
The existing checkout, wallet, provider provisioning, renewal, refund, and customer Telegram delivery flow is treated as production-critical and must remain unchanged except for a best-effort reporting enqueue after successful delivery.

A report is eligible only when the order is paid from the wallet, is not a test or wallet top-up, has `fulfillmentStatus: FULFILLED`, and has `deliveryStatus: DELIVERED`. Fulfillment alone is not delivery success.

## Outbox architecture
- Persist a stable event keyed by order ID/version in Redis.
- Create the event and add its ID to the pending set atomically using Redis EVAL.
- Snapshot reseller attribution at event creation time.
- Track admin and reseller recipients independently.
- Process reports outside the purchase critical path; only mark a recipient sent after Telegram confirms acceptance.
- Retry transient failures with bounded backoff; never call wallet or provider APIs from reporting.
- A crash after Telegram accepts a message but before Redis records success can cause a duplicate; delivery is at-least-once, not exactly-once.

## Release gates
1. Test eligibility and atomic outbox creation.
2. Implement worker with per-recipient isolation, locking, retry limits, and observability.
3. Integrate only after customer Telegram delivery succeeds, using a non-awaited best-effort enqueue.
4. Run full `npm test` and failure-injection tests.
5. Verify preview/test deployment before enabling any scheduled processing.
6. Do not modify `main` production behavior or trigger deployment without explicit release approval.

## Invariants
- Reporting cannot debit/refund wallets or provision/modify provider accounts.
- Reporting cannot change fulfillment or delivery status.
- Failed customer delivery never creates a success report.
- Admin and reseller notification failures are isolated.
- Do not scan all users or wallet balances in the checkout path.
