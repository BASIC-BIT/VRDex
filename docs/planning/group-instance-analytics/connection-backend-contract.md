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

Backend tests cover unauthorized reads, feature defaults and updates, fenced
snapshot rejection, freshness, identity mismatch, credential rotation, expired
leases, role ID validation and cross-club role rejection. Provider writes and
the completed onboarding UI remain separate integration work.
