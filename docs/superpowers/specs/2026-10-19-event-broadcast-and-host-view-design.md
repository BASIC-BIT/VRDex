# Event broadcast, host view, and persistent playback

Status: approved by BASIC in this chat on October 19, 2026. Recommendations below
are approved design direction, not shipped behavior or verified provider readiness.

## Outcome and delivery

Deliver one cohesive PR through multiple implementation, verification, and review
rounds. Extend the existing event media system rather than introduce another
control plane. The useful end result is:

- Hosts can open an event-specific lineup with performer links and live status.
- An event can broadcast one continuous program through organizer-owned VRCDN
  and optional Twitch destinations, preserving output links across DJ changes.
- Visitors can start watching on an event page and continue listening while
  navigating VRDex.

Confirmed direction: schedules must not cut off healthy sets automatically.
Silence, stream death, or an explicit cutoff determines handoff. Direct performer
links remain useful independently and provide a fallback during worker failure.

## Existing foundations and limits

Inspected on October 19 at repository commit `0d7246b`:

- `convex/_eventMediaControl.ts`, `schema.ts`, and `events.ts` already model
  programs, sources, scenes, outputs, commands, sessions, permissions, and audit.
- `scripts/event-media-ecs-bridge.mjs` starts and stops ECS tasks. Its command
  claim path currently selects only `start_program` and `stop_program`.
- `workers/restream/live-control.mjs` and `vrcdn-poc.mjs` demonstrate runtime
  source/hold switching. The default container command remains the synthetic
  benchmark worker, not a complete production event worker.
- Deployment notes record a successful 30-minute 720p30 VRCDN relay. This is
  historical evidence, not a fresh live verification of arbitrary source loss.
- Event authoring already includes private VRCDN output setup and worker status.
- Event pages collect public DJ links with PC/Quest copying and support VRCDN
  playback, Twitch embeds, and a browser-local performer sequence.
- VRCDN and Twitch server live-status helpers exist. Provider status observations
  are distinct from decoded-media readiness and audio observations.

The September lineup design deliberately excluded shared restreaming. This design
adds that mode without changing existing authored events into managed broadcasts.

## Approach

Current recommendation: extend the existing Convex control plane and one worker
per event session. Publish one composed program to destination-specific senders.
Put a read-only host view alongside authenticated broadcast controls, and retain
one browser playback owner in the root layout.

Alternatives considered:

- External OBS plus event links is simpler operationally but does not implement
  the shared automatic handoff requested here. Keep it supported as manual mode.
- Browser-only switching is useful today but cannot give a world player one
  continuous output or synchronize every listener's source.

### Host and operator view

Provide a host page reachable from the event page. For published events, its
read-only roster contains only the same public performer data as the event.
Private/draft events retain existing access checks. Keep freeform performers and
missing-link slots visible; preserve repeated appearances rather than deduplicate
away scheduled slots.

Each row shows local set time, performer, selected source, source status, and
copy/open actions for available VRCDN PC/Quest and Twitch links. Other public
stream choices remain accessible when a performer has several. Preview opens
only on explicit action; opening the roster must not play every source.

Keep scheduled-current, source-live, and broadcast-selected state separate.
Multiple performers can be live simultaneously. Show an unavailable/unknown
state for failed or expired checks with observation time available to operators.
Deduplicate and bound provider probes across views. Do not use these cached
indicators as the worker's automatic handoff evidence. VRCDN probes touch the
media endpoint, so measure provider connection impact during validation.

Authorized operators additionally get current/next source, output health, manual
source selection, next, hold, automatic-mode toggle, start, and stop. Reuse
community/event capabilities and enforce them in backend commands. Private task
details, credentials, source diagnostics, and audit details stay authenticated.
An ordinary host copying links gains no broadcast-control authority.

### Continuous event program

Convex owns intended state, accepted commands, session identity, and audit.
The worker owns decoding, source observations, program rendering, and output
health. Persist observed state separately so an accepted command is not reported
as an audible switch before the worker acknowledges it.

