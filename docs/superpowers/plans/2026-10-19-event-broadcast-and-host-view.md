# Event broadcast and host view implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete event host tools, continuous event broadcasts, and persistent
browser playback in one PR with independently verified work rounds.

**Architecture:** Extend the existing Convex media control plane and ECS bridge.
A session-fenced worker observes and switches inputs while independent senders
publish the program. One root-layout browser owner retains playback across routes.

**Tech Stack:** Next.js, React, TypeScript, Convex, Node, FFmpeg, ECS/Fargate,
Secrets Manager, existing VRCDN MPEG-TS playback, and supported Twitch APIs.

**Spec:** [Approved design](../specs/2026-10-19-event-broadcast-and-host-view-design.md).
Read the spec before executing any task.

## Global constraints

- One PR, multiple commits and implementation/review rounds.
- Prepare the next eligible slot at most two minutes before its boundary.
- Confirm media failure for at least one second.
- Before the next slot starts, never promote it automatically.
- Current recommendation: optional maximum overrun is off by default.
- Automatic silence handoff remains disabled until calibration passes
  representative quiet intros, breakdowns, and actual set endings.
- Event calendar end is not itself a media cutoff.
- Hosted output remains disabled by default until existing provider and
  operational gates and fresh acceptance evidence pass.
- Operator-owned destinations; no raw Twitch ingestion or provider account pool.
- Keep direct links, separate PC/Quest URLs, and existing watch modes working.
- Existing backend permissions and private/public boundaries apply to every task.
- Review substantive public copy with BASIC before shipping; no invented approval.
- Application tooling requires Node 24 and repository-pinned pnpm 10.15.1.
  Do not silently change the existing Node 22 worker image without testing it.

## Review focus

- Repeated appearances or a link revoked during an event must preserve slot
  identity and stop offering the revoked source. Tasks 2, 4, 5, and 8 pin this.
- Replayed commands and overlapping replacement workers must not produce two
  broadcasters or acknowledge a stale switch. Tasks 1 and 5 pin this.
- A connected but frozen/silent input must not be mistaken for a ready successor
  or block the continuous hold program. Tasks 3 and 5 pin this.
- Failed, slow, or invalid Twitch output must not interrupt VRCDN or leak its
  stream key through FFmpeg errors. Task 6 pins this.
- Back/forward navigation, rapid Play clicks, and sign-in layout changes must
  retain at most one audible browser session. Tasks 8 and 9 pin this.

## File and responsibility map

- Existing `convex/_eventMediaControl.ts`, `schema.ts`, and `events.ts`: authoritative
  configuration, command/session persistence, capability checks, public projection.
  Extract new worker mutations into `convex/eventMediaWorker.ts` rather than adding
  another large block to `events.ts`; existing entry points remain compatible.
- New `convex/_eventBroadcastInputs.ts`: validated policy and worker payloads,
  schema-derived record types, configuration bounds, safe source projections.
- New `workers/restream/handoff-policy.mjs`: pure decision function with JSDoc
  types; keep it directly executable in the existing worker container.
- New `workers/restream/input-supervisor.mjs`, `program-renderer.mjs`,
  `output-sender.mjs`, `event-worker.mjs`: decoding, stable program clock,
  independent destinations, and session/control-loop orchestration respectively.
- Existing `scripts/event-media-ecs-bridge.mjs`, worker Dockerfile, and Terraform:
  start the real worker with scoped credentials and enforce runtime limits.
- New `apps/web/src/lib/server/event-source-status.ts`: bounded provider status
  aggregation using existing VRCDN/Twitch helpers.
- New `apps/web/src/app/[slug]/events/[eventSlug]/host/page.tsx` and sibling
  `operate/page.tsx`: public-safe roster and authenticated controls respectively.
  Add server authorization before rendering private data, not just hidden buttons.
- New `_components/event-host-view.tsx` and `event-operator-view.tsx`: host roster
  and observed/commanded broadcast UI; existing editor links to the operator route.
- New `apps/web/src/lib/event-playback-owner.ts` and
  `_components/event-playback-provider.tsx`: playback lifecycle and React binding.
- New `_components/event-compact-player.tsx`: compact presentation using existing
  controls; existing event players become clients of the retained owner.

## Round 1: Contracts and media failure proof

### Task 1: Session ownership and command acknowledgement

