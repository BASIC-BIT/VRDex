# Task 3 report

## Result

Implemented shared-worker placement, transactional leases, and independent local
fencing. No event authority, registry, media packaging, or grant lifecycle changes.

## Files

- `convex/_mediaRelayControl.ts`: deployment authentication, verified bindings,
  registered worker identity, source ownership, bounded live-lease capacity reads.
- `convex/mediaRelayWorker.ts`: authenticated register/claim/renew/observe/release RPCs.
- `convex/_mediaRelayTables.ts`: worker registrations, persistent source epoch,
  optional current owner/expiry/progress, indexed owner + lease expiry.
- `packages/media-relay/src/worker/deployment.ts`: schema-derived trusted deployment
  bindings using the existing allocation and worker identity schemas.
- `packages/media-relay/src/worker/lease.ts`: per-source monotonic watchdog with
  independent timer, send-time deadline, synchronous latched fencing.
- `packages/media-relay/src/index.ts`: exports the watchdog for downstream workers.
- `tests/backend/media-relay-control.test.ts`: seven transactional/auth tests.
- `packages/media-relay/tests/lease.test.ts`: four local-authority tests.
- `convex/_generated/api.d.ts`: canonical local generated worker API types.
- `docs/engineering/media-relay-admission.md`: service contract, config ownership,
  rotation, source invariants, and watchdog integration requirements.

## Decisions and interfaces

All worker RPCs require the separate `MEDIA_RELAY_WORKER_TOKEN` credential.
`MEDIA_RELAY_WORKERS` binds workerId, exact workerEpoch, verified allocation,
maxSources, and draining. Missing configuration fails closed. Provisioning is an
operator release input; workers cannot invent capacity from metadata. One token
is trusted for the configured deployment, so deployment workers share that trust
boundary. No credentials or hosted configuration were created.

Source RPCs require workerId, workerEpoch, streamKey; owner-only RPCs additionally
require source epoch. Claim and renew return the shared OwnershipLease directly;
denials throw. Registration takes the shared WorkerObservation and accepts null
resource samples. Source observation accepts state and monotonic progressAt in
server timestamp units. Observations never renew authority.

Thirty-second leases renew after ten seconds. A new claim increments a persistent
source epoch. Release requeues a source (or stops it if explicitly draining),
clears ownership, and retains epoch. Terminal observations clear only that source's
ownership. Old/expired owners cannot observe, renew, or release. Existing Task 2
source/grant separation is preserved.

Worker drain rejects new claims while allowing existing legitimate renewals.
Explicit source draining denies that source's renewal. The kill switch rejects
both claims and renewals. Capacity counts authoritative live leases, not caller
job counts; shrinking configured capacity below active count denies renewals and
should therefore be performed only after draining to the intended count.

The watchdog is one instance per source epoch. It returns false before acceptance,
anchors the deadline at request start minus a 250 ms safety tick, rejects stale or
wrong-identity replies, and cannot revive after fencing. Its interval never awaits
renewal. The fence callback must disable publication synchronously before launching
asynchronous cleanup. Future media integration must honor that contract.

## Verification

Every shell sourced `/workspace/vrdex-env.sh`; proxy and CA settings were preserved.
Process/socket tests and canonical local generation used additional network
permission. The cloud-start catalog entry was absent, so its checked-in skill and
canonical guide were read. No hosted commands ran and no long-lived service was
started by this task.

- Initial RED run: both requested suites failed because new modules did not exist.
  The next backend run exposed a root-level missing zod dependency; the deployment
  schema was moved into its owning media-relay package, where zod already exists.
- Explicit behavioral RED/GREEN: pre-lease authority test failed true versus false,
  then passed after the watchdog returned false without a lease. Worker drain
  renewal test failed with draining denial, then passed after separating claim
  drain policy from existing renewal policy.
- `node --conditions=import --import tsx --test tests/backend/media-relay-control.test.ts packages/media-relay/tests/lease.test.ts`: final **11/11 passed**.
  Racing ownership is repeated five times. Tests include exact expiry boundary,
  stale epochs, two sources racing for one slot, unverified allocation, separate
  credential denial, restart, failure isolation, and pending renewal/cleanup promises.
- The same command with `tests/backend/media-relay-admission.test.ts`: **22/22 passed**
  before adding the final two Task 3 boundary/race tests; all 13 admission regressions passed.
- `pnpm typecheck:backend`: passed on final production code.
- `pnpm --filter @vrdex/media-relay typecheck`: passed.
- `pnpm verify:backend:local`: passed, `health:status` returned `ok`. Repeated after
  bounding the capacity index; final local generation included owner + expiry index.
  Reviewed generated diff contains only the new control/worker module references.
- `git diff --check`: passed.
- `pnpm exec markdownlint-cli2 docs/engineering/media-relay-admission.md`: passed;
  repository configuration expanded the lint command to 262 Markdown files.
- `pnpm exec prettier --write ...`: unavailable (no prettier executable); no files
  were changed by that failed formatting command. TypeScript printer formatted the
  new TypeScript modules instead.

## Self-review and limitations

Reviewed ownership mutation paths, lease boundaries, persistent epochs, independent
source failures, drain behavior, and indexed capacity serialization. No unrelated
full test suite ran. No implementation blocker remains.

Operational allocation evidence and deployment secret remain release inputs.
A JavaScript interval cannot execute while its event loop is blocked; this covers
stalled asynchronous requests, not a blocked runtime. Later media output/registry
integration must respect the synchronous fence. Unknown resource samples remain
unknown and do not produce fabricated CPU/memory headroom. Per-worker limits are
operator-reviewed admission limits, not a measured capacity or physical-phone claim.
