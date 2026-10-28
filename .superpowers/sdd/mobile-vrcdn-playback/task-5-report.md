# Task 5 report

Status: DONE_WITH_CONCERNS. Local implementation and focused verification are
complete. Provider adapters, production cleanup throughput and physical-phone
validation remain later tasks.

## Delivered

- `createRelayRegistry` composes the real single-attempt packager, source lease
  watchdog, bounded publisher and pure aggregate cgroup resource sampler. No
  event renderer imports. Duplicate admitted sessions share one source job;
  bounded slots isolate failures and quarantine physically pending work.
- `startRelayWorker` is a bootable boundary with immediate reconciliation,
  persistent periodic work, signal handling and idempotent shutdown. Deployment
  supplies authenticated control/storage/native-demand adapters explicitly.
- Segment uploads finish before immutable snapshot-object writes; authoritative
  publication then uses a real Convex transaction. Local AbortSignal/current
  checks precede each awaited phase. Two fixed serial rendition lanes prevent
  old same-epoch completion from overwriting newer output; timed-out physical
  operations retain their queue slots until settlement.
- Epoch-scoped paths, bounded contiguous snapshot validation, monotonic media
  sequence and takeover discontinuity validation. Continuity is persisted in
  bounded source snapshot metadata and copied per attempt. Uncertain local
  publications also reserve sequence values for the next attempt.
- Recovery is registry-owned. Stale output becomes recovering; last fresh
  dual-rendition output, or first-claim startup fallback, anchors the shared
  30-second budget. Repeated failures/native requests do not reset it. Eight
  consecutive attempts bound early failures. Actual fresh output continues
  beyond thirty seconds. Unsupported codecs terminate immediately and persist the bounded reason
  `unsupported`. Existing grants return that exact unavailable reason; only
  fresh authorized Play clears it.
- Native-demand injection exposes healthy/lastActivityAt reads. An outage denies
  new jobs and cannot prolong the last known idle grace. No JS heartbeat or
  source acquisition on page mount was added. Explicit Play increments an
  admission revision when restarting a terminal source; native polling cannot.
- Control-plane source discovery, continuity reads and transactional publication
  use the existing deployment credential and registration binding. The new
  state/lease index filters active leases before bounded reads, avoiding
  starvation of later expired sources.
- Controller-approved terminal-only expired acknowledgment preserves durable
  progress and clears only the exact matching old worker/source epoch. It cannot
  set ready, advance freshness, publish or renew. A takeover race cannot let the
  old owner overwrite the new one.
- Ten-minute object retirement eligibility is shared policy. A bounded,
  single-flight sweep passes a cutoff and batch limit to storage; local state
  does not accumulate a deletion map. Bucket lifecycle remains the later
  backstop, never publication authority.
- Carried Task 4 fix: continuity requires the complete strict video/audio field
  shape before any filesystem, acquisition or process resources are created.

## Interfaces for Tasks 6/7

Exact method/type signatures are in the exported server-only source modules.
The complete adapter and lifecycle contract is documented in
`docs/engineering/media-relay-runtime.md`.

- `@vrdex/media-relay/worker/main`: `startRelayWorker(RegistryOptions)`.
- `@vrdex/media-relay/worker/registry`: `createRelayRegistry`, `RegistryOptions`,
  `RelayControl`; returns `{reconcile():void, drain():void, stop():Promise<void>}`.
- `@vrdex/media-relay/worker/publisher`: `createPublisher`, `RelayStorage`,
  `PublicationCommit`; `publishSnapshot({lease,snapshot,segments:{directory},signal})`.
- Control adapter captures workerId/workerEpoch/credential and maps register,
  list, claim, renew, read, observe and commitSnapshot to the corresponding
  `mediaRelayWorker` RPCs. List rows are `{source,state,admissionRevision}`.
  `readSource` returns `{recoveryStartedAt,progressAt?,continuity?}`.
- Storage writes immutable segment and snapshot objects, honoring signal and
  `retireAfterMs`. Retirement accepts `{before,limit,signal}`. Its enumeration
  must make durable progress rather than repeatedly listing only young objects.
- Control commit accepts validated full bounded snapshot metadata plus the exact
  immutable `objectKey`. Stored snapshot metadata is the authoritative pointer;
  `snapshotObjectKey(snapshot)` derives its object reference. Do not implement
  this check with S3-only CAS: S3 does not know the Convex lease.
