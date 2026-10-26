# Event broadcast integration verification

Status, October 24, 2026: the nine-task branch has source implementations for
canonical VRCDN/Twitch inputs, six presets, protocol-2 durable intent, bounded
current/candidate control, resource diagnostics and the persistent host player.
Task 9 adds the pinned local-CLI argument seam and guarded migration rehearsal.
Actual final-image capacity/admission, Task 7 real counter-failure media proof,
Task 8 browser/visual/audio flows, real Convex migration and owned-provider/device
gates remain open. No rollout or whole-flow acceptance is claimed.

The previously deployed state and October 22 evidence below remain historical:
Status: implementation and retained evidence through October 22, 2026. The
persistent Lambda dispatcher is available in production, and the bounded
decoded-silence proof passed. The backend policy deployed successfully and the
obsolete calibration variable was read back absent. No event was started to
observe production worker configuration or a production silence handoff.
Earlier dated proofs retain their original scope and deployment state; their
silence-off, hosted-output-off and ECS dispatcher statements do not describe the
new target behavior. General provider/device acceptance remains separate.

The approved designs are [event broadcast and host view](../superpowers/specs/2026-10-19-event-broadcast-and-host-view-design.md)
and [persistent event streams](../superpowers/specs/2026-10-22-persistent-event-streams-design.md).

## Persistent dispatch and automatic silence

Normal dispatch now uses a minute-scheduled Node.js 22 Lambda, 256 MiB memory,
180-second timeout and reserved concurrency one. Each invocation performs one
ordinary bridge pass with a unique identity and fresh token fetched from the exact
Secrets Manager ARN. Runtime SDK v3 imports are deferred, and SDK/secret/Convex
calls have 15-second bounds. EventBridge and Lambda event age are capped at
60 seconds with zero failed-event retries. A later invocation discovers and
reconciles current work. Completion, timeout or replacement never triggers global
media drain. Actual runtime SDK support, secret fetch and scheduled polls passed
in the production cutover recorded below.

Hosts use the existing authorized Start/Stop, automatic/manual, Next and Hold
controls. There is no daily renewal or host enable toggle. Start dispatch can take
up to one minute plus scheduler jitter, followed by ECS startup; running controls
remain worker-driven. Production media retains the reviewed 720p30 image,
4 CPU/8 GiB, admission cap one and 12-hour session bound. Internal emergency SSM
publication control remains in place, with its value preserved during migration.
Estimated idle dispatch costs are $0.19–$0.92/month outside free allowances for
one-to-five-second Lambda passes, compared with about $12.66/month for idle ECS.
Active media is approximately $0.1975/hour plus egress and ancillary charges.

Launch fencing and actual ECS STOPPED remain authoritative. Pre-existing ambiguous
starts without recorded task ARNs and stale claimed commands need operator
recovery. Neither a failed invocation nor a terminal media row frees admission.
Never delete reservations or blindly retry Start to bypass ambiguity. The CLI
bridge remains an optional recovery tool.

The effective missing/empty-policy default is below -90 dBFS continuously for
15 seconds. Its bounded decoded-media proof passed and the backend policy is
deployed. Production worker application has not been directly observed because
no session was started. Optional maximum overrun remains unset, and changing it
preserves custom silence. Handoff requires
automatic mode, matching fresh progressing decoded current A/V, sustained analysis
and a matching fresh decoded-ready successor whose authored interval is eligible.
Manual selection and Hold remain authoritative. Reconnect/failure resets evidence;
silence without a ready successor retains the current source, including the last
slot. An accumulated qualifying interval may switch when eligibility arrives,
without a new post-boundary grace. Threshold changes require a session restart.
The obsolete calibration environment variable is no longer an activation control.

### October 22 decoded-silence proof

`scripts/event-silence-local-proof.mjs` completed an 85.561-second bounded run at
320x180/15fps and 200 kbps H.264 with actual AAC/MPEGTS, AAC 160 kbps/48 kHz stereo,
and the unchanged factory decoder. FFmpeg was 7.1.5. The historical -81 dBFS quiet
tone decoded between -81.018 and -80.869 dBFS and stayed selected for 16.068 seconds
after the successor boundary. Digital zero decoded at -120 dBFS and qualified the
continuous 15-second rule. A short pause retained A, an audible burst reset the
interval, and qualified silence retained A before eligibility, on the final slot,
with a disabled/unready successor and under manual `hold_current`.

After automatic mode resumed and B became eligible and decoded-ready, the worker
made a `silence` switch and the recorded encoded frame was blue B, RGB `[0,0,255]`.
Final manual slate remained selected, with decoded RGB `[31,27,32]`. The recording
contains 4,707 packets with maximum gap 66.667 ms and maximum GOP one second.
Its 3,648,328 bytes have SHA256
`39f374b6cc81b9923660c8441aac1238d3482fc189a29ec0a8f1c20841efd423`.
The receipt is `/workspace/rehearsal-sdd/persistent-silence-proof.json`; failed
attempts remain in `/workspace/rehearsal-sdd/persistent-silence-failed-attempts.json`.

The 720p and 640x360 attempts hit resource/processing bounds. One 320x180 attempt
had an incorrect harness expectation for successor readiness under manual mode;
only the harness expectation changed. Another reached actual slate but failed
with a render-clock processing-budget error when Return-to-auto started a new A
decoder. The final green sequence places slate last and avoids that restart. It
does not prove the restart failure fixed. No media module changed. These synthetic
measurements do not establish production-resolution capacity, hosted Convex
authority, provider/device acceptance, a real-music false-positive rate,
reconnect/frozen-PTS behavior or delayed-event-loop tolerance.

### October 22 production dispatcher cutover

Preflight at 15:53:46 UTC found zero active sessions. The old idle ECS dispatcher,
task ID prefix `91e599`, reached STOPPED at 15:55:03.348 UTC, exit 0. The new
`vrdex-restream-worker-event-bridge` Lambda then completed a manual ordinary poll
at 15:56:20.866 UTC, proving actual runtime SDK imports and token retrieval. The
first observed scheduled invocation completed at 15:58:07.905 UTC, warm duration
1.408 seconds and maximum memory 116 MiB. Scheduled invocations at 15:59:06.701
and 16:00:08.748 UTC also completed, establishing three consecutive scheduled
passes. The minute schedule, 60-second event age
and zero retry attempts were read back for both delivery controls. Master SSM
remained `true`, version 2; ECS running tasks were zero. No event was selected or
started. This verifies dispatcher availability without new event-publication
acceptance. Backend deployment is recorded below; no production event session
was created to observe the effective worker configuration.

