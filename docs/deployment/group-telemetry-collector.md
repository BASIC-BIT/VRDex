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
5. Build `workers/group-telemetry/Dockerfile`, push the image, and configure `container_image` with its immutable `@sha256:` digest URI. Terraform rejects service enablement when that digest is absent. Once the reviewed automation bootstrap below is complete, the main-branch release lane performs this step automatically.
6. Apply with `enable_service=false` and `desired_count=0`. Review the task role, execution role, one-secret scope, SSM deployment gate, logs, alarms, budget, and egress-only networking.
7. After a `go` or acceptable `adjust`, set `enable_service=true`, `desired_count=1`, and a budget alert email. Keep the task cap at two.

## Automatic releases and drift detection

`.github/workflows/group-telemetry-release.yml` is the only automatic writer
for routine collector releases. A successful `main` Baseline Checks run builds
the exact main SHA, publishes an immutable SHA tag, plans against checked-in
production enable/count state plus fail-closed repository variables, and
applies the saved plan only after the policy helper proves that it changes the
collector image and release metadata alone. ECS must stabilize on the exact
digest, then `communityTelemetry:collectorDeploymentReadiness` must report a
fresh matching heartbeat from `GROUP_TELEMETRY_COLLECTOR_ACCOUNT_ID` with
`telemetry_v1` and `vrchat_proof_v1`. Because proof capability is required,
the same release must also have reached the proof-claim gate with usable proof
budget and no active account cooldown.

Before enabling the lane, perform one reviewed bootstrap from the trusted state
holder:

1. Migrate any existing local collector state to the declared S3 backend with
   `terraform init -migrate-state`, then inspect the remote state.
2. Plan the current production variables with the reviewed release image and
   source SHA. The first plan includes task metadata plus heartbeat, auth,
   control-plane failure, and restart metric filters and alarms.
3. Apply that infrastructure plan manually. Automatic releases intentionally
   reject it because it contains more than an image-only task revision.
4. Provision the main-only GitHub OIDC release role, following the
   least-privilege requirements in the stack README.
5. Configure every required GitHub variable and secret listed there, then set
   `GROUP_TELEMETRY_RELEASE_ENABLED=true`.
6. Dispatch the workflow manually only from a commit reachable from `main`, or
   let a successful `main` Baseline Checks run trigger it automatically.

The CloudWatch filters consume only redacted JSON event names:
`collector_heartbeat`, `collector_auth_required`,
`collector_control_plane_failure`, and `collector_worker_restart`. The worker
also logs `collector_session_check` with a bounded `outcome`; its
`auth_required` outcome is always paired with `collector_auth_required`, so
the existing alarm covers it. They must
never include a profile slug, proof code, provider target, account identifier,
cookie, key, or raw error payload. Missing successful heartbeats alarm after
two one-minute periods. Every alarm notifies the `${name_prefix}-alerts` SNS
topic, which emails `budget_alert_email`. The address confirms the subscription
once, from the message SNS sends on the first apply; until then the alarms
change state but nobody is told.

The Terraform-managed `${name_prefix}-operations` dashboard combines those
collector signals with ECS task count, CPU, and a bounded recent-log view.

Steps 1-7 are the bring-up sequence for standing a fleet up, not a description of
the current state. Production has been through them: BASIC accepted durable
service-account sessions on 2026-07-27, and the fleet runs enabled.

Apply production with the checked-in run state, not the defaults:

```bash
terraform apply -var-file=environments/production.tfvars
```

`environments/production.tfvars` carries `enable_service`, `desired_count`, and
the production `requests_per_minute` budget. An explicit request-budget change
must update that checked run state before the next automatic image release, so
the release cannot silently restore Terraform's default. The file otherwise
contains no account-specific values. Image digest, secret ARN, subnets, and
security groups stay in the operator's gitignored `terraform.tfvars`. The
variable defaults remain disabled so a new environment is safe by default, but
applying production without that var-file would set `desired_count = 0` and take
the fleet down, which now also disables collector-resolved VRChat claims.

The stop condition in `docs/planning/community-group-telemetry.md` still applies:
if VRChat objects, stop the traffic and clear the saved session.

The execution role reads only the assigned account secret and SSM startup gate. The application task role has no AWS data permissions. The worker receives no customer credential and cannot claim work for a different collector account ID.

## Normal health

- Account state is `ready`; integration state becomes `active` after membership succeeds.
- A `collector_session_check` event with `outcome: ok` appears every 8-12 minutes, including with no groups assigned. `outcome: auth_required` means the stored session is not being accepted; a long gap means the worker is not reaching the provider or the control plane, and the heartbeat and control-plane alarms say which.
- Active groups poll every randomized 60-120 seconds; quiet groups poll every 3-5 minutes.
- Group membership metadata is cached for five minutes while instance state continues on the active/quiet cadence. Join, leave, and membership-transition calls always invalidate or bypass that cache.
- The worker enforces a local process safeguard, then atomically reserves the predicted request cost against control-plane global, account, and integration minute budgets. A denied local budget defers the assignment instead of repeatedly reclaiming it.
- A 429 honors `Retry-After` plus jitter. 5xx, network, and timeout failures back off exponentially. A 404 degrades only the affected integration.
- CloudWatch should have one running task, no sustained CPU alarm, and no raw provider payload or authorization values in logs.
- The private dashboard shows last observation, coverage, account state, and gaps.