- Gateway demand adapter: `read({streamKeys,signal})` returns
  `{healthy,activity:[{streamKey,lastActivityAt}]}` from native playlist requests.
  It never creates a source or advances terminal admission revision.
- Gateway reads must validate source state/current epoch/freshness independently.
  Immutable objects left by obsolete epochs confer no playback authority.

## Changed files

- New runtime: `packages/media-relay/src/worker/{registry,publisher,main}.ts`.
- Shared schemas/helpers/policy and server-only package exports:
  `packages/media-relay/src/{contracts,policy}.ts`, `package.json`.
- Inherited continuity validation: `packages/media-relay/src/worker/packager.ts`.
- Control persistence/RPCs/admission restart:
  `convex/{_mediaRelayTables,mediaRelayWorker,mediaRelayPlayback}.ts`.
- Resource sampler declaration: `workers/restream/resource-sampler.d.mts`.
- New tests: `packages/media-relay/tests/{registry,publication,recovery}.test.ts`;
  shared local-media and registry fixtures in `*-fixture.ts`.
- Existing tests updated: package `contracts.test.ts`, `packager.test.ts`, and
  `tests/backend/media-relay-control.test.ts` and `media-relay-admission.test.ts`.
- Docs: new `docs/engineering/media-relay-runtime.md`, packaging cross-reference,
  and this report.

## RED/GREEN and self-review evidence

Observed RED before implementation:

- Four publisher behavior tests failed against the explicit unimplemented
  publisher boundary, then passed with ordered/fenced/bounded publication.
- Registry/recovery behavior tests failed against the unimplemented registry,
  then passed with composed lifecycle handling. Initial helper imports duplicated
  tests; shared fixtures were extracted to prevent that duplication.
- Malformed untyped continuity returned instead of rejecting before resources;
  the complete strict schema now rejects it.
- New backend publication/discovery tests initially failed for missing RPCs,
  then passed after implementing authenticated transactional endpoints.
- Expired exact-owner terminal acknowledgment failed with authority denied;
  the approved terminal-only branch now accepts it without freshness authority.

Self-review regressions observed RED then corrected:

- Updating registry continuity mutated the baseline used by a running restarted
  packager. The test observed nextSequence 2 instead of 1. Each attempt now gets
  its own fixed baseline, preventing later scan failures/reconnect loops.
- A losing claim could permanently pin a local slot. Failed unowned reservations
  now retire only after their physical operation settles.
- A terminal source taken over elsewhere could pin its old local slot. Bounded
  authenticated discovery plus confirmed local cleanup now permits removal.
- Discovery applied the row limit before filtering live leases, starving a later
  expired source. The state/lease index applies eligibility before the limit.

Intermediate verification corrections:

- One recovery test inspected retry count before asynchronous cleanup settled;
  it now waits for actual cleanup before the next retry tick.
- `/proc` child discovery did not identify the fixture child reliably. The real
  fixture now uses an opt-in local exec wrapper recording its own PID; the kill
  targets only that owned PID, then recovery and cleanup are checked.
- The package suite initially passed 42/43: the existing exact policy fixture
  omitted new shared `objectRetentionMs`. It was updated and the full focused
  package suite subsequently passed 43/43.
- Adding an incomplete legacy allocation declaration hid another existing export.
  That declaration was removed; the runtime reuses allocation validation through
  the existing resource sampler. Shared helper `.at` usage was adjusted for the
  Convex ES2021 library target. Both typechecks subsequently passed.
- `pnpm exec prettier` was not on PATH; the already-installed Prettier 3.8.1 binary
  in pnpm's store formatted all changed implementation/tests/docs. No install ran.

Unsupported propagation was additionally tested RED/GREEN through registry
observation and real authenticated backend acknowledgment to `getPlayback`.
Repeated reads preserve the reason, new authorized Play clears it, and stale
ownership cannot write it back. No raw diagnostic text or new product prose.

## Final verification

All commands activated `/workspace/vrdex-env.sh`. Process/socket tests used
additional network permission while preserving proxy/CA settings. Sources were
only generated loopback fixtures; no hosted/provider stream was acquired.

