# VRCDN Mobile Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shared HLS video, persistent audio-only listening, PiP and branded DJ Now Playing the default VRCDN playback experience without changing existing lineup policy.

**Architecture:** Convex admits public playback and owns source/worker leases. Shared ECS workers package one provider acquisition into two HLS renditions; a manifest gateway tracks native-player demand and serves fresh playlists, while CloudFront delivers immutable segments from private S3. A retained root player owns native media, mode and metadata.

**Tech Stack:** Next.js/React/TypeScript, Convex, Node.js, FFmpeg, ECS/Fargate, S3, CloudFront, API Gateway/Lambda, DynamoDB, Terraform. Follow repository Node 24/pnpm 10.15.1 development tooling.

**Spec:** [Approved design](../specs/2026-10-28-mobile-vrcdn-playback-design.md). Read it before this plan.

## Global Constraints

- Default availability for every VRCDN stream played through VRDex; no owner opt-in.
- Shared relay workers, rather than a dedicated container for each stream.
- Audio-only stays selected across DJ changes until explicitly changed.
- Original profile images remain untouched; live title is `<DJ display name> - VRDex`.
- Existing lineup behavior is preserved; no new automatic background lineup switching.
- No implementation claim based on desktop emulation establishes physical-phone behavior.
- Unsupported input gets an explicit unsupported result, not a hidden expensive transcode.
- Native current playback must not route through Web Audio. Preserve the foreground failure/boundary policy and its blocked-promotion gesture.
- No production resource apply, permanent service enablement or spending authorization is implied by design approval.
- Public sentences require the existing exact-copy review; utility labels can use approved patterns. New product copy contains no em dash or double hyphen.
- No source connection on page mount. Native playlist activity, not browser JS timers, sustains an admitted session.

## Review Focus

1. A source link is removed from one event while a public profile still references it: revoke only the event grant (Task 2).
2. The control plane stalls while a source is still producing bytes: the local monotonic watchdog fences the old epoch before takeover (Tasks 3, 5).
3. A locked phone keeps receiving cached segments without JS: uncached manifest demand retains playback; an empty room still stops (Tasks 6, 12).
4. A user toggles mode or closes while admission/play is pending: one audible owner, no stale resume, persistent choice retained (Tasks 8, 9).
5. HLS recovers with different timestamps, segments arrive out of order, or a keyframe is late: fresh valid publication and a monotonic discontinuity, never a stale healthy claim (Tasks 4, 5, 12).

## Execution structure and file ownership

Work on an isolated implementation branch/worktree, `feat/mobile-hls-playback`, reconciled against current main before code changes. Preserve the spike and its proof files. Read applicable `AGENTS.md`, cloud startup and worktree guidance first. This plan is one feature with twelve reviewable deliverables; do not create twelve project trackers.

Create workspace package `packages/media-relay/` for shared runtime schemas, worker/gateway logic and tests. Match `@vrdex/api-contracts`' source-export convention and reuse its Zod 4.3.6 version. Bundle deployment entrypoints with an explicit esbuild 0.28.0 dev dependency. Dependencies are declared directly, not resolved through another package's transitive install.

Convex owns database authorization/leases under new relay files, independent of event worker authority. `workers/media-relay/` contains deployment packaging, not a forked event renderer. `infra/terraform/media-relay/` owns new relay resources and their off-by-default activation. Web behavior stays with the current root provider/adapters rather than introducing another global playback coordinator.

The following interfaces are named contracts for neighboring tasks. Define their exact schemas once in Task 1; derive TypeScript types from them. Convex database field validators are storage representations, not an independent external protocol.

