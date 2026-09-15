# Event playback transport proof

Status: local browser experiment passed on September 14, 2026. This is Task 1 of
[the implementation plan](../superpowers/plans/2026-09-14-event-lineup-live.md),
not a product-player implementation or a live-provider compatibility claim.

## Result and parameters

The existing mpegts.js transport produces usable decoded Web Audio samples in
Chromium and Firefox on Windows. The proof routes each media element once through
an analyser, a source gain, a shared viewer gain, and an output analyser. The
measurement is upstream of viewer mute and volume. The prepared source has zero
source gain until switching.

Use **below -90 dBFS for at least 1000 ms** as the measured initial candidate for
Task 4. Sample every 100 ms, require decoded progress and a running audio context,
and invalidate evidence when the interval exceeds 500 ms. Pause, context suspension,
and observation resets must discard the accumulated interval. This threshold
separates the tested quiet tone from digital silence. It is not a general music
classifier or evidence that a broadcaster has finished.

RMS is `sqrt(sum(sample * sample) / sampleCount)`. The dBFS value is
`20 * log10(max(rms, 1e-12))`, with 2048 float time-domain samples per observation.
The -240 dBFS results below are the formula's floor for digital zero.

## Recorded browser evidence

Both tests passed in 54.0 seconds, sequentially, with Playwright 1.60.0,
Node 24.18.0, pnpm 10.15.1, FFmpeg 7.1.1, and the worktree's pinned mpegts.js.
The test project is named desktop-chromium, but each case explicitly launches its
named engine, so the second row is an actual Firefox run.

| Measurement | Chromium 148.0.7778.96 | Firefox 150.0.2 |
| --- | --- | --- |
| Initial audible sample, dBFS | -21.03 | -24.41 |
| Input at viewer volume 25%, dBFS | -21.10 | -21.05 |
| Output at viewer volume 25%, dBFS | -33.14 | -33.09 |
| Input while viewer muted, dBFS | -21.09 | -21.16 |
| Output while viewer muted, dBFS | -240 | -240 |
| Quiet tone range, dBFS | -81.13 to -81.00 | -81.43 to -81.00 |
| Connected silent sample, dBFS | -240 | -240 |
| Recorded qualifying silence, ms | 1094.7 | 1107 |
| Prepared switch to first measured output, ms | 148.6 | 43 |
| Forced scheduling gap, ms | 769.6 | 746 |
| Observation after gap | invalid, zero accumulated silence | invalid, zero accumulated silence |
| Peak HTTP media connections | 2 | 2 |
| Final HTTP connections / FFmpeg children | 0 / 0 | 0 / 0 |

The switch delay includes the button action and sampling delay. It is not a
measured acoustic gap. Initial startup samples can contain decoder transients.

Both browsers proved zero media connections before Play, including Prepare next
before Play. An unavailable next source did not switch the silent current source.
After recovery, the next source had decoded progress before switching. Its output
was silent while prepared. Disconnecting it invalidated observation even with
buffered media. Restarting recovered valid progress. Stop and page navigation
released connections. Each run opened eight successful media connections over
its lifetime, never more than two concurrently, and hit no server connection-limit
rejection. The local server also enforces a two-connection ceiling as containment.

The unmodified VrcdnStreamPlayer separately played the same transport. Its mute,
unmute, and 0.25 volume state were verified. This is automated decoded-output and
control evidence, not a human listening comparison. No product-player code changed.

## Fixture and limits

FFmpeg generates eight-second black-video MPEG-TS files with AAC audio at 48 kHz.
Each HTTP connection loops its fixture with real-time FFmpeg pacing, so normal
fixture EOF does not masquerade as broadcaster completion. The controls can close
a connection and reject the next attempt with HTTP 503, then restore it.

The sources are a 440 Hz sine, digital silence, the sine attenuated by 0.001,
and a sine with a 600 ms break and a two-second break. The quiet source is a
synthetic quiet-music proxy, not a representative music corpus. A prior -80 dBFS
candidate classified that quiet source as silence; -90 dBFS did not during the
recorded full-second observation. The 600 ms break never qualified. The two-second
break did qualify, as expected for a one-second rule. A genuine silent musical
break can therefore cause a handoff if the later product's eligibility and next
readiness conditions are also true. Do not claim zero false transitions in music.