The esbuild 0.28.0 artifact records 63 hashed inputs; its 47,168-byte ZIP SHA256 is
`d05875a95e5edd25a28bc51aa34085f17be627e2313a95f86fde82bd6a30cdb6`.
S3 readback and deployed `CodeSha256` matched
`0Fh1qV5e3SWii8Uao0CF8XvmJ+IxOpX4b96CvWowzbY=`. Independent spec reviews of the
policy/proof, handler/SDK and infrastructure tasks found no outstanding issues.
Nine evaluated IaC resources were bootstrapped, with Terraform state import still
pending. See [deployment and recovery](../deployment/restream-worker.md#persistent-event-dispatcher-deployment)
for the retained manifest, owner values and migration requirements.

### October 22 backend deployment and verification

The backend policy deployed to `https://superb-pig-954.convex.cloud` with Convex
CLI exit 0. Schema validation passed and no indexes were deleted. At
`2026-10-22T16:04:06.604Z`, production readback confirmed
`VRDEX_EVENT_BROADCAST_SILENCE_CALIBRATED` absent, with concurrency one and session
bound 43,200 seconds unchanged. The default-silence behavior is established by
deployed source and tests. Zero sessions existed and no event was started, so this
is not a direct readback of a running worker's effective policy or a production
silence handoff.

The scripts suite reported 353 passed, one skipped and zero failed across
354 tests. The full backend run reported 1,844 passed and one failed across
1,845 tests. The sole failure was an authored-event helper timeout. Rerunning that
case with all workspace dependencies and no competing load passed one of one in
7.98 seconds; this does not turn the original full-suite run into an all-pass
result. Backend typecheck exited 0. CI will rerun from the complete checkout.

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
| Default automatic silence below -90 dBFS for 15 seconds after decoded-media proof; maximum overrun remains optional/unset | Qualifying digital silence can end a set only with an eligible decoded-ready successor | Synthetic quiet-tone retention does not establish a real-music false-positive rate; threshold changes require restart |
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

Historical browser review found that the retained sequence reused September's early
promotion and synthetic silence rule. The then-current October policy applied to the
shared browser session as well: prepare up to two minutes early, promote only at
or after both authored boundaries on confirmed failure with a decoded-ready next
source, while leaving automatic silence disabled in that review. The persistent
automatic-silence policy above supersedes that disabled default. Deliberate manual
early selection remains available. Quiet progressing media continues after the
boundary unless the effective silence policy qualifies a handoff.

Browser transport tracing also reproduced cold-start churn: the first request
was aborted after approximately 1.12 seconds before media time advanced, creating
a second connection before pause/revocation. New connections now have a bounded
five-second decoded-start allowance; established playback retains the one-second
failure rule. Connection-count regressions remain exact. Gain assertions inspect
the connected audio graph rather than retaining disconnected zero-gain history.

## Local proof methods

The following retained records describe their original snapshots. Prior disabled
silence tests and deployment gates are historical; the persistent-dispatch and
automatic-silence section above states the current implementation, passed proof,
production dispatch cutover, backend deployment and direct-observation limits.

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
the preserved Task 10 snapshot (unchanged through `aa61f59`); only proof scripts and evidence storage were mounted. The
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

## Subsequent controller review follow-up (October 20)

The second review wave changed `event-worker.mjs`; its snapshot hash is
`4fe138a5bd50502c04bb9391ed465031293b2bbaef282a31477b53f0ba2a8118`.
The other eight packaged modules still match the retained two-hour manifest.
Renderer, decoder and sender sustained-media evidence therefore keeps its
original scope. The old image is not proof of this changed controller, and its
manifest and failed-attempt evidence remain untouched.

That wave's local image
`sha256:143cbd55aa8b1f4a5c55706ff58fa42e2b6b8660ee24e89f5fadf0d78901c3dd`
uses Node 22.23.3 and the changed controller. The actual startup proof passed:
malformed primary setup caused natural CLI exit with zero renewals and an error
observation; invalid optional setup left primary publication healthy with zero
primary restarts; unreachable primary publication stopped at the 15-second
startup deadline and never renewed after fencing. A separate 40-second real
dual-output run passed outage/recovery and packet/GOP checks. Exact launch
arguments and inspected image, mounts, read-only root, network isolation and
resource limits were captured before starting each container; exit state and
packaged source hashes were retained afterward. No runtime source was mounted.

`node scripts/event-startup-local-proof.mjs` is the repeatable local scenario.
It uses test-owned control/enablement responses and loopback receiver transport,
with real worker CLI, renderer and senders. Backend regressions separately prove
that terminal media errors retain admission until bridge-confirmed task STOPPED,
that destination saves cannot mutate active/reserved sessions, and that detached
projections do not consume the bounded eligible-source configuration. None of
these local results implies live-provider or hosted acceptance. No additional
two-hour run was required for unchanged encoder/transport modules.

## Third controller review follow-up (October 20)

The third wave changes initial automatic selection to authored half-open slot
intervals. Fresh and replacement workers stay on slate in schedule gaps and
after the final explicit end; an already selected healthy source may overrun.
Remembered source IDs do not establish playback. The current controller hash is
`6e1c3ea329cb202b09b7331c500998278f0c2fa52e4b3be4979b7d358ce66e41`.
The other eight packaged runtime modules still match the prior manifests.

Local image
`sha256:1810e5e35e2707af0d735370c0ff1ae817b07fd9cffe32fa7c8a9646c288c1c3`
uses Node 22.23.3. `node scripts/event-join-local-proof.mjs` passed a real
controller/decoder/renderer/encoder/required-sender run: slate before the next
boundary, selection after the boundary, continued healthy playback after its
end, and replacement startup remaining on slate after both slots ended. Each
session renewed authority and reported progressing publication. Both captured
streams were 720p30 H.264 with 48 kHz AAC, with maximum 34 ms packet gaps and
one-second GOPs. The expired feed was never opened.

The same image also passed the startup fencing proof. Exact image IDs, launch
arguments, inspected mounts/read-only root/network/cgroup limits, exit state,
packaged hashes, logs, raw media and media hashes are retained. Only harness
scripts and evidence directories were mounted; runtime modules came from the
image. Runs used no external network and two-CPU/four-GiB limits. This is bounded
synthetic controller integration evidence, not a fresh two-hour soak or provider
acceptance. The earlier two-hour and round-two proofs retain their original
snapshot scope.

Backend regressions separately verify terminal command settlement through actual
observations and process reconciliation, capacity held until confirmed STOPPED,
and selected-only required public output links. Host-status regressions cover an
80-slot roster, bounded request duration and probe fanout, partial observations
and refresh scheduling. Desktop/mobile fixture checks verify usable authored
links and Start disabled while a terminal task is held, then available after
command settlement and confirmed stop. Fixture UI state transitions do not
substitute for the separate Convex/ECS boundary tests.

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

At the Task 10 production snapshot, the backend suite passed 1,641 tests and the
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

At that earlier review, representative rights-cleared quiet intros, breakdowns
and actual set endings were unavailable. Its synthetic silence checked the then
disabled behavior only. The persistent-stream work above supersedes the old
calibration gate and silence-off recommendation. It still does not establish a
measured real-music false-positive rate; maximum overrun remains optional/unset.

## Fourth review: command transactions and host authorization

Manual source switches prepare the candidate alongside the current decoder and
commit mode/source only after actual encoded publication. A failed or timed-out
switch removes the candidate before acknowledgement and retains the previous
source when still authorized and ready, otherwise slate. Late candidate recovery
cannot commit failed intent. Return to auto from manual or hold reevaluates the
current authored half-open interval; a gap returns to slate. An already automatic
healthy overrun remains allowed. Stable profile stream projections no longer
write or advance `updatedAt` on each refresh; stream, identity, access and removal
changes still update availability.

An unusable start payload terminates its session and settles outstanding intent,
clearing its active pointer. Existing task reservations remain held. When a task
was admitted, durable cleanup intent survives that failure and destination
revocation. The bridge may claim Stop after worker acquisition and retries stored
Stop intent against the same task during reconciliation, including after a failed
request or late task registration. Only actual ECS STOPPED releases capacity.

Host server rendering, bounded status probes and reactive updates now share an
event/community-scoped operations-read projection. Owners and authorized read-only
operations staff can view drafts without control permission. Anonymous public
access remains available; unauthorized draft requests are concealed, and status
responses use `private, no-store`. Real Convex authorization tests traverse the
server token helper and actual page/status routes for owner, read-only staff,
anonymous, nonstaff and wrong-community requests. Token delivery is injected;
this is not genuine Clerk acceptance. The live subscription withdraws content
on authorization loss. Desktop/mobile fixtures supplement those boundary tests.

The retained fourth-review image is
`sha256:952affdbf9eed3d2b6bd2910e8bb651b89d40df065691b8a36cbc491da7a4b0e`,
using Node 22.23.3. Its controller SHA-256 is
`44694eb903d2beb331bb64a1ef0a7e5dd4dd834710e91de1f3a6d9c625bda87f`.
`event-command-local-proof.mjs` passed 24.5 seconds of real packaged decoder,
renderer, encoder and required sender output: failed candidate preparation while
current playback continues, late recovery without switching, successful retry,
Return to auto and gap slate. Local synthetic control and UDP/RTMP endpoints are
injected. The recording has H.264 1280×720 at 30 fps, AAC 48 kHz, maximum packet
gap 34 ms and one-second GOP. Recording SHA-256:
`ec723772dd2a037d8d7a1a2c8cff1c0f9d6b6c15e24996de48df4c0082a6e1c0`.

The image's other eight runtime modules match the previous snapshots. Earlier
startup, gap/boundary/overrun, dual-output and two-hour recordings retain their
original image/controller attribution. This short command proof does not create
a new two-hour claim or provider acceptance. Hosted output, automatic silence
and optional maximum overrun retain their existing disabled defaults.

## Fifth-review relay lifecycle and control proof

Sessionless queued intent stays visible and attaches in sequence when Start
schedules the next worker. It no longer blocks Start; current-session commands,
capability, active-session and held-output locks still apply. Accepted fenced
live/hold observations and command acknowledgements mark only the selected
destination active. Terminal media completion restores ready without asserting
ECS STOPPED. Disabled/revoked destinations and replacement sessions retain their
own authority. Repeated observations do not churn the destination timestamp.

Stopped-task definition cleanup failures remain pending for per-session retry.
Managed and legacy reconciliation continues to later tasks and commands; backend
control errors still propagate. Actual STOPPED remains the admission boundary.

Relay mappings now follow current/prepared decoder reconciliation, including
manual preparation and rollback. Retired routes reject requests and close stale
streams; retained streams stay connected. Source identity and URL revision both
participate in reuse. The live cap remains 64, and tests advance through 70
historical sources before rotation. Exact HTTPS authorization, public IPv4 DNS
pinning and MPEGTS-only decoder boundaries remain unchanged.

The local fifth-review image is
`sha256:f9f13a9c002bd728e0673e017e89a90e953679dbbb5ca722f6da0a6c94d9a172`.
It derives from the retained fourth-review image `952affdbf9ee` with one layer
copying the two changed modules. Its 16 base layers and Node 22.23.3 runtime match
that verified image. The normal Dockerfile build exhausted local disk during
COPY; this local proof used a temporary single-COPY Dockerfile, not a successful
rebuild of the production Dockerfile. The production Dockerfile is unchanged.

Fifth-review controller SHA-256:
`a4de9d933ffe3ac7952f1416450379cf874235d66e1333a8c114eeac4f34510a`.
Fifth-review relay SHA-256:
`60f9e6c5d8ba6163db39acd39e66c31530e00d12e2cfc3e3e9160487f3975148`.
The other **seven** runtime modules match the retained earlier image. Earlier
eight-module identity statements describe their historical snapshots.

`event-relay-local-proof.mjs` passed 26.8 seconds with actual packaged relay HTTP,
decoder, renderer, encoder and sender. After 70 historical mappings, it rotates
the current source URL, rejects its stale route, retains the current HTTP stream
through failed candidate preparation, retries successfully, returns to automatic
playback and publishes gap slate. Local provider DNS/transport and control are
injected; production TLS/SSRF rules are unchanged. The container used no external
network, a read-only root, two CPUs and four GiB; only harness scripts and evidence
were mounted. It exited zero without OOM. H.264 720p30/AAC 48 kHz output has a
34 ms maximum packet gap and one-second GOP. Recording SHA-256:
`450e10c5a6834bed8261180243131b5815f11cc8cc8c72cfbf3ac19d27016660`.
Decoded frame samples show the rotated blue source and later green source.

The affected test batch passes 238 tests with no skips. Six desktop/mobile
fixture checks cover pre-session Start, terminal locks and Stop while another
command is pending. Screenshots passed visual review with fallback fonts after
font download failures; this is not a canonical-font visual acceptance result.
Actual backend attachment, authorization and route/component boundary tests are
separate from those browser fixtures. No genuine Clerk or provider acceptance is
claimed. The old two-hour recording remains evidence of its old controller and
relay; this bounded lifecycle proof creates no new sustained-run claim. Encoder,
decoder and output sender implementation is unchanged, and rollout gates remain
disabled as previously documented.

The scoped follow-up review found that legacy cleanup retries could replay a
terminal publication update after a replacement session had started. Cleanup-only
retries now skip that update. The shared legacy status mutation changes program
and destination state only while its session owns the active program, covering
the first delayed terminal observation as well as retries. Two real-backend
regressions verify unchanged replacement program/output records and successful
lease renewal through repeated cleanup failures and eventual success. The
follow-up affected backend/bridge batch passes 163 tests. No runtime/media or UI
files changed in this follow-up; the packaged proof and browser evidence retain
their exact source identity and original scope.

## Sixth-review abrupt process termination

Confirmed exact-task ECS STOPPED now restores an owned selected output to ready
when the worker dies before sending a terminal media observation. The transition
checks the output's event/program identity and current publication ownership;
a terminal session with an already-cleared pointer is safe to reconcile, while
a different replacement pointer prevents shared-output changes. Disabled and
revoked destinations remain intact. Only actual STOPPED releases admission, and
pending task-definition cleanup does not block replacement scheduling.

Eight new real-backend cases cover abrupt publication loss, replacement start
without destination reconfiguration, unrelated optional destinations, wrong task,
nonterminal process reports, repeated confirmation, terminal-media-before-process
ordering, disabled/revoked output, replacement ownership and mismatched output
scope. The affected backend/bridge/authorization/control batch passes 171 tests.
Backend types and documentation checks pass. No runtime, harness or UI source
changed; existing image `f9f13a9c002b` media proof and browser evidence retain their
source identity and bounded claims. No new media, browser or sustained run was
needed for this backend-only transition.

## Seventh-review schedule navigation and bounded worker reads

The static Terraform task now exposes only the synthetic benchmark. Event
entrypoints continue through bridge-created task definitions carrying their
event/session identity. No provider configuration or rollout gate was enabled.

Next retains authored-adjacent navigation when an authored slot is current.
Without one, it selects the available current half-open interval, then the first
available future slot, and fails after the last interval. Previous still fails
without an authored current slot. Manual Next may select early; automatic mode
stays on slate in a gap until the future boundary. An unavailable or removed
current source is fenced without repeatedly erasing a pending authorized
selection before its encoded acknowledgement.

Command polling and earlier-pending acknowledgement checks now use scoped
status/sequence indexes. A poll claims at most 20 commands in sequence and stops
at a future availability boundary. Legacy/sessionless numbering and attachment
process at most 20 oldest pending rows per call, so repeated polls drain older
intent before newly queued commands without scanning completed history or
imposing a permanent backlog cap. Lease acquisition queries at most two
unexpired rows per nonterminal status and denies any other unexpired sibling,
even with an inconsistent active-session pointer. Expired and terminal histories
do not consume these candidate ranges.

The focused controller/backend batch passes 163 tests; the additional affected
media/control/authorization/relay/policy/projection batch passes 142, and static
worker configuration passes 10. All have zero failures/skips. Real Convex handler
tests instrument returned indexed-query rows, with 2,000 completed commands and
2,000 mixed terminal/expired sessions, plus 95 mixed legacy/sessionless pending
commands. They verify bounded results, repeated ordered progress, future-head
blocking, fenced acknowledgements and all six nonterminal sibling statuses.
These are local query-result measurements, not production load benchmarks.

Current local proof image:
`sha256:cb3cd0cc174f55f200ae9731ce3e3c7386cfab0ed8083e961c0e03e01882c527`.
Controller SHA-256:
`a37b6b20a18fb734b6191c78a67867514e5f4a3db44f4098be7c55df4457eb11`.
All nine packaged runtime hashes match source; eight modules, including relay,
renderer, decoder and senders, match the fifth-review image `f9f13a9c002b`.
The new image inherits that verified image's exact 17 layers and launch config,
plus one local controller-COPY layer. This resource-constrained local packaging
does not replace a fresh production-Dockerfile build in remote CI.

`scripts/event-next-local-proof.mjs` passed in 47.736 seconds on Node 22.23.3
with actual packaged relay HTTP, decoder, renderer, encoder and RTMP sender.
Ten command outcomes cover failed Next/rollback to slate, late candidate recovery
without promotion, explicit retry into future B, automatic gap slate,
unavailable-current Next, removed-current Next, after-last failure and joining a
current interval. Six decoded source samples agree with acknowledgements: green B
for each successful Next and red A between the revocation/removal cases. Four
real-time renewals and 66 observations occurred. H.264 720p30/AAC 48 kHz output
has a 34 ms maximum packet gap and one-second GOP. Recording SHA-256:
`806db1e4becdc5611fbe9f7bae1e8a6399c1c4ad7eb7d4299a6efd99e0b4dd36`.

The container used network none, a read-only root, two CPUs, four GiB and a
256 MiB /tmp; only scripts read-only and evidence writable were mounted.
Client/container exited zero without OOM. Control, provider DNS/transport and
the RTMP receiving boundary were local injections; production HTTPS/SSRF rules
remain unchanged. The first run completed its command checks but failed final
pixel sampling, so its failed log and recording remain separate. The corrected
sampler selects frames 500 ms after each encoded source acknowledgement.

The fifth-review recording now describes its historical controller with the
unchanged relay. Earlier two-hour/controller recordings retain their original
snapshot attribution. This short selection proof creates no new sustained-run,
hosted, provider, physical-device or genuine Clerk acceptance. UI is unchanged;
no browser/visual rerun was needed. Hosted output, silence and optional maximum
overrun remain disabled.

## Eighth-review recovery and focused regressions

A fresh workspace reset restored base `339c4f5` without the prior uncommitted R8
patch or raw evidence. This round recreated the three published findings. Older
proof descriptions above remain historical reports for their named snapshots;
raw historical files, including the two-hour recording, were lost in the reset.
They are not counted as fresh checks of this controller or relay.

Automatic missing-current policy now resolves the available current half-open
interval, otherwise the first available future slot, with none after the last.
Only the missing-current policy candidate discards an obsolete end. Authored
adjacency, healthy overrun, two-minute preparation and one-second media-death
confirmation remain intact. Automatic reconciliation owns successor decoder
lifetime after current revocation; pending command fences remain authoritative.

New admission protocol `fenced-v1` has backend-atomic launch marker and unlaunched
release alternatives. Exact event/session/dispatch/active-program and claimed
Start ownership, no epoch/ARN, and eligible lifecycle state fence both. One marker
winner alone may call RunTask. Unknown marker replies never release or launch;
RunTask ambiguity and lost task registration retain capacity. Old unmarked
reservations fail closed. Unused-definition cleanup retries independently of
released admission; competing loser cleanup cannot overwrite the winner's ARN.

Host missing/stale source status is Unknown, fresh explicit failure Unavailable,
and fresh Twitch Offline remains separate. Reader timestamps remain raw. Existing
large-roster/shared-four-probe and actual server/route/component tests cover the
partial-response boundary. Four new anonymous browser fixtures passed on desktop
and mobile, with no font fallback. Root visual review passed all four for labels,
PC/Quest copy controls, Preview, selected/scheduled context, other links, repeated
performers, guest rows and no clipping/overflow. This is local Chromium evidence,
not genuine Clerk, physical-device or provider acceptance.

Fresh browser artifacts are under `/tmp/r8-host-screens-final`; exact paths and
SHA-256 values, commands and full counts are recorded in the R8 task report.
No image was pushed and no provider/infrastructure write was performed.

Initial eighth-review normal Dockerfile image:
`sha256:d8179e574a69a3c39a3c745d3ed54512626396493778a8532b7468a2b12303f6`.
Packaged Node is 22.23.3. At commit `e97b6de`, all nine packaged runtime hashes
matched that source snapshot. Its controller SHA-256:
`b27fa260813cbd4c3be5e9e3a6ca5241c114456fc27c92c79533acaec0fc67a1`.
This build used the managed proxy CA secret and the checked-in Dockerfile,
without pushing an image. Each proof uses network none, read-only root, two CPUs,
four GiB and a 256 MiB /tmp; only proof scripts read-only and evidence writable are
mounted. Runtime code comes from the image.

`scripts/event-lineup-edit-local-proof.mjs` exercises established red A, deliberate
expired blue C and Return to auto A, removal to slate while B is unready, green
current-interval B before obsolete A's future end, future-A gap slate without
early promotion, red A at its boundary, healthy A overrun with decoded-ready
eligible B, then real source death confirmed for at least one second before green
B. Encoded acknowledgements, control observations and decoded media agree. Slate
checks verify its authored dark background and brighter center as well as its
mean RGB. Source samples remain red `[254,0,0]`, blue `[1,0,255]` and green
`[1,128,1]`; both slates average `[30,27,31]`, with corner `[19,19,19]` and center
`[75,75,75]`.

The first attempt stopped during a readiness wait without recorded fence
metrics. Its cause remains unestablished. A host-UID attempt then failed before
runtime imports because packaged files use the normal image's root permissions.
The first isolated default-user run completed the media timeline but failed a
sampler tolerance of three against the neutral slate's four-value mean RGB
spread. Inspection confirmed the authored slate. The corrected sampler also
checks spatial contrast, and instrumented isolated repeats retain per-tick
metrics and final state. These failed attempts remain separate from passing
proofs. No runtime deadline or renderer budget was raised.

Two sequential resource-instrumented runs passed at the same two-CPU/four-GiB
limits, with total harness times 41.700 and 44.024 seconds. These include packet
and frame verification after recording. Each retained nine source/slate samples,
three lease renewals and 118 control observations. Both show H.264 1280x720 at
30 fps, AAC 48 kHz, monotonic DTS, maximum packet gap 34 ms and one-second GOP.
Real decoder failure evidence exceeded one second before the final handoff.
These are bounded local proofs, not sustained capacity acceptance.

An earlier instrumented repeat and the later GC/pressure diagnostic tripped the
unchanged two-second renderer processing budget. The later diagnostic measured
2.395 seconds of event-loop delay, maximum GC pause 144 ms, container memory about
352 MB with no memory-limit events, and CPU quota throttling. The task host was
near its 16 GiB memory limit with active reclaim: memory-limit events increased
by 13,403 and page scans by 457,741 during collection. This correlates host
pressure with the stall but does not establish a unique cause. Decoder and
generator thread counts did not show host-sized pools. No runtime fix, processing
budget increase or resource-cap increase was inferred from these observations.

The passing recordings and the failed capacity attempts remain available with
per-process CPU/RSS/thread counts, encoder queues/progress, cgroup metrics and
final states under `/workspace/r8-media`. The evidence manifest records exact
paths, SHA-256 values and ffprobe recording durations separately from total
harness times. The first uninstrumented stop remains unexplained. Representative
capacity and sustained reliability validation remain required before enabling
hosted output; silence and optional maximum overrun remain disabled. No new
hosted/provider acceptance or fresh two-hour soak is claimed.

The two sequential passing recordings are:

| Evidence directory | Recording duration | Recording SHA-256 |
| --- | --- | --- |
| `/workspace/r8-media/resource-n9yeND` | 35.221333 s | `68543ac5d68845eecae52c65eab3c57f58f7e402398655fb2d48600e0073f3b6` |
| `/workspace/r8-media/resource-repeat-vxeaS7` | 36.121333 s | `aacd4f1654d6f4e71b201747bde9c6ef3cb7bc73f807d420f64b7de2e9fffea0` |

Each directory contains `result.json`, `resource-samples.json`, `diagnostic.json`,
`observations.json`, `acknowledgements.json`, `samples.json`, `media-samples.json`,
`death-evidence.json` and `lineup-edit.ts`. `/workspace/r8-media/evidence-manifest.json`
hashes all media evidence, including failed attempts; `container-inspects.json`
records exits, resources and mounts. Both passing containers exited zero without
OOM. These local paths describe this recovered workspace, not durable hosted
artifact URLs. The task report also hashes raw test/build logs and the four
visually reviewed screenshots. Preserve or export those artifacts before another
workspace reset.

### Same-key replacement correction

Independent review of the initial eighth-review patch accepted the admission and
host-status fixes but reproduced early automatic playback when a different
source reused the current authored slot key. Refresh had overwritten the current
source identity before policy evaluated the replacement's interval. The earlier
same-key test used an already-current interval and missed that future boundary.

The correction preserves current identity by matching both slot key and source
ID. Decoder reconciliation filters unavailable identities before deduplicating
renderer keys, so the available same-key replacement stays warm. Policy
successor distinctness also uses the pair, and Next/Previous treat the old pair
as removed rather than skipping the replacement. Manual Next can still select a
future replacement deliberately; automatic mode waits for its boundary. An
expired same-key replacement does not revive, including after the last interval.

Seven new targeted RED cases failed on `e97b6de`. Complete worker/policy tests
then passed 204/204, and the affected controller, policy, media-control,
authorization and configuration batch passed 283/283. The independent
reproduction now keeps slate and the old identity before the replacement's
boundary. Pending command authority, ordinary healthy overrun and source URL
revision checks remain covered by the existing regressions.

The fresh normal Dockerfile image is
`sha256:11df603af3b7c769193541864fcdfdd9677c5c0a3df65325f31d85670eaaa2a7`,
with Node 22.23.3. All nine packaged runtime hashes match the corrected source.
Exactly two runtime modules changed relative to `d8179e`:

- Controller: `be059ef48f3e941677f7d110d8a62f932518605e9b0c0e85f113278831edafcf`.
- Handoff policy: `1e805a20ddc9a5207ebdaf316b05e795f66094100d5c1507240019fa1478d79e`.

The other seven modules retain their previous identity. Earlier media runs,
including the historical two-hour result, do not verify this new controller or
policy. Existing UI evidence remains applicable because this correction changes
no UI. Hosted output, silence and optional maximum overrun remain disabled.

The corrected image completed one isolated end-to-end run in
`/workspace/r8-media/fix1-controlled-j3vM7u`. It recorded 36.521333 seconds of
media; total harness time, including packet and frame verification, was 44.516
seconds. The recording SHA-256 is
`88c9eb3835361ab410922597a6fd0d0f0a4032f83d563292e9b3ea757ae0bcc7`.
All nine decoded samples passed: established red A, manually selected expired
blue C, automatic A, removed-current slate, green B, same-key future slate,
same-key boundary red A, healthy A overrun with ready B, and green B after
qualified A death. Both slate samples have average RGB `(30,27,31)`, dark corner
`(19,19,19)` and brighter center `(75,75,75)`. The boundary A sample is
`(254,0,0)`, establishing actual encoded replacement media after its boundary.
Controller state retained old B and publication stayed on slate before then.
Control observations agree with every sampled state.

The run recorded 117 observations and three lease renewals, with qualified death
evidence spanning 1184.08 ms. Packet DTS was monotonic; maximum packet gap was
0.034 seconds and maximum GOP 1 second. Video was H.264 1280×720 at 30 fps and
audio AAC at 48 kHz. The read-only, network-isolated container exited zero without
OOM under the unchanged two-CPU/four-GiB limit. Only the proof script and evidence
directory were mounted; runtime modules came from the image.

Repeated correction attempts also hit the existing renderer processing-budget
fence. Two reached the same-key boundary before failing later; another failed
earlier while selecting C. A separate attempt could not start when VFS container
copies exhausted disk. Their media, observations, counters and diagnostics are
retained. Root revised the requested two fresh passes to this one complete pass
plus the 204/283 focused regressions after the documented environment limits and
experiment cap. This is F1 functional verification, not repeatability or hosted
capacity acceptance. The two earlier passing recordings belong to `e97b6de`, not
the corrected controller or policy.

Task-owned stopped container objects were removed to recover space; both images
and all raw evidence remain. Seven exports preceded deletion, but a validation
command incorrectly required an optional diagnostic absent from an older harness
schema, and the same shell continued to removal before hash sealing. Complete
metadata and raw evidence were validated and hashed afterward; the report
records this ordering gap explicitly. No global prune or host setting changed.

`/workspace/r8-media/r8-fix1-evidence-manifest.json` hashes current correction
sources, image provenance, logs, metadata and raw media. The original R8 manifest
remains a historical snapshot. Its working harness path has since changed; its
exact `e97b6de` blob survives as `/workspace/r8-media/r8-e97-proof-harness.mjs`
(SHA-256 `1f6224513efd9404612d20c198563bf27aeeff71a708ded71829b64a5b385a5b`).
The correction uses `/workspace/r8-media/r8-fix1-proof-harness.mjs`
(SHA-256 `6be4316011db04cba9cf3b7734e43cb4913ebd304f5bce4f6e51780f0ce33bc9`).
No claim is made that historical manifest paths still identify current sources.

## Bounded one-source provider rehearsal

### Initial attempt

On October 21, the approved ten-minute Fargate attempt passed one 120-second
synthetic run at 2 CPU/4 GiB. Task `a6fd95e7753d41febad69f62f5e315de` reached
STOPPED with exit 0. It retained one primary sender, six optional process attempts
through intentional receiver death/recovery, 34 ms maximum packet gap, one-second
GOP and zero measured queue. Worker resources were 117.17 sampled CPU seconds over
121.787 harness wall seconds and 548,909,056 bytes peak sampled summed RSS. Generated
input and local receivers are separate resource groups; the workload excludes the
production HTTPS relay, a warm successor and live provider output.

That capacity run used source `16e46cb`, ECR digest
`sha256:abf9bf6c6a68d44f0159386bb7d740da9df50ab0c337f536f108818014d0a6e4`.
The final reviewed provider adapter is source `dcf83fe`, packaged as
`sha256:59388ac42078ba3f7ca44ce560b3e51e306f7ed460325e4855320f00f76adb23`.
All 13 packaged hashes were checked. Only the adapter changed between these images;
the nine runtime modules and synthetic proof retain their hashes. Capacity was not
rerun on the later image, and the later adapter was not launched.

One 1 CPU/2 GiB `basicbit1` source task produced a public capture. Its initial
12-second strict live decode probe failed with timeout 124 and PPS errors. A separate
ten-second raw capture timed out with curl exit 28 after 1,914,216 bytes; offline decode
of those bytes exited 0 with 197 frames and 7.3 seconds of output progress. The media
was H.264 1280x720 at 30 fps with AAC at 48 kHz. Startup warnings remain in the preserved
evidence. This is a bounded decodable source sample, not clean-start or provider-output
acceptance.

The run window began at `22:06:48.956Z` and ended at `22:16:48.956Z`. Review rework and
source diagnostics consumed it, so no output task or second source was launched. Both
switches remained false. Source StopTask was requested at `22:14:27.917Z`; its execution
stopped at `22:14:40.062Z`, before the task deadline `22:14:56.062Z`. ECS deprovisioning
finished at `22:15:04.466Z` with exit 143 from operator termination, not successful
180-second completion. Cleanup readback at `22:15:47.817Z` confirmed both tasks STOPPED,
zero running tasks, both network interfaces DELETED, and all three proof definitions
INACTIVE. The approved IAM policies remain as durable tooling; both switches are false.
All seven private capacity artifacts and the source/failed-probe evidence are preserved.
A further bounded live window is required for actual
output, source/hold/return, source replacement/recovery and dedicated-switch fencing.
Real Convex authority, distinct-source handoff, Twitch, sustained reliability, musical
silence calibration and physical device gates remain open. Ordinary hosted output
remains disabled.

The [isolated rehearsal procedure and attempt record](event-broadcast-rehearsal.md#october-21-2026-attempt-record)
contains exact provenance, private evidence paths, cleanup status and limitations.

### Second bounded attempt and canonical-host correction

A separately approved second window began at `22:24:44.718Z` on October 21, with a
`22:34:44.718Z` global deadline. One source and one output task used the preserved
`dcf83fe092f1c2bf3b492633516ac05b97504e0b` image,
`sha256:59388ac42078ba3f7ca44ce560b3e51e306f7ed460325e4855320f00f76adb23`.
The public `basicbit1` sample decoded 228 frames over 8.266667 seconds with AAC audio.
This source result does not prove output publication.

Output task `a253c3007ee4447ea9295ac52a578302` exited 1 after 63 ms, before
`proof-start`, with only the generic safe failure log and no S3 output artifacts.
Its public observer received zero bytes and failed with `TimeoutError`. Boolean-only
credential inspection showed a valid split credential using exact `ingest.vrcdn.live`;
the parser required a one-label regional host. The working source used the same
canonical host. Synthetic regression tests reproduce the rejection and verify the
narrow production parser correction for split and combined forms, regional support,
negative host/URL cases and the rehearsal startup gate.

This parser change is locally tested only. It intentionally changes
`output-sender.mjs`; the earlier nine-runtime-files-unchanged proof applies only to
the two preserved images. Neither contains this fix. A new reviewed image is required
before future provider testing. No successful provider output or switch-caused
fencing is claimed, and no second source or output retry occurred.

Final native cleanup at `22:29:03.711Z` confirmed source STOPPED at `22:27:44.091Z`
with operator-stop exit 143, output STOPPED at `22:26:47.643Z` with exit 1, zero
RUNNING tasks, both task network interfaces DELETED and both revision-2 proof task
definitions INACTIVE. Both switches were false, production version 1 and rehearsal
version 4. Evidence remains in `/workspace/rehearsal-sdd/live-20261021T222402Z/`.
The [second-attempt record](event-broadcast-rehearsal.md#october-21-2026-second-bounded-attempt)
lists the capture, contract-inspection and cleanup receipts. Provider-output,
source/hold/return, source loss/recovery and dedicated-switch fencing gates remain
open. Another attempt requires separate authorization; ordinary hosted output stays
disabled.

The required fixed image is now published from `4d701bb05bb242cfe5dab9bbdafcba00ddbffe2e` at ECR digest
`sha256:2e121beb9ded4592c01c763c4c1cacc49cb9c522e3f661e41c7e8b10e35d88f6`.
All 13 packaged hashes match reviewed source; only `output-sender.mjs` differs from the preserved `59388ac` image, with the same base RootFS and unchanged default CMD.
Native readback at `22:40:14.127Z` confirmed ECR ACTIVE, both switches false and zero RUNNING tasks. At that readback, no live task or capacity rerun had used this image; provider acceptance remained open.
Safe receipts in `/workspace/rehearsal-sdd/` are `published-image-canonical-host.json`, `packaged-image-canonical-host-verification.json` and `canonical-image-published-verification.json`.

### Third bounded attempt and passive transport evidence

The third window was `23:00:42.918Z` to `23:10:42.918Z`. One source and one output
used canonical-host image `2e121beb` from `4d701bb`. Credential validation passed,
but the output failed with exit 1 after 15.8 adapter seconds. Source readiness and
publication were never observed; four sender attempts/restarts had zero output
progress. No hold/return command ran. A clean local 442-frame, 14.741333-second
recording showed the neutral hold slate. The independent output observer received
zero bytes and three HTTP 401 responses. None of this establishes provider success
or the cause of ingest failure.

The independent source sample retained 1,179,648 bytes, received HTTP 200 after
7.547 seconds, and decoded 130 frames over 4.5 seconds with AAC at 48 kHz. The
source stop at `23:03:41.391Z` followed output failure and was cleanup, not the
controlled +40-second loss test. No replacement source or output retry occurred.
Final readback at `23:05:26.916Z` confirmed both tasks STOPPED, zero RUNNING,
production/rehearsal switches false at versions 1/6 and both revision-3 definitions
INACTIVE. Four downloaded artifacts and the 46-file evidence set are hash-sealed in
`/workspace/rehearsal-sdd/live-canonical-20261021T225904Z/`.

The live root cause remains unknown. Local immediate source replay works even when
output publication is false; a 3.5-second delayed response hits the existing
three-second relay timeout. The live worker's response latency was not measured.
The missing RTMP app hypothesis is refuted, including by FFmpeg 5.1.9 source.
Local delayed handshakes reproduce the two-second protocol timeout or, with a
diagnostic-only extended timeout, the 512 KiB queue cap before startup expiry.
The measured queue case does not prove the age guard fired. Host FFmpeg 7.1.5 was
used for those local runs. These mechanisms do not establish the cloud cause.

Task 5 adds proof-only passive wrappers through the existing real lookup/request/
spawn dependencies and existing renderer callbacks. Bounded numeric/boolean
`transport` fields survive finalization; callbacks, object identities, arguments,
response stream flow and lifecycle gates retain their behavior. Offline tests cover
forwarding, failures before teardown versus adapter/worker cleanup, split marker detection,
secret canaries, oversized floods and finalizer retention. This clarifies observation
scope without a DNS or transport bypass. The nine runtime modules remain unchanged
from `4d701bb`; the parser correction is already part of that baseline. No deadline,
queue, endpoint or transport option was relaxed. The reviewed image is now published
as recorded below; separate operator authorization is required for a future attempt. Provider publication and
all remaining live/device gates remain open. See the
[third-attempt record](event-broadcast-rehearsal.md#october-21-2026-third-bounded-attempt)
for exact task timelines, limits and investigation references.

### Published transport-observation image, no live validation

The reviewed `689db1b6a9fe605c8207ddf246b3d26af8daa645` source is published as
`079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker@sha256:f8f833097f68cdb147cda2ed8521ce7fa50b4177c0d5833e95d3acf678c5073e`,
local image ID
`sha256:85a07cd41a613182256620014edf0e3d76c4d12dd2bc18dbba74f652950bcc0e`.
All 13 packaged source hashes match. Only the proof rehearsal script differs from
the canonical-host image; the other 12 packaged files, base/runtime RootFS and
default command match. Independent task re-review and whole-branch review passed,
with all 38 offline tests passing and no material findings.

Readback at `23:28:05.811956Z` confirmed ECR ACTIVE, zero RUNNING tasks and both
switches false at production/rehearsal versions 1/6. Temporary registry directories
were absent. The four publication, packaging, image-difference and readback
receipts and `final-with-transport-review.md` remain in `/workspace/rehearsal-sdd/`;
the [published-image record](event-broadcast-rehearsal.md#published-passive-observation-image)
lists their exact names. At that publication readback, no live validation or capacity rerun had used this
image. The later authorization and measured October 22 outcomes follow below.

### October 22 source correction, staged evidence and capacity

BASIC authorized autonomous completion within $20, superseding the earlier
per-window/count approval caps and $1 target. Ordinary hosted output remains off.
Explicit task deadlines, sequential source publishers and exact cleanup remain.

Passive observation isolated four 1 to 11 ms, zero-byte source failures before
TCP/TLS. Node family selection required an `all: true` address-array callback;
the relay returned a scalar. Real Node 24 and the exact extracted image Node
22.23.4 reproduced `ERR_INVALID_IP_ADDRESS` before TCP. Commit
`33770f7723f3bdbfa80a710eda3cfa6a5287aa0a` fixes only that shape while retaining
the first prevalidated public IPv4. RED preceded the edit; 6 relay, 1 selected
source-boundary and 38 rehearsal tests passed, followed by independent review.
Image `sha256:fa5515d574355d6a647ce8390285f62edec1ad4f7e6e98956230c0b1391c2548`
has all 13 matching source hashes; only the relay differs from `f8f833`.

Corrected Fargate probes reached actual TCP/TLS, HTTP 200 and decoded source
readiness. After two preserved partial runs, the fresh hybrid passed in 120.968
seconds with readiness/loss/recovery and encoded commands 1/2/3. Sequential source
replacement was verified. Its program recording passed packet verification with
a 33.334 ms maximum gap and one-second GOP. This accepts the real provider source
chain to a local receiver, not public `basicbit` output. The initial embedded CLI
no-op is also preserved; Node 22/24 RED/GREEN entry-guard tests and rereview cover
its correction.

The stored `basicbit` output credential remains rejected by both the current
sender and a legacy POC pusher. The latter failed naturally after 0.73 seconds
with authentication/bad-name indicators. The output secret has no previous-version
fallback. Browser retrieval and AWS replacement
were authorized, but callable browser controls were unavailable. No key was updated.

The five-minute 2 CPU/4 GiB synthetic run failed around 196 seconds with
`renderClockBudgetExceeded`. The same workload on 4 CPU/8 GiB passed 300 seconds,
301.479730396 wall seconds, exit 0, with one primary process, 34 ms maximum packet
gap, one-second GOP, zero maximum queue bytes and 562,741,248 bytes peak worker RSS.
Six artifacts uploaded successfully. This does not change production resources or
establish long-duration capacity, a live Twitch account or provider-output acceptance.

The separate `basicbit1` hold/fence probe passed, exit 0, with 55.998 seconds
of advancing provider output. Dedicated-switch false was observed and the real
worker fenced with `control_failed`; publication and tracked children were gone
after cleanup. Public HTTP 200 capture retained 3,883,008 bytes, decoded to H.264
720p30/AAC and visually matched the neutral hold frame. Startup PPS/header warnings
are preserved. This accepts working-account hold publication and switch fencing,
not the original two-account rehearsal. Final readback at `01:09:32.522792Z`
confirmed zero RUNNING tasks, all five final tasks STOPPED, their interfaces
DELETED, the latest proof definitions INACTIVE and both switches false at
production/rehearsal versions 1/21. The rejected output secret is unchanged.
`basicbit` output, two-account/independent-DJ, real Convex, live Twitch, musical
silence, device and multi-hour capacity gates remain open. See the [October 22 record](event-broadcast-rehearsal.md#october-22-2026-diagnostic-session)
for exact provenance, failed attempts, receipts and remaining gates.

## October 24 Task 9 verification ledger

The source-only checks exercise the actual argv builder and production migration
handlers against Convex-test; they do not start a native backend. The local driver
is import-safe and has bounded real-HTTP execution for ROOT. See the
[rehearsal procedure](./event-broadcast-rehearsal.md#october-24-2026-task-9-source-prerequisites)
for exact environment names, fixed scenarios, receipts and cleanup.

Still required on final source: `pnpm typecheck:backend`, `pnpm test:backend`,
`pnpm test:scripts`, `pnpm verify:api-contracts`, `pnpm typecheck:web`,
`pnpm lint:web`, `pnpm test:web`, canonical local bindings generation and
`pnpm check:backend:generated`. The last command starts a backend; it is not a
static declaration comparison. ROOT must record native exits and source pins,
then retain Python transport/input, exact-image, browser screenshots/video and
VLM review evidence. Add `ci:browsers` and `ci:visuals` to the single implementation
PR before its normal CI run. No PR or deployment readiness follows from this
source ledger. Physical PC/Quest acceptance requires actual clients.

Source verification used Node's child-free runner on three inspected files:
`convex-local-args.test.mjs`, `local-event-broadcast-rehearsal.test.ts`, and
`event-broadcast-migration-rehearsal.test.ts`: 18 tests passed, zero skipped.
The driver test invokes production scheduling against the unchanged map and
records the expected `Unproved broadcast configuration` failure with successful
owned cleanup. That passing negative test does not validate the later lifecycle
scenarios. The full in-memory lifecycle path runs when the production map actually
admits the default profile; no test injects a production admission map.
