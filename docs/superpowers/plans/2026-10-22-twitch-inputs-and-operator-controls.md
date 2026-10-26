# Twitch inputs and operator controls implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let event operators broadcast lineup or custom VRCDN/Twitch sources with reliable manual controls, selectable output quality, and useful diagnostics in one PR.

**Architecture:** Extend the existing Convex control plane and event worker. Canonical input references feed bounded acquisition handles; committed operator intent is separate from observed encoded output. Server-owned quality/capacity profiles drive the renderer, destination adapters, dispatcher, and diagnostics.

**Tech stack:** Next.js/React/TypeScript, Convex, Node.js 22, FFmpeg, Python 3, Streamlink 8.6.2, Requests 2.34.2, urllib3 2.8.0, ECS Fargate, Terraform, node:test, convex-test, unittest, Playwright.

**Spec:** [Approved design](../specs/2026-10-22-twitch-inputs-and-operator-controls-design.md). Read it before this plan. Its behavior and bounds apply to every task.

## Global constraints

- One implementation PR. Preserve the previously selected subagent-driven method and autonomous $20 work budget; track paid verification and clean up every temporary task.
- Canonical VRCDN/Twitch inputs only. No arbitrary event-authored fetch endpoints, browser automation, cookies, authenticated Twitch playback, or stored signed playback locators.
- Six output presets: 480p30, 480p60, 720p30, 720p60, 1080p30, 1080p60. Input support includes 1080p60-only channels. Legacy output defaults remain 720p30/160-kbps AAC; new program audio defaults to 320 kbps. Twitch audio stays 160 kbps. Audio is stereo/48 kHz.
- Preserve authored VRCDN choices, performer-sequence playback, stable event outputs, and the persistent player. No additional independent product toggles or operator CPU/memory controls.
- Current plus candidate only: at most two acquisitions and two decoders. Browser preview is separate and initially muted.
- Preparation budget 15 seconds from worker receipt, persisted without renewal on takeover. Decoder freshness one second; decoder startup/stall guard five seconds. Initial reservoir target two seconds, compressed buffer cap four MiB per Twitch input.
- Provider HTTP timeout five seconds; DNS bound two seconds. Running acquisition without normalized output ends after 15 seconds. Cancellation gives a process group at most one second before forced termination. Reconnect delays are 1/2/4/8/10 seconds, capped thereafter.
- Keep the existing silence/death/overrun rules, 30-second lease, publication fencing, terminal Stop, 12-hour session bound, and dispatch admission cap. Timetable eligibility alone does not force a source change.
- Resource sampling every ten seconds; stale after 30 seconds. Provider-status concurrency four, refresh/cache 30 seconds, aggregate wait ten seconds, freshness 60 seconds.
- Additive settings apply on the next session. Never restart or resize an on-air worker implicitly. Deploy the protocol migration with no active sessions.
- Use shared UI primitives, desktop/mobile screenshot evidence, and VLM review. Utility labels are sufficient; any new authored public prose follows AGENTS.md's exact-copy review rule.
- Temporary research scripts are evidence, not production modules. Keep fixtures/negative evidence; reimplement against the interfaces below. Do not depend on `/tmp` artifacts remaining available.
- The current workspace overlay has less than one MiB free. Before implementation, use the worktree/cloud-start workflow to establish adequate space for Git objects, generated files, image builds, and browser artifacts. Prefer a suitably provisioned environment or assessed temporary volume; do not begin a build on the full overlay or delete unrelated data.

## Review focus

1. A stale tab edits a lineup without the new field: preserve the current input; explicit null resets it, and changing performer clears it. Task 1 tests this through authoring contracts.
2. Cut arrives after a promotion grant but before encoded confirmation: retain the newer slate intent and treat late acknowledgment as superseded, not publisher-fatal. Tasks 3 and 5 test both orderings.
3. A worker replacement inherits a promoting receipt near expiry: keep original identity/deadline and committed target, without reopening Cancel or rolling back to the prior source. Tasks 3 and 5 test recovery.
4. A 1080p60/320-kbps program enables Twitch simulcast: validate the selected video profile, conservative Twitch audio/GOP, and combined resource load. Tasks 2 and 6 test actual destination output.
5. Resource data arrives late or out of order: show Unknown when stale, retain actual allocation, and never turn low usage into a lower price estimate. Tasks 7 and 8 test this.

## File ownership and interfaces

Use focused modules rather than growing `convex/events.ts` and `event-worker.mjs` into additional monoliths. Existing entry points remain adapters.

