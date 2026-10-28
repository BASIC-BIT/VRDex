# Hosted phone playback experiment

Standalone static test project, separate from VRDex application hosting.
Vercel project `vrdex-mobile-playback-test`, team `basicbit`.

The build generates two 35-minute prerecorded HLS samples with FFmpeg: a video
clock and tone, and audio-only tone. FFmpeg runs only during the build. The
deployed page uses native HLS, PiP and Media Session controls, with downloadable
logs and notes kept on the device. No backend, live relay or production keys.

Build locally from the repository root with system FFmpeg:

```sh
node scripts/mobile-media-spike/hosted/build.mjs
```

Output is ignored under `apps/web/playwright-artifacts/mobile-media-static`.
For standalone Vercel builds, upload `build.mjs`, `index.html`, `client.js`,
`package.json`, and `vercel.json` from this directory. Install with `npm install`
and build with `npm run build`; publish `dist`. `ffmpeg-static` is pinned to
5.2.0 for that build. Do not include this README or generated media as inputs.

On a phone: choose a mode, Start test, use PiP for video, switch apps, lock for
15–30 minutes, then return and Save log. Record audible interruptions and phone
OS in the notes. Test each mode separately. Samples end after 35 minutes.

Local Chromium verification: both modes advanced, video entered PiP, log
download succeeded and zero page errors occurred. FFprobe durations were 2100
seconds for video and 2100.032 seconds for audio. The 390-pixel layout was
inspected visually. This does not establish phone background/lock behavior,
audible output, live VRCDN delivery or production lineup/Web Audio behavior.

Vercel's default project authentication is retained. Use a deployment-scoped
shareable URL for phone access where available; do not disable project protection.

## Physical-device feedback, 2026-10-28

BASIC reported that both hosted modes worked as expected and identified the
device/browser as iPhone Safari. This is user-reported acceptance of the hosted
prerecorded HLS video/PiP and audio tests. Exact iPhone model, iOS version, test
durations and exported logs were not supplied. Do not infer Android acceptance,
live stream behavior or a measured 30-minute result from this feedback.

Bounded public GET checks of `basicbit` and `basicbit1` on the same date returned
401 for `.live.ts` and `.live.mp4`, and 404 for both `.m3u8` and `.live.m3u8`.
Those IDs did not provide a working public feed during the check. This cannot
establish which formats an active broadcast supports.

Next prerequisite: a known-active public VRCDN stream ID or playback/preview
link, with no ingest credential. Compare the working MPEG-TS response against
HLS manifests and direct MP4. For HLS, validate that referenced media loads and
the live playlist advances, then repeat the iPhone test on that live source.
For MP4, inspect whether it is a Safari-compatible stream before considering
it as another direct playback path. Neither URL suffix nor HTTP status alone
proves mobile playback. Prefer direct provider delivery if verified; consider
a relay only if those paths cannot satisfy background playback. Keep existing
lineup behavior unchanged and do not enable hosted restream infrastructure as
part of this probe.

### Active basicbit check

BASIC enabled `basicbit` for a follow-up on October 28. Direct `.live.mp4`
returned HTTP 200 and actual fragmented MP4 bytes. A bounded 2,031,616-byte
capture decoded as H.264 High video and AAC LC audio in FFprobe. Both HLS
manifest variants still returned 404. MPEG-TS timed out in that check, so no
successful MPEG-TS result is claimed. The MP4 response had no observed CORS
header; the test uses a plain native video element without crossOrigin or Web
Audio processing. The production lineup's Web Audio path is not covered.

The hosted page now has `VRCDN live video`, pointing directly to the public
basicbit `.live.mp4` endpoint without a proxy. Its logs distinguish live MP4
from synthetic HLS. Repeat PiP, app switching and screen-lock checks on iPhone
Safari before choosing a production transport. The broadcaster must stay live.

BASIC subsequently reported that direct live MP4 did not play on iPhone Safari.
This invalidates direct-MP4 phone acceptance despite server/FFmpeg readability.
Bounded normal and Safari-user-agent range probes showed that a `bytes=0-1`
request received HTTP 200 with chunked MP4 instead of partial content. That is a
candidate Safari compatibility issue, not a confirmed root cause without the
phone's error log. A saved capture played in Chromium; it is a finite local-file
check rather than evidence for live HTTP playback. The page now records media
error codes, network state, metadata/loading events and play rejection details,
and reports a 15-second startup timeout. It no longer labels every rejected
play attempt as an autoplay problem. Further direct-MP4 changes require the
phone evidence; no relay is provisioned by this diagnostic update.

