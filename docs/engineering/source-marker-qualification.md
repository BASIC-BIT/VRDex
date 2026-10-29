# Source-identified audio marker qualification

Status: unqualified candidate. This proof does not admit an allocation, start a
production session, or replace the capacity matrix. Historical1000-Hz recordings
cannot acquire source identity retrospectively. The measured capacity map stays
empty until the final immutable image passes every required gate.

## Signal and original-time evidence

Synthetic source A uses700Hz and B1300Hz. Only the fixture frequency changes;
noise, amplitude, phase, duration, encoder settings and playback remain fixed.
The classifier sees decoded mono48-kHz s16 samples and original integer audio
metadata. It does not read the expected source, selection or visual timestamps.

The RMS detector starts each480-sample block at its actual metadata-row boundary,
including short final blocks. Every sample and byte is accounted for. An episode
retains its original first-loud onset, exclusive guarded end and original row
references. A1440-sample loud run is the minimum for identity. Nominal signal
length is distinct from measured detector length: the phase-zero1441-sample
construction measures1440 loud samples, and its next one-sample block is quiet.
No marker onset is moved to improve pairing.

The classifier fits both carriers independently, including DC and sine/cosine
coefficients, over the fixed interior. It checks every48-sample residual window
at one-sample steps against the original episode, including prefixes and guards.
The residual limit remains0.14. A source requires its fit score at least0.60,
the other below0.05, finite conditioning at most100 and a complete consistent
single-carrier envelope. Whole-episode mixed energy and a separate local mixture
veto cannot be overridden by a dominant carrier. The local veto requires two
adjacent480-sample windows with major amplitude at least0.40, minor at least0.10
and ratio at least0.20. It preserves the declared30-ms quarter-amplitude floor.

Original video PTS use1/90000; audio samples use1/48000. Pairing uses the exact
integer numerator `15 * audioSample - 8 * videoPts`. The100-ms gate is72000;
the full open half-period candidate fence is360000. Every intersecting episode
is retained, including foreign/unknown/mixed competitors and competitors outside
an individual measurement window. No nearest-only pairing or future-source
exception is permitted. Genuine carry and steady-edge fragments have explicit
visual references and cannot also become full pairs. Steady full-flash selection
uses strict interior endpoints; equality at either200-ms edge is excluded.

Each record preserves every decoded identity epoch, including slate and unknown,
in an ordered immutable integer table. At most32 epochs fit inside the existing
8192-byte header/watermark/failure reserve. The predecessor comes from the actual
encoded epoch table, so A→slate→A cannot inherit the earlier A as its predecessor.
Visual IDs, original PTS spans, identity, watermarks and carry provenance are
cross-checked. Missing, duplicate or inconsistent references fail. Each marker
record is capped at512KiB and the complete capacity receipt at1MiB; exceeding a
bound fails without dropping a transition or episode.

## Preserved contract corrections

Ruling38 preserves a metadata-aligned short-tail counterexample. The phase-zero
A481 construction produces a short unknown/insufficient episode and a separate
long A episode. Both are retained and independently checked against every RMS
block, row, sample and byte. The other nine constructions retain their exact
long-source positive vectors. No detector/floor/phase adjustment was made.

Ruling43 preserves the original32-scene inventory and128 formerly unsatisfied
contracts. Six ordinary families now require their complete exact reason sets.
A future selected-source episode inside the first source's full fence remains a
foreign failure. A carry episode whose original detector block starts before
selection still intersects the first interval; it cannot be clipped or excluded.

Two postdecode structural-fault scenes explicitly change their baseline
construction to the existing absent-audio carry case. The visual and watermark
remain genuine and the audio reference is null. All three original contexts
must actually pass with no reasons before the declared one-field mutation. The
matcher reconstructs that exact structural delta and rejects unrelated changes,
a failing baseline or an editable expected-FAIL waiver. Other signals and all
association gates are unchanged. See the preserved
[contract amendment facts](./evidence/twitch-operator-task6/source-marker-contract-amendments.json).

## Exact-image execution

The separate qualification command leaves the 42-Python/90-Node owner
and acquisition gate and its deadlines unchanged. It enumerates79,996 required
IDs in83 explicit groups and294 invocations, including3,072 quarter-amplitude30-ms mixtures:

| Family | Required assertions |
| --- | ---: |
| Mass encoded classifier cases | 22,528 |
| Whole-scene association cases | 512 |
| Six-profile encoded bridge | 48 |
| Compressed1080p60 source bridge | 8 |
| Literal contracts | 56,900 |

