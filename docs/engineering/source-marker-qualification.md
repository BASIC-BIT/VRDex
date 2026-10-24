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
IDs in83 explicit groups, including3,072 quarter-amplitude30-ms mixtures:

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

 Every
unrun/failed case remains in its exact result shard; duplicate, missing, changed
or overlapping shards fail the union. Each shard has at most256 cases/256KiB,
each case at most512 bytes of summarized facts. Complete scene observations are
losslessly gzip-compressed alongside the original source PCM and encoded media;
compressed observation bytes and all final result shards together remain
subject to the frozen262144-byte invocation numeric cap. A65536-byte failure
reserve sits inside both numeric and aggregate invocation caps. Source, decode
and result files are accounted together; an overrun makes every invocation ID
incomplete. No episode or original media is removed to make a positive fit.
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