Use session-scoped command sequence numbers, acknowledgements, renewable leases,
and fencing so retries cannot start duplicate broadcasts and an old worker
cannot continue acting after replacement. Connect live control commands to the
running media process rather than restarting the program for each switch.

The render clock and hold source must survive a missing input. A dead performer
must not freeze FFmpeg or terminate the whole program. Bound current/next input
connections, isolate decoding failures, and reconnect inputs with backoff. Prove
the pipeline architecture with source death and recovery before building all
operator controls around it. If the present filter graph cannot satisfy that
contract, revise the input handling behind the same control-plane interface.

VRCDN browser playback uses the existing MPEG-TS transport; do not assume its
derived HLS URL is available. Preserve separate PC and Quest playback links.
One stable program does not imply one universal URL works in every VRChat player.

### Handoff policy

Represent policy as explicit state transitions with monotonic observation time
separate from schedule time. Reuse applicable pure lineup timing rules, while
keeping browser and shared-worker ownership separate.

1. Prepare the next eligible slot at most two minutes before its boundary.
2. Before the next slot starts, never promote it automatically. If the current
   source dies, show hold and retry the current source until another is eligible.
3. At or after the boundary, continue healthy current playback. Switch only on
   qualified source silence or confirmed media failure, with fresh evidence.
4. Confirm media failure for at least one second; temporary provider-status
   errors alone do not qualify. Reset evidence after recovery or source changes.
5. Silence must mean sustained input audio below a calibrated threshold, with
   decoded media progressing. Viewer mute/volume and missing audio analysis are
   not silence. Automatic silence handoff remains disabled until calibration
   passes representative quiet intros, breakdowns, and actual set endings.
6. Switch only when the next source has fresh decoded-media readiness. Otherwise
   keep healthy current output, or use hold if the current source has failed.
7. Manual source selection suspends automatic following. Returning to automatic
   mode explicitly reconciles the current slot and eligible successor.

Current recommendation: optional maximum overrun is off by default. If configured,
its deadline forces current output to the next ready source or hold. An operator
may explicitly choose a source early; automatic eligibility does not restrict
that deliberate action. Manual hold suspends handoffs until released.

After the last set, do not select a nonexistent successor. Retain healthy output
until manual stop or the session's explicit stop deadline. Event calendar end is
not itself a media cutoff. Every session has a bounded maximum duration, and a
forced stop is visible to operators before it occurs.

### Destinations and credentials

Start with organizer-owned output accounts and existing scoped secret storage.
Store credential references, not stream keys or combined secret ingest URLs, in
Convex. Reuse existing source/output authorization and compliance requirements;
check current provider terms before enabling hosted output.

Implement Twitch as an optional RTMP/RTMPS destination using the authorized source
program. Preserve Twitch watch links and supported embeds. Do not extract Twitch
playback media as a rebroadcast input. Provider status credentials and broadcast
credentials have different purposes and scopes.

Use bounded, independent destination queues and reconnect loops. A Twitch outage
must neither block nor restart a healthy VRCDN output. Report each destination's
observed health. Validate encoding and keyframe settings against current provider
requirements and measure worker cost with both destinations active.

### Persistent browser playback

Mount one playback owner beneath the shared root layout. Event pages and a compact
player control that owner; route components must not own the active media element.
Keep the media element mounted during client navigation and change its presentation
without destroying the decoder. Reuse transport and player controls.

Start only after explicit Play. Browsing another event never replaces the current
stream. Pressing Play for another event deliberately replaces it. Provide pause,
volume/mute, close, source/event identity, and return-to-event controls. Closing
disposes connections; pausing keeps no next-source preparation running.