Explicit AudioContext suspension and resumption passed in both engines. A real
700 ms main-thread delay invalidated stale evidence. Opening and focusing another
headless tab left the proof document visible in both browsers. Chromium's CDP
freeze request also left this audible page sampling. These observations do not
verify a genuinely hidden tab or OS suspension. Native background/resume, mobile,
and Safari remain unverified. Safari is unavailable on this Windows host.

The rejected-play case injects a NotAllowedError into the proof's play path and
proves its visible Resume recovery. It does not prove every native autoplay-policy
combination. No authorized live provider source was supplied or connected, so
provider CORS, encoder variation, and live VRCDN behavior remain unverified.

## Reproduction and artifacts

From the isolated worktree, start the fixture page in one PowerShell terminal:

```powershell
$env:VRDEX_ENABLE_PLAYWRIGHT_FIXTURES='true'
$env:NEXT_PUBLIC_CONVEX_URL='http://127.0.0.1:3210'
pnpm --filter web exec next dev --webpack --hostname 127.0.0.1 --port 3027
```

Then run the opt-in proof in another terminal:

```powershell
$env:EVENT_PLAYBACK_PROOF='true'
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3027'
pnpm --filter web exec playwright test event-lineup-proof.spec.ts --project=desktop-chromium --workers=1
```

The test launches and closes its own loopback server and FFmpeg children in each
case. `FFMPEG_PATH` overrides the default Windows Chocolatey path or Unix ffmpeg
executable. Browser binaries must already be installed with Playwright. The
standalone server command is `node scripts/event-playback-proof.mjs`, default
port 4319, with a ten-minute deadline and SIGINT/SIGTERM cleanup. Stop the separately
started Next server when done. The page returns not-found in production and when
the existing Playwright fixture flag is absent.

Generated media stays ignored under
`apps/web/playwright-artifacts/event-playback-proof/`. Full per-case JSON and PNG
attachments are in `apps/web/playwright-artifacts/results.json` and the Playwright
HTML report. This run also extracted `proof-chromium.json`, `proof-firefox.json`,
`proof-chromium.png`, and `proof-firefox.png` to the generated-media directory for
local inspection. Screenshots show the existing baseline controls; they do not
complete the later product UI's visual acceptance.

Validation also passed web typecheck and targeted ESLint for both fixture files
and the browser test. Remaining product-policy, live-provider, native-background,
and Safari verification belongs in the feature handoff.

## Review follow-up: short interruption and clean EOF

The revised proof passed both actual browsers, Chromium in 33.495 seconds and
Firefox in 31.443 seconds. It now pauses HTTP byte delivery for 600 ms and resumes
the same connection. Measured interruption durations were 601.95 ms and 613.18 ms.
Buffered playback concealed both interruptions: every recorded sample remained
valid and the observed failure duration stayed zero. The current source stayed
audible. This verifies that a short transport interruption need not be a playback
failure. It does not prove cancellation of an already accumulating failure timer;
Task 4 must test that policy deterministically.

A separate control ends the HTTP response cleanly and stops its FFmpeg child.
The fixture records mpegts.js LOADING_COMPLETE separately from decoder error,
media-element ended state, decoded progress, and remaining buffered duration.

| EOF observation | Chromium | Firefox |
| --- | --- | --- |
| Loading complete | true | true |
| Decoder error | false | false |
| Media element ended at first observation | false | false |
| Buffered seconds at first observation | 0.926 | 0.997 |
| Decoded progress at first observation | true | true |
| Later media element ended | true | true |
| Later buffered seconds | 0 | 0 |
| Later observation valid | false | false |

The later samples were taken about 1.9 seconds after the first EOF observation.
No source switch was requested or inferred from EOF. These results demonstrate why
clean transport completion, buffered playback, and broadcaster completion must
remain separate concepts. Both final server connection counts and FFmpeg child
counts were zero, with one controlled EOF per run.

Browser launch and page creation now run inside the cleanup-protected region.
Nested finally blocks attempt transport cleanup even if attachment writing or
browser close fails. Pending short-interruption timers are cleared on server
shutdown. Duplicate overwritten Chromium freeze evidence was removed.

The revised run also passed targeted ESLint, full web typecheck, Node syntax check,
and whitespace validation. Existing native-background, Safari/mobile, live-provider,
autoplay-policy, and human-listening limits still apply.