```text
PlaybackMode = video | audio
PublicContext = profile(profileId, linkId) | event(eventId, selectedSourceId)
StreamKey = canonical provider/streamId/packagingVersion identity
SourceDescriptor = { streamKey, streamId, inputFormat: vrcdn_fmp4, packagingVersion: 1 }
DjMetadata = { displayName, artworkAssetId: string|null, artworkRevision: string|null }
PlaybackGrant = { id, streamKey, context, contextRevision, issuedAt, expiresAt, renditions: [video,audio] }
Admission = preparing(retryAfterMs) | ready(grant, videoPlaylist, audioPlaylist, metadata)
          | unavailable(reason) | capacityLimited(retryAfterMs)
OwnershipLease = { streamKey, workerId, epoch, serverNow, expiresAt, renewAfterMs }
RenditionSnapshot = { streamKey, epoch, rendition, targetDurationSeconds,
                     sequence, discontinuitySequence, generatedAt, segments }
Segment = { sequence, objectKey, durationSeconds, programDateTime, discontinuity }
WorkerObservation = { workerId, workerEpoch, observedAt, allocation, activeJobs, resources,
                      jobs: [{streamKey, sourceEpoch, state, progressAt}] }
```

Defaults copied from the approved design: idle grace 180,000 ms; source recovery budget 30,000 ms; grant lifetime 43,200,000 ms; segment URL validity at least 300,000 ms; freshness `max(10,000 ms, 3 * actualTargetDurationMs)`; target segment duration approximately two seconds. Planning choices: lease 30,000 ms, renew every 10,000 ms, local watchdog every 250 ms, rolling window eight segments. Keep these in one shared policy module and test boundaries.

### Task 1: Shared protocol and policy

**Files:** Create `packages/media-relay/package.json`, `tsconfig.json`, `src/contracts.ts`, `src/policy.ts`, `src/index.ts`, `tests/contracts.test.ts`; modify root/web package manifests and lockfile for declared workspace dependencies.

**Interfaces:** Produce the schemas/types above; `parseSourceDescriptor(input: unknown): SourceDescriptor`; `streamKeyFor(streamId: string): StreamKey`; `isSnapshotFresh(snapshot: RenditionSnapshot, now: number): boolean`. Clock values crossing processes are server times; local elapsed checks use monotonic time.

- [ ] Write tests: reject client URLs, unknown fields/modes, nonfinite times and malformed IDs; normalize equivalent VRCDN references to the same key; reject a snapshot at its exact stale boundary, accept immediately before it; pin every policy value above.
- [ ] Run `node --import tsx --test packages/media-relay/tests/contracts.test.ts`; confirm missing-contract failures.
- [ ] Implement schemas, source identity and policy; package runtime exports use Zod-derived types. The input URL is generated inside guarded acquisition, never part of admission payloads.
- [ ] Re-run the contract tests and `pnpm --filter @vrdex/media-relay typecheck`; expect all pass.
- [ ] Commit `feat: define shared playback relay protocol`.

### Task 2: Public playback admission and context authorization

**Files:** Create `convex/_mediaRelayTables.ts`, `_mediaRelayAuthorization.ts`, `mediaRelayPlayback.ts`, `tests/backend/media-relay-admission.test.ts`; modify `convex/schema.ts`, generated API through normal local generation, and relevant public playback projections.

**Interfaces:** Consume Task 1. Produce `openPlayback({context, streamId, preferredMode}): Admission`, `getPlayback({grantId}): Admission`, `releasePlayback({grantId}): void`, and internal `resolveGrant({grantId, now}): valid(grant,metadata)|denied(reason)`. Store grants separately from source sessions; deduplicate session creation by StreamKey in a transaction. Use existing public-query authorization helpers, not an owner-claim requirement.

