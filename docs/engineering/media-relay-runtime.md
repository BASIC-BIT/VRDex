# Shared media relay runtime

`@vrdex/media-relay/worker/main` exports `startRelayWorker(options)`. It boots
registration, discovery, demand reads and source reconciliation immediately,
keeps its reconciliation interval alive, installs SIGTERM/SIGINT handlers, and
returns `{reconcile, drain, stop}`. `stop` is idempotent and removes its handlers.
The shared package root does not import this Node runtime.

The runtime composes the real packager, Task 3 lease watchdog, publisher, and
existing pure cgroup resource/allocation sampler. It never imports the event
renderer. `packager`, clocks and counter reads can be injected for local tests.
Production adapters for Convex, object storage and native gateway demand are
separate deployment work; this entry point requires those adapters explicitly.
It does not read credentials or fabricate a worker allocation.

## Registry boundary

`createRelayRegistry({control, storage, binding, directory, demand, clock?,
limits?, metrics?, packager?, readCounters?})` returns `{reconcile(), drain(),
stop()}`. Reconcile schedules bounded work and returns synchronously. An
independent 250 ms interval also checks output, idle demand and lease deadlines.
No external promise sits in that authority-check path.

`binding` is the existing validated worker ID/epoch, measured allocation,
`maxSources`, and draining flag. Sources are discovered as admitted sessions,
not grants. Duplicate rows share one source job. Jobs, including quarantined
physical operations, occupy at most `maxSources` slots. A losing claim without
local authority releases its reservation after its physical operation settles.
A completed terminal job is removed after acknowledgment and disappearance from
discovery, or after an explicitly newer admission revision. Native demand
cannot increment that revision or restart a terminal source.

One attempt owns one acquisition. Recovery waits for its actual setup/stop
completion before another attempt starts. A teardown rejection quarantines the
attempt. Each attempt receives a fixed copy of continuity; the registry reserves
subsequent sequences even when an upload/commit is uncertain. Persisted
continuity survives takeover and an explicit new Play admission.

Defaults:

| Boundary                     | Behavior                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| External operation           | 5 seconds, AbortSignal, one physical slot per operation channel                                    |
| Recovery retry               | 1 second, at most 8 consecutive attempts without dual-rendition progress                           |
| Cleanup wait at shutdown     | 3 seconds; fence is immediate, pending cleanup remains owned                                       |
| Output recovery              | Shared 30-second budget from last fresh dual-rendition output; first claim is the initial fallback |
| Native idle grace            | Shared 180 seconds; no JS heartbeat authority                                                      |
| Observation/demand/discovery | Once per second, single-flight                                                                     |
| Retired-object sweep         | Once per minute, at most 1000 objects per call, ten-minute age cutoff                              |

Both rendition clocks must progress. Freshness uses the shared actual-target
rule; a stale ready attempt becomes recovering. New failures and native requests
do not reset the 30-second budget. Unsupported codecs become unavailable
immediately with the bounded terminalReason `unsupported`. The existing playback
grant response preserves `unavailable(reason: "unsupported")`; only a fresh
authorized Play clears the reason. No raw media diagnostics are persisted. Fresh output keeps a source alive beyond 30 seconds. Recovery start
and durable progress survive worker takeover. Only explicit admission of a
terminal session resets startup progress; its sequence history remains intact.

Drain denies new jobs and retains valid leases for existing jobs. Stop fences
all publication synchronously, aborts attempts and begins owned cleanup. It does
not release a lease ahead of confirmed physical cleanup; shutdown leases expire
under the existing control-plane deadline. A non-cooperative adapter cannot be
forcibly terminated by a Promise timeout. Its slot remains occupied, preventing
unbounded detached retries. Metrics are structured callbacks, never raw source
URLs or process logs. A cleanup timeout is reported through metrics.

## Control adapter and authenticated RPCs

The adapter captures the configured worker ID/epoch and the existing separate
relay credential. Signals must be honored before dispatch; no browser identity
conveys worker authority. All listed RPCs live in `convex/mediaRelayWorker.ts`.

| Adapter method                                                | RPC and result                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| `register(observation, signal)`                               | `registerWorker`                                              |
| `list(signal)`                                                | `listSources`: bounded `{source, state, admissionRevision}[]` |
| `claim(source, signal)`                                       | `claimSource`: OwnershipLease                                 |
| `renew(lease, signal)`                                        | `renewSource`: same-identity OwnershipLease                   |
| `read(lease, signal)`                                         | `readSource`: `{recoveryStartedAt, progressAt?, continuity?}` |
| `observe({lease,state,progressAt,terminalReason?,signal})`    | `observeSource`                                               |
| `commitSnapshot({lease,snapshot,objectKey,signal,isCurrent})` | Check signal/current synchronously, then `commitSnapshot`     |

Discovery includes current worker ownership and eligible unleased/expired sources.
Its state/lease index filters live leases before applying each bounded read,
preventing a run of live sources from starving a later expired source. Registration
and existing worker credential/binding checks apply to the new service reads.