**Files:** modify `convex/schema.ts`, `_eventMediaControl.ts`, `events.ts`;
create `_eventBroadcastInputs.ts`, `eventMediaWorker.ts`, and
`tests/backend/event-media-worker.test.ts`.

**Interfaces:** add worker mutations `acquireSession`, `renewSession`,
`claimCommands`, and `acknowledgeCommand` under `eventMediaWorker`. Every request
uses the existing bridge credential plus session ID, worker ID, and fencing epoch;
every command has a monotonically increasing session sequence. Derive IDs and
record types from Convex schema. Acquiring returns either a lease containing
`epoch`, `expiresAt`, and selected configuration, or an explicit denied result.
Renew every 10 seconds with a 30-second lease; expiry fences media publication.
Acknowledgement carries command ID, sequence, and actual outcome, never credentials.

- [x] Write tests `duplicate_start_is_idempotent`, `expired_owner_cannot_ack`,
  `replacement_increments_epoch`, and `queued_switch_does_not_change_observed_source`.
  Assert one open owned session, old epoch rejection, monotonic sequencing, and
  unchanged observed source until acknowledgement. Include unauthorized actor and
  cross-event IDs. Reuse existing backend test helpers for actual Convex mutations.
- [x] Run `node --conditions=import --import tsx --test tests/backend/event-media-worker.test.ts`;
  verify the new expectations fail before implementing them.
- [x] Implement the mutations, backend validators, additive schema fields, and
  compatibility handling for legacy records without sequence/epoch fields.
  Preserve existing web/Discord command vocabulary and audit rejected commands.
- [x] Rerun that command and `pnpm typecheck:backend`; require all passing.
- [x] Commit as `feat: fence event media sessions and acknowledge worker commands`.

### Task 2: Deterministic shared-program handoff policy

**Files:** create `workers/restream/handoff-policy.mjs` and
`tests/backend/event-broadcast-policy.test.ts`; modify `_eventBroadcastInputs.ts`.

**Interfaces:** export `decideHandoff(input)` from the worker policy module.
Input includes `scheduleNow`, `observationNow`, `mode`, current/next slot identity,
current evidence, next readiness, and validated policy. Return a discriminated
decision: `stay`, `prepare` with slot key, `switch` with slot key and reason,
`hold` with reason, or `stop` with reason. No side effects or provider calls.
Policy contains optional silence threshold/duration and optional maximum overrun;
unconfigured silence and overrun are disabled. Keep observations monotonic.

- [x] Write table tests asserting: healthy playback survives the boundary; failed
  current source before next start produces hold; 999ms failure cannot switch;
  1000ms confirmed failure can switch only to ready eligible next; stale evidence
  cannot switch; configured cutoff uses hold if next is unavailable. Include
  manual hold, overlapping slots, gaps, duplicate performer appearances, source
  revocation, missing analyzer, final slot, and explicit session deadline.
- [x] Run `node --import tsx --test tests/backend/event-broadcast-policy.test.ts`;
  confirm failure, then implement the pure reducer and configuration validation.
- [x] Rerun policy tests and existing `tests/web/event-playback.test.ts`; both
  must pass. Do not change browser handoff semantics incidentally.
- [x] Commit as `feat: define evidence-based event broadcast handoffs`.

### Task 3: Prove a continuous render clock through input death

**Files:** create `workers/restream/input-supervisor.mjs`, `program-renderer.mjs`,
`scripts/event-broadcast-failure-proof.mjs`, and
`tests/backend/event-broadcast-renderer.test.ts`; reuse `live-control.mjs`.

**Interfaces:** `createInputSupervisor({ source, clock, onObservation })` returns
`start()`, `stop()`, and readiness/health observation access. The renderer's
`createProgramRenderer({ quality, onProgress })` returns `start()`,
`selectSource(slotKey)`, `hold()`, and `stop()`. Supervise decoders separately from
the always-running hold/program clock. Use bounded frame/audio buffers; a stopped
decoder cannot hold open the output clock. Keep at most current and next inputs.

- [x] Add a real FFmpeg harness with two labeled local audio/video feeds and a
  hold slate. Kill current, stall next, recover next, and switch repeatedly.
  Assert program timestamps keep advancing, output remains decodable, stalled
  next is not ready, hold is visible, and recovered audio is present.
- [x] Run `node scripts/event-broadcast-failure-proof.mjs`; record the initial
  failure against the existing POC graph before selecting the input isolation.