- [ ] Write convex-test cases: guests admitted for an actual public link; invented/hidden links denied; 20 simultaneous Play requests create one queued source; separate contexts get separate grants; removal revokes one event grant but leaves the profile grant valid; metadata edits do not restart/revoke; started event survives its calendar window under existing rules; cancelled events do not.
- [ ] Run `node --conditions=import --import tsx --test tests/backend/media-relay-admission.test.ts`; confirm failure before implementing handlers.
- [ ] Add tables via a schema fragment and handlers; context revision contains only playback-relevant source/publication policy. Grants expire at twelve hours and allow both rendition URLs. Apply existing rate-limit conventions to configured admission limits; page reads never invoke admission.
- [ ] Generate the local Convex API using the canonical local guide; re-run tests plus `pnpm typecheck:backend`. Expect generated API and handlers to agree without handwritten generated edits.
- [ ] Commit `feat: admit shared VRCDN playback by public context`.

### Task 3: Shared-worker placement, leases and fenced ownership

**Files:** Create `convex/_mediaRelayControl.ts`, `mediaRelayWorker.ts`, `tests/backend/media-relay-control.test.ts`, `packages/media-relay/src/worker/lease.ts`, `tests/lease.test.ts`.

**Interfaces:** Produce authenticated `registerWorker(observation)`, `claimSource({workerId,streamKey})`, `renewSource({workerId,streamKey,epoch})`, `observeSource(...)`, `releaseSource(...)`; `createLeaseWatchdog({clock,fence}): { accept(lease,sentAt), check(), stop() }`. Worker APIs authenticate the deployment identity and verified allocation; they are not public client mutations.

- [ ] Write tests: one valid epoch owner under racing claims; takeover denied before expiry; old observations rejected after takeover; lost/slow renewal cannot extend local authority; fence occurs before async cleanup; draining workers get no new work; admission limits protect existing streams; one worker's failed job does not revoke its other sources.
- [ ] Run `node --conditions=import --import tsx --test tests/backend/media-relay-control.test.ts packages/media-relay/tests/lease.test.ts`, then implement transactional claims and the 30/10-second lease contract. Anchor local authority conservatively at request start, as in event-worker; watchdog never waits for renewal promises.
- [ ] Validate with injected monotonic clocks and real stalled promises; repeat race tests with convex-test. Expect deterministic denial/fencing at boundaries and no event authority/schema changes.
- [ ] Commit `feat: coordinate shared relay leases and capacity`.

### Task 4: Guarded acquisition and two-rendition HLS packaging

**Files:** Modify `workers/restream/source-relay.mjs`, `tests/backend/event-broadcast-relay.test.ts`; create `packages/media-relay/src/worker/packager.ts`, `tests/packager.test.ts`, `tests/source-acquisition.test.ts`.

**Interfaces:** Extend guarded `createSourceRelay` with an explicit input format/content type while retaining existing MPEG-TS defaults. Produce `startPackager({source,epoch,directory,signal,onSnapshot,onFailure}): Promise<{stop():Promise<void>}>`. A session starts one upstream acquisition and one FFmpeg child with video/audio and audio-only outputs.

- [ ] Add failing tests for exact generated MP4 URLs, redirects/private DNS/rebinding rejection, expected Content-Type, closing a previous connection before reconnect, and unchanged existing TS consumers. Build a loopback synthetic H.264/AAC source; assert audio rendition has no video track, both playlists advance and reference only complete segments, and a late keyframe produces a truthful target duration without false independence flags.
- [ ] Run new tests and `node --conditions=import --import tsx --test tests/backend/event-broadcast-relay.test.ts`; then implement the smallest format extension and package boundary. FFmpeg receives only the guarded local URL.
- [ ] Use real FFmpeg/FFprobe in media tests. Reject unsupported codecs explicitly; normalize/validate timestamp handling rather than suppressing warnings. Stop/failure bounds TERM/KILL, sockets and directories to this job only. Test partial fragments, source restart and monotonic discontinuities.
- [ ] Re-run the source/packager tests and existing relay tests; expect no leaked child/socket, one normal upstream per source and decoded outputs. Commit `feat: package guarded VRCDN feeds into native HLS renditions`.

### Task 5: Worker registry, publication and source recovery

