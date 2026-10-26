# Event broadcast render-clock proof

Status: retained local architecture evidence from October 19, 2026, with the
October 22 passing bounded silence-policy proof below. The historical 720p30
render-clock results retain their original scope. Provider/device acceptance
remains separate.

## October 23 nonblocking input and operator proof

The worker now separates transport preparation, decoded readiness, durable
promotion, and encoded confirmation. One input manager owns current/candidate
acquisitions. The renderer owns corresponding decoders. Each counts retiring
resources until physical closure, so replacing a slow candidate cannot create a
third acquisition or decoder. A lazy VRCDN route admits one upstream connection,
including pending DNS and closing sockets; Twitch retains its own reconnect loop.
The immutable session media settings bind before any acquisition starts.

The operator controller never waits for transport readiness, retirement, Begin,
promotion, or acknowledgement from a worker tick. Backend protocol v2 owns the
committed intent, pinned target and original preparation deadline. Local receipt
adds a conservative 15-second cap without extending the backend deadline on
refresh, retry, promotion or takeover. Fresh configuration can confirm a promotion
before its RPC reply without losing the receipt. Obsolete callbacks cannot select
media or clear newer operations. Encoded acknowledgement retries preserve the
original source/revision/slot and output watermark.

Ordinary Start/admin receipts use one ordered controller slot. Program reporting
waits for unresolved receipt evidence while lease renewal, configuration, and
emergency controls continue. An unknown transport outcome retries the exact
frozen payload, even if the command disappeared from later claims. An explicit
stale reply is reconciled with a later claim before rebuilding encoded evidence;
it does not mark a still-claimed command complete. Source-control promotion may
overtake Start. Unsupported admin actions settle as failed without successful
media observations. Real Convex tests cover these receipt/report races separately
from the synthetic recording authority.

Cut changes local committed intent and holds the renderer immediately. Stop
fences publication before cleanup. Cancel retires the candidate while keeping the
committed source. Manual intent survives fallback and recovers its pinned source;
Return to auto in a timetable gap commits automatic slate before future standby
work. Decoded readiness still requires progressing audio/video within one second,
and decoder startup/stall still has its five-second guard.

Local host verification used Node 24.19.0 and FFmpeg 7.1.5, with synthetic control
and local transports. The command recording proved failed B preparation preserves
A, explicit retry selects B, Return to auto returns A or gap slate, and Cut during
an unresolved third-source request stays slate after its late readiness callback.
Independent decoded frames were blue `[1, 0, 255]`, red `[254, 0, 0]`, and final
slate `[30, 27, 31]`. Sixteen post-Cut output watermarks advanced on slate; three
lease renewals completed. The 720p30 recording had a 34-ms maximum packet gap and
a one-second GOP, with AAC at 48 kHz.

The silence proof uses the supported **480p30** preset, keeping its 180p15 source
fixtures. It retains quiet AAC/PCM around -81 dBFS, measures digital zero at
-120 dBFS, resets silence after an audible burst, and checks timetable eligibility,
final/disabled/unready successor retention and manual hold. It independently
decodes blue after the eligible silence handoff and neutral slate after Cut.
Historical small-profile evidence below remains historical; production profile
validation accepts exactly the six supported presets.

Run the lifecycle tests and local proofs with:

```bash
node --conditions=import --import tsx --test tests/backend/event-broadcast-input-manager.test.ts tests/backend/event-broadcast-worker.test.ts tests/backend/event-broadcast-renderer.test.ts tests/backend/event-broadcast-relay.test.ts tests/backend/event-broadcast-policy.test.ts
node scripts/event-command-local-proof.mjs
node scripts/event-silence-local-proof.mjs
```

All worker constructor callers use an input manager. Local proofs share
`scripts/event-proof-fixtures.mjs`, which supplies synthetic immediate handles and
an in-memory v2 authority; production has no acquisition/interpreter fallback.
The image installer explicitly packages that helper and both required proofs,
and excludes server-owned allocation configuration from its runtime module glob.
Actual Node 22/deployment-image execution, direct-provider acceptance, sustained
six-preset capacity and device observations remain separate gates. These local
recordings establish lifecycle correctness, not those acceptance claims.

