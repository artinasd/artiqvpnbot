# Dynamic PasarGuard panels

## Current implementation

The CMS panel registry is stored separately from plans under the Redis key `cms:panels`. Each record has a stable generated ID, display name, type, HTTPS base URL, encrypted credentials, connection status, and timestamps. The supported type is currently `pasarguard`.

Plans can be assigned to a panel through the CMS. Their global plan ID remains unique; plan names may repeat across panels. Orders created from these plans persist `panelId`, the dynamic service ID (`panel_<id>`), the display name, and the provider ID (`panel:<id>`). This lets later account operations find the same panel even if its display name changes.

The Telegram purchase/test service menus now expose only active CMS-registered panels, and empty plan storage is no longer populated from hardcoded defaults. Legacy environment-configured provider integrations are removed. Existing orders and subscriptions are not automatically migrated and may no longer be manageable through the CMS panel flow. Verify customer impact and retain a rollback path before production cutover.

## Required environment configuration

Before using panel management, configure `PANEL_CREDENTIALS_ENCRYPTION_KEY` in Vercel for the target environment. Generate a random 32-byte key locally, for example:

```sh
openssl rand -hex 32
```

Store the output as a Vercel environment variable. Do not commit it, send it through Telegram, or paste it into a public issue. Use the same key in every deployment that needs to read the same Redis panel registry. Changing or losing the key makes stored credentials undecryptable; there is no automatic recovery.

The existing `ADMIN_CMS_PASSWORD` protects the panel API using the CMS's current `x-admin-password` header convention.

## Add a panel

1. Open the CMS in the intended environment.
2. Enter a display name, HTTPS base URL, PasarGuard admin username, and password.
3. Save the panel. The credentials are encrypted before the registry is written.
4. Run **Test connection**. The test authenticates and reads the groups endpoint only; it does not create, edit, or delete panel users.
5. After a successful test, the panel becomes available as a Telegram service.
6. Add plans under that panel. Plan IDs must be globally unique, while plan names may repeat across panels.

A panel that has not passed a connection test is not exposed as a purchasable service. Editing connection details returns it to pending until tested again. Renaming a panel preserves its ID. Disabling removes it from new service selection without deleting its panel or plan records.

## Security behavior

- Panel URLs must use HTTPS.
- The connection test resolves the hostname and rejects private/special-use addresses, rejects redirects, uses a timeout, and bounds response-body sizes.
- Only a read-only groups request is used to verify access.
- Credentials and access tokens are not returned to the browser or written to application logs.
- New panel provider requests re-check the URL and use the original panel ID.
- Existing order records and provider references are retained. Disabling a panel does not delete its data.

These checks are defense-in-depth. Before broad production use, review DNS behavior for the chosen hosting/runtime and the actual PasarGuard deployment's URL/authentication behavior.

## Rollout and rollback

1. Review this PR and its CI checks.
2. Set the encryption key in the appropriate Vercel environment before using the CMS panel form.
3. Prefer testing in a preview/staging environment with a separate test panel and non-customer test accounts. If no separate panel is available, treat the first real-panel test as a controlled cutover and schedule a maintenance window.
4. Before cutover, record the current panel URLs, credential ownership, plan names/prices, and required service names outside the repository. Do not copy passwords into issues, commits, or logs.
5. Recreate panels through the CMS one at a time and test each connection before adding plans. Verify plan lists, purchase, test account, renewal targeting, account details/removal, and reseller pricing before opening purchases broadly.
6. Only after the new panels are confirmed should the hardcoded service/provider definitions be removed in a separately reviewed cutover change. No legacy subscription migration is planned; customers may need to buy new subscriptions after the cutover.
7. If a newly added panel misbehaves, disable it in the CMS. This prevents new purchases while preserving records for investigation. Keep a rollback path until the first panel's full workflow succeeds.

This feature does not run a Redis migration at deploy time. Opening the panel registry itself is read-only; creating or editing panels/plans writes only the corresponding CMS records.