**Files:** Create `packages/media-relay/src/worker/{registry,publisher,main}.ts`, `tests/{registry,publication,recovery}.test.ts`; import existing resource sampler/allocation helpers without importing the event renderer.

**Interfaces:** `createRelayRegistry({control,storage,clock,limits,metrics}): {reconcile(),drain(),stop()}`; `publishSnapshot({lease,snapshot,segments}): Promise<void>`. Storage exposes epoch-scoped object writes. Registry owns job lifetimes; publisher owns segment-before-playlist ordering and current-epoch checks.

- [ ] Write failing tests: duplicate grants share one job; uploads complete before a referenced snapshot; blocked upload queue is bounded; stale epoch cannot become current; out-of-order snapshots rejected; job crash isolated; stale source becomes recovering; thirty seconds without output becomes terminal unavailable despite repeated native playlist demand.
- [ ] Run `node --import tsx --test packages/media-relay/tests/registry.test.ts packages/media-relay/tests/publication.test.ts packages/media-relay/tests/recovery.test.ts`, then implement bounded jobs/retries and aggregate resource sampling. Native demand can retain an admitted source but cannot create/restart terminal jobs. Each reconnect/takeover uses a monotonically increasing media sequence and valid discontinuity.
- [ ] Run real-media recovery tests with disconnected upstream, delayed/missing objects and a killed child. Confirm honest stale responses, fresh recovered output, cleanup, and no indefinite queue/log/disk growth. Retire remote objects after ten minutes; a bucket lifecycle is the longer backstop, not publication authority.
- [ ] Commit `feat: publish and recover bounded shared HLS jobs`.

### Task 6: Native manifest gateway, demand and signed segment delivery

**Files:** Create `packages/media-relay/src/gateway/{handler,demand,playlist,signing}.ts`, `tests/{gateway,demand,signing}.test.ts`; add internal grant/current-epoch read endpoints to `convex/mediaRelayWorker.ts`.

**Interfaces:** `createManifestHandler({authorize,readSnapshot,demand,signSegment,clock}): (Request)=>Promise<Response>` for `/p/:grantId/:rendition/index.m3u8`; `recordDemand({streamKey,at}):Promise<void>`; `lastDemand(streamKey):Promise<number|null>`. The grant ID is an unguessable playback capability; never an admin token. Missing/expired/revoked grants are denied before cache lookup.

- [ ] Write tests: no-store playlists; fresh cached immutable segments; five-minute-or-longer signed segment URLs; old context or epoch denied; invalid paths/renditions rejected; coalesced monotonic demand writes at ten seconds; idle shutdown at 180 seconds even when Close was lost; cached segment reads do not need to refresh demand; terminal playlist polling cannot create work.
- [ ] Run `node --import tsx --test packages/media-relay/tests/gateway.test.ts packages/media-relay/tests/demand.test.ts packages/media-relay/tests/signing.test.ts` and implement the injected handler. Validate Convex grant/current-epoch responses at the boundary. Cache authorization/epoch reads for at most two seconds; redact capabilities from logs. DynamoDB stores demand observations only, with conditional max-time updates and coalescing per gateway process/source.
- [ ] Test unavailable demand store fails conservatively: retain existing admitted jobs for bounded grace, deny unaccounted new starts, report degraded health, never create unlimited demand. Verify CORS for the configured VRDex/preview origins without wildcard credential leakage.
- [ ] Test stable URLs across new epochs, correct relative/absolute segment URLs, decreasing sequence rejection and no stale-health claim. Native grant expiry never depends on JavaScript refresh. Commit `feat: serve authorized native playlists and account for playback demand`.

### Task 7: Off-by-default AWS deployment and resource boundaries

**Files:** Create `workers/media-relay/Dockerfile`, `scripts/package-media-relay.mjs`, `infra/terraform/media-relay/{main,variables,outputs,versions}.tf`, `tests/relay.tftest.hcl` under that Terraform root, and `docs/deployment/media-relay.md`.