1. `pnpm --filter @vrdex/media-relay test`: **44/44 passed**. Covers shared
   contracts, watchdog, packager/source security, publication, registry, recovery.
2. `node --conditions=import --import tsx --test
tests/backend/media-relay-control.test.ts
tests/backend/media-relay-admission.test.ts`: **26/26 passed**.
3. `pnpm --filter @vrdex/media-relay typecheck`: **exit 0**.
4. `pnpm exec tsc --noEmit --project convex/tsconfig.json`: **exit 0**.
5. `git diff --check`: **exit 0**.

Real-media registry proof: initial fresh snapshots, disconnected upstream,
missing-object upload error, owned child SIGKILL, new increasing/discontinuous
output, then stalled upload with finite attempts and terminal unavailability.
The maximum simultaneous upstream count was one. Snapshot publication checked
that every referenced completed file had been read into storage first. Terminal
stall left no new snapshot commits, and stop left the owned source attempt
directory empty. The suite still performs Task 4 decode/probe checks for both
renditions. Final inspection found zero `/tmp/vrdex-packager-*` fixture directories.
No broad test suite, deployment, resource apply, credential operation or provider
mutation ran.

## Limits and concerns

- Concrete provider adapters are later work. They must honor AbortSignal before
  dispatch, stream/bound uploads, bound retries, use the control transaction for
  publication, and advance retirement enumeration. A submitted RPC cannot be
  recalled; its remote transaction still checks live epoch/lease/sequence.
- Ten minutes is retirement eligibility, with a bounded 1000-object/minute sweep
  in this runtime. Provider sweep throughput/backlog needs measurement against
  admitted load; lifecycle is a longer backstop. No production capacity claim.
- Non-cooperative external operations remain quarantined in finite slots. Stop
  reports cleanup timeout and returns after its bound; it cannot forcibly resolve
  arbitrary adapter promises. Default packager teardown is exercised with real
  media and owns its child/acquisition cleanup.
- Stop fences immediately and leaves control leases to normal expiry rather than
  releasing before physical cleanup. Drain retains existing valid leases while
  denying new work.
- Local results do not establish hosted VRCDN profile compatibility, production
  provider behavior/capacity, or physical-phone playback.

## Review fix round 1: observation quarantine

Review base: `774221f`. Addressed the Important finding in
`task-5-review.md`: job deletion now also requires `job.observe.isIdle()`.
A timed-out observation that ignores cancellation retains its physical slot and
therefore the source's bounded job reservation. Source disappearance or admission
revision changes cannot bypass that guard. No other runtime behavior changed.

Added regression in `packages/media-relay/tests/registry.test.ts` with
`maxSources: 1`. The first observation ignores its aborted signal and remains
physically pending. Its source becomes terminal and disappears from discovery;
three replacement reconciliations must admit no replacement. Settling the
observation then permits the replacement source. The test releases the pending
operation and stops its registry in `finally`.

Commands activated `/workspace/vrdex-env.sh`; the focused test used additional
network permission, preserving proxy/CA environment.

RED command:

```text
node --conditions=import --import tsx --test --test-name-pattern='disappearing terminal job' packages/media-relay/tests/registry.test.ts
```

Observed output before the fix (exit 1):

```text
✖ disappearing terminal job retains its slot while an observation ignores cancellation
AssertionError [ERR_ASSERTION]: pending observation must retain the only job slot
2 !== 1
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

GREEN: the identical command after the one-line guard change exited 0:

```text
✔ disappearing terminal job retains its slot while an observation ignores cancellation
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

`pnpm --filter @vrdex/media-relay typecheck` emitted its normal
`tsc --noEmit --project tsconfig.json` invocation with no diagnostics and exited 0.
`git diff --check` produced no output and exited 0. No broad or real-media suite
was rerun for this isolated job-retirement guard.

Self-review: all per-job physical channels now participate in removal: attempt
cleanup, publisher lanes, renewal, observation and initialization. The existing
slot retains `busy` until physical settlement, independently of timeout/abort.
The new guard neither delays synchronous fencing nor interferes with bounded
shutdown; a permanently stalled adapter conservatively retains capacity as
intended. The regression proves both retained capacity and release after actual
settlement. Existing provider/phone limitations remain unchanged.
