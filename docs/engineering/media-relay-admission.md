# Shared VRCDN playback admission

`convex/mediaRelayPlayback.ts` admits explicit public Play requests. Public profile
and event page queries remain read-only and do not create sources or grants.
The relay uses one source row per case-preserving `StreamKey`, independently of
context grants. Source creation and capacity checks happen in the same Convex
mutation, so concurrent admissions reuse one queued source.

## Public caller contract

`openPlayback({context, streamId, preferredMode, continuationGrantId?})` returns the shared
`packages/media-relay` Admission contract. A preparing result includes the opaque
`grantId` to pass to `getPlayback({grantId})`. `releasePlayback({grantId})` is
idempotent and releases only that grant. A grant permits both video and audio
renditions for exactly 43,200,000 ms. Mode preference remains client state; it
must persist across DJ changes until the listener explicitly changes it.

Existing outbound/media links do not have stored row IDs. Use these stable
context identifiers, which the backend checks against the actual public source:

| Context | Identifier |
| --- | --- |
| Profile | `profileId` is the profile document ID; `linkId` is the canonical, case-preserving VRCDN stream ID parsed from a link in its public profile-page projection. Equivalent URL spellings identify the same stream. |
| Event with `event_stream` mode | `eventId` is the event document ID; `selectedSourceId` is the canonical VRCDN stream ID parsed from an authorized public `watch`, `stream`, or `vrcdn` media link. |
| Event with `performer_sequence` mode | `selectedSourceId` is the projected slot's existing `playbackKey`. The selected slot must resolve the requested stream through its current public performer and stream choices. |

A raw stream ID never establishes authority. Profile publication and field
visibility use the existing public profile helpers; event publication, community,
slot, and performer checks use the existing public event projection. Direct video
files do not become live relay inputs. Invalid source identities return
`unavailable` with reason `unsupported`.

New event admission must fall inside the existing doors/start-to-end watch
window. An existing unexpired grant can continue after that window while its
context remains authorized. Its server-issued admission time is continuation
proof: the server cannot determine whether native playback became audible.
Cancellation, disabled watch surfaces, date-only events, hidden public context,
or removal/change of the selected source deny revalidation. A shared source's
existence never authorizes a new out-of-window start.

The context revision fingerprints only source identity and publication policy,
including the profile link visibility or event watch mode/slot performer.
Display names, descriptions, artwork, labels, and calendar continuation are not
revision inputs. Every resolution also rechecks current authorization. Removing a source denies its
grant immediately; restoring exactly the same public source and policy may
revalidate a still-unexpired grant. Explicit release remains latched across any
restore. The revision is not a permanent revocation tombstone. Live
metadata reads public selected artwork IDs/revisions without changing original
assets. Missing asset-backed artwork is represented by null handles.

## Foreground lineup continuation

A started performer sequence may pass its current `continuationGrantId` when
admitting another slot after the event window. The server resolves the original
unexpired, unreleased grant against current source policy and revision. Both
contexts must belong to the same event, whose current mode must be
`performer_sequence`. The target public slot, performer and canonical stream are
independently authorized. Different streams receive distinct grants and ordinary
source, grant and rolling admission quotas still apply. Profile, other-event,
expired, released and revoked proofs fail. Revoking the original slot removes its
continuation authority even if the event itself remains public.

Consecutive slots using the exact same stream retain the established native node
and playlist. `rebindPlayback({grantId, selectedSourceId,
expectedSelectedSourceId, expectedContextRevision})` reauthorizes both the original
and target slot in the same performer-sequence event. The target must resolve the
same canonical stream key. The expected context fields provide compare-and-swap
protection against stale identity updates. A successful `PlaybackRebindSchema`
result contains `kind: rebound`, the updated grant and authoritative metadata.
It does not assert media readiness. A denial contains `kind: denied`.

This narrow identity-only operation changes the existing grant's context and
revision, preserving its ID, issue time, expiry, URLs, source row and media node.
It does not admit, restart or renew a source and does not extend the grant. This
is the exception to otherwise distinct per-context grants, needed to preserve
existing same-stream lineup behavior. Client rebinding is serialized and fenced
against current ownership, viewer intent and Close. A denied rebind pauses and
exposes the existing explicit retry policy; it never claims the new identity.
Metadata-only edits use ordinary refresh and do not need a rebind.
Refresh and recovery responses carry the client admission identity generation.
Starting and completing a rebind invalidate older responses, including replies
whose server work finished before the rebind but whose delivery was delayed.
Refresh/recovery do not start while a rebind is in flight. A stale response cannot
restore the previous context, overwrite the current native title or supply the
expected context for a later CAS.

An explicit manual change to a different stream retires the old native transport
and clears installed-current metadata immediately. Its valid grant remains held
as silent continuation proof until target admission finishes. A superseding
manual choice transfers that held proof to the newest admission; cancellation,
Pause, Close or target revocation release it. Cancelled target admissions release
any late capability they return. Target installation publishes only its own
admitted metadata and releases the old proof. The backend still reauthorizes the
unreleased proof and target independently; retirement never extends authority.

The native lineup uses the existing foreground coordinator and boundary/failure
policy. Prepared playback is element-muted and owns no public current metadata.
Promotion mutes the old current before unmuting and playing the prepared source.
A blocked promotion retains the old identity and existing Enable playback gesture.
Decoded progress and media readiness are observed directly. Native audio level is
`unavailable`; native media never connects to Web Audio. Silence handoff remains
disabled. Hidden documents do not prepare, change lineup identity or hand off.
The admitted current may keep playing while hidden, and a healthy overrun is not
cut merely because its authored interval or the event calendar ends.

