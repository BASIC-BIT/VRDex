# Event broadcast quality and capacity

Status: candidate implementation; measured production allocation is unavailable.
No preset is admitted to a new production session until its checked-in evidence
covers both audio settings and its frozen destination membership. Local media
proofs are functional diagnostics, not Fargate capacity evidence.

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
The image also runs 22 renderer and 20 timestamp/PCM tests: 51 required Node
outcomes in total. The timing tests include real FFmpeg conversion of 44.1-kHz
mono input to timestamped stereo 48-kHz PCM and a prewarmed 30-fps source rendered
as a 60-fps stereo program with measured markers; all required cases must pass.
Public receipts retain bounded typed acquisition reasons and separate decoder
readiness. `realAdMarkersObserved` means an actual public HLS `ad_wait` state;
`realAdPlaybackObserved` remains false unless decoded ad playback is verified.

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
all 46 packaged source files and 1850 installed wheel payload files with the
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

| Observation | Measured result | Consequence |
| --- | --- | --- |
| Default fixture AAC packetization | 42 PES groups of 16 frames, plus groups of 13 and 6 | Most audio groups span 371.5 ms |
| Audio position behind preceding video DTS | 271.6–304.3 ms for full groups | Paced file decoding delivers old audio after newer video |
| Raw PCM and metadata gaps | Both approximately 337 ms at P95 | Raw PCM output flushing is not the demonstrated cause |
| Decoded pulses near source seconds 3 and 6 | 4,938 detected sampleframes each, zero copied in all three attempts | Tail limits and the advanced cursor discard expired audio |
| Encoded output | Eight flashes, six beeps; exact silence around two interior flashes | The strict synchronization gate correctly remains failed |

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

| Preset | Primary only | Twitch simulcast |
| --- | --- | --- |
| 480p30 | Unproved | Unproved |
| 480p60 | Unproved | Unproved |
| 720p30 | Unproved | Unproved |
| 720p60 | Unproved | Unproved |
| 1080p30 | Unproved | Unproved |
| 1080p60 | Unproved | Unproved |

This table and the production map must be populated together from passing
controller receipts before Task 6 completion. No production deployment is part
of the benchmark work.
