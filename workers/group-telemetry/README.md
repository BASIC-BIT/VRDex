# Group telemetry collector

This account-scoped worker polls only explicitly assigned VRChat groups and sends aggregate observations to the Convex control plane. It has no person-presence code, strips user IDs embedded in provider instance locators, rejects foreign group markers, and never logs the account secret or provider payloads.

Required environment after the real-provider and explicit provider-approval deployment gates:

- `VRDEX_GROUP_TELEMETRY_CONVEX_SITE_URL`
- `VRDEX_GROUP_TELEMETRY_COLLECTOR_ACCOUNT_ID`
- `VRDEX_GROUP_TELEMETRY_ACCOUNT_SECRET_JSON` injected from one Secrets Manager secret with `workerApiKey`, `authCookie`, and optional `twoFactorAuthCookie`
- `VRDEX_GROUP_TELEMETRY_USER_AGENT`, including application/version/contact
- `VRDEX_GROUP_TELEMETRY_ENABLED=true`, injected from the account stack's SSM deployment gate

Optional `VRDEX_GROUP_TELEMETRY_REQUESTS_PER_MINUTE` defaults to 30. Global, account, and integration kill switches in the control plane stop claims. ECS desired count is the live infrastructure stop; the SSM value prevents a disabled task revision from starting and is re-read when tasks restart.

The worker exits on any authenticated provider 401. The local login bootstrap can refresh the alias-scoped operating-system vault session, but this slice intentionally has no vault-to-AWS transfer command. Keep the hosted service disabled until VRChat explicitly approves durable service-account sessions and that secret-safe transfer path is implemented. Passwords and TOTP seeds are never worker inputs or vault records.