**Interfaces:** Bundle `src/worker/main.ts` and `src/gateway/handler.ts`. Define versioned environment contracts for control-plane URL, deployment credential reference, media bucket/distribution, demand table, enabled flag, measured per-worker source cap, global source cap, admission limits, warm minimum/maximum and traffic ceilings. Enabling requires all release inputs; zero/absent caps do not mean unlimited.

- [ ] Write Terraform mock-provider tests: disabled plan creates no billable relay compute; enabled plan rejects absent measured capacity/limits; private bucket blocks public access; CDN OAC and gateway signatures protect segments; worker IAM has only its media namespace/control identity, not event output credentials; relay switch is independent of event publishing.
- [ ] Run `terraform -chdir=infra/terraform/media-relay init -backend=false` and `terraform -chdir=infra/terraform/media-relay test` using the repository's provider setup, with no apply. Implement the isolated resources and bounded packaging workflow. Select and record a reviewed Node image digest; retain CA/proxy behavior from cloud Docker guidance.
- [ ] Build the real image locally with an ephemeral synthetic input, not provider credentials. Prove registered allocation/resource readings, two simultaneous sources, graceful drain, TERM/KILL cleanup and no untracked processes. Inspect gateway artifacts and image source hashes.
- [ ] Run Terraform format/validate/test and packaged-artifact smoke tests; document costs included/excluded and exact rollback/deletion commands. Commit `infra: define isolated shared relay deployment disabled by default`.

### Task 8: Retained player owner, HLS adapters and mode preference

**Files:** Create `apps/web/src/lib/{playback-mode,native-hls-adapter}.ts`, `tests/web/{playback-mode,native-hls-adapter}.test.ts`; evolve/rename `event-playback-owner.ts`, `event-playback-adapters.ts`, `event-playback-request.ts` and their tests for profile/event context; modify `event-playback-provider.tsx` and profile VRCDN entrypoints.

**Interfaces:** `readPlaybackMode(storage): PlaybackMode`, `writePlaybackMode(storage,mode):void`; root owner gains `setMode(mode):Promise<void>` and an active context union while preserving Play/Pause/Close/revalidate contracts. `createNativeHlsAdapter({grant,mode,mount,notify})` owns audio/video elements; add an explicit desktop MSE HLS adapter only where native capability fails.

- [ ] Write failing tests: preference persists across DJs/routes/reloads with no autoplay; denied storage falls back to memory; event start-window and post-window continuation behavior preserved; public profile Play is not subject to an event calendar; pending admission cannot resume after Close; metadata-only changes retain media nodes.
- [ ] Run `node --import tsx --test tests/web/playback-mode.test.ts tests/web/native-hls-adapter.test.ts tests/web/event-playback-owner.test.ts`, then migrate existing owner callers together. Reuse existing root mount/one-audible ownership; do not leave parallel old/new global owners or stale APIs. HLS begins only after admission and gesture; slow startup rejection is blocked, not muted autoplay or false offline. Declare `hls.js` directly in the web package for the non-native adapter and record its resolved version in the lockfile.
- [ ] Test toggle race and failure: pause old, play target under the toggle gesture, never two audible sources; paused stays paused; source stays the same; stale completion cannot override latest intent; hardware-only iPhone volume isn't written. Close PiP on audio selection, never force it on return.
- [ ] Run existing owner/request/revalidation/recovery and foreground tests plus new ones; `pnpm typecheck:web`. Commit `feat: retain native HLS playback with persistent audio mode`.

### Task 9: Native lineup observations and public controls

**Files:** Create `apps/web/src/lib/native-hls-observed-source.ts`, `tests/web/native-hls-lineup.test.ts`; modify `event-lineup-runtime.ts`, `vrcdn-observed-source.ts` callers and observation types, `vrcdn-player-controls.tsx`, its stories, compact/inline/profile players, and `apps/web/e2e/event-lineup-live.spec.ts`.