- [x] Implement supervised input and renderer lifecycle; use hard switches first.
  Bound reconnect backoff at 1, 2, 4, 8, then 10 seconds and release obsolete inputs.
  If the current FFmpeg build cannot meet the renderer contract, stop and revise
  this implementation section with measured evidence before UI integration.
- [x] Require the proof to complete a 180-second scenario with no timestamp
  regression and max processing delay under 10 seconds. Run the focused renderer
  tests with `node --import tsx --test tests/backend/event-broadcast-renderer.test.ts`.
- [x] Commit code and an engineering evidence note with exact commands/results.

## Round 2: Useful host view

### Task 4: Public-safe roster and bounded live status

**Files:** create `event-source-status.ts`, host route, `_components/event-host-view.tsx`,
`tests/web/event-host-view.test.ts`, and `apps/web/e2e/event-host-view.flow.spec.ts`;
modify `_eventPublic.ts` and `_components/event-public-page.tsx` only as needed.

**Interfaces:** `getEventSourceStatuses(sources)` returns observations keyed by
normalized provider/source ID with `state: live | offline | unavailable` and
`observedAt`. Accept only public projected sources. Cache deduplicated checks for
30 seconds, allow four concurrent probes, and expire indicators after 60 seconds.
Retain the existing helpers' actual observation timestamp; reading cached results
does not make them fresh. Read-only host rows use authored slot identity.

- [x] Write tests for repeated performer slots, missing links/freeform performers,
  multiple live sources, revoked links, provider timeout, expired observations,
  unpublished event access, and no output-account/secret/task data in responses.
- [x] Run `node --import tsx --test tests/web/event-host-view.test.ts` and confirm
  failure before implementing aggregation and roster rendering.
- [x] Reuse existing DJ link parsing/copy primitives and provider status helpers.
  Add a link from the event page. Do not mount preview media until explicit action.
- [x] Run unit tests and
  `pnpm --filter web exec playwright test event-host-view.flow.spec.ts --project=desktop-chromium --project=mobile-chromium`.
  Verify PC/Quest copying, unavailable status, and zero unsolicited previews.
- [x] Capture and inspect desktop/mobile screenshots; show the usable host view
  at the first UX checkpoint. Commit as `feat: add event host links and live status`.

## Round 3: Real event worker and destinations

### Task 5: Connect worker ownership, policy, and observations

**Files:** create `workers/restream/event-worker.mjs`,
`tests/backend/event-broadcast-worker.test.ts`; modify bridge, Dockerfile,
`infra/terraform/restream-worker/{main.tf,variables.tf,terraform.tfvars.example}`,
and `docs/deployment/restream-worker.md`.

**Interfaces:** worker loads validated session configuration from Task 1; polls
commands every second, renews the lease on Task 1's cadence, executes Task 2's
decisions through Task 3, and acknowledges after observed execution. Stop publishing
on lease loss, kill switch, or explicit deadline. Poll the kill switch every
10 seconds and fail closed on inability to establish enablement.

- [x] Write tests for retries, out-of-order/replayed commands, process restart,
  lease expiry, permission revocation, config/link changes, max duration, kill
  switch failure, and current-vs-next status. Assert stale owners stop and report
  actual media progress rather than just ECS running state.
- [x] Run `node --import tsx --test tests/backend/event-broadcast-worker.test.ts`;
  observe failures, then implement control loop, secret-safe diagnostics, and
  scoped credential wiring. Persist no raw input/output secrets in event records.
- [x] Select the real worker command explicitly for event sessions; retain
  benchmark/POC entry points. Enforce concurrency admission before creating tasks.
  Fence expired tasks before authorizing replacement output; provider ingest
  ownership must be checked during real rehearsal as well as local tests.
- [x] Run worker tests, existing media-control tests, the failure proof, and
  Terraform format/validation with no apply. Add runtime/heartbeat/command-latency
  metrics and document worker-hour/egress measurement and budget alarm setup.
- [x] Commit as `feat: run controlled event broadcasts with enforced session limits`.

### Task 6: Independent VRCDN and Twitch output senders

**Files:** create `workers/restream/output-sender.mjs`,
`tests/backend/event-broadcast-output.test.ts`; modify worker, Dockerfile,
output setup validators, account configuration, bridge secret mapping, and docs.

**Interfaces:** `createOutputSender({ destination, credentialRef, program, onHealth })`
returns `start()`, `stop()`, and observed health. Destination is `vrcdn` or
`twitch`; secret resolution happens only in the worker boundary. Each sender has
an independent bounded queue capped at two seconds and restart/reconnect loop.