| Owner | New focused files | Existing integration |
| --- | --- | --- |
| Canonical references | `convex/_eventBroadcastSources.ts`, `convex/_twitchLinks.ts`, `convex/eventMediaSources.ts` | Slot/lineup inputs, schema, worker projection, API schemas, frontend Twitch parser |
| Output settings | `workers/restream/broadcast-profiles.mjs`, `convex/eventMediaSettings.ts` | Renderer, output sender/setup, session creation, control projection |
| Intent protocol | `convex/_eventBroadcastControl.ts`, `convex/eventMediaControlMigration.ts` | Command admission, worker mutations, schema |
| Acquisition | `workers/restream/input-manager.mjs`, `workers/restream/twitch-input.mjs`, `workers/restream/twitch_input.py`, `workers/restream/twitch_transport.py`, `workers/restream/requirements-twitch.lock` | Existing VRCDN relay, decoder lifecycle, Dockerfile |
| Runtime control | `workers/restream/operator-control.mjs` | Worker ticks, renderer acknowledgments, input manager |
| Allocation/proofs | `workers/restream/broadcast-capacity.mjs`, `scripts/event-broadcast-capacity.mjs`, `scripts/event-twitch-input-proof.mjs` | Dispatcher, IaC packaging, existing proof infrastructure |
| Diagnostics | `workers/restream/resource-sampler.mjs`, `workers/restream/broadcast-rates.mjs` | Worker reports, fenced session snapshot, control-status projection |
| Console/editor | `apps/web/src/app/_components/event-operator-sources.tsx`, `event-operator-preview.tsx`, `event-operator-diagnostics.tsx`, `event-stream-settings.tsx`, `apps/web/src/app/events/slot-broadcast-input-select.tsx` | Existing operator/host view, editor serialization, status route, foreground playback |

The new `_components` files in this table all live under `apps/web/src/app/_components/`. No new workspace package is required. `broadcast-profiles.mjs`, `broadcast-capacity.mjs`, and `broadcast-rates.mjs` are pure ESM without Node-only imports, usable by Convex and the packaged worker. Add JSDoc types and derive TypeScript types from authoritative exports/Convex validators, rather than maintaining parallel handwritten declarations.

Execution order is Tasks 1–8, then Task 9. Task 4 can be developed independently after Task 1; serialize integrations and commits touching shared files. Each task gets implementation review before proceeding. No code execution starts until this written plan has been reviewed.

## Task 1: Canonical broadcast inputs and event source management

**Files:** Create the three canonical-reference modules above and `tests/backend/event-broadcast-sources.test.ts`. Modify `convex/schema.ts`, `_eventSlots.ts`, `_eventInputs.ts`, `_eventLineup.ts`, `_eventRuntime.ts`, `_eventPublic.ts`, `events.ts`, `eventMediaWorker.ts`; `packages/api-contracts/src/schemas.ts`, `mcp-json-schema.ts`, existing lineup contract tests; `apps/web/src/lib/twitch-url.ts`, `apps/web/src/lib/calendar/event-lineup-adapters.ts`, and editor persistence serialization. Regenerate `docs/api/openapi.yaml` and generated bindings using repo commands when their owners change.

**Interfaces:**

- Export `broadcastInputValidator` and schema-derived `BroadcastInputRef = {kind: "vrcdn"; streamId: string} | {kind: "twitch"; channel: string}` from `_eventBroadcastSources.ts`.
- Export `broadcastInputKey(input: BroadcastInputRef): string`, `parseBroadcastInputUrl(value: string): BroadcastInputRef`, and `resolveBroadcastInput({choices, explicitInput, legacySelectedStreamId}): BroadcastInputRef | undefined`. Validation uses the existing VRCDN parser and moved canonical Twitch parser.
- Add optional `broadcastInput` to slots and slot/lineup authoring. Omitted preserves, null resets; performer replacement clears. Existing `selectedStreamId` remains separate.
- Add `events.getPersonBroadcastInputChoices({personSlug})`, returning public canonical choices with `{input, key, label}`. Preserve the existing VRCDN-only `getPersonStreamChoices` response. Editable event projections expose `broadcastInput` and `broadcastInputChoices` separately from existing stream choices.
- `eventMediaSources.create({currentSlug, label, url})`, `.rename({currentSlug, sourceId, label})`, `.replace({currentSlug, sourceId, label, url})`, `.remove({currentSlug, sourceId})` are public mutations. Create/replace return `{sourceId, revision}`. Replacement creates a new record; removal disables instead of deleting.
- Worker `sources` adds canonical `input`, positive `revision`, and canonical public provider URL, retaining event/slot association. No signed locator crosses this interface. Source-removal hooks into Task 3's pending-cancel/active-slate transaction.

