# Group telemetry collector

This account-scoped worker polls only explicitly assigned VRChat groups and sends aggregate observations to the Convex control plane. With the corresponding club features enabled, it also reads membership audit events and management data, and executes explicitly queued staff actions. It has no instance-attendance tracking code, strips user IDs embedded in aggregate instance locators, rejects foreign group markers, and never logs the account secret or provider payloads.

## Club analytics and management

The club-management implementation in this revision has local test coverage; live provider proof and release approval remain separate. Existing integrations default to analytics only. Membership management, Posts and instance operations require independent feature enablement, current staff authority and the assigned bot's actual permissions. A provider permission catalog is not evidence that the bot holds those grants.

Membership audits retain aggregate movement and permission-controlled identifiable group membership activity, not named instance attendance. Scans resume with provider offsets and fixed time windows. Each window must produce two identical raw audit-ID passes, then finalize staged IDs before coverage is marked complete. Changed or incomplete passes retry without certifying coverage. Statistics are retained permanently; this revision does not add deletion workflows.

Queued provider reads and writes use the existing authenticated control plane, integration leases, credential generation and shared request budgets. Immediately before a write, the worker rechecks current human authorization, feature enablement, provider grants and relevant destination eligibility. Uncertain submitted writes are not automatically retried. Preflight retries are bounded; unsent work more than 15 minutes late becomes missed, including remaining invitation recipients. Event cancellation stops linked unsent work without undoing existing posts or instances.

Fresh management preflight reserves its checks and write together. Ordinary
actions require at least two requests per minute, normal instance closure three,
and instance invitations four, within both account and integration limits.
Lower configured limits reject that action with `operation_budget_too_low`;
the worker never raises the limits itself. A reservation or execution deadline
that expires while authorization is in flight prevents the provider write.
If submission was already authorized, that job retains an indeterminate outcome
rather than becoming eligible for automatic replay.

See [the operation contract](../../docs/planning/group-instance-analytics/operation-backend-contract.md), [membership ingestion](../../docs/planning/group-instance-analytics/membership-ingestion-contract.md), and [notification delivery](../../docs/planning/group-instance-analytics/operation-notifications.md). Actual provider writes require the approved test group and reviewed action targets; passing fake-transport tests is not that proof.

Required environment after the real-provider and explicit provider-approval deployment gates:

- `VRDEX_GROUP_TELEMETRY_CONVEX_SITE_URL`
- `VRDEX_GROUP_TELEMETRY_COLLECTOR_ACCOUNT_ID`
- `VRDEX_GROUP_TELEMETRY_ACCOUNT_SECRET_JSON` injected from one Secrets Manager secret with `workerApiKey`, `authCookie`, and optional `twoFactorAuthCookie`
- `VRDEX_GROUP_TELEMETRY_USER_AGENT`, including application/version/contact
- `VRDEX_GROUP_TELEMETRY_ENABLED=true`, injected from the account stack's SSM deployment gate
- `VRDEX_GROUP_TELEMETRY_RELEASE_SHA`, the exact Git SHA used to build the image
- `VRDEX_GROUP_TELEMETRY_RELEASE_VERSION`, a lowercase release label matching
  `[a-z0-9][a-z0-9._-]{0,63}` (for example, `git-a1b2c3d4e5f6`)

Optional `VRDEX_GROUP_TELEMETRY_REQUESTS_PER_MINUTE` defaults to 30. Global, account, and integration kill switches in the control plane stop claims. ECS desired count is the live infrastructure stop; the SSM value prevents a disabled task revision from starting and is re-read when tasks restart.

The worker reports `telemetry_v1`, `vrchat_proof_v1`, `profile_link_destinations_v1`, `automatic_group_aggregates_v2`, and `explicit_group_statistics_admission_v1` capabilities with its
release SHA on startup and a bounded heartbeat. It separately polls the proof
queue so the control plane can prove that the proof protocol, not merely the
process, is live. Logs are JSON with fixed event names and bounded fields; they
never include proof codes, provider target IDs, provider bodies, exception
messages, session material, or worker credentials.

Automatic assignments require the capability in both the claim request and a
fresh heartbeat from that exact worker/account. They validate public/free-join
policy before admission and collect aggregates only, without authority refresh,
club operations, provider-read jobs, or named membership scans. A restricted
initial target releases its allocation as admission-required. Membership loss
after admission persists a group stop and fences pending polls; cleanup can
leave the group, but cannot rejoin it or switch accounts. Account proof and
destination jobs retain their separate authorization. Automatic enrollment stays
disabled until separately authorized activation.