- [x] Write tests for one blocked sender, Twitch disconnect, invalid credentials,
  missing destination setup, and error output containing a synthetic secret.
  Assert VRCDN progresses, queue memory stays bounded, and secrets are redacted.
- [x] Run `node --import tsx --test tests/backend/event-broadcast-output.test.ts`;
  confirm failure. Check current Twitch ingest/encoding and embed requirements,
  VRCDN guidance, and applicable existing provider gates before implementation.
- [x] Implement isolated senders from the composed program, destination-specific
  credentials/status, and validated output setup. Reuse encoded packets where
  compatible, but never share a blocking destination write path.
- [x] Run output tests and extend the real failure proof with two local RTMP
  destinations; disconnect one and assert the other continues for the entire run.
  Document the supported quality settings and measured additional CPU/egress.
- [x] Commit as `feat: publish isolated VRCDN and Twitch event outputs`.

## Round 4: Operator control room

### Task 7: Authenticated controls with actual execution state

**Files:** create operate route, `_components/event-operator-view.tsx`,
`apps/web/e2e/event-operator.flow.spec.ts`; modify editor navigation and existing
media command/configuration handlers. Extend `tests/backend/event-media-worker.test.ts`.

**Interfaces:** operator UI consumes existing media status plus Task 1's observed
source, command acknowledgement, lease, and per-destination health. Submit commands
through the authorized backend; no browser bridge credentials or secret values.
Separate scheduled current, live input, commanded source, and observed output.

- [x] Write tests for anonymous/read-only host access, unauthorized command
  attempts, revoked capability, double-click next, stale acknowledgements, and
  worker failure while direct links remain accessible.
- [x] Run focused backend and browser tests to confirm failure, then implement
  start/stop, source selection, next, manual hold, return-to-auto, policy setup,
  muted-by-default preview, and command pending/failed states. Confirm stop before
  execution; never report queued commands as completed switches.
- [x] Verify `event-operator.flow.spec.ts` on desktop/mobile, including failed
  Twitch output while VRCDN remains healthy and recovery from a held state.
- [x] Capture and inspect screenshots; review exact new public prose with BASIC.
  Commit as `feat: add event broadcast operator controls`.

## Round 5: Persistent browser player

### Task 8: One retained playback owner and transport adapters

**Files:** create `lib/event-playback-owner.ts`,
`_components/event-playback-provider.tsx`, `lib/twitch-player-adapter.ts`,
`tests/web/event-playback-owner.test.ts`; modify root layout and existing VRCDN,
lineup, and watch-surface components.

**Interfaces:** export an `EventPlaybackOwner` with `play(request): Promise<void>`,
`pause()`, `setVolume(number)`, `setMuted(boolean)`, `close()`,
`update(request)`, and `subscribe(listener): () => void`. Requests discriminate
`vrcdn`, `performer_sequence`, and `twitch` with stable event/source identities.
Provider owns the media mount for its entire lifetime; route UI never reparents or
recreates the active element. Reuse `EventLineupSession` lifecycle behind an adapter.

- [x] Write tests for rapid Play replacement, repeated same-event Play, rejected
  autoplay, old async completion after replacement, close, revoked source, late
  metadata update, pause releasing prepared input, and volume independent of
  source-silence evidence. Assert one owner and disposal of superseded resources.
- [x] Run `node --import tsx --test tests/web/event-playback-owner.test.ts`;
  confirm failure, then implement generation-guarded lifecycle and React binding.
- [x] Use the supported Twitch player API and a visible compliant player size;
  load the SDK once. Browser controls map to real player operations, including
  unavailable/autoplay-blocked states. No hidden Twitch audio extraction.
- [x] Rerun owner tests plus existing lineup lifecycle/player tests; ensure
  provider mounting works with and without Clerk/Convex configuration.
- [x] Commit as `feat: retain event playback across client navigation`.

### Task 9: Compact presentation and route continuity proof

**Files:** create `_components/event-compact-player.tsx`,
`apps/web/e2e/event-persistent-playback.flow.spec.ts`; modify inline player controls,
root layout spacing, and relevant Storybook stories.

**Interfaces:** inline and compact controls consume Task 8's same owner snapshot;
no second media instance. Show compact presentation away from the active event,
with return link, pause, mute/volume, close, and active event/source identity.
Use a larger visible presentation when Twitch's minimum player size requires it.