The ID authority is
`c55078312b8e2b6d24c84f7caa82cd487b1a440da20c301ed0e69ab5f44a9f16`.
The R38 expected-contract authority was
`4056a6148c9b0b5051dc6c2d99ef0f7f8a224bc3ec08c5acb4a1e69e7aeecff4`.
The R43 expected-contract authority is
`2af9fce4e907623fa75a6f4191d102d10745d47573884e4d5553e28675993873`.
Both canonical implementations agree; matching these hashes is enumeration,
not observed qualification.

The source constructor uses actual FFmpeg seeded noise. Mass cases include the
frozen44100-mono→48000-stereo normalizer. Whole scenes pass through the actual
buffer and source-marker observer on an explicit offline ordinal timeline, then
the unchanged program and Twitch encoder builders. This tests codec behavior,
not renderer wall-clock scheduling. Profile bridges use independent42/43 channel
noise and all six real builders. The compressed bridge uses the actual12-second
1080p60 H264/AAC fixture, retains its complete original PCM/PTS baseline, submits
every second decoded source video ordinal at480p30, and submits all decoded
stereo PCM without trimming or subtracting delay. Its measured original audio
and video origins remain in the evidence. It counts2/3 AAC generations, compared
with1/2 for raw-input paths. All bridge pulses, formats, GOP, bitrate and quality
must satisfy their own gates; no source-baseline failure becomes a semantic pass.

Each result requires successful construction, complete source baseline, encoding,
probing, exact format, complete decode/coverage, original artifact SHA binding and
physical child closure. An expected semantic negative can pass only after all
nine prerequisites. Timeout, missing bytes or wrong format is incomplete.
The qualification packet adapter accounts for every declared packet, original
integer PTS/DTS, per-stream order and byte totals before marking the probe stage
complete. It never drops a malformed packet through the legacy helper.
Persisted codec rows retain all nine actual prerequisite states and point to
full SHA-bound original observations. Union validation reloads those bounded
lossless observations and re-evaluates the canonical classifier, whole-scene or
bridge contract; it does not trust a saved PASS or its summary facts. Literal
rows explicitly mark codec prerequisites as not applicable.
Mass slot evidence is derived from the full original record, continuous audio and
video metadata, and the independent detector's complete block/episode table.
Metadata-aligned blocks reconstruct the original guarded ranges; sample, byte,
frame and coverage totals must agree. The canonical train assigns each complete
episode once and binds every visual to its original frame. Copied case tables,
if supplied, must match that derivation exactly; new producers omit them.

Every unrun/failed case remains in its exact result shard; duplicate, missing,
changed or overlapping shards fail the union. Each shard has at most256
cases/256KiB, each case at most512 bytes of summarized facts. Complete scene
observations are losslessly gzip-compressed alongside original source PCM and
encoded media. The default `legacy-native-evidence-v1` policy, including
`sourceClosed` and unselected runs, allows 196608 normal/262144 final numeric
bytes with a 65536-byte failure reserve. Only the explicitly selected,
authenticated reviewed owned `trustedStackMeasurement` workload can use
`r83-native-evidence-v1`, with 1572864 normal/1638400 final numeric bytes and the
same 65536-byte failure reserve. Each policy covers the whole invocation; it
never renews per child, record or scene. Positive replay, results, receipts and
the complete held outer reservation must fit both the normal numeric budget
and existing normal aggregate budget. The failure allowance funds only negatives.

The adopted R94 result allowance applies only to privately acquired R90
PROGRAM dependencies with the matching reviewed profile, plans and intent,
owned mass invocation, `root-program-v1` producer and `root-originals-v1`
retrieval. The one exact `${recordKey}-result.json` observation may contain
262144 UTF-8 bytes including its final LF. All other chargeable outer originals
have an independent combined limit of 196608 bytes; their combined positive
reservation with the result is at most 458752 bytes. These allocations remain
inside the existing normal numeric and aggregate budgets. Native132, legacy,
sourceClosed and unselected scopes keep their previous result and reservation
limits. A second retained identity remains fully charged.

