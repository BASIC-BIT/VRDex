# Community group telemetry

## Status

Implementation contract for [epic #176](https://github.com/BASIC-BIT/VRDex/issues/176).

## Product contract

### Locked decision

- A community connects an immutable VRChat group ID to a VRDex-owned service account. Customer VRChat credentials are never requested or stored.
- Service-account proof authentication uses a tokenized loopback browser on the operator's workstation. Passwords and verification codes stay in that process. The resulting session cookies, immutable account ID, and save time are stored under an account alias in the operating-system credential vault, validated before reuse, and never written to a plaintext fallback.
- Collection is continuous and aggregate-only: group member count, visible group instances, world/instance identifiers, and population counts.
- Private operator analytics ship first. Every public telemetry surface defaults off and is controlled independently by an authorized community operator.
- Missing or stale coverage is data quality, not zero attendance.
- Person-level presence and VRCX donation are separate data families. Aggregate records do not contain usernames.

### Current recommendation

Use Convex as the product/control plane and one account-scoped ECS service as the initial worker plane. Each worker receives only one Secrets Manager reference, claims fenced leases for that account, and writes normalized observations through internal Convex functions. This keeps the first fleet small and understandable without building a general job platform.

## Provider disposition

VRChat's Creator Guidelines allow respectful API applications but explicitly describe the API as unsupported and unstable. They require an identifying User-Agent, caching, metered requests, randomized polling, standard error handling, and 429 backoff. They also say applications should not request or store login credentials, auth tokens, or session data, and VRChat currently offers no OAuth flow for this use case. VRDex-owned accounts remove customer-consent risk but do not have a published service-account exemption. The community-maintained OpenAPI specification currently describes:

- `GET /groups/{groupId}` for group/member state and group member count
- `GET /groups/{groupId}/instances` for aggregate visible instance data
- `POST /groups/{groupId}/join` for free-join or request-to-join transitions
- `POST /groups/{groupId}/leave` for disconnect cleanup

The implementation treats those routes as a replaceable adapter, not a permanent provider guarantee. Local operating-system vault reuse is a deliberate bounded risk for VRDex-owned proof accounts, not a claim of provider approval or exemption. If VRChat objects, operators must stop proof traffic and clear the saved session.

### Open research checkpoint

The [2026-07-22 provider proof](../engineering/group-telemetry-provider-proof.md) records a successful Free Join transition and four hours of empty-state aggregate polling: 59 samples and 122 successful provider requests with no retries or errors. Because no instance was active overnight, non-empty visibility and active cadence remain unverified. Request-to-Join and Invite-Only also remain unverified. Future proof runs use account-scoped operating-system vault reuse and validate the immutable account ID before collection. Fleet scale-out and AWS-hosted provider sessions remain stopped until the proof reaches an acceptable disposition and VRChat explicitly approves the production service-account model.

## Data and source boundaries

- `communityVrchatIntegrations` owns the connection lifecycle and public visibility toggles.
- `collectorAccounts` and `collectorAccountLeases` own sanitized fleet metadata and fenced work claims; secrets remain external references.
- `communityPopulationObservations` stores one exact aggregate snapshot per successful poll. `instanceSessions` and `instancePopulationObservations` retain exact per-instance aggregate history for event recaps; `communityMemberCountObservations` retains changes and six-hour heartbeats. All carry immutable provider IDs where applicable, source, collector version, and idempotency keys.
- `collectionCoverageWindows` records observed, estimated, stale, unknown, and degraded time. Gaps never become population samples.
- `communityTelemetryRollups` stores versioned, reproducible community or event windows.
- `eventInstanceAssociations` stores manual confirmations and private suggestions separately. Suggestions never publish automatically.
- A future `instancePresenceObservations` family may reference immutable external user IDs under a separate privacy policy. It is intentionally absent from the MVP schema.

Only first-party observations feed v1 rollups. Future VRCPOP or VRCX adapters may write to the same normalized boundary with their own provenance, but conflicting sources require an explicit reconciliation rule and new rollup version.

For v1 coverage, the eligible denominator is the requested hour, day, or event rollup window. The numerator sums intervals between adjacent `observed` or `estimated` samples only when they are no more than five minutes apart. `unknown`, `stale`, and `degraded` intervals add no measured duration; they remain visible coverage gaps rather than zero attendance. `estimated` is reserved for a future source and has no first-party writer in the MVP.

## Metric catalog

All v1 rollups use version `community-telemetry-v1` and UTC bucket boundaries. Player-time metrics use trapezoidal population integration; gaps over five minutes are not interpolated.

| Metric | Unit and grain | Freshness and gap policy |
| --- | --- | --- |
| Current population | people, latest community sample | current for six minutes; omitted when stale |
| Active instances | instances, latest poll or maximum observed within a rollup | visible provider instances only; no value is inferred through gaps |
| Peak concurrency | people, rollup window | maximum summed population at an observed timestamp |
| Player time | player-minutes/hours, rollup window | trapezoidal integration only across gaps of five minutes or less |
| Instance duration | milliseconds, session | `openedAt` through `closedAt`; only successful complete enumerations increment misses, and two misses confirm closure |
| World distribution | observed samples by immutable world ID | no inference during gaps |
| Group membership growth | members, observation range | latest minus earliest observed count |
| Coverage | ratio and windows | measured intervals divided by the requested rollup window; unknown is never zero |

Counts are provider observations and may be delayed or approximate. Queues and individual users are not included.

## Polling and failure contract

- Active groups poll with randomized 60-120 second delays; quiet groups use 3-5 minutes.
- Account, integration, and process request budgets are enforced before calls.
- 429 honors `Retry-After` and exponential jittered backoff. Transient 5xx/timeouts back off. Any authenticated provider 401 immediately marks the account `auth_required`; a visibility 404 from group metadata or instance enumeration degrades only the selected integration.
- Every successful poll writes one group-level snapshot and one aggregate population point per visible instance. Group member counts write on change and at a six-hour heartbeat.
- A poll idempotency key prevents retry/reassignment duplication.
- Global, account, and integration kill switches stop new provider requests. Lease fencing prevents a stale worker from writing after reassignment.

## Retention

- Exact group and per-instance observations: 90 days after their hourly rollup exists.
- Session boundaries, coverage windows, compacted member-count changes, and rollups remain queryable so gaps and lifecycle history do not disappear during compaction.
- Hourly rollups: 18 months.
- Daily rollups and confirmed event recaps: retained while the community integration/history remains retained.
- Disconnect stops new collection and public presentation immediately. Historical private data is retained by default until an authorized deletion workflow is requested; this behavior is shown before disconnect.

Compaction may remove redundant heartbeats only after an equivalent rollup exists. Change points, session boundaries, coverage gaps, and event-linked windows remain reproducible.

## Security and operations

- `manage_integrations` authorizes connect, disconnect, private dashboard reads, event association, and visibility changes.
- The real-provider proof never persists service-account passwords or verification codes. It stores only the session cookies, immutable account ID, and save time in the account-scoped operating-system credential vault; malformed, expired, or mismatched sessions are removed. `--fresh-login` bypasses the saved session, `--clear-session` deletes it, and `--auth-from-env` remains a trusted development escape hatch that bypasses the vault.
- The disabled production worker contract supports one account session secret in AWS Secrets Manager, with Convex storing only its ARN/reference and generation. Activating durable session storage requires explicit provider approval; passwords and TOTP seeds are never stored.
- Logs and audit records contain status classes, request counts, sanitized error categories, and opaque account aliases; raw headers, cookies, credentials, provider payloads, and private observations are excluded.
- ECS workers are account-scoped, have bounded desired count/cost alarms, and default disabled behind an SSM startup gate. Convex is the dynamic global request stop; ECS desired count is the live infrastructure stop.
- Account loss or rotation ends the lease, opens an honest coverage gap, increments credential generation, and requires a new healthy account before reassignment.

## Validation gates

- Pure tests cover polling jitter/backoff, redaction, lifecycle confirmation, idempotency, gap-aware rollups, boundaries, corrections, and association review.
- Convex tests cover authorization, capacity, leases/fencing, kill switches, visibility defaults, and public projections.
- Worker adapter tests cover schema drift, 401/404/429/5xx, timeouts, and aggregate-only parsing.
- Desktop/mobile Playwright baselines and accessibility assertions cover the dashboard before completion.
- The real-provider proof writes sanitized evidence JSON outside git and updates `docs/engineering/group-telemetry-provider-proof.md` with only request counts, tested states, cadence, remaining gaps, and go/adjust/stop disposition.