- [x] Write browser assertions for event-to-profile-to-event navigation,
  back/forward, rapid alternate Play clicks, client auth/layout changes, and
  mobile navigation. Compare media identity and progressing timestamps before
  and after navigation; assert one audible source and close releasing transport.
- [x] Confirm the new browser tests fail, then connect compact/inline controls,
  source title changes, keyboard focus, mobile safe-area spacing, and explicit
  replacement. Existing scheduled watch-window rules govern new starts.
- [x] Run
  `pnpm --filter web exec playwright test event-persistent-playback.flow.spec.ts --project=desktop-chromium --project=mobile-chromium`.
  Include managed/direct VRCDN and performer-sequence cases; use the supported
  Twitch SDK stub for deterministic controls and a separate live embed check.
- [x] Capture and inspect screenshots on all existing themes and mobile sizes.
  Commit as `feat: add persistent event player presentation`.

## Round 6: Integrated verification and one-PR delivery

Tasks 1–9 completed their independent implementation and review rounds; the
controller state and per-task reports retain commit and verification evidence.

### Task 10: Calibration, rehearsal, documentation, and review

**Files:** update deployment/planning docs, API contracts/OpenAPI and MCP docs if
fields change, public event help, and `docs/engineering/event-broadcast-verification.md`.
Extend local proof scenarios and existing compatibility tests.

- [ ] Calibrate silence with rights-cleared quiet passages, intros, breakdowns,
  and true end-of-set examples. Record selected threshold/duration and false
  positives. Enable automatic silence only after those criteria pass; leave it
  explicitly disabled and report the gap if representative evidence is missing.
- [ ] Run `pnpm lint:web`, `pnpm typecheck:web`, `pnpm typecheck:backend`,
  `pnpm test:web`, `pnpm test:backend`, API/MCP/Discord compatibility checks for
  changed surfaces, `pnpm lint:markdown`, and affected builds. Run browser suites
  from Tasks 4, 7, 9 plus existing event-lineup/watch-mode regressions.
- [ ] Run the 180-second local failure proof and a sustained event-duration
  rehearsal at the claimed quality. Include healthy overrun, silence, source
  death, late next DJ, operator override, replacement worker, Twitch failure,
  maximum session stop, and direct-link fallback. Record resource cost.
- [ ] Discover native provider/GitHub tools first. Verify intended accounts and
  permissions before real two-source VRCDN/Twitch tests. Provider writes and
  billable task runs require the repository's explicit operator authorization;
  prepare exact run configuration/results for review first. Lack of access is
  a recorded blocked live check, never a successful verification.
- [ ] Perform a whole-branch review, including public/private projection,
  credential/log redaction, worker fencing, output isolation, browser lifecycle,
  and exact public copy. Address findings and rerun only affected checks.
- [ ] Open or update one PR with `ci:browsers` and `ci:visuals`, attach its URL
  to this chat, and keep every round on that PR. Summarize actual behavior,
  evidence, disabled capabilities, and any unresolved live-provider checks.
  Do not claim production readiness from synthetic tests alone.

## Plan self-review and execution readiness

Coverage: host view is Task 4; worker contracts/policy/rendering are Tasks 1–3 and
5; independent destinations are Task 6; controls are Task 7; persistent playback
is Tasks 8–9; runtime/provider/quality/copy/documentation gates are Task 10.
The five review-focus risks have explicit tests in their owning tasks.

Dependency order: 1 → 2 → 3; 4 can follow those without hosted access; 5 consumes
1–3; 6 consumes 5; 7 consumes 4–6; 8–9 share only public playback contracts;
10 validates the integrated result. If delegating, preserve these ownership
boundaries and use a single integrator for shared schema and event entry points.

Environment note: `/workspace/vrdex-env.sh` was absent during planning. Node
`v24.19.0` is available. Selecting the existing prepared Corepack tools fixed the
pnpm bootstrap failure: prepend `/workspace/.vrdex-tools/bin` to `PATH` and set
`COREPACK_HOME=/workspace/.vrdex-tools/corepack` for commands. This selects pinned
pnpm `10.15.1`; the normal commit hook then passed without bypassing checks.
Follow the cloud startup guide and default to anonymous local development.

Next gate: BASIC reviews this written plan and selects subagent-driven or native
execution. The approved design does not substitute for that plan review.