- [ ] **Step 1:** Write failing tests asserting canonical `twitch:basic_bit`, reserved-path/URL rejection, VRCDN normalization, explicit-choice precedence, multiple-VRCDN ambiguity, zero-VRCDN Twitch fallback, missing/hidden explicit choices staying unavailable, and legacy VRCDN preservation. Include real Convex/contract tests for omitted/null/performer-change behavior, unauthorized source mutation rejection, creation without starting a session/output, replacement preserving the old source, label-only rename, and disabled audit rows. Pin canonicalization with `assert.equal(broadcastInputKey({kind: "twitch", channel: "basic_bit"}), "twitch:basic_bit")`.
- [ ] **Step 2:** Run `node --conditions=import --import tsx --test tests/backend/event-broadcast-sources.test.ts` and `pnpm test:api-contracts`; confirm the new assertions fail.
- [ ] **Step 3:** Implement the stated helpers/mutations and propagate the optional field through schema, both slot and lineup persistence paths, API/MCP schemas, editable projections, and serialization. Re-export the Twitch parser from its old frontend path; migrate its implementation once.
- [ ] **Step 4:** Run the two commands above plus `pnpm typecheck:backend`, `pnpm typecheck:api-contracts`, and existing `tests/web/twitch-url.test.ts`. Regenerate/check OpenAPI with `pnpm --filter @vrdex/api-contracts generate:openapi` and `pnpm check:api-openapi`. All relevant tests/typechecks pass; existing performer-sequence projections remain unchanged.
- [ ] **Step 5:** Commit canonical input selection and source management. Update `docs/developers/vrdex-mcp-event-writes.md` with omitted/null semantics in this commit.

## Task 2: Video/audio presets and compatible destination formats

**Files:** Create `broadcast-profiles.mjs`, `convex/eventMediaSettings.ts`, and `tests/backend/event-broadcast-settings.test.ts`. Modify schema/session creation and control projection, `program-renderer.mjs`, `output-sender.mjs`, `hosted-worker.mjs`, `vrcdn-poc.mjs`, `_eventOutputSetup.ts`, `_eventMediaControl.ts`, renderer/output tests, and `docs/deployment/restream-worker.md`.

**Interfaces:**

- `broadcast-profiles.mjs` exports `VIDEO_PROFILES`, `parseMediaSettings(value)`, and `resolveDestinationProfile({settings, destination})`. `MediaSettings = {videoPreset: VideoPreset; audioBitrateKbps: 160 | 320}`; `VideoPreset` is the six IDs in Global constraints. Destination is `vrcdn | twitch`.
- `VIDEO_PROFILES` keeps existing four profiles; adds 854x480/30/1000-kbps and 854x480/60/1500-kbps profiles. These are initial encodings subject to visual/provider proof, not permission to waive that proof.
- `eventMediaSettings.configure({currentSlug, videoPreset, audioBitrateKbps})` validates `manage_event_media` and changes next-session settings only. Session creation snapshots `mediaSettings` and `controlProtocolVersion: 2`. Legacy programs normalize to 720p30/160; newly created programs default to 720p30/320.
- `createProgramRenderer({quality, audioBitrateKbps, ...existing})` accepts the snapshot. `outputArguments(destination, target, profile)` uses selected dimensions/fps and destination GOP/audio. VRCDN remuxes; Twitch preserves selected video dimensions/fps with a two-second GOP and 160-kbps AAC. It no longer forces 720p30.

- [ ] **Step 1:** Write failing tests for all six profile dimensions/fps, audio validation, legacy/new defaults, unknown preset rejection, active-session immutability, and next-start behavior. Assert 1080p60/320 produces VRCDN 1080p60/320 and Twitch 1080p60/160, with destination GOP one/two seconds respectively. Include `assert.equal(VIDEO_PROFILES["480p60"].height, 480)` and `assert.equal(VIDEO_PROFILES["480p60"].frameRate, 60)`.
- [ ] **Step 2:** Run `node --conditions=import --import tsx --test tests/backend/event-broadcast-settings.test.ts tests/backend/event-broadcast-output.test.ts tests/backend/event-broadcast-renderer.test.ts`; confirm the new cases fail.
- [ ] **Step 3:** Implement the stated settings/profile interfaces, replace duplicated profile tables with the shared authority, and replace the sender's hardcoded fixed-profile checks with selected-profile validation. Keep independent queues, fencing, and optional-output failure isolation. Snapshot destination profiles for the session; changing a checkbox or profile mid-session does not silently reconfigure a sender.
- [ ] **Step 4:** Run the same tests and backend typecheck. Decode short real FFmpeg outputs for both audio choices and all frame rates; use audible fixtures and `ffprobe` to assert actual dimensions, channels, sample rate, bitrate tolerance, and GOP. Do not require silent AAC to consume its full target bitrate. This is format correctness, not the long capacity proof in Task 6.
- [ ] **Step 5:** Commit selectable media settings and destination compatibility, including the deployment documentation's old fixed-720p30 restrictions and audio explanation.

## Task 3: Durable operator intent and fenced transitions

**Files:** Create `_eventBroadcastControl.ts`, `eventMediaControlMigration.ts`, `tests/backend/event-broadcast-control.test.ts`. Modify schema, `_eventMediaControl.ts`, `_eventBroadcastInputs.ts`, `events.ts`, `eventMediaWorker.ts`, and source-removal integration from Task 1.

