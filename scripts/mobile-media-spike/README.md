# Mobile media spike

Throwaway investigation, not a shipped feature. No lineup policy changes,
production relay, backend bindings or new dependencies.

Run from the repository root with Node 24 and installed workspace dependencies:

```sh
node scripts/mobile-media-spike/server.mjs
```

In the managed cloud environment, first run `source /workspace/vrdex-env.sh`.
On a local PC, use the repo's normal Node/pnpm setup and `pnpm install`.
Set `FFMPEG_PATH` to the full FFmpeg executable path on Windows so both the
HLS generator and reused MPEG-TS fixture use the same executable.

## Local-thread handoff

Continue this experiment, not production implementation. Scope is PiP and
uninterrupted audio across app switching and phone lock, with HLS comparison.
Keep each site area's existing lineup behavior; do not add background DJ switching.

Start this script locally and expose port 4320 through a trusted HTTPS tunnel
for the phones. There is no need to start Next.js or Convex. The harness uses
continuous FFmpeg subprocesses and local temporary files, so it is not directly
deployable as a Vercel static site or ordinary serverless function. A hosted
version would need a separate media origin or pre-generated test media.

Next work: collect physical-device evidence below, check a known active VRCDN
source for HLS, then propose the smallest production change supported by those
results. Existing browser evidence does not establish locked-phone audio.

Open `http://127.0.0.1:4320`. FFmpeg must be installed. Stop with SIGTERM or
Ctrl+C. Each invocation owns a temporary HLS directory and removes it on shutdown.
The reused MPEG-TS fixture has a ten-minute lifetime; restart before a longer
MPEG-TS device run. HLS continues until shutdown.

The three modes compare the unchanged production MPEG-TS transport and custom
fetch loader with native live HLS video and native live HLS audio-only. Native
HLS capability is detected; unsupported browsers log that result rather than
silently substituting JavaScript HLS. HLS is synthetic and locally encoded,
not proof of a VRCDN HLS endpoint or production relay capacity. The harness
uses native video controls, unlike the site's custom controls, and does not
exercise the lineup's Web Audio routing.

For a phone, use an approved HTTPS forwarding mechanism that reaches this
loopback server. The phone cannot use the cloud machine's localhost URL.
All browser media requests use the same origin. No forwarding is configured
by this script. HTTPS is needed for a representative Media Session test.

## Device acceptance still required

On physical iPhone Safari and Android Chrome, separately test all three modes:

- Start with a deliberate tap; enter PiP and switch apps.
- Lock for 15–30 minutes and listen for interruption.
- Exercise lock-screen and headphone play/pause controls.
- Return from PiP, resume after interruption and change Wi-Fi/mobile networks.
- Download event evidence and record device, OS, browser and audible results.

Timer samples and progressing video timestamps do not prove audible output.
Headless Chromium and mobile viewports do not prove mobile OS suspension behavior.
Automatic lineup transitions remain outside this experiment.

## Initial evidence, 2026-10-27

- Chromium played synthetic MPEG-TS using the production transport and entered
  real browser PiP; no page errors in that run.
- FFprobe identified H.264/AAC in the video HLS and AAC in audio-only HLS.
- A follow-up Chromium run at a 390×844 viewport confirmed advancing playback
  in all three modes and waited for PiP entry before confirming it. An earlier
  probe checked PiP too soon and failed during exit; this was a probe timing
  error, corrected by waiting for the actual PiP state.
- A bounded GET to `basicbit1.m3u8` and `basicbit1.live.m3u8` on
  `stream.vrcdn.live/live/` returned 404. The same ID's MPEG-TS and MP4
  returned 401. This does **not** establish HLS availability for a live,
  authorized source. Recheck with a known active source before deciding.

Recommendation: first validate direct element playback with PiP and Media
Session on phones. If MPEG-TS cannot survive suspension but native HLS can,
prefer a provider HLS endpoint; evaluate a relay's cost and latency only if
the provider cannot supply one. Do not add a production HLS fallback that
repeatedly requests known 404 endpoints.