**Interfaces:** `createNativeObservedSource({grant,mode,isCurrent,mount}): Promise<ObservedNativeSource>` returns `media`, `play`, `pause`, `release`, `setMuted`, `setVolume`, `ready`, and `sample(observedAt,paused)`. Sample fields are progress/readiness/failure and `audioLevel: {kind:"unavailable"}`; never invented dBFS. Controls expose `mode`, `onModeChange`, PiP support/state and actions without owning transport lifetimes. Observer implementations preserve the existing failure/boundary policy.

- [ ] Write tests for unchanged foreground handoff/overtime, current/prepared source ownership, no new hidden-document handoff, healthy source not cut at schedule end, old grant revocation and explicit enable gesture after blocked promotion. Verify the native path constructs no AudioContext/media-element source.
- [ ] Run `node --import tsx --test tests/web/native-hls-lineup.test.ts` red; migrate native observations and mute/volume to element control, preserving current/next readiness semantics. Do not change the disabled silence-handoff policy or promise background lineup switching.
- [ ] Add Video / Audio only and PiP controls to shared UI/stories; artwork replaces the video view in audio mode. Use approved utility labels, touch targets and keyboard/accessibility patterns. Verify all event/profile entrypoints use the owner rather than mounting another transport.
- [ ] Run existing lineup and owner regressions, focused Storybook/browser tests, screenshots at phone/desktop widths and visual inspection. Label the eventual PR `ci:browsers` and `ci:visuals` per repo policy. Commit `feat: integrate native HLS controls while preserving lineup policy`.

### Task 10: Authorized DJ metadata and immutable branded artwork

**Files:** Create `apps/web/src/lib/now-playing.ts`, `tests/web/now-playing.test.ts`, `apps/web/src/lib/server/now-playing-artwork.ts`, `tests/backend/now-playing-artwork.test.ts`; extend public metadata projections and `apps/web/src/app/api/v0/profiles/[slug]/assets/[assetId]/file/route.ts` for authorized derived artwork.

**Interfaces:** `applyNowPlaying({identity,mode,actions}):void`, `clearNowPlaying():void`; `getNowPlayingArtwork({profileId,assetId,revision,brandVersion}):Promise<publicImmutableUrl>`. Resolve identity from the playing context, not schedule guessing or a prepared next DJ. Derivative key includes profile image revision and canonical brand version.

- [ ] Write tests: live title ends exactly `- VRDex`; permitted image/wordmark derivative leaves original bytes unchanged; old image revision has a different immutable URL; hidden/private/arbitrary image URL denied; metadata refresh doesn't reconnect; wrong/absent DJ uses the authorized neutral fallback; Close clears metadata; Media Session Resume obeys the owner fences.
- [ ] Run `node --conditions=import --import tsx --test tests/web/now-playing.test.ts tests/backend/now-playing-artwork.test.ts` red, then implement native title/artwork updates and cached image generation using existing Sharp/public-asset patterns and approved canonical logo. Enforce byte/dimension bounds; no per-viewer image rendering.
- [ ] Verify actual image bytes, public image fetch, cold Safari fetch permissions, metadata transitions and visuals. The Island/lock-screen layout is controlled by iOS, not a custom Live Activity. Commit `feat: publish authorized branded DJ Now Playing metadata`.

### Task 11: Operator controls, capacity evidence and deployment review

**Files:** Create `scripts/media-relay-proof.ts`, `scripts/media-relay-control.ts`, `convex/mediaRelayOperations.ts`, `tests/scripts/media-relay-proof.test.ts`, `tests/backend/media-relay-operations.test.ts`, `docs/engineering/media-relay-verification.md`; extend relay runtime configuration/diagnostics.

