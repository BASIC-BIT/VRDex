# Real-event streaming pilot design

Status: proposed execution design. Planning only; no provider or deployment settings changed.

## Outcome and priority

Get BASIC able to try real VRCDN and Twitch DJ inputs through one stable VRCDN
program URL as soon as practical, then start and operate the same experience
through the existing event website. BITRATE is the working target; its selected
event, rehearsal date, participants and device availability are execution inputs.

Both providers means **inputs** for the first trial. The initial output is VRCDN,
720p30 H.264 with AAC320, one worker and no Twitch simulcast. This is the builder's
recommended initial scope, not a withdrawal of the approved 480p/720p/1080p,
30/60-fps, AAC160/320 and optional Twitch-output feature scope.

Success has three separate milestones:

1. **Assisted dress rehearsal:** real mixed inputs, stable host URL, operator-assisted
   Take/Cut/Hold/Return/Stop and actual viewer playback. The website's normal Start
   remains blocked; its console does not control this diagnostic worker.
2. **Website pilot:** the event's normal Start, controls, diagnostics, public watch
   surface and host links work through real backend admission and the dispatcher.
3. **Remaining feature qualification:** other quality/output configurations,
   long-duration/provider edge cases and the complete acceptance matrix.

No claim of milestone 2 follows from milestone 1. Deliver milestone 1 while the
shared production-qualification work continues; do not let an unbounded audit
backlog prevent an honestly scoped personal trial.

## Current evidence and actual blockers

PR #388 merged at `abc8ae07a0bf07ee1309a44e4aedb5705458d650`.
The [retained current-image results](../../engineering/authority/reviews/current-image-smoke/README.md)
show 134 matching packaged source files, native132 passing on Fargate, a roughly
20-second real dual-1080p Twitch to 720p30 Take/Cut/Return result, and a successful
owned `basicbit1` VRCDN publishing/playback codec smoke. They do not establish a
30-minute soak, automatic handoffs, exact output content/freshness, capacity
admission or actual VRChat-device acceptance.

The production allocation map is empty. Normal site Start rejects before session
writes. Its key is `videoPreset:simulcastEnabled`, so `720p30:false` can be admitted
independently, but it authorizes **both AAC160 and AAC320**. Preserve the existing
contract by accepting two 300-second primary-only capacity cases before adding
that single key. The other 22 cases need not delay that key.

The current source-marker contract separately requires the frozen paired canary
and full 79,996-case qualification. Existing conditional execution supports
single PROGRAM and native132 commands; the four-capture/group path still has a
real preparation/design gap. That policy cannot be silently waived by writing a
map entry or declaring a smoke to be qualified capacity. Normal website release
must satisfy it, or adopt an explicitly reviewed replacement contract. This plan
keeps the current contract; no replacement is presumed.

Merged code also does not establish deployment. Backend protocol/map, dispatcher
bundle, image digest, output-account grants and website must be inventoried and
released coherently before the website pilot.

## Approaches considered and recommendation

- **Finish all shared qualification and all 24 capacity cases before any trial.**
  Gives the broadest evidence first, but unnecessarily postpones a personal feed
  trial and the one configuration the first event actually needs.
- **Work only toward one admitted website configuration.** Avoids the other 22
  capacity cases initially and needs no new admission mode. Shared source proof
  and deployment gaps still prevent a reliable promise of immediate availability.
- **Deliver an isolated assisted trial first, with incremental normal admission
  in parallel. Recommended.** Uses the real media worker, output and existing
  command semantics immediately, keeps production fences intact, and exposes the
  remaining site integration work rather than pretending it passed.

This recommendation follows the user's priority of a real-event test ASAP. It
adds no public Start bypass, experimental admission flag or second website console.

## Provider roles and event preparation

Reserve the known-working `basicbit1` account as the sole program output. Never
also ingest that output as an upstream source. Use `basicbit` as a read-only VRCDN
input only after BASIC identifies and authorizes its currently observed 720p60
feed. Its rejected publication credential does not itself prevent playback.
If that feed is unsuitable, use a consenting DJ's independent VRCDN feed or repair
the controlled source account. Identify an existing publisher before replacement;
do not rotate keys or disconnect an unidentified publisher speculatively.

Use a consenting event DJ's canonical Twitch channel. The public channels used in
private diagnostics are not assumed authorized for republication. Configure the
existing event output/source attestations and owner/community account grants.
Keep ingest secrets in the existing secret store; map references explicitly to
the execution role and dispatcher. No raw keys in plans, commands or recordings.