## October 22 automatic-silence proof status

The current implementation resolves missing/empty event policies to below -90 dBFS
continuously for 15 seconds. The bounded decoded-media proof passed and the
backend policy deployed successfully. No event session was started to observe a
production worker applying the policy.
There is no host calibration toggle. Maximum overrun remains optional/unset.
Silence handoff requires automatic mode, matching fresh progressing decoded A/V,
sustained analysis and an authored-eligible fresh decoded-ready successor. Manual
selection and Hold prevail. Reconnect/failure clears evidence; no ready successor
means the current source stays selected. Changing a threshold requires restarting
the session for matching decoder analysis.

The bounded `scripts/event-silence-local-proof.mjs` run passed in 85.561 seconds at
320x180/15fps, using actual AAC/MPEGTS, AAC 160 kbps/48 kHz stereo and the unchanged
factory decoder. The -81 dBFS quiet tone measured -81.018 to -80.869 dBFS and stayed
selected for 16.068 seconds after the boundary. Digital zero measured -120 dBFS
and qualified the 15-second rule. Short pauses, audible reset, pre-boundary
silence, final slot, disabled/unready successor and manual `hold_current` retained
the source. Automatic promotion then encoded blue B, and final manual Hold encoded
slate. The 4,707 packets had maximum gap 66.667 ms and maximum GOP one second.
Recording SHA256 is
`39f374b6cc81b9923660c8441aac1238d3482fc189a29ec0a8f1c20841efd423`.

The receipt at `/workspace/rehearsal-sdd/persistent-silence-proof.json` retains
measurements. `/workspace/rehearsal-sdd/persistent-silence-failed-attempts.json`
retains resource-bound 720p/640x360 attempts, a corrected harness expectation in
manual mode and a failed slate-to-auto decoder restart at 320x180. The final
passing sequence puts slate last and avoids that restart. Recovery from that
restart failure remains unproven, with no media module changed. This synthetic local proof does
not establish production-resolution capacity or a real-music false-positive rate.
Production retains its reviewed 720p30 image and 4 CPU/8 GiB allocation.

