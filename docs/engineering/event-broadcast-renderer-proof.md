# Event broadcast render-clock proof

Status: local architecture evidence, October 19, 2026. This does not enable hosted
output or establish VRCDN/Twitch acceptance. The verified target is 720p30.

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
and clears buffered media, PTS, level and silence evidence. Silence accumulation requires an explicitly supplied calibrated
threshold and fresh decoded A/V; the default does not enable silence handoff.

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
  // silenceThresholdDb is omitted until calibration passes.
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