Prepare one timed rehearsal event with two ordered lineup slots, a spare authorized
custom source, an authenticated operator, host playback links and a direct-source
fallback. Date-only events cannot Start. Changing media settings starts a new
session; live settings and allocation snapshots remain immutable.

## Assisted trial architecture and bounds

Extend diagnostic orchestration, leaving the old fixed VRCDN rehearsal unchanged.
Use the current production worker, input manager, Twitch wrapper, supervisors,
renderer, output sender and production command reducer. Only authority/control
transport is diagnostic, as in the existing proof helpers. Sources and output
are pinned in a private run manifest; no production sessions or admission rows are
created. Ordinary native smoke remains distinct from conditional proof acceptance.

The run manifest fixes a fresh run ID, source identities/revisions, one authorized
output, 720p30/AAC320, 4 vCPU/8 GiB initial shape, a 45-minute maximum workload,
180-second finalization reserve and an independent 50-minute provider stop. There
is one program publisher and at most two simultaneous physical input acquisitions.
Do not scale a failed run automatically. Diagnose first; a new shape requires a
new bounded run and budget reservation.

For a genuinely usable assisted trial, provide a small private operator helper:
reuse existing v2 command kinds and encoded acknowledgements through a run-scoped
S3 command object. Root is the sole writer. The worker's temporary diagnostic role
can read only that command object and write only its status/artifact prefix, plus
read the existing rehearsal kill switch. Reuse the execution role's exact output
secret grant. Preserve all unrelated roles and policies.

The command envelope contains `runId`, strictly increasing sequence and at most
32 commands, with an 8-KiB total cap. Each command has a stable operation key,
issued time and expiry no more than 30 seconds later. Allow Take, Cut, Hold,
Return-to-auto, Cancel and Stop only; use existing reducer meanings and reject
unknown IDs, revisions, expired operations and malformed envelopes. Preserve
pending operations rather than overwriting them; Cut/Stop retain their existing
supersession behavior. Poll at most once per two seconds through bounded AWS CLI
children already available in the image. This adds diagnostic transport latency;
record issue/claim/encoded-ack times separately from renderer latency.

Status is bounded to 64 KiB and includes input readiness/freshness, committed and
pending intent, last encoded output progress and typed command outcomes. It never
claims success from enqueue alone. The helper is for BASIC and the assisting
operator, not an unauthenticated public endpoint or a new product control mode.
Two consecutive control-read failures fence publication; Stop and deadline always
fence senders before awaited cleanup. Keep the existing emergency switch and
exact-task stop path. A new task initially waits at most 60 seconds for an armed
run manifest and never publishes before Root verifies its exact-task stop schedule.
Independently scheduled provider stop must work without a live chat session.
Cancel that stop only after the task is confirmed stopped.

Run a clean 1800-second mixed-provider dual-decoder interval before intentional
interruption tests. Keep policy scenarios in a separate controlled-fixture run;
public DJs need not deliberately break their live broadcasts. The assisted trial
must retain real output playback/content observations; codec headers alone are
insufficient. Private recordings remain private and have explicit size/retention
bounds calculated from duration and bitrate before launch. Reuse the existing
private proof recording allowance of 1700 MiB total, with at most 1 GiB for the
program and 64 MiB of independent playback clips. Small records total at most
8 MiB, each at most 1 MiB; commands/status keep their smaller bounds. Stream
uploads in existing 32-MiB manifested parts. Root reserves 6 GiB local space for
two complete reads and verification; signed URLs and private media are excluded
from public artifacts. These are diagnostic recording bounds, not amendments to
conditional qualification or R90/R94 limits.

## Handoff and failure acceptance

Use a controlled current-image fixture server and the actual worker/renderer.
Record independently decoded source identity, output timestamps, command
acknowledgements, publication progress and cleanup for each scenario:

- Healthy A overruns its scheduled end while eligible ready B waits: stay on A.
- Digital-zero intervals shorter than the configured silence duration do not
  switch; an audible burst resets accumulated silence. At -90 dBFS for 15 seconds,
  progressing A with eligible freshly decoded-ready B switches to B.
- Silence before eligibility never bypasses the authored boundary. Missing or
  unready B never becomes a fabricated successful handoff.
- Source death produces confirmed decoder failure, then eligible ready B or slate.
  One second is the policy confirmation interval, not a promised viewer latency.
- An explicit maximum overrun triggers B or slate while A stays healthy.
- Manual hold suppresses automatic successor selection across boundary/silence;
  source loss can still require safe slate. Cut supersedes a pending Take, and
  explicit Return restores automation.
- Failed or canceled preparation keeps the previous committed source/mode.
  Browser source-hint failure becomes Unknown and never changes the program.
