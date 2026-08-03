# Group telemetry collector operations

## Deployment gate

Do not enable fleet infrastructure until a VRDex-owned account and consenting test group complete the bounded provider proof in `scripts/prove-vrchat-group-telemetry.mjs`. Hosted provider-session storage is cleared by BASIC's 2026-07-27 risk decision, recorded in the bootstrap steps below — a product-owner acceptance of a known operating pattern, not a VRChat grant. The proof writes sanitized local evidence under ignored `artifacts/group-telemetry-proof/`; evidence and logs must never contain credentials or cookies. Local proof sessions are confined to the operator's operating-system credential vault. That cache is a deliberate bounded risk for VRDex-owned proof accounts, not a provider-approved exemption; stop proof traffic and clear it if VRChat objects.

Record a `go`, `adjust`, or `stop` disposition in `docs/engineering/group-telemetry-provider-proof.md`. For Free Join, Request-to-Join, and Invite-Only, record the observed membership transition. If a path cannot be exercised, record it as unverified with the exact next test; do not treat a mock as provider evidence. A collection proof should run for multiple hours across active and quiet cadence, retaining only counts, state names, request classes, timing, and hashed target identity.

Required proof environment:

| Name | Storage | Purpose |
| --- | --- | --- |
| `VRDEX_VRCHAT_PROOF_ACCOUNT_ALIAS` | non-secret local config | Stable vault key for the VRDex-owned account, such as `VRDex_Oak`. |
| `VRDEX_VRCHAT_PROOF_GROUP_ID` | ephemeral operator environment | Consenting group ID. |
| `VRDEX_GROUP_TELEMETRY_USER_AGENT` | non-secret config | Identifying app/version/contact User-Agent. |
| `VRDEX_GROUP_TELEMETRY_PROOF_ENABLED` | ephemeral operator gate | Must be exactly `true` before the proof can make provider requests. |
| `VRDEX_VRCHAT_PROOF_USER_ID` | optional non-secret guard | Expected `usr_...` ID; aborts local login if another account authenticates. |

Run read-only membership inspection first with `pnpm proof:group-telemetry`. On the first run, it starts a tokenized browser form on `127.0.0.1`; the operator enters the VRDex-owned account credentials and TOTP or email code there. Credentials and codes remain in the form process. The resulting session is stored under `VRDEX_VRCHAT_PROOF_ACCOUNT_ALIAS` in the operating-system credential vault and validated against the stored and optionally configured immutable account ID before reuse. Invalid or expired sessions are removed automatically; transient validation failures stop without deleting a potentially valid session or asking for credentials. Use `--fresh-login` to replace a session and `--clear-session` to delete it. The command reads non-secret values from the process environment or ignored repository `.env.local`. Add `--allow-join` only after the group owner approves the membership transition. Use `--duration-minutes=240` or up to `1440` for the collection run. Send `Ctrl+C`, stop the process, or create `artifacts/group-telemetry-proof/STOP` to interrupt the run; the harness checks the stop file at least every five seconds and still writes sanitized evidence. Transient errors remain inside the bounded run with jittered backoff, while authentication or moderation-class failures stop it. Every artifact also includes an explicitly labeled, deterministic `synthetic_no_provider_request` check showing that the production failure policy honors a 429 `Retry-After` value; do not intentionally hammer VRChat to manufacture a live rate limit. Naturally observed provider failures remain separate in `statusClasses`, `retries`, and `backoffMs`.

`--auth-from-env` is an explicit trusted-development fallback. It requires `VRDEX_VRCHAT_PROOF_AUTH_COOKIE` and accepts optional `VRDEX_VRCHAT_PROOF_2FA_COOKIE`; never commit, print, or paste either value. It bypasses the vault, cannot be combined with `--fresh-login` or `--clear-session`, and is not the normal operator path. The local vault cache is an operator convenience only; hosted sessions are governed by the recorded risk decision below and by the stop condition, not by the presence of a local cache.

## Account bootstrap

1. Create a dedicated VRDex-owned VRChat account and enable the provider-required account protections.
2. The provider-approval half of this gate was cleared by BASIC on 2026-07-27:
   durable VRChat service-account sessions are accepted as a known, acceptable
   operating pattern for VRDex-owned proof accounts. This is a product-owner
   risk decision, not a statement that VRChat has granted VRDex anything, so the
   stop condition in `docs/planning/community-group-telemetry.md` still stands —
   if VRChat objects, stop proof traffic and clear the saved session.
3. Transfer the session with `pnpm ops:vrchat-session:transfer -- --secret-id
   <arn>`. It re-validates the saved alias-scoped session against VRChat,
   generates a 48-byte `workerApiKey`, writes only `workerApiKey`, `authCookie`,
   `twoFactorAuthCookie`, and `vrchatUserId` into the named secret, and prints
   just the lowercase SHA-256 digest for registration. No secret value is
   printed, passed as a process argument, or written to disk. The worker
   refuses to start without `vrchatUserId` and sends it with every
   control-plane call, which rejects the request when it does not match the
   collector the account id names — so pairing one collector with another
   account's secret cannot run. `vrchatUserId` is
   not a secret: it records which collector account the secret belongs to, so a
   later transfer refuses an alias paired with another account's secret id
   rather than deploying the wrong session under it. Add `--dry-run` to
   rehearse; a dry run writes nothing, and so also skips the validation that
   would rotate the live session.
   Do not hand-extract cookies or store the password or TOTP seed.