Support managed VRCDN output, direct VRCDN event streams, existing performer
sequence, and supported Twitch embedding through explicit playback variants.
Keep one audible foreground player; operator source previews are deliberate,
separate muted-by-default inspections. Twitch needs its supported player API for
controls and must satisfy embed parent and player sizing rules. Do not hide a
Twitch video player to simulate background audio. Use a compliant visible size
or retain its larger player presentation when needed.

Hard reloads, external navigation, and closed tabs do not preserve playback.
Do not promise mobile background playback. Refresh metadata while mounted so
changes and revocation are reflected without resetting healthy media needlessly.
Re-evaluate cancel/end state without treating wall-clock event end as a healthy
stream cutoff. Keep existing watch-window rules for starting new playback.

## Work rounds within one PR

1. Contracts and failure proof: reconcile existing commands/schema; test source
   death, hold, replacement, and destination isolation using local synthetic feeds.
2. Host view: reuse roster links and provider status, then visually review a
   realistic event on desktop and mobile.
3. Broadcast worker: implement command consumption, leases, handoffs, independent
   senders, recovery, and real runtime safeguards. Exercise full event scenarios.
4. Operator controls: connect acknowledgements, previews, and fallback actions.
   Review the workflow at a usable checkpoint before polish.
5. Persistent playback: promote existing playback into the shared owner and prove
   navigation continuity for managed output and existing watch modes.
6. Integrated review: full failure rehearsal, docs, security/permission review,
   provider validation where access is available, and one PR for the whole change.

Rounds can produce multiple commits and review cycles. Keep the same PR and
rewrite its description around final behavior. A blocked provider test must be
reported as blocked, not counted as passing or silently dropped from scope.

## Verification and rollout

- Pure policy tests cover late/early DJs, gaps, repeated appearances, quiet
  passages, stale observations, failure confirmation, manual hold, cutoff,
  missing-next-source, final slot, and separate clock domains.
- Backend tests cover capability checks, public/private projections, command
  retries, lease expiry, worker fencing, acknowledgement, and bounded duration.
- Real local FFmpeg tests cover source death/recovery, audio continuity,
  hold output, timestamp progression, repeated switches, and one failed sender.
- Browser tests prove the same media session survives route navigation, no
  duplicate audio starts, explicit replacement works, and close releases resources.
  Include existing performer sequence and Twitch API behavior.
- Capture desktop/mobile screenshots and visually inspect host, operator, inline,
  compact, unavailable, and recovery states. Review exact substantive public copy
  with BASIC under the repository copy policy before shipping.
- A real two-source VRCDN event rehearsal and optional Twitch output run verify
  audible transitions, continuous output, disconnect recovery, and provider links.
  Include a sustained run at the advertised quality and measured worker cost.

Hosted output remains disabled by default until existing provider and operational
gates and fresh acceptance evidence pass. One PR can contain the implementation
without enabling unverified hosted output in production. Keep max duration,
concurrency cap, kill switch, budget monitoring, and documented operator rollback.
Update deployment, API/MCP, public usage, and engineering docs alongside behavior.

## Scope boundaries

This PR targets an event-duration program with organizer-owned destinations.
It does not add 24/7 broadcasting, pooled provider accounts, VRDex viewer delivery,
raw Twitch ingestion, recording publication, or a new Discord control project.
Preserve existing Discord command compatibility through the shared backend.

## Source trail

- `docs/planning/restreaming-media-control.md`
- `docs/deployment/restream-worker.md`
- `docs/planning/event-lineup-live-design-2026-09-14.md`
- `docs/engineering/event-lineup-verification.md`
- `apps/web/src/lib/server/twitch-live.ts`
- `apps/web/src/lib/vrcdn-live.ts`
- `apps/web/src/app/_components/event-dj-links.tsx`
- `apps/web/src/app/events/event-editor-form.tsx`

Provider requirements must be rechecked during implementation against the Twitch
embed/broadcast docs, VRCDN docs, and VRChat player guidance linked by the existing
restream planning document. Repository evidence alone does not establish current
provider authorization or production readiness.