## Stops and recovery

Use the Convex global kill switch to stop all new claims without taking the web app down. Use the account kill switch or `quarantined` state for one account, and the integration kill switch/disconnect for one group. Set ECS desired count to zero for the live infrastructure stop. The SSM deployment gate prevents a disabled revision from starting after a task restart; it is not a dynamic stop for an already running process.

Any authenticated provider 401 immediately sets the account and every assigned integration to `auth_required`, releases all leases, and opens degraded coverage. Recover with `pnpm ops:vrchat-session:transfer` (`scripts/transfer-vrchat-session-to-aws.mjs`), which validates the session, replaces only the session fields, and mints a fresh worker key; do not manually extract the local vault record. Re-register the account with the printed `workerKeyHash` to increment credential generation, restart the task, then return the account to `ready`. Password-based unattended reauthentication is intentionally absent. Recovery puts integrations into `connecting`; it does not backfill the outage or turn it into zero attendance.

### Reading production state

Everything here is a read. Production Convex needs `CONVEX_DEPLOYMENT_PROD` and `CONVEX_DEPLOY_KEY_PROD` in the main checkout's ignored `.env.local`; the AWS calls need account credentials for `us-east-1`. Under Git Bash export `MSYS_NO_PATHCONV=1` first, or the `/aws/ecs/...` log group name is rewritten as a Windows path and the call fails validation.

```bash
pnpm cx prod run communityTelemetry:fleetHealth '{}'
pnpm cx prod run communityTelemetry:collectorProofAvailable '{"now": 1788498562000}'
aws ecs describe-services --region us-east-1 --cluster vrdex-group-telemetry --services vrdex-group-telemetry --query 'services[0].{desired:desiredCount,running:runningCount,taskDef:taskDefinition,events:events[:5].message}'
aws ecs describe-tasks --region us-east-1 --cluster vrdex-group-telemetry --tasks $(aws ecs list-tasks --region us-east-1 --cluster vrdex-group-telemetry --desired-status STOPPED --query taskArns --output text) --query 'tasks[].{started:startedAt,stopped:stoppedAt,exit:containers[0].exitCode}'
aws logs filter-log-events --region us-east-1 --log-group-name /aws/ecs/vrdex-group-telemetry --start-time $(( ($(date +%s) - 6*3600) * 1000 )) --filter-pattern '{ $.event != "collector_heartbeat" }' --query 'events[].message' --output text
```

`fleetHealth` strips the secret reference and worker key hash; the rest of the account row is safe to read aloud. `collectorProofAvailable` is the claimant's own gate: `false` means the claim page shows "We could not reach VRChat", and the account row says why:

| Reading | Meaning |
| --- | --- |
| `state: auth_required`, `lastHealthResult: provider_401` | The stored VRChat session is dead. The control plane answers the worker's heartbeat with 423 `collector_disabled`, the worker fails six times and exits 1, and ECS restarts it about every five minutes. Those stopped tasks and `collector_worker_restart` log events are the expected shape of this state, not a second failure. Recover with the 401 path above. |
| `state: ready` but `lastProofPollAt` older than two minutes | The worker is not reaching `proof_claim`. Check `consecutiveControlFailures` and the `collector_control_plane_failure` log events for the phase and failure class. |
| `state: ready`, `cooldownUntil` in the future, or `killSwitchEnabled` on the account or in `settings` | Budget or operator gates. Nothing is broken; wait or clear the switch. |

With no assigned telemetry integrations the session is exercised only by proofs, so a session that dies after the transfer's validation is first noticed by the first real claim. A release readiness check that requires `vrchat_proof_v1` fails while the account is `auth_required`; that failure is correct and clears once the session is replaced and the account is back to `ready`.

For account loss, quarantine the account before assigning groups elsewhere. Capacity allocation chooses only ready, non-cooled-down accounts with reserved headroom. The internal reassignment operation checks target headroom, releases the old lease, and opens an unknown coverage window before the replacement account joins. A quarantined account stays quarantined when credentials rotate; reconcile or remove its old VRChat group memberships before explicitly returning it to `ready`. For rollback, stop ECS, turn on the global kill switch, and leave stored history in place while the previous image/configuration is restored.

## Cost and self-hosting

The default task is 256 CPU/512 MiB, desired count is capped at two, and logs retain 30 days. ECR removes untagged images after seven days, while immutable `git-*` release tags remain available for rollback until an operator deliberately removes old tagged releases. The optional AWS Budget defaults to USD 30/month with 80% forecast and 100% actual alerts after the `Component` cost-allocation tag is activated.

A self-hosted deployment may run the same container outside ECS. It must provide an equivalent per-account external secret, startup gate, HTTPS-only egress, restart policy, logs without payloads, and every required runtime variable documented in `workers/group-telemetry/README.md`, including the exact release SHA and bounded release version. The Convex control plane remains authoritative for assignments, leases, budgets, and public settings.