### Safari rejection and bounded HLS packaging check

BASIC confirmed media error 4 on iPhone Safari and successful playback in a
desktop browser. Error 4 identifies source rejection; it does not uniquely
identify range handling, codecs or container timing as the cause. Direct MP4
therefore remains failed for the target phone/browser.

A subsequent bounded public MP4 capture returned HTTP 200 and 3,997,696 bytes.
Stopping capture mid-fragment caused an initial packaging error; retaining only
complete MP4 boxes through the last complete `mdat` removed 1,952 trailing bytes.
FFmpeg stream-copy packaging then exited 0 and generated about nine seconds of
HLS (three 2-second segments, an initial 2.983-second segment and a final short
segment). A two-second decode of that playlist exited 0. Both packaging and
decode reported initial non-monotonic timestamp warnings. No codec re-encode
was used. This proves bounded packaging feasibility, not continuous relay health,
timestamp correctness across reconnects, audible quality or live iPhone acceptance.

Current recommendation: evaluate a small live HLS packaging relay, preserving
the original audio/video codecs where possible and explicitly checking timestamp
handling and reconnects. Vercel can host the test UI, but a continuous media origin
is required for the relay. No live relay or paid infrastructure was provisioned
by these checks, and no production player/lineup behavior changed.

## Bounded live relay experiment

BASIC authorized a live relay test and requested a persistent page URL.
Bookmark `https://vrdex-mobile-playback-test.vercel.app`; this is the project's
stable production alias, not a per-deployment or expiring share URL. Default
Vercel authentication remains enabled, so an owner login may be needed once.
The separate test project is the only production target changed here.

On October 28 a non-persistent one-vCPU/2-GB Vercel Sandbox was created for
this test, with a two-hour hard timeout and port 8080 exposed. Sandbox name:
`vrcdn-mobile-hls-test`, session `sbx_OTnJWcfBUqheyLPJR3oTrtd5vmF8`.
Its public origin is `https://sb-3ff8cher6fix.vercel.run`. The checked-in rewrite
maps `/relay/` on the stable test-page origin to this temporary origin.
The page URL persists; live relay availability does not.

The sandbox runs `scripts/mobile-media-spike/live-relay.mjs` with Node and system
FFmpeg (installed via `apt-get update` and `apt-get install ffmpeg`). Input is
fixed to public `basicbit.live.mp4`. No credentials or arbitrary URL forwarding.
It stream-copies into a rolling eight-segment HLS playlist, with stale/unready
playlists returning 503, and bounded reconnect attempts. The relay process
also stops after 110 minutes, clears its files and terminates FFmpeg.
For this session its process deadline is 2026-10-28T20:42:45Z (16:42 Indianapolis),
before the sandbox's hard timeout. No automatic extension or permanent hosting
has been configured. To stop early, use Vercel Sandbox stop-session on the
session ID above; normal signal shutdown of the relay also cleans up FFmpeg.

Verification: public health returned ready with eight fresh segments; two
playlist reads six seconds apart differed; all referenced segments downloaded;
a four-second decode of the captured playlist exited 0. Decoder output still
included non-monotonic DTS warnings, so timestamp/long-duration audio quality
and phone acceptance remain open. The stable Vercel `/relay/health.json` route
also returned HTTP 200 with `Cache-Control: no-store`. Production VRDex and
its lineup logic remain unchanged.

Choose `Live HLS relay` on the phone page while BASIC's source is broadcasting.
Repeat PiP, app switching, screen lock and Save log. This experiment does not
establish a production relay design, permanent uptime or Android acceptance.

## Live video feedback and audio-only test

BASIC reported the live HLS relay working on iPhone Safari. Exact device model,
iOS version, durations and exported logs were not provided. Live audio-only
acceptance is a separate pending test.

The same relay now emits an audio-only HLS rendition at `/audio/index.m3u8`
from the same single upstream connection, with AAC stream copy and no video
track. The phone page offers `Live HLS audio only`, uses a native audio element,
and disables PiP for that mode. The stable Vercel path is
`/relay/audio/index.m3u8`. Health returned eight fresh segments; FFprobe
identified AAC audio only, and a four-second FFmpeg decode exited 0 with no
errors. The relay restart retained the original 2026-10-28T20:42:45Z deadline
via `RELAY_EXPIRES_AT`; the sandbox hard timeout was not extended.

During this update the workspace went unavailable. Deployed source was
recovered through the Vercel connector and committed through GitHub; the local
checkout will need a fetch/reset or clean reconciliation when it returns.
