# Event broadcast quality and capacity

Status: candidate implementation; measured production allocation is unavailable.
No preset is admitted to a new production session until its checked-in evidence
covers both audio settings and its frozen destination membership. Local media
proofs are functional diagnostics, not Fargate capacity evidence.

## Required native CI coverage

Every **Restream Local Checks** job builds the current production worker image
and runs the full deterministic transport gate with network isolation. The
46-case timing suite lives at `tests/native/event-media-timing.test.mjs`; its
assertions are unchanged. The packaged owner runs that file alongside
`tests/backend/event-twitch-input.test.ts` (9 cases),
`tests/backend/event-broadcast-renderer.test.ts` (22 cases), and
`tests/scripts/event-capacity-output-contracts.test.mjs` (13 cases). These 90
Node cases and 42 Python cases are all required, with their exact identities
reviewed in `.github/scripts/restream-native-names.json` against the accepted
F1 receipt. A missing, duplicate, unexpected, skipped or failed case fails CI.

The host driver is `node .github/scripts/restream-native.mjs`, after the existing
`docker build -f workers/restream/Dockerfile -t vrdex-restream-worker:ci .`.
It resolves the fresh image ID and invokes the existing CLI inside its uniquely
owned container, with `--network none`, working directory `/app`, and
`VRDEX_PROOF_INNER=twitch`. The controller can also supply an optional reviewed
finite binding context through `VRDEX_NATIVE_BINDING_CONTEXT` and its read-only
context mount. The original native132 command and assertions still run when
that context is absent, with an honest unproven/absent-binding state:

```sh
node scripts/event-twitch-input-proof.mjs --case all --output-dir /tmp/event-capacity-ci-native
```