- Stop, lease/control loss, kill-switch false and session deadline actually stop
  sending. No retry may resume publishing after terminal authority loss.

Controlled faults prove media/control behavior, not forced failure of a real
provider. Real ads, expiry and interruptions count as observed only when seen.

## Qualification and website release

Produce a finite readiness packet for the exact candidate before more formal
proof launches: required originals and their identities, actual image/runtime
inventory, missing inputs, supported commands, canary/group transport and replay,
resource/retrieval bounds and cleanup ownership. Classify every item as verified,
needs review or missing. A single PROGRAM result cannot fill a paired-canary row.
If command support is missing, produce and review its bounded execution design
before coding or launching it. No open-ended search through old audit chatter.

After supported exact-image proof preparation, perform genuine prelaunch Root
approval and required source qualification; accept the canary before bulk groups.
Then prioritize 720p30 primary-only AAC160 and AAC320 at 300 steady dual-decode
seconds each. Preserve current resource/media/marker/cleanup thresholds, including
CPU P95 strictly below 80%, internal delay below two seconds, 100-ms A/V limit and
PSNR at least 28. Do not subtract generator, transport or diagnostic overhead.

Only accepted evidence may populate `720p30:false` with measured shape/evidence
identity. All other keys remain absent. Backend and dispatcher use the same map;
worker image stays pinned and verifies actual ECS metadata. Run the real local
whole-flow migration/session rehearsal, not its admission-blocked mode or a test
resolver. Reflect genuinely unavailable configurations honestly in operator setup;
do not expose another enable switch.

Inventory live deployments, quiesce sessions and ambiguous dispatch ownership,
deploy compatible backend/dispatcher/web and exact image, run required migration
under its existing fences, confirm output grants and concurrency cap one, then
Start from the real event console. The first website trial is an exclusive,
bounded operator window: pre-arm a 50-minute stop using the existing emergency
switch before Start, then add an exact-task stop as soon as its ARN is observed.
Refuse a global emergency-stop schedule if another session or publisher would be
affected. Keep the existing one-session cap and remove stop automation only after
actual sender/task cessation. A calendar end does not stop the program, and the
current server session deadline can be 12 hours; neither is a 45-minute test cap.
No new enable flag is introduced. No blind protocol-1 rollback after protocol-2
migration and no deleting reservations to manufacture available capacity.

## Real-event completion and rollback

Milestone 2 is complete only when BASIC can configure both source providers, add
an off-lineup custom source, Start from the website, operate Take/Cancel/Cut/Hold/
Return/Stop, see honest source/worker/output state, and watch the stable program
URL in the target world. Capture actual PC and standalone Quest player evidence
when those devices are available. Missing Quest evidence remains a visible gap;
PC testing can proceed without falsely claiming Quest acceptance.

Keep a direct authorized performer link available as the human fallback. Cut to
slate for a pause; Stop for terminal shutdown. For control failure, fence through
the existing emergency switch and exact-task recovery. Confirm provider output
cessation, ECS STOPPED, inactive run-created definitions, absent ENIs, closed child
groups and correct admission reconciliation. Preserve false fencing if authority
is uncertain. Restore only compatible deployments and confirmed account ownership.

Complete the remaining 22 capacity cases after the first admitted configuration.
Twitch simulcast needs separate output credentials and provider acceptance; it is
not a prerequisite for Twitch DJ inputs. Rebuild/retest affected proofs after
runtime changes rather than inheriting old image results.

## Cost and execution discipline

The standing ceiling is $20 total. Preserve the existing ledger: $16.56346 held,
$1.75346 estimated compute excluding network/storage; $3.43654 is currently
unreserved. Before paid work, itemize outstanding reservations and conservative
network/storage/compute bounds. Release a closed reservation only with an explicit
history-preserving reconciliation; never reset the budget or substitute compute
cost for total spend. Stage work within available headroom and stop new paid
launches before the ceiling. Do not create a NAT gateway for testing.

A 45-minute 4-vCPU/8-GiB worker is about $0.148 compute at the previously observed
$0.19748/hour rate, before transfer/storage. Price and cap each complete run,
including controlled fixtures, receivers, recordings and teardown. The full shared
qualification budget needs its own finite estimate before bulk release; no promise
that all qualification fits the remaining budget is made.

Keep the already selected subagent-driven implementation method. Use focused
reviews and existing controls; do not introduce repeated approval menus or new
per-feature toggles. The only missing human execution inputs are the actual event
and time, authorized live DJ feeds, identification of any occupied provider account,
and availability of the target VRChat devices.
