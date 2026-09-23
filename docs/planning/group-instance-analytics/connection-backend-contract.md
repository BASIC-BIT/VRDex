# Club connection backend contract

`clubConnection.get` is restricted to the club owner or `manage_integrations`.
It returns independent enabled features, current own-member evidence, baseline
readiness and role assignment allowlists. Legacy integrations default to
analytics alone. Feature selection does not grant staff or bot permissions.

`setFeatures` has the same human gate. `setProviderRoleAllowlist` is owner-only,
accepts existing active VRDex roles in that club and bounded VRChat role IDs.
These IDs constrain later role assignments; saving them performs no provider
write and does not prove the provider role exists. Dispatch must resolve the
current provider role and reject changes to the bot's own roles.

Authenticated worker HTTP ingestion calls internal `recordAuthority` with
`collectorAccountId`, hashed worker credential, `workerId`, `fencingToken`,
`integrationId`, `epochStartedAt`, and `authority` containing `groupId`, `userId`,
optional `ownerUserId`, `membershipStatus`, `permissions`, and `observedAt`.
The mutation checks current assigned account, credential, active lease, epoch,
kill switches, bot identity, group identity and a 60-second freshness window.
Snapshots are invalid after credential rotation, reassignment or a new epoch.
The permission catalog is never a substitute for own-member grants.

Readiness is a baseline only: membership requires member-data access, posts
require announcement management, instances require member-instance creation.
Each actual operation must additionally apply its specific permission checks
and obtain fresh authority immediately before execution. A stale snapshot is
unknown, never ready. The polling cadence may exceed the freshness window.

New and reused pending provider reads advance the integration's next poll hint
to the current time. Existing provider backoff and kill switches still apply.
After a budget-delayed data read, the worker refreshes authority if its evidence
is older than 30 seconds and rechecks membership and grants. If the data itself
ages beyond that margin during refresh, it records an explicit read failure
instead of sending stale evidence that leaves the request running.

`clubProviderReads.get` returns server-authoritative `fresh` and
`remainingFreshMs` for the stored observation. The duration is zero for failed,
absent, future-dated or expired evidence. The 60-second boundary is expired.
The query still rechecks the requester, feature, epoch and collector access.

The browser supplies a unique `freshnessNonce` per mount or refresh attempt,
including when `request` returns a previously used request ID. Convex caches
queries by their arguments and elapsed wall time does not invalidate them.
The nonce forces a new server evaluation; it grants no authority or lifetime.
It is optional for existing query callers, which must not treat a cached
duration as new evidence. The shared hook measures elapsed time with
`performance.now()`, starting before the query, so client clock offsets and
transport delay cannot prolong readiness. The hook accepts the first deadline
for each attempt nonce, request ID and observation timestamp. Reactive updates
for that same observation retain the deadline even when the server returns a
smaller remainder. Replayed results, including larger durations, cannot extend
or revive it. `observedAt` identifies the observation; it is never compared to
the device clock. A changed observation or a pending/running read that succeeds
gets a new nonce evaluation, with actions disabled until it arrives.
Null, failed, stale and denied results immediately disable readiness.
Operation execution retains its independent
server authorization and freshness checks.

Backend tests cover unauthorized reads, feature defaults and updates, fenced
snapshot rejection, freshness, identity mismatch, credential rotation, expired
leases, role ID validation and cross-club role rejection. Provider writes and
the completed onboarding UI remain separate integration work.
