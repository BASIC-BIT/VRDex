# Group telemetry collector

This account-scoped worker polls only explicitly assigned VRChat groups and sends aggregate observations to the Convex control plane. It has no person-presence code, strips user IDs embedded in provider instance locators, rejects foreign group markers, and never logs the account secret or provider payloads.

Required environment after the real-provider and explicit provider-approval deployment gates:

- `VRDEX_GROUP_TELEMETRY_CONVEX_SITE_URL`
- `VRDEX_GROUP_TELEMETRY_COLLECTOR_ACCOUNT_ID`
- `VRDEX_GROUP_TELEMETRY_ACCOUNT_SECRET_JSON` injected from one Secrets Manager secret with `workerApiKey`, `authCookie`, and optional `twoFactorAuthCookie`
- `VRDEX_GROUP_TELEMETRY_USER_AGENT`, including application/version/contact
- `VRDEX_GROUP_TELEMETRY_ENABLED=true`, injected from the account stack's SSM deployment gate
- `VRDEX_GROUP_TELEMETRY_RELEASE_SHA`, the exact Git SHA used to build the image

Optional `VRDEX_GROUP_TELEMETRY_REQUESTS_PER_MINUTE` defaults to 30. Global, account, and integration kill switches in the control plane stop claims. ECS desired count is the live infrastructure stop; the SSM value prevents a disabled task revision from starting and is re-read when tasks restart.

The worker reports `telemetry_v1` and `vrchat_proof_v1` capabilities with its
release SHA on startup and a bounded heartbeat. It separately polls the proof
queue so the control plane can prove that the proof protocol, not merely the
process, is live. Logs are JSON with fixed event names and bounded fields; they
never include proof codes, provider target IDs, provider bodies, exception
messages, session material, or worker credentials.

The worker exits on any authenticated provider 401. The local login bootstrap refreshes the alias-scoped operating-system vault session, and `pnpm ops:vrchat-session:transfer` moves that validated session into the account's AWS Secrets Manager secret without printing it.

Both halves of the deployment gate are now cleared: BASIC accepted durable service-account sessions as an operating pattern on 2026-07-27, and the vault-to-AWS transfer command ships. The fleet is enabled. Passwords and TOTP seeds are never worker inputs or vault records.

Recovery after a 401 is the same path: re-run the login bootstrap with `--fresh-login`, re-run the transfer, then re-register the account so the credential generation increments and the task restarts.