**Interfaces:**

- `CommittedIntent = {kind: "automatic"} | {kind: "manual"; sourceId; revision} | {kind: "slate"}`. Store `committedIntent`, `intentSequence`, and optional `pendingControlCommandId` on the session. The command row owns its target, prior intent, preparation expiry, and `controlPhase: preparing | promoting`; do not duplicate the pending object on the session.
- `WorkerSourceTarget = {sourceId, revision, slotKey}`. A control target is `{kind: "source", source: WorkerSourceTarget, mode: manual | automatic}` or `{kind: "slate", mode: slate | automatic}`. The latter covers Cut and Return to auto in a schedule gap.
- Extend `queueEventMediaCommand` with required idempotency for new UI requests, scoped to event/session/actor; reuse only an identical payload and reject conflicting key reuse. Map existing switch/hold/next/previous commands into the new protocol; local preview does not queue `preview_source`.
- Add `events.cancelEventMediaOperation({currentSlug, commandId, idempotencyKey})` and worker `beginPreparation`/`promoteOperation`. Preserve existing worker entry points for lease/lifecycle functions; Task 7 adds optional resource snapshots to existing reports.
- `beginPreparation({...workerSessionArgs, commandId, sequence})` starts the persisted 15-second operation budget once. It covers preparation through confirmation without resetting on promotion/takeover. `promoteOperation({...workerSessionArgs, commandId, sequence, target})` atomically commits authorized intent before renderer selection.
- Protocol results are a discriminated union: `ok`, `superseded`, `cancelled`, `failed` with `expired | source_unavailable | actor_revoked`, or `fenced` with `lease | destination | stopped`. Only fenced outcomes stop publication. Ordinary failed/superseded commands settle without a lease revocation.
- Program observations/command completion carry `intentSequence`, `outputMs`, source revision, and coherent rendered identity. Existing command sequence is operation identity. Disable a source and cancel its pending preparation or establish active slate in the same transaction.

- [ ] **Step 1:** Write failing Convex tests for idempotent admission, a second Take rejection, Cancel preparing versus promoting, preparation expiry, failed preparation retaining prior intent, promotion committing target before acknowledgment, stale same-epoch observations, duplicate acknowledgments, and Stop outranking/rejecting controls. Add both orderings of Cut versus grant/ack, removal versus promotion, and role revocation before/after commit. Cover destination revocation, protocol migration quiescence, and takeover retaining original identity/expiry. In the Cut race assert `assert.equal(session.committedIntent.kind, "slate")` and `assert.equal(lateAck.kind, "superseded")`.
- [ ] **Step 2:** Run `node --conditions=import --import tsx --test tests/backend/event-broadcast-control.test.ts tests/backend/event-broadcast-worker.test.ts tests/backend/event-media-worker.test.ts`; confirm new cases fail.
- [ ] **Step 3:** Implement transactional state/phase checks and typed results. Prioritize admitted Cut over ordinary command ordering without cancelling lifecycle Stop. Reject stale identities as nonfatal supersession. Keep observed current source separate from committed intent.
- [ ] **Step 4:** Implement bounded protocol migration: verify no open sessions before activation; normalize legacy canonical rows/known manual source, fail ambiguous manual state to slate, and reject old worker protocol for new sessions. Quiescence is a deployment condition, not another feature flag. Migration must be idempotent and must not revive historical commands or removed profile links.
- [ ] **Step 5:** Run `node --conditions=import --import tsx --test tests/backend/event-broadcast-control.test.ts tests/backend/event-broadcast-worker.test.ts tests/backend/event-media-worker.test.ts` and backend typecheck. All targeted races pass with actual Convex transactions.
- [ ] **Step 6:** Commit durable control state and document protocol migration in the deployment guide.

## Task 4: Bounded Twitch acquisition and public-network boundary

**Files:** Create Python adapter/transport/lock and `twitch-input.mjs`; create `workers/restream/tests/test_twitch_transport.py`, `test_twitch_input.py`, and `tests/backend/event-twitch-input.test.ts`. Modify Dockerfile and worker README. Preserve research fixtures by converting them into checked-in synthetic test fixtures, never production imports from `/tmp`.

**Interfaces:**

- Python runs as `python3 -m workers.restream.twitch_input --channel LOGIN --video-preset PRESET`. Stdout is normalized MPEGTS only; stderr is bounded structured events only. It resolves a fresh channel locator per attempt and never prints raw library exceptions/URLs.
- Events include `acquiring`, `warming`, `transport_ready`, `ad_wait`, `unavailable` with a fixed reason code, and `cancelled`. Transport readiness is not decoded readiness.
- `createTwitchInput({source, settings, signal, onState, spawnProcess})` returns immediately with `{transportReady: Promise<{url}>, dispose(): Promise<void>}`. The loopback MPEGTS endpoint is private; disposing is idempotent and cannot block control processing.
- `install_fetch_boundary(session, on_connect=None)` owns the pinned HTTPS transport. Allow exact approved API hosts and the validated `.ttvnw.net` CDN suffix boundary; reject special/mixed DNS, proxies, forbidden headers, unsafe redirects, and TLS overrides. Numeric connect retains original certificate hostname/SNI. Disable Chromium fallback.