The retained owner publishes `PlaybackSnapshot.metadata` only from an installed
current admission, successful same-stream identity rebind or current metadata
refresh. Its `lineup.current` remains the actual retained source identity during
overtime, rather than the scheduled slot. Prepared metadata never enters that
snapshot. Now Playing consumers must use this current metadata seam and must not
infer a performer from the clock or scheduled selection.

Shared controls offer Video, Audio only and supported picture-in-picture actions.
Mode preference persists in browser storage with a same-session memory override
when writes fail. Restoring a preference does not start playback. Audio mode uses
currently authorized profile artwork, with an icon when no asset is selected,
and remains selected across performer changes. Phone-sized browser screenshots
and synthetic desktop HLS playback do not establish physical iPhone/Safari,
lock-screen, background or hardware-volume behavior.

## Server configuration

These are Convex backend environment variables owned by the VRDex operator.
Admission is disabled unless explicitly enabled with all three positive integer
limits. Missing, zero, fractional, negative, or above-bound values fail closed.
Task 7 release controls must align with these limits before any live enablement.
No configuration in this implementation enables production admission.

| Variable | Default | Accepted values |
| --- | --- | --- |
| `MEDIA_RELAY_ENABLED` | disabled | Exactly `true` enables admission subject to all limits. |
| `MEDIA_RELAY_MAX_SOURCES` | 0 | 1–1,000 concurrent queued/starting/ready/recovering/draining source rows. |
| `MEDIA_RELAY_MAX_GRANTS` | 0 | 1–10,000 unreleased, unexpired grants globally. |
| `MEDIA_RELAY_ADMISSIONS_PER_MINUTE` | 0 | 1–10,000 successful admissions in a rolling 60,000 ms global window. |
| `MEDIA_RELAY_PLAYBACK_ORIGIN` | unset | Operator-controlled HTTPS base URL, without credentials, query, or fragment. |

Limits use bounded indexed reads and Convex transaction conflict detection,
matching existing backend quota conventions. Release returns grant capacity but
retains admission history for the rolling rate limit. Source idle lifecycle and
grant cleanup belong to the following relay lifecycle work. Public page reads
and grant polling never renew source activity; native playlist requests sustain
an admitted source in the delivery layer.

A source in `ready` state returns capability URLs under
`<origin>/p/<grantId>/video/index.m3u8` and `/p/<grantId>/audio/index.m3u8`. Missing delivery origin
keeps admission preparing; delivery implementation must use this same route
contract and call internal `resolveGrant({grantId, now})`. `now` is trusted server
time, never a caller-controlled expiry override. An off switch denies existing
grants as well as new admissions. These variables contain no credentials;
recreation means restoring reviewed operator configuration, and no key rotation
is required. Grant handles are server-generated cryptographic UUIDs and must be
treated as bearer capabilities rather than logged or exposed in page data.

## Shared worker ownership

`mediaRelayWorker` exposes deployment-authenticated worker RPCs: `registerWorker`,
`claimSource`, `renewSource`, `observeSource`, and `releaseSource`. Every call
requires `credential`; source calls also carry `workerId`, `workerEpoch`, and
`streamKey`, with `epoch` on owner-only calls. Registration accepts the shared
`WorkerObservation` schema. These are service RPCs, not browser authorization.
The event bridge credential is never accepted as relay configuration.

The operator must provision these Convex backend release inputs before workers
can register. No values or credentials are created by this change:

| Variable | Requirement |
| --- | --- |
| `MEDIA_RELAY_WORKER_TOKEN` | Separate secret for the relay deployment. Distribute only to that deployment and the backend. Rotate by replacing both; old callers then fail closed and local leases fence. |
| `MEDIA_RELAY_WORKERS` | JSON array of unique worker bindings: `{workerId, workerEpoch, allocation: {cpuUnits, memoryMiB, evidenceId}, maxSources, draining}`. Epochs are positive integers, `maxSources` is 1–1,000, and `draining` is required. Restore from reviewed deployment configuration. |

A trusted deployment provisioner must verify the worker identity, allocation,
and evidence before writing bindings. Worker self-reported metadata cannot grant
capacity. Increment workerEpoch on process replacement; stale registration cannot
replace newer identity. Allocation must match the provisioned binding exactly.
Resource samples may be null; observed job counts never control admission.
Missing credentials or bindings fail closed. Disabling `MEDIA_RELAY_ENABLED` denies claims and renewals while still allowing
observations and release. Draining bindings deny new claims but preserve renewals
for existing owners; explicit source draining stops that source from renewing. An operator must not reuse one deployment secret with
untrusted workers: it authorizes all identities explicitly bound to that deployment.

Claims consume existing admitted source rows and count live leases transactionally
against per-worker capacity. Source epochs survive release and strictly increase
on every successful claim. Queued rows have no owner; starting, ready, recovering,
and draining may hold a lease. Expired ownership is retained only as a tombstone
until takeover or later lifecycle cleanup. Stopped and unavailable observations
clear ownership; a failure affects only that source. Release returns a source to
queued, or stops a draining source. Grant rows are independent and untouched.

Leases last 30,000 ms with renewal requested every 10,000 ms. Each source epoch
owns a separate `createLeaseWatchdog({clock, fence})`; the clock must be monotonic.
`accept(lease, sentAt)` anchors authority at the request start and subtracts a
250 ms safety tick. `check()` returns whether authority currently exists. The
independent 250 ms interval fences without awaiting renewal or cleanup. `fence`
must synchronously disable publication, then start asynchronous cleanup. Stop is
latched: a delayed response cannot revive a fenced watchdog. A replacement epoch
needs a new watchdog. The timer cannot protect against a blocked JavaScript event
loop; media output integration must respect the synchronous fence before cleanup.