The historical R94 contract added `resultSizing` with SHA-256
`0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c` while retaining
the three historical R85 hashes. The adopted successor below replaces those
unavailable authority premises. Both G0 and G12 still require the complete 41830-byte audit
original `program-result-sizing-r94-v1`. Its exact body is checked in at
`tests/fixtures/program-result-sizing-r94-v1.txt` for source verification and
is not a packaged runtime asset. Complete design, review, adoption and source
audit originals still join through Root's proof/catalog/K and real A closure.
Genuine Root-only audit bodies stay outside N/G/O while requiring full Root
possession, hashing, storage and read work. Runtime DATA, descriptions, refs,
observations and repeated logical uses retain their ordinary charges. A is
ordinary outer data and cannot exceed 196608 bytes.

Reviewed bundle preparation supplies its explicit `execution` and `workload`
to G0. Selected R90 preparation requires the existing accepted original command;
a domain, policy ID or synthesized command cannot select the larger reservation.
Preparing K does not create privately acquired state or external approval. Real
runtime acquisition independently validates the complete actual intent again.

Raw result consumers use `replayProgramOriginal` with an owned bounded
resolver. Declared reference checks precede reads; returned type and actual
length checks precede extra copying and parsing. Resolver owners use
`readBounded` with their original deadline, cancellation and file-identity
checks, including Root's injected approval lookup. Direct object replay checks
serialized size but cannot bound allocation already performed by its caller.
From the pre-result manifest snapshot, acceptance requires
`N + M + R + O <= 1572864` and
`G + M + R + O <= invocationAggregate - 65536`; the result enters each equation
once. Source-only simulated outer admission is not actual image, media,
external approval, capacity or population-fit evidence. Larger valid semantic
shapes can still exceed the hard result bound and fail closed.

Bootstrap and each runtime original remain capped at 196608 bytes, profile and
manifest at 65536 bytes each, with at most 256 runtime entries. Invocation
aggregates remain 16MiB for mass/literal, 32MiB for association/profile and 64MiB
for compressed-source, with the failure reserve inside each aggregate. Every
full DATA logical use and actual maps-read event is charged. Only independently
semantically audited `implementationCode` bodies receive code-original numeric
treatment; their full unique bodies still require reservation in every using
invocation and group aggregate. JSON, profile/configuration and mixed authority
data remain DATA. Collector labels do not establish semantic approval. Source,
decode and result files are accounted together; an overrun makes every invocation
ID incomplete. No episode or original media is removed to make a positive fit.
Result shards use lossless gzip with the original256-KiB decompressed limit,
and retrieval validates actual compressed bytes/SHA before bounded decoding. Artifact/CPU/deadline feasibility is unproved until actual execution.

Root runs only `canary-000` first, with its four frozen representative trains.
Bulk groups require the same image/source/plan/contract pins and a complete
successful canary terminal. Root additionally verifies native STOPPED/exit,
cleanup and full original artifact retrieval before releasing bulk work. The
command cannot schedule or retry another group.

```sh
node scripts/event-source-marker-collector.mjs \
  --request /tmp/marker-qualification-request.json
```

The fixed request binds a unique `task6-…` run ID, canonical group, candidate
revision, immutable image digest and source-manifest SHA. Actual ECS metadata
must report one container at8CPU/16GiB and that digest. Source bytes, Node22.23.4
and FFmpeg5.1.9 are checked in the actual image. Original private S3 objects use
`synthetic-benchmarks/<runId>/qualification/<groupId>/`; there are no public URLs.

Each group has400 seconds of work and20 seconds for closure. The outer collector
has at most160 seconds for artifact uploads and20 for terminal upload, with an
absolute600-second process deadline. Root enforces660 seconds RUNNING plus120
seconds PENDING. Per-scene20-second, ordinary invocation90-second and compressed
360-second work limits remain. At most two media children run concurrently.
Every process owner records the isolated container baseline and PID/start-time
identities, catches detached orphans, uses bounded TERM/KILL and requires two
empty censuses. Uploads start only after media closure, own their children, and
cannot start while terminating. The128MiB aggregate includes the64KiB terminal.

The inner terminal cannot attest its own future upload or ECS STOPPED. Root
requires the uploaded terminal, uploader closure, actual exit status, inactive
definition, absent ENI and full-byte/hash retrieval independently. Local retrieval
handles one group at a time, preserving verified original private objects before
local deletion, under the frozen384MiB high-water/two-copy allowance. No script
here deletes those objects or writes a production map.

## Conditional native binding and single PROGRAM source path

### Adopted authority and reset recovery

