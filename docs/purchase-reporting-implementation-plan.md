# Safe purchase reporting implementation plan

## Baseline and scope

- Production checkout and fulfillment code is the protected baseline.
- This feature branch starts from the currently deployed rollback version.
- No wallet, checkout, provider, renewal, refund, or customer-delivery code is changed in the first phase.
- Reporting is eligible only for a paid, non-test order after Telegram delivery has succeeded.

## Observed fulfillment contract

`lib/fulfillment.js` currently:
1. Loads and locks an eligible order.
2. Provisions or renews the provider account.
3. Persists `fulfillmentStatus: FULFILLED` and `deliveryStatus: PENDING`.
4. Attempts Telegram delivery (QR photo, then text fallback).
5. Persists `deliveryStatus: DELIVERED` or `FAILED`.

Therefore `FULFILLED` alone is not a successful customer purchase. A Telegram delivery failure must not generate a success report.

## Target architecture

### Customer path (unchanged)

Wallet debit -> provider provisioning/renewal -> customer Telegram delivery -> persist delivery result.

Reporting must never be awaited in this path and must never call wallet or provider APIs.

### Reporting outbox

After a paid order reaches `FULFILLED` and `deliveryStatus: DELIVERED`, create an idempotent reporting event in Redis. The event should snapshot the minimal order and attribution fields needed for the report, so later user reassignment does not rewrite historical attribution.

Suggested event shape:
- event ID: stable order ID + report version
- order ID, created/fulfilled/delivered timestamps
- customer Telegram ID and display name
- plan, service/panel, amount, currency
- purchase vs renewal
- reseller Telegram ID captured from the customer at the time the order is completed
- per-recipient state for admin and reseller: pending/sent, attempts, last error, sent timestamp

Create the event using an atomic Redis operation (SET NX or equivalent) so repeated fulfillment callbacks cannot create duplicate events. The reporting event must be independent of order state and must not mutate it.

### Delivery and retries

- Process admin and reseller messages independently.
- Persist a recipient as sent only after Telegram confirms success.
- Use bounded exponential backoff and a maximum retry policy, with failed events visible to an admin.
- A scheduled Vercel Cron endpoint or another durable worker should process pending events in bounded batches; confirm deployment/runtime configuration before choosing the scheduler.
- Protect the endpoint with a dedicated secret and constant-time secret comparison.
- Keep each batch within Vercel's execution budget. No full-table wallet balance scans in a notification request.
- A crash between Telegram acceptance and Redis acknowledgement can produce a duplicate; document this at-least-once delivery edge. Use stable report references and minimize duplicate impact.

## Statistics

Do not calculate global totals by loading all orders, users, and each user's wallet balance in the customer fulfillment request. Start with transaction-level reports. If aggregate daily/monthly statistics are required, maintain separate atomic counters/ledgers updated by the outbox worker and reconcile them periodically.

## Tests required before integration

1. Eligibility: paid delivered purchase and renewal qualify; pending/failed delivery, test, wallet top-up, unpaid, refunded, or uncharged orders do not.
2. Idempotency: duplicate event creation produces one event.
3. Recipient isolation: admin failure does not block reseller; reseller failure does not block admin.
4. Retry: failed recipients remain pending and are retried without modifying orders or wallets.
5. Historical attribution: reseller ID is snapshotted at event creation.
6. Failure injection: Redis unavailable, Telegram timeout, worker interruption, lock contention, malformed event.
7. Existing checkout/fulfillment regression suite passes unchanged.

## Release sequence

1. Characterize current purchase behavior with tests; no production-path edits.
2. Implement and test eligibility and event creation primitives.
3. Implement worker, per-recipient delivery, retry and observability.
4. Integrate only after successful customer delivery; do not await reporting.
5. Validate with mocked dependencies and a Preview deployment/test accounts.
6. Review diff, merge only after all gates pass; monitor fulfillment and reporting independently.
7. Keep an immediate revert path. Never re-run a customer's paid checkout to test reporting.

## Non-negotiable invariants

- Reporting code cannot debit/refund wallets or provision/modify provider accounts.
- A report cannot mark an order fulfilled or delivered.
- Customer delivery success is determined by the existing delivery result.
- A reporting exception cannot change purchase success/failure.
- No changes to `main` or production deployment until explicit release approval.