- [ ] **Step 1:** Add failing Python contracts for canonical hosts/suffix confusion, nested segments/keys/init/redirects, DNS rebinding/mixed answers, certificate mismatch, connection reuse, forbidden headers/ports/protocols, proxy refusal, unknown CDN host, and no global urllib3 mutation. Add synthetic HLS tests for TS/MP4-family input, 1080p-only selection, two-second/four-MiB warmup, jitter, three-second cold acquisition, ads, 403/fresh resolution, retry bounds, and cancellation. Assert `self.assertLessEqual(buffer_high_water_bytes, 4 * 1024 * 1024)` and zero live process-group members after cancellation. Use a local TLS fixture with a test CA; never disable verification for positive cases.
- [ ] **Step 2:** Run `python -m unittest discover -s workers/restream/tests -p 'test_twitch_*.py'` and `node --conditions=import --import tsx --test tests/backend/event-twitch-input.test.ts`; confirm the new contracts fail.
- [ ] **Step 3:** Implement the pinned adapter and Node process/loopback wrapper with the exact Global bounds. Preserve managed-executor proxies; direct-fetch proofs run in the isolated AWS task. Treat browser-integrity/private/auth failures as unavailable. On expiry/death discard temporary locators and use canonical fresh resolution.
- [ ] **Step 4:** Generate a fully hash-locked dependency set for the specified Streamlink/Requests/urllib3 versions, install it into the image at build time, and add an image smoke asserting versions and import/FFmpeg availability. No runtime pip, extra task privileges, or secret grants.
- [ ] **Step 5:** Run the Python and Node test commands from Step 2 plus the image smoke. Cancellation leaves zero process-group members and all transport contracts pass with TLS verification enabled.
- [ ] **Step 6:** Commit acquisition, packaging, security contracts, and documented provider limitations. Keep ordinary diagnostics free of tokens, raw signed URLs, and response bodies.

## Task 5: Nonblocking input lifecycle and real worker control

**Files:** Create `input-manager.mjs`, `operator-control.mjs`, and `tests/backend/event-broadcast-input-manager.test.ts`. Modify `event-worker.mjs`, `source-relay.mjs`, `input-supervisor.mjs`, `program-renderer.mjs`, worker/renderer/relay tests, and `scripts/event-command-local-proof.mjs`.

Migrate the other runtime-constructor callers in `scripts/event-relay-local-proof.mjs`, `event-worker-local-proof.mjs`, `event-output-local-proof.mjs`, `event-lineup-edit-local-proof.mjs`, `event-vrcdn-rehearsal.mjs`, `event-next-local-proof.mjs`, `event-session-local-proof.mjs`, `event-startup-local-proof.mjs`, `event-silence-local-proof.mjs`, and `event-join-local-proof.mjs`, plus the existing media-worker test fixture. These script names all live under `scripts/`.

**Interfaces:**

- `createInputManager({settings, createVrcdnInput, createTwitchInput, onState})` returns `reconcile({current, candidate, intentSequence, epoch})`, `readySources()`, and `stop()`. Reconcile returns synchronously; it starts/retires bounded handles and never awaits media acquisition. Ready sources contain `{slotKey, sourceId, revision, url}` only after transport readiness.
- `createOperatorControl({control, renderer, inputs, clock})` exposes `applyConfiguration(configuration)`, `advance(observation)`, `getState()`, and `stop()`. It carries operation identity/generation into every callback and performs Task 3's backend transitions. It does not own a second lease or publisher.
- The worker's renderer creation receives session `mediaSettings`. Decoder startup begins on transport-ready input, keeping existing readiness/stall guards intact. The current source and encoded slate remain usable during candidate warming.
- `createEventWorker({inputs, ...existingNonAcquisitionArgs})` consumes that input manager. Retire its old `resolveSource`/`retainSources` dependency pair. The CLI constructs the real manager; local proofs supply a synthetic manager with the same interface, not a legacy production fallback.