The minute Lambda dispatcher runs ordinary one-pass reconciliation without global
drain on completion, timeout or replacement. Worker leases, emergency SSM
publication control and the 12-hour session limit remain independent. Production
cutover confirmed the old idle ECS dispatcher STOPPED at 15:55:03.348 UTC on
October 22; a manual Lambda poll completed at 15:56:20.866 UTC and the first
observed scheduled poll completed at 15:58:07.905 UTC. The next scheduled passes
at 15:59:06.701 and 16:00:08.748 UTC also completed. Actual runtime SDK imports and
secret fetch passed. The backend policy deployed with Convex CLI exit 0, and
`VRDEX_EVENT_BROADCAST_SILENCE_CALIBRATED` was read back absent at
`2026-10-22T16:04:06.604Z`; concurrency one and the 43,200-second bound remained.
No event was selected or started, so production worker configuration and silence
handoff were not directly observed. See
[integration verification](event-broadcast-verification.md#persistent-dispatch-and-automatic-silence)
and [deployment](../deployment/restream-worker.md#persistent-event-dispatcher-deployment)
for current dispatch, recovery, artifact and cutover details. The sections below
preserve the original architecture proof, including its then-disabled silence
setup; that setup is superseded by the effective policy above.

## Why the POC graph was replaced

The read-only POC inspected in `workers/restream/vrcdn-poc.mjs` normalizes two live
inputs and a hold source into `streamselect`/`astreamselect`. The failure proof
reproduces that graph with labeled red/blue UDP MPEG-TS publishers, using the
existing `FFmpegProcess` helper from `live-control.mjs`. ZMQ responds successfully
before publisher loss. After stopping both publishers, output remains at 9,088 ms
through the subsequent observation window and the command selecting hold times
out. A connected but nonproducing input can block both the program and its control
filter. An always-running hold input does not fix that graph's dependency.

The baseline harness uses Python's standard-library `ctypes` with system libzmq;
this environment has FFmpeg's libzmq support but no Python `zmq` package. Production
rendering requires neither Python nor ZMQ.

## Isolated media path

`input-supervisor.mjs` gives each authorized source its own FFmpeg decoder. It
normalizes video into YUV420p and audio into 48 kHz stereo signed 16-bit PCM. Only
one complete latest video frame plus a partial frame is retained. PCM retains a
250 ms tail (48,000 bytes), plus at most three partial stereo-sample bytes. Pipe
chunks are consumed continuously, including while the source is prepared but not
selected. Old media is discarded; source loss cannot stop the program clock.

Readiness requires at least two decoded frames, fresh video and audio (under one
second old), and an increase between two distinct decoded video PTS from FFmpeg
`showinfo` in the current connection epoch. The first PTS only establishes a
baseline. Repeated initial PTS cannot establish readiness, including after
reconnect. Observations bind `slotKey` and `sourceId` and use the provided
monotonic clock. Missing/stale media produces a persistent `failureSince`.
Recovery clears failure evidence. Reconnect starts a new failure-evidence epoch
and clears buffered media, PTS, level and silence evidence. Silence accumulation
requires a supplied threshold and fresh decoded A/V. The standalone decoder does
not choose event policy; the worker supplies the effective Convex policy. The
original proof below omitted that threshold and did not test automatic silence.

A decoder with no progressing A/V for five seconds is killed. Reconnect delays are
1, 2, 4, 8, then 10 seconds, reset after ten seconds of healthy connection.
`reconcileSources` serializes configuration refreshes and awaits obsolete decoder
termination before creating replacements. It rejects more than two inputs or
duplicate slot keys, including when calls overlap.

`program-renderer.mjs` owns a monotonic frame clock, a neutral hold slate, silence,
and one persistent H.264/AAC MPEG-TS encoder. Each tick chooses fresh decoded media
or hold, independently of decoder sockets. Frame and PCM queues into FFmpeg have
explicit high-water limits. More than two seconds of missed clock work is a fatal
session error, rather than unbounded accumulation. This is an overload guard;
Task 5 must handle `onError` by stopping the session and releasing its inputs.

Encoding preserves the POC's four dimension/rate/bitrate profiles, with a
one-second GOP for VRCDN, AAC 160 kbps, 48 kHz stereo, and a two-thread `veryfast`
x264 encoder. Raw PCM input probing is explicitly bounded: the default FFmpeg
probe otherwise deadlocked initial audio/video pipes during the first rehearsal.
Hard cuts are intentional; there are no fades in this implementation.

## Worker and sender API

```js
const renderer = createProgramRenderer({
  quality: '720p30',
  onProgress: ({ outputMs, wallElapsedMs, delayMs }) => {},
  onObservation: observation => {},
  onError: error => {},
  // Current workers supply the effective policy threshold.
  // This historical render-clock example omits silence analysis.
});
renderer.subscribe(mpegTsChunk => sender.enqueue(mpegTsChunk));
await renderer.reconcileSources([
  { slotKey: 'slot-1', sourceId: 'source-1', url: authorizedMediaUrl },
  { slotKey: 'slot-2', sourceId: 'source-2', url: authorizedNextUrl },
]);
await renderer.start();
const accepted = renderer.selectSource('slot-1');
// accepted is readiness/selection acceptance, NOT an output acknowledgement.
const state = renderer.getState();
// Acknowledge only after state.renderedSlotKey AND state.renderedSourceId match.
renderer.hold();
await renderer.stop();
```

`getInputs()` returns supervisors with `source`, `buffer`, `start()`, `stop()` and
`getObservation()`. Observation fields are `slotKey`, `sourceId`, `observedAt`,
`ready`, `progressing`, `analysisActive`, and optional `failureSince`, `audioLevelDb`,
`silenceSince`. The standalone supervisor accepts `source`, optional `quality`,
`clock`, `onObservation`, `ffmpeg`, and `silenceThresholdDb`.

`getState()` reports requested `selectedSlotKey`, encoded `renderedSlotKey` and
`renderedSourceId`, `outputMs`, `running`, `error`, `ticks`, and `videoQueueBytes`.
Selection acknowledgement waits for measured encoder progress to cross the frame
submitted with that identity. Hold has undefined rendered identities. Source
identity is preserved even when the same slot is configured with a replacement.
A stopped renderer cannot restart; create a new renderer for a new session.

`subscribe` returns an unsubscribe function and delivers encoded MPEG-TS chunks
without waiting for destinations. Subscribers must synchronously enqueue into
bounded independent sender queues and must not block or throw. Senders must wait
for transport headers/keyframes on attachment or reconnect; the program repeats
MPEG-TS headers and provides one-second keyframes. Per-destination remuxing,
credentials, reconnection and health belong to Task 6, not this renderer.

## Reproduction and evidence

Run from the repository root with Node and FFmpeg on PATH:

```sh
node scripts/event-broadcast-failure-proof.mjs --baseline
node scripts/event-broadcast-failure-proof.mjs
node --import tsx --test tests/backend/event-broadcast-renderer.test.ts
```

The default isolated scenario runs for 180 seconds. It starts both real UDP feeds,
selects A, kills A, verifies failure, stalls B, rejects B as unready, resumes B,
waits for actual decoded recovery, selects B, restarts A, switches repeatedly,
shows hold, and releases obsolete A. The recorded program is decoded again to
verify red A pixels, neutral hold pixels, blue recovered B pixels, silent hold,
and audible recovered B. FFprobe checks every stream's packet DTS for regression
and the maximum keyframe interval. Encoder progress checks every gap and wall-clock
processing delay. Results and the MPEG-TS file are in `/tmp/event-broadcast-proof`.
`PROOF_SECONDS` allows shorter diagnostics; only the default 180-second run is the
sustained acceptance check. `PROOF_QUALITY` and `PROOF_PORT_BASE` select exploratory
profiles and distinct local ports.

Host: FFmpeg 7.1.5 (Debian 13), Node 24.19.0, five available CPU cores. The worker
image remains Node 22 / Debian bookworm. Its runtime and FFmpeg version have not
been tested here; all production code uses Node 22-compatible APIs, but container
acceptance remains a rollout gate.

The first 180-second 720p30 run (two-second GOP, before the provider keyframe fix)
produced 719 progress samples and 180,033 ms of output with maximum measured delay
143.326 ms, no packet DTS regression, hold RMS 0, and recovered audio RMS 0.0564.
The full backend suite passed 1,560 tests; backend typecheck passed. The final
one-second GOP run and focused test totals are recorded below.

An exploratory concurrent 1080p60 run failed the two-second processing-budget
guard within 15 seconds. Its aggregate process CPU time and concurrent load do
not establish a dedicated-event capacity measurement. No 1080p60 performance
claim is made. The intermediate 720p60 and 1080p30 profiles are preserved but not
verified. Reprofile on the actual worker before advertising a higher quality.

Costs/tradeoffs: separate decode processes, substantial raw video copying across
pipes and Node, latest-frame drops rather than source backpressure, up to 250 ms
of queued audio, conservative readiness requiring both audio and video, and a
hard failure on encoder overload. These are deliberate bounds. This local proof
uses simple labeled sources; it does not measure high-motion encoding load,
provider transport latency, public delivery, multi-hour memory behavior, or
sender isolation. Those acceptance gates remain separate.

Final one-second-GOP acceptance run: **180 seconds at 720p30 passed**. It produced
720 measured progress samples and 180,033.333 ms of program media. Maximum
processing delay was **129.745 ms**, below the 10,000 ms requirement. Maximum
keyframe interval was 1.0000000000000004 seconds (floating-point representation).
All packet DTS checks passed; decoded source/hold colors matched, hold PCM RMS was
0, and recovered B RMS was 0.0563994. The program stayed decodable through death,
stall, recovery, repeated selection, and obsolete-input release. Final focused
suite: **11 passed, zero failed**. No high-quality or provider acceptance claim
is inferred from this result.

Review regression verification: startup and reconnect with repeated initial PTS
are rejected until a distinct increasing PTS arrives. Focused suite: 13 passed.
A subsequent 60-second real-source death/recovery rehearsal passed with 240
progress samples, maximum delay 127.548 ms, one-second keyframes, valid packet
DTS, visible hold, and recovered audio RMS 0.054497.