The historical R85 design, guards and native-pins originals are historically
unavailable; equivalence is not established. The
[recovery assessment](./authority/reviews/recovery-assessment.md) and
[finite superseding amendment](./authority/program-authority-rebaseline-v1.md)
enumerate the historical R85/R94 and R76/R81/R83/R87/R90/R91/R93 original gaps.
They remain historical gaps. The amendment replaces only its named current
eligibility premises. Genuine R94 remains byte-identical, with its original
status language and all result/accounting limits. Any additional missing
normative original requires a recorded independent disposition before complete
current closure can be claimed.

The [five-row identity table](./authority/program-authority-identities-v1.json)
identifies complete Git-retained design, guards, pins, R94 result sizing and
authority-rebaseline originals. The operative DATA contract has exactly
`design`, `guards`, `pins`, `resultSizing` and `authorityRebaseline`; old, mixed,
missing or extra contracts fail. The
[exact-body disposition](./authority/reviews/rebaseline-exact-body-review.md)
and [Root adoption](./authority/reviews/rebaseline-adoption.md) identify the
reviewed successor subjects. The
[implementation review](./authority/reviews/rebaseline-implementation-review.md)
and [source verification](./authority/reviews/rebaseline-verification.md) record
their own exact subjects and limits. No source record is external prelaunch A.

After a reset, recover these exact tracked bodies and dispositions from their
recorded commits. Recompute complete byte lengths and SHA-256 against the
identity table, then compare the DATA contract and ordered references. Do not
regenerate authority from hashes, substitute generic audit bytes, or fall back
to historical constants. An edited subject needs fresh identity, review and
explicit adoption before use.

G0/G12 require all five whole originals, and G1–G11 require the whole adopted
guards original alongside their existing operands. Mandatory references require
exact kind, ID, length and hash, with no `range` property. Candidate creation,
both launch producers and independent outer replay enforce catalog membership.
Replay reopens and hashes complete source/audit originals and requires A's exact
K audit set. Catalog uniqueness does not erase repeated logical-use charges.
Materialization validates all five checked-in bodies before any output write and
returns their bytes separately from packaged runtime files. Its pending K does
not attest substantive reviews or external approval.

Root must place genuine complete disposition, adoption, implementation and
semantic-review operands in the existing proof/source/catalog/K closure and
exact A audit set. Optional K attachments alone are insufficient. Candidate
image/source/native reviews stay outside runtime and must establish actual
image/config/layers, native ELF/aliases, provider/source/Node/FFmpeg, wheel and
runtime correspondence. A source/runtime change requires a rebuilt and
reobserved image before final K and A. The 134-entry package manifest, 139-path
builder source closure and native132 identity inventory remain unchanged;
manifest-listed injected runtime files are counted and checked separately.

Actual preparation remains OPEN. The baseline correspondence inventory covers
`/app` and `/opt/twitch`; it lacks complete critical-native, loader/alias,
running `/proc` view and source/build/provider-provenance observations. The
private builder still pins revision `db9abbcd` and its 139-source tree, with no
runtime-input channel. Changed-source preparation and a bounded, separately
counted manifest-listed runtime channel require separate review. The current
`validateExecutionCommand` admits only the single-PROGRAM collector or CI
native132, and selected R83 binds one owned invocation. The group collector uses
a different command and four frozen canary invocations. Single-PROGRAM K/I/context
and R83/R94 selection cannot authorize that four-capture canary. Its command,
context and replay boundary needs a later bounded design before execution;
canary remains OPEN. This preparation gap permits no implicit widening of
commands, selection, caps or scope, and supplies no source change or new framework.

Current source verification leaves conditional PROGRAM/native132, actual
runtime/native fit, current-image correspondence and ordinary 42-Python/90-Node
execution, external A, four paired canary captures, bulk qualification and
capacity OPEN. Historical optional R93 differential skips remain unrun without
their retained baseline. The production allocation map remains empty pending
measurements. Unit fixtures now supply explicit synthetic capacity through
resolver dependencies; default production scheduling and bridge paths still
reject unmeasured configurations.