- [ ] **Step 1:** Write failing tests with indefinitely pending acquisition: worker ticks, lease renewal, current output, locally received Cut, Cancel, and terminal Stop continue. Assert no more than two handles/decoders, even when an obsolete producer ignores cancellation until forced kill. Add old async readiness after Cut, takeover near expiry, committed actor revocation, fallback/manual recovery, and schedule-gap Return to auto. Include `assert.equal(worker.getState().committedIntent.kind, "slate")` after receiving Cut, before the acquisition promise resolves.
- [ ] **Step 2:** Run the Node test command from Step 4; confirm the new assertions fail.
- [ ] **Step 3:** Implement the lifecycle/controller interfaces and migrate all existing worker callers. Remove the old blocking prepare/serialized pending-command path rather than keeping a competing implementation. Cut holds the renderer before awaiting producer cleanup. Stop remains terminal. Handle Task 3's nonfatal results without fencing a healthy publisher.
- [ ] **Step 4:** Run `node --conditions=import --import tsx --test tests/backend/event-broadcast-input-manager.test.ts tests/backend/event-broadcast-worker.test.ts tests/backend/event-broadcast-renderer.test.ts tests/backend/event-broadcast-relay.test.ts tests/backend/event-broadcast-policy.test.ts`. Run `node scripts/event-command-local-proof.mjs` and `node scripts/event-silence-local-proof.mjs` against real FFmpeg; verify encoded source identity, digital silence/quiet retention, eligibility, and no stale promotion after Cut.
- [ ] **Step 5:** Commit lifecycle/control integration and update `docs/engineering/event-broadcast-renderer-proof.md` with the preparation/promotion distinction and encoded-output evidence.

## Task 6: Quality-aware dispatch and measured capacity

**Files:** Create `broadcast-capacity.mjs`, the two proof scripts in File ownership, `tests/scripts/event-broadcast-capacity.test.mjs`, and `docs/engineering/event-broadcast-quality-capacity.md`. Modify `scripts/event-media-ecs-bridge.mjs`, `event-media-ecs-sdk.mjs`, Lambda bridge packaging/IaC, session bridge projections, Docker COPY list, existing bridge tests, and deployment guide.

**Interfaces:**

- `resolveWorkerAllocation({videoPreset, simulcastEnabled})` returns a checked-in allowed `{cpuUnits, memoryMiB, evidenceId}` or rejects an unproved configuration. The completed mapping must cover all six presets, with primary-only and optional-Twitch cases accounted for.
- The server snapshots this allocation with media settings. The bridge uses that snapshot for task definition, passes exact nonsecret allocation/settings metadata, and rejects client-supplied arbitrary resources or mismatched profiles. Existing launch ownership/idempotency/unknown-outcome admission semantics remain intact.
- `event-broadcast-capacity.mjs --preset PRESET --cpu UNITS --memory MIB --duration-seconds N --simulcast true|false --output-dir PATH` produces machine-readable proof receipts. `event-twitch-input-proof.mjs --case CASE --output-dir PATH` runs deployed-image acquisition/failure cases. These are bounded proof CLIs, not new operator controls.

- [ ] **Step 1:** Write failing dispatcher tests asserting both task/container resources, immutable preset propagation, shape validation, optional-sender allocation, unchanged launch fencing, and Lambda SDK/CLI request parity. Add harness tests that deliberately fail on any unexpected post-startup readiness loss, wrong output identity/fps/audio/GOP, orphaned child, or missing terminal receipt.
- [ ] **Step 2:** Run `node --test tests/scripts/event-broadcast-capacity.test.mjs tests/scripts/event-media-bridge-lifecycle.test.mjs tests/scripts/event-media-ecs-sdk.test.mjs tests/scripts/event-media-lambda-bridge.test.mjs`; confirm new cases fail.
- [ ] **Step 3:** Implement the mapping/dispatch/harness interfaces. Include the new pure modules in every worker and Lambda artifact that imports them; make the Step 2 tests pass. Build the exact deployment image and verify deterministic jitter, cold-start, ad-wait, 403/fresh-resolution, TLS boundary, and cancellation on its FFmpeg version. Record image digest/package hashes and preserve failed attempts. Short format checks do not substitute for steady capacity proofs.
- [ ] **Step 4:** Measure each preset with two 1080p60 inputs, initially four vCPU/eight GiB; retry failures at eight vCPU/16 GiB. Optionally step passing presets down to two/four, then one/two. Require zero unexpected readiness losses, existing live-delay budget, and CPU P95 below 80% allocation during steady dual decode. Verify selected source/slate identity, output timestamps, visual quality, lip sync, both audio choices, and actual destination profiles. Include simulcast load in the evidence or a separately measured allocation entry.
- [ ] **Step 5:** Complete at least one 30-minute buffered public-input run recorded privately and an owned/synthetic end-to-end publishing run. Public third-party input probes do not authorize republishing those channels. Treat real ads, forced expiry, and physical playback as observed only when actually exercised. Keep billing within the existing budget, use hard inner/outer deadlines, and confirm each created AWS task STOPPED and definition INACTIVE in a final readback. Record source-to-viewer latency separately from internal renderer lag.
- [ ] **Step 6:** Populate the complete measured allocation map and commit proof tooling, durable sanitized receipts, metadata, and deployment docs. If neither tested shape passes a promised preset, fix/revisit encoding capacity before merge; do not silently remove the option or relax readiness. No production configuration changes occur during benchmark tasks.

