# Event broadcast integration verification

Status: implementation and local acceptance, October 20, 2026. Hosted output
remains disabled. This record distinguishes the current event worker from the
June 2026 provider POC and records outstanding rollout gates. The approved design
is [event broadcast and host view](../superpowers/specs/2026-10-19-event-broadcast-and-host-view-design.md).

## Implemented behavior

One session-fenced event worker decodes at most the current and next input and
feeds a stable 720p30 H.264/AAC program clock. Independent bounded senders publish
VRCDN and an explicitly enabled optional Twitch destination. The next performer
may prepare within two minutes of its boundary, but automatic promotion never
starts early. Healthy sets overrun their schedule. Confirmed source death uses
hold while a late successor becomes ready. Manual selection suspends following;
manual hold and resuming automatic mode are separate commands. Encoder progress,
not accepted intent, establishes the observed source. Maximum session duration
is an explicit cutoff; the event calendar end is not.

Host pages expose ordered public performer links and bounded provider-status
observations without automatically opening media. The private operator page
checks the signed-in identity and event-media capability on the server before
rendering its payload. Browser playback has one retained root media owner with
explicit Play, replacement, pause, close, route navigation, and public metadata
revalidation. PC and Quest links remain separate, and authored direct performer
and event links remain available independently of the managed program.

## Material decisions and costs

| Decision | Reason | Practical cost and remaining gate |
| --- | --- | --- |
| Separate decoders and stable renderer clock | The original shared filter graph stalled when inputs died | Extra decode/encode CPU; measure the full worker, not only sender processes |
| One supported event profile, 720p30 at 1800kbps video and 160kbps AAC/48kHz stereo | Evidence exists for this profile | Other standalone benchmark profiles do not establish event-worker capacity |
| Separate Twitch transcode with two-second GOP; VRCDN uses one-second GOP | Destination profiles differ | Additional CPU; the current official 720p30 example is 3000kbps; this implementation deliberately uses 1800kbps and still needs live acceptance |
| Shared service credential plus event/session/worker/epoch fencing | Reuses the approved bridge contract and existing secret store | This is not per-session authentication; broader rollout may require stronger credential isolation |
| Explicit destination owner/community grants | Managing an event or ticking compliance cannot authorize another community's broadcast account | Deployment registries need migration; missing or malformed bindings fail closed |
| Fence the program when destination configuration or authorization changes | Publication authority must be current | Deliberate optional-grant removal interrupts the primary until restart; optional network/credential failures remain isolated |
| Remove revoked managed links from public projection | The retained browser owner must observe managed-destination revocation | A broken registry can interrupt managed viewing; separately authored direct links remain available |
| Refresh kill-switch authority after five of its ten seconds | The former nine-second cadence left only one poll interval of scheduling margin | About twelve reads per minute instead of seven; the ten-second fail-closed TTL and three-second read timeout remain unchanged |
| Anonymous public revalidation every 15 seconds, with a 10-second request timeout | Revocation must work after navigating away | A backend outage can interrupt otherwise healthy playback |
| Keep the retained media DOM and its ancestry mounted | Navigation must not restart the decoder | Root-shell geometry and fullscreen ownership need browser coverage |
| Dispose Twitch when visible width is below 400px or height below 472px | A supported visible player cannot fit | Narrow/short viewports use the external link; no hidden background-audio iframe |
| Keep automatic silence and maximum overrun off by default | Quiet music is not necessarily the end of a set | Representative rights-cleared intros, breakdowns and endings remain a calibration gate |
| Infrastructure operator cleans up terminal-but-running ECS tasks | Existing bridge refresh records actual ECS STOPPED; it does not infer StopTask from a terminal media row | Inspect and stop the exact task, then confirm cleanup; never delete admission records to fake free capacity |

## Security and integration regressions