The inner flag keeps this command local; no S3 envelope or AWS credentials are
used. The native gate regression result remains separate from conditional
measurement and capacity admission. The
[conditional native-binding source path and separate readback scopes](source-marker-qualification.md#conditional-native-binding-and-single-program-source-path)
describe the optional context and its evidence requirements. The native command
has a 360-second hard timeout, at most one second of
TERM grace, and then KILL. Bounded host commands and cleanup fit within a
400-second absolute driver deadline and a seven-minute step; the existing job
retains its 20-minute limit. A pass requires native exit zero, independent
stopped/PID-zero/no-OOM/image checks, the strict terminal receipt, cancellation
within 1500ms, closed child/process groups, successful removal and exact-ID
absence. Uncertain creation, deadline or cleanup outcomes fail. The summary
records source revision, fresh image ID, runtime versions, counts, actual native
exit, receipt verdict and cleanup; raw media artifacts are not uploaded.

The full host `pnpm verify:vrdex-mcp` → `pnpm test:scripts` chain and all other
script coverage remain required. The timing file leaves the host glob through
its directory move. Other native owner cases intentionally overlap host/backend
coverage, so host and native totals are not disjoint. The old path selector
only controls the optional gateway and local-validation steps; setup, image
build and the full native gate run even for unrelated changes.

The Dockerfile's apt FFmpeg package is not version pinned. Fresh builds test
the production worker environment, without guaranteeing the historical image
digest or FFmpeg version. This ownership change does not establish the cause of
the historical host pacing failure, resolve other host failures, or grant
production capacity acceptance. Actual CI duration and native success still
need fresh execution evidence.

## Session authority

The server snapshots `{cpuUnits, memoryMiB, evidenceId}` with media settings and
exact destination profiles. Rescheduling preserves this snapshot. Optional
output credential loss or later authoring cannot reduce the allocation. Settings
changes apply to the next session. Roll out with no active sessions, following
the existing protocol migration. Legacy sessions retain cleanup/reconciliation
projections but cannot start without a proved allocation.

The shared CLI/SDK/Lambda dispatcher validates the snapshot against its measured
map before registering a task. Both task and container receive identical CPU
and memory values with explicit units. Dispatcher CPU/memory environment
overrides are rejected. Launch markers, admission reservations, unknown-outcome
fences, client tokens and exact-task cleanup retain their existing ownership.
The minute Lambda schedule, reserved concurrency one and production admission
cap one remain unchanged.

Managed startup compares the authenticated configuration with the immutable ECS
environment snapshot and actual ECS v4 task/container metadata. Task CPU is
reported in vCPU, container CPU in CPU units; both memory values are MiB. Missing
or mismatched metadata prevents publication. The runtime shape validator imports
no measured-map data, avoiding an image/evidence circular dependency.

## Declared capacity protocol

The production matrix contains all six presets, 160/320-kbps primary AAC, and
primary-only/Twitch-simulcast cases: 24 immutable cases. Start at 4096 CPU units /
8192 MiB; diagnose failures, then repeat genuine capacity failures at 8192/16384.
Optional smaller benchmark shapes are 2048/4096 and 1024/2048. These isolated
benchmark shapes do not grant production start authority.

Each accepted matrix case has a **300-second steady dual-decode interval**.
Fixture generation, startup, B handoff, slate, offline verification and cleanup
are separate phases. A 60-second invocation is a functional smoke only. The
real worker, operator controller, input manager, Twitch wrapper, Python HLS
reader/reservoir/remux, both decoder supervisors, renderer and destination
senders run together. The fixtures independently probe as H264/AAC 1920x1080/60.
They include motion/detail, distinct source colors, a visible clock and
synchronized flash/audio markers. Preencoding finishes before steady sampling;
replayers, TLS delivery, receivers and every child still count in cgroup usage.

Healthy automatic A remains selected while eligible/prewarmed B continues to
decode. Timetable eligibility alone never promotes B. Every readiness loss in
the steady interval fails, including the standby. CPU P95 must be strictly below
80% of allocation, with complete monotonic one-second samples. Memory includes
page cache. No guessed generator or receiver overhead is subtracted. Internal
renderer delay remains below two seconds. Output validation includes actual
source/slate identity, dimensions/fps/pixel format, stereo 48-kHz AAC, active
audio bitrate, GOP, packet monotonicity/gaps, marker alignment and visual PSNR.

```sh
node scripts/event-broadcast-capacity.mjs \
  --preset 1080p60 --cpu 4096 --memory 8192 \
  --duration-seconds 300 --simulcast true --audio-bitrate 320 \
  --output-dir /tmp/event-capacity-unique-run
node scripts/event-twitch-input-proof.mjs \
  --case all --output-dir /tmp/event-capacity-transport-run
node scripts/event-twitch-input-proof.mjs \
  --case public --output-dir /tmp/event-capacity-public-run
```

The public case requires two distinct canonical logins in
`VRDEX_PROOF_PUBLIC_CHANNELS_JSON`. It records at least 1800 seconds after both
inputs become ready, privately, with no network publication sender. Real ads,
forced provider expiry and physical PC/Quest playback remain observation gaps
unless separately exercised. Deterministic cases cover TLS/DNS/redirect/nested
resource boundaries, MPEGTS/fMP4 normalization with actual decoded audio, cold
start, jitter, ads, fresh resolution after 403, deadlines and cancellation.
Named outcomes must include no skipped or expected-failure required tests. The
same nine Node acquisition-owner regressions run with built-in type stripping,
including TERM-ignoring descendants, leader exit, retries and failed cleanup.
The image also runs 22 renderer, 46 timestamp/PCM/assembler and 13 encoder/output-contract
tests: 90 required Node outcomes in total (132 with the unchanged 42 Python cases).
The [encoded fixture correction](event-encoded-fixture-correction.md) preserves
both actual continuing-train endpoint failures in a pure regression. The timing
tests include real FFmpeg conversion of 44.1-kHz
mono input to timestamped stereo 48-kHz PCM and a prewarmed 30-fps source rendered
as a 60-fps stereo program with measured markers. The buffered-start regression
uses production decoder pacing, and a separate 60-to-30 startup case checks every
selected PCM interval and complete flash/beep markers. All required cases must
pass. The expanded Node file has a 90-second deadline inside a 120-second owner
proof deadline; the transport envelope remains unchanged.
Public receipts retain bounded typed acquisition reasons and separate decoder
readiness. `realAdMarkersObserved` means an actual public HLS `ad_wait` state;
`realAdPlaybackObserved` remains false unless decoded ad playback is verified.

## Raw video assembly ownership

Each pending decoded frame uses one fresh initialized frame-sized backing.
Incoming slices copy once at the filled offset; `partial.length` exposes only
received bytes. Publication transfers that backing to the matched frame and
clears pending ownership. Supersession, reset and timing failure also clear the
pending reference without modifying retained views. The buffer internally owns
at most two nonempty frame backings: the matched frame and one pending frame.
Asynchronous encoder writes can retain older published frames under the existing
writer queue bounds, so published storage is never recycled.

Twelve child-free assembler regressions cover split and multiple frames,
Buffer/Uint8Array ownership, metadata ordering and its 128-entry cap, immutable
retained views, reset/failure and nested publication errors. The repair removes
repeated-prefix copying; it does not establish a runtime speedup or passing
1080p60 allocation. The preserved Ruling 31 concat-byte inference describes the
old pinned implementation and cannot measure this assembler unchanged. Exact-image
media and capacity checks remain required under the existing gates.

## Evidence and cleanup

Every deployed proof requires a unique `VRDEX_PROOF_RUN_ID` beginning `task6-`
and the exact artifact root
`s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks`.
Uploads use private SSE-S3 objects. Required recordings are split into 32-MiB
parts with byte counts and SHA256 hashes; a manifest covers the whole recording.
A skipped oversized file, missing artifact, failed upload, missing terminal
receipt or live child cannot pass. No raw provider text, token or signed locator
belongs in a receipt.

Capacity inner deadline is steady duration plus 600 seconds, with at most 180
additional seconds for finalization; recording/upload cap is
`(steady seconds + 180) * 1,500,000` bytes. The public workload has a 2100-second
inner deadline, 180-second finalization budget and 1700-MiB artifact cap. The deterministic transport workload has a 360-second inner deadline plus 180
seconds for finalization. Root
must set an outer ECS deadline and independently confirm zero exit status,
terminal artifact delivery, exact task STOPPED and definition INACTIVE. The
inner terminal file cannot attest to its own eventual upload or AWS cleanup.

Source/proof packaging uses the explicit `workers/restream/packaging-manifest.json`.
Build the committed candidate from a clean archive; preserve the main-only
publishing workflow guard. For the constrained managed Docker disk, collect an
actual-image file inventory in an isolated Fargate task. Independently compare
all 47 baseline packaged source files and 1854 installed wheel payload files (including four relocated Streamlink data files) with the
clean archive and verified locked wheelhouse, including native libraries.
The controller records that comparison and the inventory artifact hash before
accepting the image. The small `packaged-files` export and
`verify-restream-package.py` remain an alternative when sufficient disk is
available; neither verification route may substitute repository declarations
for bytes actually read from the built image. Map/evidence documents stay outside
the image.

Record the immutable image digest, candidate revision, package/lock hashes,
actual task/container shape, all attempts and failures, phase times, resource
samples, output facts, complete artifacts and terminal provider readbacks. Task 7
changes runtime telemetry bytes; Task 9 must repeat affected exact-image and
capacity gates on the final reviewed image rather than inheriting candidate
coverage across different digests.

## Preserved image failure

The first candidate image `sha256:d136dfc9437a02908a2844d61107a265d182eb4eb974a325217dfbeb1e71685a`
failed two of 42 Python contracts; all nine Node owner contracts passed. The
[sanitized receipts and cleanup readbacks](./evidence/twitch-operator-task6/transport-d136dfc.json)
retain that negative result and the focused experiments on the same image.
The ad-deadline child imported its TLS fixture before activating private Python
dependencies, causing a `requests` import failure. FFmpeg 5.1 continued copying
Opus after a codec-whitelist error. Adding global `-xerror` rejected that input
with nonzero exit and zero output, while AAC TS and fragmented MP4 retained
192,000 bytes of decoded PCM each without decoder errors. The candidate applies
that flag and imports the package bootstrap before the fixture. Its regression
requires zero output for unsupported audio and retains real AAC decoding checks.
The original receipt incorrectly labeled the Python failures `owner_contracts`;
the corrected classifier retains the failing Python phase even when Node passes.
These diagnostic experiments do not replace a rebuilt-image deterministic gate
or establish capacity. All three diagnostic tasks stopped, their definitions
became inactive, and their network interfaces were absent at cleanup readback.

## Isolated functional failures

The next image `sha256:7046ad0634866ba48e4f4db94c4caff95916addac6f23b3031b9e54a805eb5aa`
passed all42 Python and9 Node owner contracts, then failed the60-second
480p30/simulcast/AAC320 functional case at both4CPU/8GiB and8CPU/16GiB.
[Preserved functional receipts and decoded marker timestamps](./evidence/twitch-operator-task6/functional-7046ad.json)
show zero readiness loss and valid output identity/format/quality in both cases.
CPU P95 dropped from86.44% to23.14%, but measured A/V drift remained above100ms.
Decoding the complete recordings with original timestamps places the lag in the
program before destination sending; independent seeking accounts for only about
6–16ms of measurement difference. These failures admit no production allocation.

The isolated proof harness accepts an explicit supervisor factory for diagnostic
observation. Its default remains the production supervisor. This lets an observer
record decoded timestamps and retained audio at the existing process/buffer
boundaries without changing production behavior or trusting a resource override.
The subsequent actual-image diagnostic completed that correlation. Its
[typed evidence](./evidence/twitch-operator-task6/av-timing-cf8cd9f3.json)
retains the verified full trace hash, source baselines and original failed
workload. Both source fixtures measured audio-minus-video at -1.333 ms. At
selected ticks, retained PCM was about 225 ms long and its oldest samples were
about 150–155 ms behind the latest video; newest PCM already covered the video
PTS. The old buffer selected the oldest PCM against the newest video. Additional
CPU could not correct that timestamp mismatch.

The candidate decoder associates video and PCM bytes with exact integer PTS,
using 1/90000 video and 1/48000 audio timebases. Audio is normalized to stereo
48 kHz before timestamps/sample counts are emitted on a separate metadata pipe.
Each metadata queue is limited to 128 entries, stderr lines to 4096 bytes and
audio metadata lines to 1024 bytes. Malformed or overflowing timing fails closed.
Readiness requires matched frames and fresh audio timestamps; unmatched raw
arrivals cannot refresh stale media. Raw retention stays at one matched frame,
one partial/pending frame and 250 ms of PCM.

Actual source identity transitions, resume and decoder resets invalidate the
playback anchor. Audio starts at the selected frame PTS, then advances on a
continuous sample clock. Repeated selection and duplicated 30-fps video in a
60-fps program do not replay PCM. Timestamp overlaps are skipped and explicit
gaps produce silence. Ordinary video jitter does not resnap audio each tick. Draining the PCM queue
cannot revoke still-fresh matched decoder evidence, and a forward jump between
retained video frames is not itself a decoder reset. These false reset paths were
reproduced and corrected during host integration.

The [preserved host negatives](./evidence/twitch-operator-task6/timing-host-negatives.json)
include the same recording measured by the old independent-seek verifier at
330 ms and by original-timestamp decoding at 133.33 ms, still outside the gate.
The corrected proof decodes without seeking, with video passthrough and separate
numeric metadata pipes. It checks every marker in the declared six-second A and
B windows, reports their absolute source ranges and payload completeness, and
uses the maximum absolute drift. Real FFmpeg regressions retain known aligned,
150-ms delayed/advanced and marker-straddling-gap cases; the latter measures about
384 ms and remains a failure. No favorable subset or relaxed limit is used.
After correcting false resets, the full host workload retained 60 samples,
zero steady readiness losses and clean teardown. B measured 33.33/44.83 ms;
A still failed at 125.67/113.83 ms. A subsequent regression also corrects the
future-cursor case when playout outruns newly retained PCM, preserving the
approved reanchor-on-retained-range-loss rule. A smaller real 30-fps-mono to 60-fps-stereo host path also measured
100.667 ms and failed the unchanged limit; it remains a required image test.
No production shape is admitted from these host results. Isolated exact-image timing remains an unresolved gate.

Rebuilt-image transport and strict output/capacity gates remain required; the
correction itself establishes no production allocation.

## Preserved actual packetization failure

The timestamped candidate image `sha256:870142421409fdcb1d7f58a7f078ef0f39f5249d4b41b1c689ea4983e472afc7`
failed the required 30-fps mono to 60-fps stereo case at both four and eight CPUs.
Three subsequent isolated traces preserved the same missing pulses. Their
[typed failure receipts and copy accounting](./evidence/twitch-operator-task6/packetization-870142.json)
show complete decoded PCM and metadata, with all children and cloud resources
closed. Successful diagnostic collection is not successful playback.

| Observation                                | Measured result                                                     | Consequence                                               |
| ------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------- |
| Default fixture AAC packetization          | 42 PES groups of 16 frames, plus groups of 13 and 6                 | Most audio groups span 371.5 ms                           |
| Audio position behind preceding video DTS  | 271.6–304.3 ms for full groups                                      | Paced file decoding delivers old audio after newer video  |
| Raw PCM and metadata gaps                  | Both approximately 337 ms at P95                                    | Raw PCM output flushing is not the demonstrated cause     |
| Decoded pulses near source seconds 3 and 6 | 4,938 detected sampleframes each, zero copied in all three attempts | Tail limits and the advanced cursor discard expired audio |
| Encoded output                             | Eight flashes, six beeps; exact silence around two interior flashes | The strict synchronization gate correctly remains failed  |

The default-muxed file bypassed the normalized packetization used by the Twitch
remux command. An offline control with that exact command preserved all 480 video
and 691 audio packet payload hashes and all sixteen marker pairs, while changing
the output to 691 single-frame AAC PES groups. This control ran on host FFmpeg
7.1.5, not the image's 5.1.9. It establishes a file-delivery distinction, not a
claim that arbitrary bursty live inputs are lossless.

The positive conversion fixture now uses the production remux output settings
`-muxdelay 0 -flush_packets 1`. Its media, encoder settings, paced decoding,
measurement window, marker requirements and 100-ms limit are unchanged. A packet
regression compares both layouts and their encoded payloads; a separate regression
preserves gap silence, expiration skipping and the 250-ms PCM bound. No runtime
cursor, buffering, profile or readiness behavior changes for this correction.
The original recordings and all three failures remain negative evidence.
New exact-image transport, functional and capacity proof is still required.

## Measured allocation status

| Preset  | Primary only | Twitch simulcast |
| ------- | ------------ | ---------------- |
| 480p30  | Unproved     | Unproved         |
| 480p60  | Unproved     | Unproved         |
| 720p30  | Unproved     | Unproved         |
| 720p60  | Unproved     | Unproved         |
| 1080p30 | Unproved     | Unproved         |
| 1080p60 | Unproved     | Unproved         |

This table and the production map must be populated together from passing
controller receipts before Task 6 completion. No production deployment is part
of the benchmark work.

## Decoder pacing correction awaiting image qualification

The decoder consumes buffered normalized input at readrate 1. No buffer, cursor,
FPS, freshness or render scheduling policy changes accompany this correction.
The same-image controlled experiment eliminated the observed startup acceleration
and PCM eviction/underflow in its observed interval. Its full original-PTS output
aligned all subsequent complete pulses. The original instrumented run nevertheless
passed its steady receipt while an early complete pulse had 130.667 ms audio lag.
The prior unwrapped 8-CPU 145 ms failure remains a separate negative whose exact
cause was not retrospectively established. Sanitized measured facts and original
artifact hashes are retained in
[the controlled evidence receipt](./evidence/twitch-operator-task6/decoder-pacing-control.json).

The proof now observes each actual beginPlayback through the existing supervisor
factory, preserving receiver, arguments and return. Its program tick is the frame
about to be submitted, before the renderer increments the tick. At most eight
selections retain four seconds of selected flash onsets and at most 256 decoded
source onsets each. A decoded full pulse reached by selected video must also
appear in submitted frames. Each onset includes its
source integer PTS and program tick; a pulse underway before selection is an
explicit boundary fragment. The original frame/PCM methods remain unchanged.

Full original-PTS decoding also reads source identity. First A establishes the
encoded program origin, and Take must match the same origin and submitted tick
within one output frame. Every submitted flash in both four-second transition
windows must appear in the recording. Every complete flash must have exactly one
unused audio onset within its own one-second cycle's half-period association
fence. Missing audio cannot alias the next cycle. The maximum absolute drift
includes these pairs and every existing steady-window pair, with the unchanged
100 ms gate. Missing transition coverage fails receipt admission. No existing
steady interval is shifted or shortened.

A carry-in visual fragment can legitimately outlast its source beep. That fragment
is reported, not paired with a beep one second later and not counted as a full
pulse. This does not exempt any subsequent complete selected pulse. Pacing can
preserve upstream buffered delay: renderer internalDelay measures only render
clock versus encoder progress. Absolute source-to-viewer latency still requires
the separate owned UTC observation; these controls do not establish it.

## Selection boundary in transition audio proof

The first 300-second canary exposed a proof ambiguity: its first B flash had a
correct B beep 7.333 ms earlier, plus an A beep 310 ms before the encoded B
selection. Both lay inside the half-period candidate search. The saved program
and destination recordings show this same cross-selection ambiguity; the original
failure receipt remains preserved in
[the numeric canary evidence](./evidence/twitch-operator-task6/selection-epoch-matrix01.json).

Audio candidate eligibility now begins at the actual encoded selection boundary
minus the existing 100 ms A/V acceptance allowance. An earlier onset cannot be an
accepted pair for a selected flash. This permits legitimate audio lead at the
boundary while excluding the demonstrated prior-source candidate. Every excluded
onset within the half-period search is reported by numeric PTS and a fixed reason,
with at most 128 unique exclusions per selection. Zero eligible candidates and
multiple eligible candidates have distinct fixed failure codes. The verifier
never resolves ambiguity by choosing whichever candidate is nearest.

The half-period fence, exactly-one-unused-candidate requirement, complete pulse
accounting, source-bound carry-in fragments, original timestamps and 100 ms gate
remain unchanged. Numeric regressions replay both actual recordings; an encoded
two-source regression changes the pulse phase at Take and reproduces the earlier
candidate overlap. Missing B audio, two eligible candidates, next-cycle aliases,
truncated media, watermark errors and out-of-gate offsets still fail. This is a
proof correction, not a runtime synchronization change. The original canary also
failed CPU capacity at 84.388% P95; the correction does not admit that allocation.

## Complete measured resource endpoint

A five-minute 8-CPU canary had 300 healthy samples and good media facts, but its
last resource counter timestamp covered only 299999.820467 ms. Wall time crossed
300000.245710 ms before the loop condition ran again. The strict coverage gate
correctly rejected that run; its original numbers remain in
[the endpoint evidence](./evidence/twitch-operator-task6/resource-sample-endpoint.json).

The proof cadence now stops only when the last actual counter timestamp minus the
same initial counter timestamp covers the full requested duration. If the 300th
read is short, the next absolute one-second cadence interval is read and retained,
including its real resource interval and sample row. Rows retain numeric counter
elapsed/interval times separately from the observation clock. No timestamp is substituted,
coverage rounded, interval discarded or receipt resource value normalized.
Publication, dual readiness, source identity and destination progress are checked
both before and after each counter read, before admitting that sample. Continuous
readiness-loss tracking and every existing strict gate remain unchanged.

The coordinator has a child-free regression that reproduces the wall-clock race,
requires the 301st real read, checks a nonzero initial timestamp and preserves
absolute cadence. A genuinely complete endpoint avoids an unnecessary extra
sample. A health failure during the counter read rejects sample admission. The
original short-coverage receipt still fails validation. This proof-only correction
requires a new exact image and fresh functional/long-canary evidence; the earlier
failed allocation is not admitted by changing its receipt.

## 1080p60 encoder capacity candidate and strict output facts

An actual 8-CPU/16-GiB diagnostic reproduced the program processing-budget error
with five queued raw 1080p frames and encoded progress slower than wall time.
[The sanitized diagnostic facts](./evidence/twitch-operator-task6/case21-processing-budget.json)
preserve its partial measurements and exact trace hash. Four original cgroup
reads are not steady CPU P95 or per-thread evidence. The trace identifies the
failure branch and backpressure; it does not establish the codec's bottleneck.
Both earlier 4-CPU and 8-CPU publication failures remain failed evidence.

The candidate uses x264 `superfast` only for 1080p60 in the program encoder and
optional Twitch encoder; other profiles retain `veryfast`. Two threads and all
resolution, frame rate, CBR bitrate, GOP, B-frame and audio options are unchanged.
The program keeps its explicit `zerolatency` tune; the Twitch encoder retains its
existing options without adding a tune. VRCDN still copies the program stream.
Reduced encoding effort may improve throughput, but at the fixed bitrate it can
reduce quality, especially after Twitch's second encode. This candidate needs new
exact-image media/capacity proof; argument tests cannot establish performance.
The two-second processing bound, 100-ms A/V bound and PSNR minimum of 28 remain.

Receipt validation requires finite positive numeric FPS before applying the
unchanged 0.001-fps tolerance, finite numeric audio bitrate and GOP, finite
nonnegative packet gap, an integer marker count, and a numeric compressed-buffer
measurement. Numeric strings, unavailable/nonfinite measurements and negative
gaps fail. Required destination evidence is exactly one VRCDN row, plus exactly
one Twitch row when simulcast is enabled, independently of row order. Duplicated
primary rows cannot substitute for the optional destination. Existing timing,
quality, resource, cleanup and artifact gates still apply. The production
capacity map remains empty until complete measured evidence and review.

## Source-identified proof candidate

The next proof schema uses independent700/1300-Hz source identity, original integer
PTS, complete interval accounting and strict compact evidence. Its explicit image
manifest now contains85 files; this source count has not yet been verified in an
actual image. The expanded132-case gate remains required. The separate79,996-case
qualification and all affected capacity proofs remain open. See
[source marker qualification](./source-marker-qualification.md) for contracts,
preserved counterexamples, fixed execution bounds and root-owned acceptance.

## October 24 Task 9 source status

The local migration fixture/driver and CLI pin forwarding are source prerequisites,
not capacity receipts. The production measured map remains empty. All 24 matrix
outcomes, both audio rates, destination modes, final-image inventory, immutable
image/source pins, controller cleanup receipts, the 132-outcome deterministic
gate and separate 79,996-case source-marker qualification still require actual
accepted evidence. The earlier 47-file baseline and later 85-file candidate
counts above describe their dated source/image states. The current checked-in
manifest has 88 source entries after the encoded-fixture regression; that static count is not a final-image
inventory claim. ROOT must reconcile the completed manifest with actual image
bytes and the accepted map before recording deployment readiness. Task 9 changes
no worker runtime, proof package or capacity-map bytes.
