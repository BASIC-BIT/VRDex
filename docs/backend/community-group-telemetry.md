# Community group telemetry backend

## Scope

This backend implements the aggregate-only slice of [epic #176](https://github.com/BASIC-BIT/VRDex/issues/176). A VRDex-owned VRChat account observes a connected group's member count and visible group instances. It never accepts a customer's VRChat credentials and does not store instance user lists, usernames, or user IDs.

## Control plane

`communityVrchatIntegrations` is the community-owned lifecycle record. Connect, disconnect, private reads, publication settings, and event association require `manage_integrations`. Connect allocates one healthy account only while `assignedGroupCount < capacity - reservedHeadroom`; Convex mutation serialization prevents concurrent over-allocation. The same VRChat group cannot be active on two community profiles. Disconnect immediately disables collection and public fields, then a fenced `disconnecting` assignment makes the service account leave the group before releasing account capacity. Reconnect resets freshness and opens a new `telemetryEpochStartedAt`; private and public projections filter observations, sessions, coverage, associations, and rollups to that epoch so a previous group's retained history cannot appear under the new connection.

`collectorAccounts` stores an opaque alias, VRChat service-account ID, capacity, health, request budget, credential generation, and an external secret reference. It never stores the credential. Local proof authentication reuses an alias-scoped operating-system vault session only after validating the authenticated immutable account ID; invalid sessions are removed and there is no plaintext fallback. The disabled production worker can resolve a provider session from the external secret only after the provider-approval deployment gate is satisfied. `collectorAccountLeases` grants a bounded work claim. `communityVrchatIntegrations.leaseGeneration` makes fencing tokens monotonic across release and reassignment, so an old worker cannot resume writes with a reused token.

Reassignment is an internal operator action and is allowed only after the source account is quarantined, retiring, or retired. The mutation serially checks target headroom, releases the old lease, moves the allocation, and opens an unknown coverage window before the next fenced claim. Registering new credentials does not automatically reactivate a quarantined or retired account; an operator must reconcile its external group memberships before explicitly returning it to `ready`.

The account-specific `/telemetry/worker` HTTP action authenticates a SHA-256 worker key using a constant-time comparison. Every non-claim operation also binds the active lease to that authenticated collector account, worker ID, and fencing token. Lease expiry is checked against trusted server time; collector observation timestamps are validated separately within a bounded clock-skew window. Its operations are limited to claim, membership result, aggregate ingest, failure, and release. Responses and fleet-health queries redact the secret reference and worker-key hash.

## Observation model

- `communityPopulationObservations`: one immutable total population, instance count, and world distribution per successful poll; the poll ID is the idempotency key.
- `instanceSessions`: first seen, last seen, and confirmed close for an immutable provider instance ID. Only successful complete instance enumerations increment the miss counter. Two consecutive misses close a session; seeing the same provider ID later opens a new session. `lastObservedAt` records actual visibility, while `closedAt` records the later confirmation poll.
- `instancePopulationObservations`: aggregate population per visible instance per successful poll. These support exact confirmed-event recaps without collecting people.
- `communityMemberCountObservations`: a row on count change or after a six-hour heartbeat.
- `collectionCoverageWindows`: observed, estimated, stale, unknown, or degraded intervals. Missing time never produces a zero observation.

Every observation carries source, collector version, observed time, coverage, and fencing token. The v1 source is `first_party`; `vrcpop` and `vrcx` are reserved adapter values, not active integrations. The adapter replaces subjects embedded in `hidden(...)` or `private(...)` instance-locator markers, including legacy user IDs without a `usr_` prefix, before ingestion. Defense-in-depth validation rejects unredacted subject markers, remaining `usr_` identifiers, foreign group markers, inconsistent world/location pairs, negative/non-integer counts, duplicate instance IDs, malformed world IDs, oversized values, and control characters.

## Rollups and retention

`community-telemetry-v1` rollups use UTC hour/day/event windows and trapezoidal integration between observations no more than five minutes apart. They include current population, active instances, peak concurrency, player-minutes, coverage ratio, member count/growth, and world distribution. Re-running the same window updates the existing versioned row, so late or corrected raw observations deterministically replace the rollup.

The hourly Convex cron schedules the previous hour, previous UTC day, and recent confirmed events. Manual confirmation and suggestion approval schedule the event rollup immediately. The daily compaction cron removes raw group and instance observations older than 90 days only when the corresponding hourly rollup exists. Instance data linked to a confirmed event is retained until that event has a rollup. Session boundaries, coverage windows, member changes, and rollups remain.

## Public projection

`getPublicCommunityTelemetry` is the only public projection. Each of current population, hourly history, member count, member growth, and event recaps defaults off and is included independently. Hourly history is one deliberate bundle containing its documented rollup fields. Current population disappears after six minutes without a successful poll, which covers the five-minute healthy quiet cadence plus scheduling tolerance; the projection remains `stale` if another enabled historical surface is still present. Disconnect returns no public telemetry.

`profiles.getPublicBySlug` attaches this same projection to the community profile. The normal web route, `/api/v0/communities/{slug}`, `/api/v0/profiles/{slug}`, hosted MCP, and stdio MCP therefore share one visibility boundary and one `PublicCommunityTelemetrySchema`. Existence-only callers opt out of the telemetry fanout. Internal observation IDs, integration/account IDs, raw coverage reasons, group IDs, and service-account metadata are excluded.

## Verification

Backend tests cover authorization, public-off defaults, concurrent capacity allocation, quarantine/reassignment, fleet stops, monotonic fencing, idempotency, concurrent sessions, close/reopen behavior, malformed input, 401 account isolation, redaction, stale public behavior, deterministic recomputation, and rollup-gated compaction. Worker tests cover the provider adapter, aggregate-only projection, account-scoped operating-system vault records, immutable identity validation, expired-session removal, transient validation failures, slow-metadata caching, request budgets, cadence jitter, 429 backoff, gap-aware player-hours, and diagnostic redaction.