4. Register the account with the digest printed by step 3 — never the key itself:

   ```bash
   pnpm cx -- prod run communityTelemetry:registerCollectorAccount '{"vrchatUserId":"usr_...","accountAlias":"VRDex_Oak","secretRef":"arn:aws:secretsmanager:...","workerKeyHash":"<digest from step 3>","capacity":100,"reservedHeadroom":15,"requestsPerMinute":30}'
   ```

   The mutation rejects a `secretRef` that is not an ARN or `secret://` reference
   and a `workerKeyHash` that is not a 64-character hex digest, so a pasted key
   fails rather than being stored.
5. Build `workers/group-telemetry/Dockerfile`, push the image, and configure `container_image` with its immutable `@sha256:` digest URI. Terraform rejects service enablement when that digest is absent.
6. Apply with `enable_service=false` and `desired_count=0`. Review the task role, execution role, one-secret scope, SSM deployment gate, logs, alarms, budget, and egress-only networking.
7. After a `go` or acceptable `adjust`, set `enable_service=true`, `desired_count=1`, and a budget alert email. Keep the task cap at two.

Steps 1-7 are the bring-up sequence for standing a fleet up, not a description of
the current state. Production has been through them: BASIC accepted durable
service-account sessions on 2026-07-27, and the fleet runs enabled.

Apply production with the checked-in run state, not the defaults:

```bash
terraform apply -var-file=environments/production.tfvars
```

`environments/production.tfvars` carries only `enable_service` and
`desired_count`. Account-specific values — image digest, secret ARN, subnets,
security groups — stay in the operator's gitignored `terraform.tfvars`. The
variable defaults remain disabled so a new environment is safe by default, but
applying production without that var-file would set `desired_count = 0` and take
the fleet down, which now also disables collector-resolved VRChat claims.

The stop condition in `docs/planning/community-group-telemetry.md` still applies:
if VRChat objects, stop the traffic and clear the saved session.

The execution role reads only the assigned account secret and SSM startup gate. The application task role has no AWS data permissions. The worker receives no customer credential and cannot claim work for a different collector account ID.

## Normal health

- Account state is `ready`; integration state becomes `active` after membership succeeds.
- Active groups poll every randomized 60-120 seconds; quiet groups poll every 3-5 minutes.
- Group membership metadata is cached for five minutes while instance state continues on the active/quiet cadence. Join, leave, and membership-transition calls always invalidate or bypass that cache.
- The worker enforces a local process safeguard, then atomically reserves the predicted request cost against control-plane global, account, and integration minute budgets. A denied local budget defers the assignment instead of repeatedly reclaiming it.
- A 429 honors `Retry-After` plus jitter. 5xx, network, and timeout failures back off exponentially. A 404 degrades only the affected integration.
- CloudWatch should have one running task, no sustained CPU alarm, and no raw provider payload or authorization values in logs.
- The private dashboard shows last observation, coverage, account state, and gaps.

## Stops and recovery

Use the Convex global kill switch to stop all new claims without taking the web app down. Use the account kill switch or `quarantined` state for one account, and the integration kill switch/disconnect for one group. Set ECS desired count to zero for the live infrastructure stop. The SSM deployment gate prevents a disabled revision from starting after a task restart; it is not a dynamic stop for an already running process.

Any authenticated provider 401 immediately sets the account and every assigned integration to `auth_required`, releases all leases, and opens degraded coverage. Recover with `pnpm ops:vrchat-session:transfer` (`scripts/transfer-vrchat-session-to-aws.mjs`), which validates the session, replaces only the session fields, and mints a fresh worker key; do not manually extract the local vault record. Re-register the account with the printed `workerKeyHash` to increment credential generation, restart the task, then return the account to `ready`. Password-based unattended reauthentication is intentionally absent. Recovery puts integrations into `connecting`; it does not backfill the outage or turn it into zero attendance.

For account loss, quarantine the account before assigning groups elsewhere. Capacity allocation chooses only ready, non-cooled-down accounts with reserved headroom. The internal reassignment operation checks target headroom, releases the old lease, and opens an unknown coverage window before the replacement account joins. A quarantined account stays quarantined when credentials rotate; reconcile or remove its old VRChat group memberships before explicitly returning it to `ready`. For rollback, stop ECS, turn on the global kill switch, and leave stored history in place while the previous image/configuration is restored.

## Cost and self-hosting

The default task is 256 CPU/512 MiB, desired count is capped at two, logs retain 30 days, and ECR retains ten images. The optional AWS Budget defaults to USD 30/month with 80% forecast and 100% actual alerts after the `Component` cost-allocation tag is activated.

A self-hosted deployment may run the same container outside ECS. It must provide an equivalent per-account external secret, startup gate, HTTPS-only egress, restart policy, logs without payloads, and the five required runtime variables documented in `workers/group-telemetry/README.md`. The Convex control plane remains authoritative for assignments, leases, budgets, and public settings.