## Task 7: Lightweight worker diagnostics and compute estimates

**Files:** Create `resource-sampler.mjs`, `broadcast-rates.mjs`, `convex/_eventBroadcastResources.ts`, `tests/backend/event-broadcast-resources.test.ts`, and `tests/backend/event-broadcast-pricing.test.ts`. Modify worker lifecycle/reporting, session schema, `eventMediaWorker.ts`, and `events.getEventMediaControlStatus` projection. Include pure rates and sampler in required artifacts.

**Interfaces:**

- `createResourceSampler({allocation, readCounters, clock})` exposes `sample()` and `latest()`. A snapshot contains `{sampleSequence, windowMs, sampleAgeMs, cpuUsagePercent?, memoryUsedBytes?}`; epoch/session identity is supplied by the worker report. Read cgroup counters for all worker children, not Node-only process stats.
- `recordResourceSnapshot(ctx, {...workerSessionArgs, sample})` in `_eventBroadcastResources.ts` validates ownership, monotonic sequence, finite/nonnegative measurements, and sample age. Invoke it from an existing renewal/program-observation mutation carrying an optional sample; no new resource RPC loop. Store only the latest observation. Resource freshness is receipt minus sample age and conservative request-duration allowance, never ordinary heartbeat time. New epoch clears the observation. Resource rejection/collection failure does not fail a valid lease renewal or media/control path.
- `estimateComputeRate({region, os, architecture, purchaseModel, allocation})` returns `{usdPerHour, rateDate, currency: "USD", scope: "cpu_memory"}` or undefined. Use dated server-owned rates with source URL, not billing APIs. Price depends on allocation, not utilization. No public event projection includes diagnostics.

- [ ] **Step 1:** Write failing tests asserting a one-core CPU delta on a four-core allocation is 25%, elapsed-window normalization, child usage, memory/cache units, initial unknown CPU, independent memory availability, counter reset, unsupported reads, delayed samples, sequence/epoch rejection, and stale after 30 seconds. Include `assert.equal(sample.cpuUsagePercent, 25)`. Pricing tests pin four-vCPU/eight-GiB compute to approximately $0.19748/hour, identical price at 0%/100% usage, undefined for unknown/mismatched rates, and no account invoice/secret/credential metadata.
- [ ] **Step 2:** Run `node --conditions=import --import tsx --test tests/backend/event-broadcast-resources.test.ts tests/backend/event-broadcast-pricing.test.ts`; confirm failure.
- [ ] **Step 3:** Implement the interfaces with ten-second sampling and no additional frontend polling or resource RPC loop. Add snapshots to an existing scheduled renewal/program-observation request. Never refresh an old resource sample through a heartbeat or await diagnostics before Cut. Project actual allocation, region, provider, active formats, rate date, estimate, and observation freshness to authorized console readers.
- [ ] **Step 4:** Run resource/pricing tests, backend typecheck, and a real worker proof where counter reading fails but publishing and manual controls continue. Assert no extra snapshot history table and no public resource fields.
- [ ] **Step 5:** Commit diagnostics plumbing and document that prices exclude transfer, IPv4, logs, extra storage, provider subscriptions, taxes, and discounts.

## Task 8: Operator console, editor choices, and local preview

**Files:** Create the five UI modules in File ownership and `tests/web/event-operator-state.test.ts`. Modify `event-operator-view.tsx`, `event-host-view.tsx`, `event-editor-form.tsx`, editor persistence, Twitch/player helpers, `apps/web/src/lib/server/event-source-status.ts`, and `apps/web/src/app/[slug]/events/[eventSlug]/host/status/route.ts`. Add `apps/web/src/app/[slug]/events/[eventSlug]/operate/status/route.ts` for authorized custom-source status windows alongside the existing `/operate` page. Extend existing `apps/web/e2e/event-operator.flow.spec.ts`, `event-host-view.flow.spec.ts`, and `event-playback-owner.spec.ts`.

**Interfaces:**

- `EventOperatorSources({sources, control, canControl, onTake, onCancel, onRemove, onCreate, onReplace})`, `EventOperatorPreview({source, onClose})`, `EventOperatorDiagnostics({session, now})`, `EventStreamSettings({settings, activeSettings, canControl, onSave})`, and `SlotBroadcastInputSelect({value, choices, onChange})` use API-derived types. Source management uses Task 1 APIs, settings use Task 2, and controls use Task 3.
- Preview owns a local player handle and foreground identity; it never replaces the persistent event playback request. Muted Twitch preview is noninteractive until Monitor acquires audio focus.
- Operator status GET resolves bounded source IDs from the authorized event. Reuse the existing four-probe/30-second cache/ten-second wait reader; no arbitrary URL parameter or media acquisition. Prioritize current/next/preview/visible window; unqueried/stale stays Unknown.
- Diagnostics uses the existing reactive control query, not another resource poll. Show current CPU/memory, allocation, provider/region, format, freshness, and compute-only estimated hourly rate inside a collapsed disclosure.