A transactional commit validates live ownership, source epoch, enabled state,
freshness, contiguous bounded segment paths, immutable snapshot key, monotonic
sequence and takeover discontinuity. It stores the bounded validated snapshot as
the authoritative pointer metadata; `snapshotObjectKey(snapshot)` gives its
immutable object reference. Both rendition snapshots establish ready output.
Persisted progress is the older rendition's generated time. No object-store
conditional write is assumed to know Convex lease authority.

Expired ownership can acknowledge **only** stopped/unavailable when the stored
worker ID, worker epoch and source epoch still exactly match. This branch
preserves durable progress and rejects attempted newer timestamps. It preserves
the stored terminal reason unless the matching owner supplies a validated code. It clears
ownership without renewing, publishing, setting ready or reviving a source.
A racing takeover either wins a newer lease or loses to the terminal transaction;
the expired owner cannot overwrite the newer owner. This cleanup acknowledgment
conveys no publishing authority.

## Publication and storage adapter

`createPublisher({storage, commitSnapshot, isCurrent, limits?})` exposes
`publishSnapshot({lease, snapshot, segments:{directory}, signal})` and `isIdle()`.
Each rendition has a serial lane with at most two pending publications by default.
An operation that times out retains its physical lane slot until settlement.
This prevents out-of-order completion and growth from detached uploads.

Publication validates local relative paths, then performs:

1. Upload every referenced complete segment under
   `<streamKey>/epochs/<epoch>/<attempt>/<rendition>-<sequence>.ts`.
2. Write the immutable snapshot object under
   `<streamKey>/epochs/<epoch>/snapshots/<rendition>-<lastSequence>.json`.
3. Recheck local signal/current lease and commit the authoritative control pointer.

Every awaited phase has a synchronous fence before the next side effect. Abort
and lease loss can leave obsolete immutable objects, never authorize them as a
current epoch. The remote transaction is the final ownership check; adapters
must not replace it with an S3-only CAS. Same-epoch sequence reservations and
transactional checks also reject delayed/out-of-order completions. A submitted
RPC cannot be recalled; its server transaction still validates current lease,
epoch and sequence. Gateway readers must independently validate current source
state, ownership epoch and snapshot freshness.

`RelayStorage` requires:

- `putSegment({objectKey,filePath,signal,retireAfterMs})`: complete the upload
  before resolving; read files within the callback lifetime and honor abort.
- `putSnapshot({objectKey,snapshot,signal,retireAfterMs})`: immutable object write.
- `retire({before,limit,signal})`: bounded age-based retirement with durable
  enumeration/cursor progress. Do not repeatedly scan only young objects.

Ten minutes is the shared retention eligibility policy. Sweeping is bounded and
independent from publication; its throughput and backlog must be measured in the
provider adapter. Bucket lifecycle is a longer cleanup backstop, never current
publication authority. The runtime keeps no growing per-object deletion map.
Adapters should stream file uploads and must bound their own retries and buffers.

## Native-demand boundary

`demand.read({streamKeys, signal})` returns
`{healthy:boolean, activity:[{streamKey,lastActivityAt}]}`. Times are Unix
milliseconds of authenticated native playlist activity. Healthy reads allow new
admission discovery; unhealthy, failed or timed-out reads deny new jobs and do
not extend activity. Existing jobs retain only the last known idle grace.
The adapter cannot create a source or mutate terminal state. Task 6 owns gateway
activity collection and health reporting; there is no browser timer endpoint.

## Evidence and limits

Focused package tests exercise actual FFmpeg, FFprobe, guarded loopback MP4,
completed-file reads, upstream disconnect, missing-object failure, an owned child
kill and a stalled upload. They verify increasing sequences, fresh recovery,
maximum one upstream, bounded retries and cleaned attempt directories. Unit tests
cover independent fencing during blocked renewal/teardown, idle and recovery
budgets, unknown resources, bounded publication lanes, drain and boot cleanup.
Backend tests exercise transactional publication/takeover/discovery and expired
terminal acknowledgment using Convex's local test runtime.

These are local proofs. Provider storage behavior, deployed credentials, capacity,
production cleanup throughput, actual VRCDN profiles and physical-phone playback
remain later validation gates. No resources are provisioned by this runtime work.

## Native gateway integration

The [native playlist gateway](media-relay-gateway.md) supplies the concrete
`demand.read({streamKeys, signal})` adapter and the API Gateway v2 handler
boundary. An empty discovery batch still probes demand storage health. Gateway
control reads use the separately authenticated `mediaRelayWorker:readGateway`
public query; its grant/current-epoch/snapshot metadata is validated before
immutable storage access. Task 7 binds provider SDKs to these explicit contracts.

Physical operation slots release capacity when their underlying promise settles,
before invoking result consumers. Timeout or cancellation alone does not release
a slot. This lets discovery retire a terminal job after an already-settled
rejected observation, while keeping a noncooperative pending observation
quarantined. Job removal continues to require an idle observation channel.

## Deployment binding

Concrete abortable Convex, S3, DynamoDB and secret adapters, runnable worker and
Lambda entrypoints, packaging and disabled infrastructure are documented in
[relay deployment](../deployment/media-relay.md). Provider capacity and physical-phone
release checks remain unmeasured; local fixtures are not production approval.

Current-player identity, OS controls and authorized image derivatives are covered
in [Now Playing metadata and artwork](now-playing-metadata.md).