The [capacity fixture verification](authority/reviews/capacity-unit-test-seam-verification.md)
records passing host checks at `032307dd`: backend 2019/2019, scripts 979 passes
and six documented skips, MCP verification, Temporal runtime 14/14 and Temporal
inference 7/7. Actual anonymous-local Convex analysis found exactly one public
scheduling mutation and no factory or fixture endpoint. These checks resolve the
earlier host fixture failures; they supply no native execution, measurement or A.
The actual migration rehearsal's positive production admission remains blocked
by the empty measured allocation map. Incoming main `0a7231acf3eb59c5107360536a615a1f6773a19b`
adds a separate explicit `migration-admission-blocked` baseline CI lane. That lane
requires historical migration, exact production-capacity rejection, no admission
writes and owned cleanup; it rejects whole-flow receipts, and whole-flow
acceptance rejects its receipt. Its success establishes neither positive
admission nor PROGRAM/native132, measured capacity or external A. The current
[rehearsal documentation](event-broadcast-rehearsal.md#october-24-2026-task-9-source-prerequisites)
describes both scopes. The earlier verification above remains historical evidence
for its recorded source, and integration requires fresh source and execution
evidence for the resolved merge.

Before any paid continuation, Root refreshes actual spend and reservations under
the remaining $20 ceiling and $1 ancillary reserve; $1.53346 is an estimate.
Only exact A's bounded conditional step may run. After the separate canary
preparation gates close, `canary-000` must retain
all four frozen paired captures, native terminal/cleanup and two-read originals
before bulk acceptance. No retry, promotion or expanded workload is authorized.
Evidence, deadline, cleanup or budget failure leaves affected IDs OPEN.

### Conditional source path

The checked-in source supports a conditional `trustedStackMeasurement` path
under an explicitly reviewed platform/vendor premise. Both
`nativeBindingVerified` and `loaderComplete` remain false. The strict
`sourceClosed` branch retains its missing-premise failures. Source-review
acceptance does not establish an actual profile, image, native run or allocation.

The [reviewed-bundle materializer](../../scripts/event-marker-native-bundle.mjs)
binds complete runtime originals, source closure and audit references into K.
It requires real complete inputs; its output cannot generate external Root
approval A. The [ECS request producer](../../scripts/event-marker-native-ecs-controller.mjs)
binds the selected workload, image and exact request bytes. The
[single-PROGRAM collector](../../scripts/event-marker-program-collector.mjs)
calls the [acquisition entrypoint](../../scripts/event-marker-program-acquire.mjs)
for the unchanged `mass-320-48000stereo-073` PROGRAM request. This source path
uses checked-in components and does not depend on private helper recipes.

Independent [PROGRAM replay](../../scripts/marker-qualification/program-replay.mjs)
reacquires the binding and requires the complete public-frontdoor graph:
request/use and prebinding originals, both full noise originals and their owners,
both metadata originals and their owners, and full encoder/decoder originals.
No missing optional file or collector label can select a weaker graph. The
[common outer verifier](../../scripts/event-marker-native-controller.mjs) then
joins K/source/audit, actual launch/readbacks, original inventories and real
external Root A. Materializer outputs and local/helper receipts remain pending
until those actual joins pass. Absolute deadlines, owned cleanup and cancellation
remain mandatory through collection, upload, retrieval and final publication.

One unchanged PROGRAM acquisition does not qualify the four-train canary,
paired captures, native132, bulk or capacity. There is no automatic retry or
promotion. The complete 79,996 IDs, 83 groups and 294 invocations still require
the actual first four paired captures before bulk under the existing gates.

### Separate readback scopes

CI native132 finite-binding auxiliary readback uses a finite inventory and at
most 8,388,608 combined archive bytes, including all framing, with an independent
1,048,576-byte parser bound. The controller copies exact listed members; the
allowance never resets per copy. Engine auxiliary readback retains this 8MiB
limit and grants no measurement admission. See the
[CI producer](../../scripts/event-marker-native-ci-controller.mjs),
[Engine readback](../../scripts/event-marker-engine-readback.mjs) and
[independent native132 replay](../../scripts/event-marker-native132-replay.mjs).

Root qualification original retrieval retains its separate 134,152,192-byte
payload plus 65536-byte terminal limit, totaling 134,217,728 bytes per group and
at most 257 objects. The checked-in
[Root wrapper](../../scripts/event-marker-root-retrieval.mjs) and
[retrieval library](../../scripts/event-marker-root-retrieval.py) require actual
STOPPED, definition INACTIVE and ENI absence, two full reads of every original,
and timely successful helper completion independently retained by Root. The
existing 512MiB free-before, 128MiB free-during and 384MiB local high-water limits
remain. A provisional helper file cannot attest its actual return or cleanup.
Both readback scopes retain full hashes, EOF, actual owner/cleanup, deadline and
exit evidence. These are engineering evidence protocols, not operator product
flows or authority to delete private originals.