- [ ] **Step 1:** Add failing view-state tests asserting actual versus desired/pending state, Cancel only during preparation, independent Cut, Stop precedence, retained source on preparation failure, schedule-gap Return to auto, stale/unknown diagnostics, all settings options, and active/next-start distinction. Add browser flows for custom and lineup sources, legacy preservation, replacement/removal, Take/Cancel/Cut, reload, permission loss, and preview audio focus. Assert `await expect(page.getByRole("button", {name: "Cut to slate"})).toBeEnabled()` while Preparing is visible.
- [ ] **Step 2:** Run `node --import tsx --test tests/web/event-operator-state.test.ts` and `pnpm --filter web exec playwright test e2e/event-operator.flow.spec.ts`; confirm new cases fail.
- [ ] **Step 3:** Implement the component interfaces and integrate without retaining the current global busy lock around Cut. Labels include Take, Cancel, Cut to slate, Return to auto, Preview, Monitor, Resolution, Frame rate, Audio bitrate, and Diagnostics. Keep prose minimal; show effective Twitch audio/profile where it differs. Source links remain usable when provider probes fail.
- [ ] **Step 4:** Add browser audio-focus checks: muted preview leaves program audible; Monitor hands off foreground audio before unmuting; preview cannot bypass focus through Twitch controls; close does not auto-resume; navigation retains the event request. Show resource/price details only to existing console readers; provider/source requests preserve authorization.
- [ ] **Step 5:** Run `pnpm typecheck:web`, `pnpm lint:web`, `pnpm test:web`, targeted operator/host/playback browser flows, and desktop/mobile visual checks. Capture screenshots and use VLM review per AGENTS.md; fix layout/focus/accessibility issues. Commit console/editor integration and relevant playback/operator documentation.

## Task 9: Whole-flow verification, migration rehearsal, and one PR

**Files:** Update `docs/engineering/event-broadcast-verification.md`, `event-broadcast-rehearsal.md`, new quality-capacity record, `docs/deployment/restream-worker.md`, `workers/restream/README.md`, and affected public/developer/API docs. Use existing CI configuration; add `ci:browsers` and `ci:visuals` labels to the implementation PR before its normal run.

- [ ] **Step 1:** Check spec coverage task-by-task and run `pnpm typecheck:backend`, `pnpm test:backend`, `pnpm test:scripts`, `pnpm verify:api-contracts`, `pnpm typecheck:web`, `pnpm lint:web`, and `pnpm test:web`, plus Python transport/input tests and exact-image proof commands from Task 6. Investigate failures before broadening/repeating suites. Generate Convex bindings with the repo's local verification workflow after reading its cloud-start guide; run `pnpm check:backend:generated`.
- [ ] **Step 2:** Rehearse protocol migration against real Convex test state, including old workers/commands, ambiguous legacy manual source, disabled/hidden profile links, and no-active-session precondition. Verify a replacement worker restores manual intent and continues a promoting receipt without a new deadline. Verify Stop and destination revocation fence all senders.
- [ ] **Step 3:** Use the authorized owned VRCDN accounts and a specifically selected quiet test event for a bounded live rehearsal. Use owned/synthetic inputs for publication. Validate stable output link, audible synchronized handoff, emergency slate, reconnect, chosen output formats, persistence through navigation, and cost/resource display. Check PC and Quest separately when actual clients are available; otherwise explicitly retain that unverified evidence gap and do not claim end-to-end device verification.
- [ ] **Step 4:** Perform a whole-branch code review and resolve material findings. Create one PR describing the final host behavior, protocol migration, preset/capacity evidence, and remaining real-provider/device limits. Attach its URL to this task. Triage every review comment, reply with disposition, resolve addressed threads, then push follow-up commits according to repo policy. Do not merge on the user's behalf.
- [ ] **Step 5:** Report actual check results, screenshot/video evidence, PR URL, capacity map, deployment/migration readiness, observed live-provider coverage, budget use, and final AWS cleanup receipt. Deployment preserves existing account grants, destination credentials, emergency-stop state, dispatcher lifecycle, and concurrency cap. Never substitute a claimed test pass for unavailable physical/provider evidence.

## Plan self-review and handoff

Before implementation, verify every interface referenced by a later task is produced above, each test step states its assertions and run command, all spec sections map to tasks, and no independent feature toggle or second streaming service slipped in. Shared-file integrations are serialized. Source/quality/control contracts precede worker/UI implementation; measured capacity precedes deployment.

The plan is ready for BASIC's review. Execution method is already selected: subagent-driven, with task reviews and a final branch review. This handoff does not ask the user to select it again.