The older VRCDN registry exposed a global hardcoded account. A real two-community
Convex regression reproduced unrelated-community configuration, scheduling and
bridge dispatch of `event-media/vrcdn/basicbit-output`. Direct `credentialRef`
setup also bypassed destination entitlement. The fix uses the existing Twitch
owner/grant pattern for VRCDN and the shared publication predicate. Tests cover
listing, key and direct-reference setup, owner/grants, malformed/unbound registry,
legacy ready records, scheduling, bridge dispatch, admission, acquisition,
renewal, refresh, commands/observations, and revocation. Public managed-link
revocation covers both providers and cached program links, while retaining an
authored direct fallback. See [registry migration](../deployment/restream-worker.md#vrcdn-destination-registry-migration).

The backend CI hold-encoding test previously waited three wall-clock seconds and
asserted a byte count. With FFmpeg absent from PATH, the exact observed failure
reproduced: zero bytes. The backend CI job now installs FFmpeg explicitly. The
test checks FFmpeg/libx264/AAC availability, fails with an actionable diagnostic,
and measures bitrate over at least 3.5 seconds of actual encoded progress with a
bounded 15-second startup allowance. It does not skip media verification.

The new operator page was absent from the browser-JWT forwarding inventory.
The inventory now includes its guarded Convex query and asserts token redirect,
token forwarding, capability/path validation and guard-before-render ordering.
This complements real Convex identity tests; it is not configured Clerk E2E proof.

VRCDN output browser links and editor prefill now use the existing `.live.ts`
MPEG-TS transport. Historical `.m3u8` derivation is not a supported playback path.
The Twitch adapter also distinguishes autoplay denial from explicit Pause: a
provider-iframe Play gesture can recover blocked playback, while parent Pause,
disposal and stale-owner fences still prevent unwanted playback.

A real rehearsal also exposed two controller integration defects. The first
attempt stopped around 640 seconds with `authority-expired`; its original log
did not distinguish which authority expired. A deterministic regression proved
that the nine-second kill-switch refresh cadence could expire during a delayed
poll. Refresh now begins after five seconds, without extending the ten-second
hard deadline, and expiration metrics identify the authority. A separate real
scenario decoded a healthy current input but left the renderer on hold while an
unready successor prepared. Current-source recovery now runs for both `stay`
and `prepare`, without promoting that successor early.

Final browser review found that the retained sequence reused September's early
promotion and synthetic silence rule. The October policy now applies to the
shared browser session as well: prepare up to two minutes early, promote only at
or after both authored boundaries on confirmed failure with a decoded-ready next
source, and leave automatic silence disabled. Deliberate manual early selection
remains available. Quiet progressing media continues after the boundary.

Browser transport tracing also reproduced cold-start churn: the first request
was aborted after approximately 1.12 seconds before media time advanced, creating
a second connection before pause/revocation. New connections now have a bounded
five-second decoded-start allowance; established playback retains the one-second
failure rule. Connection-count regressions remain exact. Gain assertions inspect
the connected audio graph rather than retaining disconnected zero-gain history.

## Local proof methods

- `scripts/event-broadcast-failure-proof.mjs`: actual 180-second decoder/render
  proof with source death, stalled successor, recovery, repeated switches,
  timestamp/keyframe validation, decoded pixels, and quiet/recovered PCM.
- `scripts/event-output-local-proof.mjs`: real controller, renderer, decoder and
  both senders with injected local control responses, generated input and local
  RTMP receivers. It renews real-time leases and keeps the current source past
  its scheduled end. Optional receiver death/restart exercises output isolation.
  `PROOF_SECONDS=7200` requests two actual hours, not an accelerated clock.
- `scripts/event-session-local-proof.mjs`: real controller/media scenario run
  covering healthy overrun, progressing silent current input, source death,
  late next source, operator override/hold/resume, replacement fencing and the
  maximum-session cutoff. Replacement authority is an injected test boundary;
  real Convex replacement authority has separate backend tests.
- `scripts/event-proof-metrics.mjs`: constant-memory streaming packet inspection
  and Linux PPID-tree CPU/RSS sampling. Worker totals include the Node harness,
  encoder, input decoders and senders. Generators and receivers have separate
  totals. Per-process CPU is a lower bound at exit; peak summed RSS is not cgroup
  memory. Application FLV progress bytes exclude TCP/TLS overhead and billing.

Output proofs create unique directories and stream samples to NDJSON. Existing
Task 6 sixty-second JSON evidence is preserved separately. Do not use a full
packet JSON capture or an unbounded packet array for an event-duration run.

One integration attempt of the 180-second proof hit the renderer's two-second
processing budget while the five-CPU environment also ran full backend/web/MCP
suites and the sustained dual-output proof. This is a real capacity-limit
observation, not a passing run. The failure is preserved; the rerun is isolated
from those CPU-heavy suites and keeps the same renderer deadline.

The bounded-concurrency 180-second retry passed with a 597.9ms maximum render
delay, one-second GOP, zero hold RMS and recovered-audio RMS 0.05524. The final
Node 22.23.3 image `sha256:40a6151723fe7c03cd6789302e91bd4a3c3fba93bde8050d9679b6eb01deda39`
passed the real scenario proof in 59.4 seconds, including confirmed session-deadline
expiration, 33.334ms maximum packet gap, one-second GOP and zero silent PCM RMS.
The two-hour run in that same image passed on October 20, from 00:03:13 UTC
through final verification at 02:03:20 UTC. Its packaged worker checksums match
the final source; only proof scripts and evidence storage were mounted. The
container used a read-only root, no external network, and a local two-CPU/four-GiB
cgroup limit. The primary recording contains 7,200.754 seconds of media:
1280×720 at 30fps, H.264 and 48kHz AAC. The harness measured 7,207.314 wall-clock
seconds including shutdown/packet verification, with 714 real-time lease renewals.

One primary sender survived the full run with zero restarts, zero measured queue
backlog, monotonic timestamps, a maximum packet gap of 34ms and maximum GOP of
one second. The optional receiver was deliberately killed after 2,400 seconds
and restarted after 3,600. Sampled optional publication stopped at 2,401.130 and
resumed at 3,608.455 seconds; it made 136 retries during the outage and stayed
healthy afterward. Its before/after recordings contain 2,398.421 and 3,593.187
seconds of the same video/audio format. The primary remained publishing through
the outage. The proof and resource sampler exited successfully; the container
was removed and owned browser/backend/audio services were stopped.

| Measured scope | CPU seconds | Peak sampled summed RSS |
| --- | ---: | ---: |
| Full worker, including Node harness/controller, encoder, decoder and both senders | 4,904.35 | 571.51 MiB |
| Synthetic source generator, excluded from worker | 949.87 | 90.46 MiB |
| Local receivers, excluded from worker | 73.04 | 126.61 MiB |

Continuous dual-publication windows averaged 0.731 CPU cores before the outage
(30.135–2,377.961 seconds) and 0.723 afterward (3,671.588–7,189.824 seconds).
The outage window averaged 0.456 cores; the whole run averaged 0.680. The latter
includes twenty minutes without the optional transcode and must not be used as
the continuous dual-output cost. Sender-only CPU was 52.08 seconds for VRCDN and
1,616.11 for Twitch; these are components of the full worker total, not extra
cost. CPU is a sampled lower bound at process exit; summed RSS can count shared
pages and is not cgroup memory. The 145 sampled process IDs are cumulative over
retries, not simultaneous processes.

The last whole-container cgroup sample was at 02:02:56.347927 UTC, before final
shutdown/verification. It recorded 5,921.270 CPU seconds and a kernel memory peak
through that sample of 3.566 GiB, with zero observed OOM events. Current anonymous
memory was 407.89 MiB; 3.150 GiB was tmpfs/shared-memory proof recordings charged
to the container. That storage, synthetic generator/receivers and the short-lived
counter reader are included in cgroup totals. These are last-sampled values,
not exact end-of-run counters or a production worker memory requirement.

Application FLV progress measured 1,760,729,852 bytes to the primary and
1,464,150,434 to the optional destination (1.640 and 1.364 GiB). Received MPEG-TS
files total 1,849,720,908 and 1,539,463,828 bytes respectively. Container overhead
explains the different measures; TCP/TLS overhead and provider billing are
excluded. A two-hour allocation at the tested cap represents four vCPU-hours
and eight GiB-hours before provider-specific pricing. This synthetic local
workload does not establish Fargate capacity, a price quote, musical quality,
physical device playback or live-provider acceptance.

## Browser and authentication evidence boundaries

Task 9's checked-in synthetic MPEG-TS fixture traverses the production fetch
loader, mpegts.js, MSE and video decoding. Actual media `currentTime`, DOM identity
and parent ancestry survive navigation/history/fullscreen. Synthetic managed,
direct and sequence projections test transport and lifecycle; they are not
proof of a real managed worker feeding an authenticated event route. Synthetic
layout gates are not genuine Clerk sign-in transitions.

Operator/host tests include real Convex identities and server authorization,
anonymous route denial and synthetic component fixtures. A genuine signed-in
Clerk-to-server route journey remains unverified. No authentication bypass or
new test account was introduced. Mobile Chromium geometry is not physical iOS
or OS-background playback acceptance.

The separate unmocked Twitch SDK and iframe request returned HTTP 200 on
October 19, but the probed channel was offline. This proves supported embed load
and offline presentation only. SDK fixtures prove application control behavior,
including blocked-play recovery; they do not establish live Twitch audio.

## Integration checks and visual evidence

At the final production snapshot, the backend suite passed 1,641 tests and the
web suite passed 775, both with zero skips. Required type/lint checks, API
contracts/OpenAPI, MCP and Discord compatibility checks, and production web,
Storybook and documentation builds passed. The final retained-player browser
run passed all 30 desktop/mobile cases. Six composed public-page cases include
four checked-in MPEG-TS ownership journeys and two opt-in generated-media policy
journeys. The latter prove pre-boundary failure cannot promote a successor and
post-boundary decoded silence retains the current performer until confirmed
failure. They use production transport/decoding and synthetic projection/clock
controls, not a decoder or policy bypass.

All 28 distinct standalone transport cases have passing results across the
preserved batch and correction runs; this was not one uninterrupted 28/28 green
batch. Earlier failures exposed cold-start connection churn and outage-status
flicker, both corrected with deterministic and real-browser evidence. One
subsequent Firefox development-navigation reset remains unclassified; its final
focused lifecycle run passed with additional navigation diagnostics. The initial
browser batch's 56 opt-in skips remain recorded as skips rather than passes.
Configuration-free retained fixtures use invented event IDs and synthetic public
projection polling. Configuring their root against a real local backend instead
correctly withdraws those nonexistent events; the composed suite separately
covers root polling with a controlled public HTTP projection.

Canonical CI images were inspected before narrow baseline changes: mobile editor
Details, Lineup and Review each gain 47px from the Broadcast controls header
wrapping. Controls remain legible within the viewport. Four other inspected
feature images had text-raster/metric differences with stable content and
geometry. No unrelated baselines or pixel tolerances changed. Editor screenshot
comparisons now collect subsequent steps after a mismatch while still failing
the test; readiness and overflow assertions remain hard. The PR retains the
canonical artifacts and final check status.

## Provider rollout gates

The June 10, 2026 POC did publish a measured thirty-minute two-account VRCDN relay.
Preserve that historical result in [worker deployment](../deployment/restream-worker.md).
It does not establish fresh two-source acceptance of this controller, source
failure recovery, dual-destination capacity or multi-hour provider operation.

Before enabling hosted output, the operator must verify the intended provider
accounts, ownership/grants, applicable rights/terms, exact scoped secret mappings,
kill switch, maximum duration, concurrency admission and budget alerts. Prepare
a timed run using two authorized source playback URLs and one authorized VRCDN
output, with optional separately authorized Twitch output. Record account and
permission verification, uninterrupted output, audible transitions, source loss,
recovery, output isolation, measured full-worker resources and PC/Quest/browser
results. Keep secret values out of the run configuration and reports.

No VRCDN or Twitch connector was available during native-tool discovery. Account
entitlement is therefore unverified here, not asserted absent. No secret values,
provider publication, image push, AWS apply or billable task run was authorized
or performed in this integration work. Current Twitch numeric guidance was verified in a fresh real Chromium browser
on October 20 from the official [Broadcasting Guidelines](https://help.twitch.tv/s/article/broadcasting-guidelines?language=en_US).
The initial CSS/loading shell completed into the article: 720p30 examples specify
1280×720, 3000kbps CBR, 25/30fps and two-second keyframes; x264 veryfast–medium,
Main/High; AAC-LC stereo/mono, 96kbps compatibility recommendation and 160kbps
maximum, with supported AAC sample frequencies. The older indexed localized page
and failed shell requests remain historical research evidence. The implemented
1800kbps profile is deliberately below the 3000kbps example. Documentation
verification does not establish live ingest, account rights or playback acceptance;
no encoding profile was silently changed.

Representative rights-cleared quiet intros, breakdowns and actual set endings
were unavailable. Synthetic silence verifies disabled-silence behavior only;
there is no selected production silence threshold/duration or measured musical
false-positive rate. Keep `VRDEX_EVENT_BROADCAST_SILENCE_CALIBRATED` unset/false,
automatic silence disabled, maximum overrun unset and hosted output disabled.