**Interfaces:** Proof CLI accepts explicit local/hosted target, source-count/bitrate/duration bounds, deadline and output directory; default is local synthetic. Produces measured source packing, startup, memory/CPU, transfer, queue/disk bounds, cache behavior and cleanup evidence. Operations are deployment-operator-only `drainWorker({workerId})` and `setRelayEnabled({enabled})`; never public profile-owner actions. CLI selects its environment explicitly through the repository's deployment tooling; gateway/worker credentials cannot invoke operator commands or event publishing.

- [ ] Write tests: wrong/absent target fails closed; no provider/billing call in local mode; bounded duration and child cleanup; missing measurements prevent enabling; billing alerts are never described as a hard dollar stop.
- [ ] Run `node --conditions=import --import tsx --test tests/scripts/media-relay-proof.test.ts tests/backend/media-relay-operations.test.ts`, including denial of public/gateway/worker identities for operations. Implement local proof and operator observations with resource metrics off critical paths. Measure source concurrency, reconnect storms, audio/video audience transfer and cold/warm latency. Record timestamp warnings as failures to investigate, not discarded logs.
- [ ] Prepare an owner-reviewable deployment plan with actual region/rates, warm allocation, measured caps, request/transfer ceilings, dollar budget, alerts, emergency stop and teardown. No Terraform apply or production enablement in this task.
- [ ] Run proof validation and documented offline checks; commit `ops: add bounded relay verification and release controls`.

### Task 12: Complete-flow acceptance and rollout handoff

**Files:** Create `apps/web/e2e/mobile-hls-playback.spec.ts`, `scripts/mobile-media-acceptance.mjs`; extend the verification document, public/developer playback docs and relevant CI selection/configuration.

**Interfaces:** Use real admitted grants, local synthetic transport, gateway and object origin for composed acceptance. Hosted proof uses explicit selected targets/deadlines and already-approved resources only. Archive device/OS, test duration, audible observations, logs, source/worker epochs and cleanup outcome.

- [ ] Write composed browser cases for all five Review Focus conditions, source/worker restart, native controls, retained navigation, audio preference, metadata changes, and actual media progress. Test cached segments with uncached manifests and suspended JS; native requests alone keep a session alive beyond 180 seconds, while a stopped client releases it.
- [ ] Run `pnpm --filter web exec playwright test mobile-hls-playback.spec.ts event-lineup-live.spec.ts` with the documented isolated fixture environment. Run `pnpm lint:web`, `pnpm typecheck:web`, `pnpm typecheck:backend`, `pnpm build:web`, and canonical generated API checks. Finish visual review. Do not claim green checks from an unrun command or emulate an iPhone with a viewport.
- [ ] Prepare physical iPhone Safari and Android Chrome runs: 30-minute lock, PiP, audio/video toggle, headphones/lock-screen controls, network changes, worker takeover, grant expiry and copied/revoked grants. Missing devices/evidence remain explicit release blockers, not substitutes for desktop results.
- [ ] Obtain the reviewed deployment budget/configuration before any staged hosted enablement. Roll out with small caps and independent rollback; eventual default is all eligible VRCDN streams. Preserve production fallback but clearly withdraw background guarantees when used.
- [ ] Commit final docs/evidence and open the implementation PR with useful validation links. Keep unverified release gates unchecked; do not merge/deploy merely because code is complete.

## Plan self-review and execution boundary

Spec coverage: Tasks 1–3 define identity/authority, 4–7 implement packaging/delivery and resource isolation, 8–10 integrate playback/lineup/metadata, and 11–12 establish cost/device/release evidence. All five Review Focus conditions map to explicit tests. Native observations, cold gestures, grant expiry, idle grace, copied grants, retired objects and partial media are named rather than left as generic edge cases.

Implementation is sequential at interface boundaries. The recommended execution method is Native: one implementer retains context across the tightly coupled protocol/control/player migrations, with a fresh whole-branch reviewer before integration. Independent per-task reviews can be used if BASIC prefers the Subagent-driven workflow. No implementation has started from this plan.