Automatic metadata, join, confirmation, instance and leave requests each reserve
one request immediately before transport. The join reservation durably records
the account and attempt time. Recovery after a lost response verifies membership
with that same account and stops if absent. It never repeats the uncertain join.
V2 is also required for adopted managed assignments with named history disabled.
The independent `namedMembershipCollectionEnabled` choice guards audit dispatch;
an Analytics or publication change cannot enable it.

The [automatic statistics release runbook](../../docs/deployment/automatic-group-statistics-release.md) records the required exact SHA, `automatic_group_aggregates_v2` capability, disabled admission defaults and rollback gates. A fresh capability-bearing heartbeat and matching claim request are both required for automatic dispatch. The heartbeat logs only a zero/one `automaticEnrollmentBacklog` signal; the sustained alarm uses the existing operator SNS email action. Live alarm delivery and provider acceptance require separate release proof.

After proof checks and assigned telemetry polls, the worker claims at most one
public profile-link destination lookup. It reads exact VRChat user IDs, group
IDs, or group short codes, without joining groups or fetching member lists. The
result contains only a public display name, stable ID, and approved artwork
source URL. Non-public group responses cannot supply display metadata. Artwork
bytes are handled separately by the web application's bounded image boundary.
Current person `iconUrl` values require an additional exact-file lookup to verify
file identity, owner, the `icon` purpose, and the referenced complete version.
An explicit legacy `userIcon` remains eligible without that extra read. Missing or
ambiguous file evidence omits artwork while retaining the resolved name. Temporary
file-read failures preserve cached metadata. No avatar, profile override, or banner
is selected as a substitute. Unknown image URL layouts fail closed.

Each provider request, including short-code resolution and icon-file metadata, reserves the existing
shared proof budget and consumes the local account/proof allowance. Provider
throttles publish the existing account-wide cooldown before a claim is released;
an authenticated 401 stops the account through the existing recovery path.
Cache leases bind the collector, worker ID, and credential generation. Metadata
refresh runs independently of public profile requests and does not imply
ownership or verification of the linked destination.

The worker checks its own session with `GET /auth/user` every 8-12 minutes (jittered, one request reserved from the shared proof budget), logging `collector_session_check` with `outcome` `ok`, `provider_unavailable`, or `auth_required`, so a session that dies while no group is assigned is noticed within minutes instead of by the first real proof claim. A session that answers as a different account than the secret names counts as dead. A cookie the provider rotates on any authenticated response is followed in memory only; a restart reloads the transferred secret.

The worker exits on any authenticated provider 401, from a session check or a real request. The local login bootstrap refreshes the alias-scoped operating-system vault session, and `pnpm ops:vrchat-session:transfer` moves that validated session into the account's AWS Secrets Manager secret without printing it.

Both halves of the deployment gate are now cleared: BASIC accepted durable service-account sessions as an operating pattern on 2026-07-27, and the vault-to-AWS transfer command ships. The fleet is enabled. Passwords and TOTP seeds are never worker inputs or vault records.

Recovery after a 401 is the same path: re-run the login bootstrap with `--fresh-login`, re-run the transfer, then re-register the account so the credential generation increments and the task restarts.

Explicit public request/invite statistics assignments require both aggregate v2 and explicit-admission capabilities in a fresh matching worker heartbeat. They remain automatic, analytics-only assignments. The worker inspects the same account on every pass, reserves each membership write before transport and never retries an uncertain write. Cancellation preserves pre-existing membership and retains uncertain cleanup capacity. See the [cleanup contract and manual recovery limits](../../docs/engineering/group-telemetry-provider-proof.md#explicit-statistics-admission-cleanup-contract-2026-10-27).

## Explicit admission operations

The Operator flow can assign an existing collector to one public request or invite group. The backend must be deployed first. Manual admission requires `automatic_group_aggregates_v2` and `explicit_group_statistics_admission_v1` on the same fresh worker heartbeat and claim. Metadata and membership are inspected before collection or membership writes. An uncertain operation allows inspection only, never another write.

Heartbeat diagnostics report bounded admission phase/count/age data without identity fields. Fresh approval/invitation waits are expected. Never-inspected or overdue work, repeated processing failures and unresolved cleanup feed the existing actionable backlog alarm. See the [collector runbook](../../docs/deployment/group-telemetry-collector.md#explicit-admission-compatibility-and-alarms) for exact-head readiness, email-action proof and rollback.
