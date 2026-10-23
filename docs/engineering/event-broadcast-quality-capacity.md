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
publishing workflow guard. Export the small `packaged-files` target, then run
`python3 scripts/verify-restream-package.py EXPORT LOCKED_WHEELHOUSE OUTPUT_JSON`
from that same clean source. It compares actual exported source and installed
wheel bytes against independently hashed reviewed inputs, including native
libraries. Map/evidence documents stay outside the image.

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
