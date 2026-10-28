# Real-event streaming pilot implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (already selected) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let BASIC rehearse a real mixed VRCDN/Twitch event through one stable VRCDN link ASAP, then validate normal website Start and controls after legitimate admission.

**Architecture:** Deliver an isolated assisted media trial while the existing production qualification path proceeds. Reuse production media/control modules and run-scoped diagnostic authority; preserve the empty production map until shared proof and the two initial capacity cases pass. Release only `720p30:false` first and finish the wider matrix afterward.

**Tech Stack:** Existing Next.js/Convex operator UI, Node ESM/Python/FFmpeg worker, AWS ECS Fargate/ECR/S3/SSM/Scheduler and existing deployment tooling.

**Spec:** [Real-event pilot design](../specs/2026-10-28-real-event-stream-pilot-design.md).

## Global constraints

- Initial output: one VRCDN destination, 720p30 H.264/AAC320, no Twitch simulcast; both VRCDN and Twitch inputs.
- Start with 4 vCPU/8 GiB; a diagnosed failure may justify a separately measured 8-vCPU/16-GiB run. No automatic resource escalation.
- Preserve real session, account authorization, immutable allocation, command, lease and cleanup guards. No synthetic resolver or admission bypass in production.
- `720p30:false` requires accepted primary-only AAC160 **and** AAC320 capacity cases, each with 300 steady dual-decode seconds, plus current shared qualification prerequisites.
- Assisted runs use at most 45 workload minutes, 180 seconds finalization, independent provider stop within 50 minutes, one publisher and at most two physical acquisitions. Publication waits for a verified armed stop schedule.
- Private command object: at most 8 KiB/32 commands; status at most 64 KiB; stable operation keys, increasing sequence and expiry no more than 30 seconds after issue; one Root writer; polling at most once per two seconds.
- Preserve source readiness, silence/eligibility, media progress and encoded acknowledgements. A submitted command or live hint is never successful output evidence.
- Use the existing $20 total ceiling and ledger. Current held $16.56346 and estimated compute $1.75346 exclude unaccounted network/storage; do not reset either or presume all qualification is funded.
- No new NAT gateway, public control endpoint, product enable toggle or speculative credential rotation. Reserve `basicbit1` for output; identify/authorize `basicbit` before using its feed or replacing its publisher.
- Diagnostic media: 1700 MiB total, program at most 1 GiB, playback clips at most 64 MiB, small records at most 8 MiB total/1 MiB each, existing 32-MiB manifested upload parts; reserve 6 GiB local verification space. Keep recordings and signed URLs private. Conditional proof bounds stay unchanged.
- Only planning is completed by this document. Keep the previously chosen execution method and existing authorization; do not restart approval menus between tasks.

## Review focus

1. An occupied VRCDN account or output fed back as input must fail preflight without disconnecting an unrelated publisher (Tasks 1–2).
2. Lost, repeated, malformed or expired diagnostic commands must not falsely acknowledge a Take or continue after terminal Stop/control loss (Task 2).
3. A musical pause, stale browser hint or schedule boundary must not substitute for eligible decoded-ready handoff evidence (Task 3).
4. A working external rehearsal must not mark normal website Start, capacity or unobserved Quest playback accepted (Tasks 4–7).
5. Backend/dispatcher/image mismatch, uncertain task ownership or a preexisting active session must block rollout and cleanup shortcuts (Tasks 6–8).

## File and ownership map

- `scripts/event-mixed-provider-rehearsal.mjs`: bounded real/controlled diagnostic workload, actual worker/media composition and terminal receipt.
- `scripts/event-mixed-rehearsal-control.mjs`: private command envelope transport to the existing proof-control/production reducer; bounded status.
- `scripts/event-mixed-rehearsal-infra.mjs`: pure reproducible AWS request builders for run-scoped role, task, arm/stop schedules and cleanup; no implicit provider writes on import.
- Existing proof process/packet/upload helpers: reuse bounded primitives; extract shared chunk-upload code only where necessary, preserving old capacity/Twitch CLI contracts.
- `tests/scripts/event-mixed-provider-rehearsal.test.mjs`, `event-mixed-rehearsal-control.test.mjs`, `event-mixed-rehearsal-infra.test.mjs`: real lifecycle and boundary regressions with dependency seams only at external transport/provider boundaries.
- `docs/engineering/event-broadcast-rehearsal.md`: reproducible runbook and actual readiness/results.
- `docs/engineering/event-stream-pilot-readiness.md`: finite provider/deployment/budget/qualification ledger and milestone verdicts.
- Existing qualification modules and immutable authorities: change only through the explicitly reviewed preparation/execution design in Task 5.
- Existing measured map, backend/bridge, operator components and migration driver: normal admission/rollout in Tasks 6–7; no second console.

## Task 1: Freeze the event, provider roles, deployment facts and funded scope

**Files:** create `docs/engineering/event-stream-pilot-readiness.md`; update rehearsal runbook. No product code.

**Interfaces:** consumes merged source and retained smoke originals; produces a run-input ledger with `assistedTrialReady`, `websitePilotReady`, `blockedItems`, exact source/output identities, deployment revisions and conservative run reservations. These are documented verdicts, not application flags.

- [ ] Verify the merged checkout, current BASIC AWS account `079358094174`/region `us-east-1`, existing network, exact candidate digest, no conflicting tasks/sessions and output grants. Follow the cloud-start guide before hosted bindings; never print secrets.
- [ ] Target BASIC's test event tonight, October 28, 2026, America/Indianapolis time. Confirm exact start time, event identity and source links. Use BASIC's VRCDN feed → a consenting Twitch streamer → BASIC's same feed again. The Twitch channel remains unselected; do not infer relay permission from public availability. Reserve `basicbit1` output. If `basicbit` is the desired existing feed, establish its publisher/content and consent; otherwise choose another authorized source or repair/release that account through its owner.
- [ ] Record actual backend protocol/generated API, web revision, dispatcher ZIP/source/image configuration, registry grants, reference-to-secret map, SSM state, IAM/network and ambiguous dispatch ownership. Mark unknown deployments unknown; merge alone is insufficient.
- [ ] Reconcile each closed-run reservation with a conservative total-cost bound and retained history. Reserve complete trial costs including transfer, recordings, receivers and teardown. Stop unfunded launches; do not silently erase holds. Produce a separate finite estimate before shared bulk qualification.
- [ ] Record PC/Quest availability, target world/player and direct-source fallback. A missing Quest device blocks that acceptance claim, not an honest PC trial.
- [ ] Check that no proposed input is the program output and no new publisher conflicts with an occupied account. Record exact pass/block reasons and commit the runbook/readiness ledger without credential values.

**Acceptance:** there is a concrete safe/funded provider topology, or an exact blocked human/provider input; no vague “refresh all infrastructure” action. Tasks 2–3 local implementation can proceed while those inputs are collected.

## Task 2: Build the bounded assisted-run and operator helper

**Files:** create the three `event-mixed-*` modules and named tests above; modify `workers/restream/packaging-manifest.json` and shared upload helper only if required; update rehearsal runbook.

**Interfaces:** `parseMixedRehearsalConfig(value)` returns a validated immutable manifest; `createMixedRehearsalControl({manifest,readCommand,writeStatus,clock})` exposes the existing worker control function plus bounded `close()`; `buildMixedRehearsalRequests(manifest)` returns explicit AWS setup/launch/arm/stop/cleanup request data. No provider call on import. Inputs at these boundaries are unknown until validated.

- [ ] Write failing tests for a same-account feedback loop, unauthorized source/output identity, missing real attestations, unknown source revision, oversized command/status, bad run ID and malformed/expired/duplicate sequences. Example: `assert.throws(() => parseMixedRehearsalConfig({...valid, sources:[outputAsInput]}))`; a negative must occur before sender start.
- [ ] Run `node --test tests/scripts/event-mixed-rehearsal-*.test.mjs tests/scripts/event-mixed-provider-rehearsal.test.mjs`; confirm the new assertions fail for the intended missing behavior.
- [ ] Implement real source relay/Twitch acquisition, actual input manager/supervisors/renderer and `createEventOutputs`, with existing proof-authority control translation. Real mode cannot use generated fallback; controlled mode is explicitly separate. Keep the old fixed `event-vrcdn-rehearsal.mjs` behavior unchanged.
- [ ] Implement the private helper with one writer and bounded existing AWS CLI children. Retain pending operations; reuse existing Take/Cut/Hold/Return/Cancel/Stop semantics and actual encoded acknowledgements. Test Cut/Stop supersession and no sender restart after terminal fencing. Two consecutive command-read failures stop publication; expiry alone cannot turn a rejected command into success.
- [ ] Build run-scoped S3/SSM permissions and independent Scheduler stop requests with exact role/task/object ARNs. Start in unarmed state, wait at most 60 seconds, and refuse to publish before a verified stop schedule is armed. Test missing/failed stop installation, uncertain RunTask outcome and idempotent teardown of owned resources only.
- [ ] Retain bounded private media, typed receipts, one-second resource/progress samples and status. Reuse manifested 32-MiB parts and two complete independent reads; preserve old envelope kind/limits/validation if sharing helpers. Missing/oversized/failed retention is incomplete evidence, never success.
- [ ] Run the focused tests and old proof-envelope/rehearsal regressions; run a local generated-source positive and no-source negative through real media modules. Require actual output, real acknowledgements and zero owned children. Syntax tests alone are insufficient.
- [ ] Commit the tested implementation and docs. Build/pin its candidate image, verify actual packaged sources/wheels and run the ordinary native132 gate once on the changed image. Do not repeat old-image tests as new-image acceptance.

**Acceptance:** a reviewed, stopped-by-default run can be launched/operated/terminated without a public endpoint or production writes. A missed cleanup, missing stop schedule, fake acknowledgement or real-mode generated fallback blocks live launch.

## Task 3: Prove automatic handoff and failure behavior on controlled media

**Files:** extend the new runner's controlled scenarios and tests; reuse `scripts/event-silence-local-proof.mjs`, production `handoff-policy.mjs` and operator controller; update readiness evidence. Change production behavior only if a reproduced defect requires a separately reviewed fix.

**Interfaces:** controlled scenario receipts identify fixture/source, authored eligibility, decoded evidence, mode/intent, selected output identity, issued/acknowledged commands, actual publication state and cleanup. Keep deterministic faults separate from real provider observations.

- [ ] Add failing real-media assertions for healthy overrun, short silence with audible reset, sustained eligible silence, no-ready-successor, source death, maximum overrun, manual hold, pending-Take Cut/Cancel, hint-observer failure and terminal Stop/lease/switch/deadline loss.
- [ ] Use -90 dBFS/15 seconds for the initial silence case and the production one-second failure confirmation. Measure decoded levels/progress; do not mute a browser or promise one-second end-viewer failover.
- [ ] Implement only missing diagnostic fixtures/cues; use production policy/reducer. Assert A stays beyond its schedule while healthy, B appears only with eligible fresh readiness, no ready successor yields safe slate where appropriate, and manual intent remains authoritative.
- [ ] Run focused local assertions, then one bounded current-image Fargate controlled run, at most 10 workload minutes with an independent 15-minute stop. Include fixture/receiver/control overhead in resource records. Keep it within the manifest's outer bounds.
- [ ] Independently verify recorded source/slate transitions, output progress/packets and actual sender cessation. Confirm STOPPED, inactive owned definitions, absent ENIs, closed groups and reconciled control state; retain all failures.
- [ ] Commit scenario source/results. If packaged/runtime code changed, freeze/rebuild and repeat affected image gates before the live trial; do not inherit the prior digest's receipts.

**Acceptance:** the requested schedule/silence/death/cutoff/hold behavior is demonstrated with real media. This is functional diagnostic evidence, not shared marker/capacity qualification.

## Task 4: Run BASIC's mixed-provider dress rehearsal and sustained input test

**Files:** use Tasks 1–3 runner/manifest; update readiness/runbook with exact immutable receipt references. Retain media privately.

**Interfaces:** consumes a funded/authorized manifest, known image and verified stop schedule; produces `assistedTrialReady` evidence and explicit failed/unobserved cases. It cannot produce `websitePilotReady` or a measured-map entry.

- [ ] Preflight both actual DJ inputs immediately before launch; reject no-rendition/unready channels explicitly. Confirm the output account is free and the input is independent of it. Do not replace failed feeds with unrelated public channels for republication.
- [ ] Launch one exact-image task at the reserved shape, verify actual metadata and arm the independent stop before publishing. Obtain the canonical browser/PC/Quest program links from the existing link helper.
- [ ] Let BASIC watch the stable program URL. First manually Take BASIC's VRCDN feed → the selected Twitch feed → BASIC's same VRCDN feed again. Confirm the return reacquires fresh media and the viewer's URL stays unchanged. Then exercise Cut, Hold, Return and Stop/recover as planned. Keep automatic handoff checks separate from this first manual sequence. Record assisted transport latency separately; the website does not control this worker.
- [ ] Run 1800 uninterrupted seconds after both real decoders are ready, excluding deliberate faults/retirement/startup. Retain full-window samples and private program recording; zero unplanned readiness losses or output stalls are required for a passing steady interval. A working short clip does not substitute.
- [ ] Run the existing two-distinct-Twitch public proof when funded/appropriate as a separate 1800-second **private/no-sender** test. It can proceed independently; it does not prove mixed input or VRCDN publication.
- [ ] Independently observe provider output content and freshness at each source/slate change, not just codec headers. Record PC world/player playback and available standalone Quest evidence; keep missing devices/real ads/expiry unobserved rather than accepted.
- [ ] Exercise operator emergency Stop and verify real publication cessation. Retrieve/check complete receipts/media within reserved bounds, then confirm all provider/task/role/schedule cleanup. An interrupted or failed run remains failed/incomplete.
- [ ] Publish a reviewed milestone report with the stable-link experience, limitations and remaining website gates. Do not publicly attach DJ recordings or signed URLs.

**Acceptance:** BASIC has personally tested real mixed streams through the stable host URL. If successful, this is the first useful event milestone, delivered without waiting for every production preset or fabricating admission.

## Task 5: Close the finite shared qualification preparation and execution gap

**Files:** update readiness ledger; existing `scripts/event-marker-native-{controller,ecs-controller,ci-controller,bundle}.mjs`, `event-marker-evidence-policy.mjs`, `event-marker-program-acquire.mjs` and `scripts/marker-qualification/*` only according to the reviewed execution design; source qualification docs and corresponding focused tests.

**Interfaces:** consumes current adopted authorities and an exact candidate; produces a complete artifact-status ledger and command/context/replay table for single PROGRAM, native132, paired canary and bulk groups. Unsupported rows must produce a reviewed execution design and implementation plan before that proof launch, not an invented success receipt.

- [ ] Inventory the exact required whole originals, current image/runtime/native observations, `profile`, `proofDescriptions`, `verifierClosure`, `plans`, `nativeCatalog`, runtime manifest and complete semantic/review/adoption operands. Classify each verified/needs-review/missing with a finite action; reuse genuine retained bodies.
- [ ] Specify missing canary/group command admission, K/I/context transport, matching reservation policy, original inventory, outer replay, deadlines and cleanup in `docs/superpowers/specs/2026-10-28-stream-qualification-execution-design.md` and its corresponding implementation plan. Preserve fixed IDs/trains and existing R90/R94/native/SDK bounds. Do not extend the single PROGRAM allowance by relabeling a group command.
- [ ] Independently review that design, then implement its focused tests RED/GREEN and only the required transport/controller support. Preserve `nativeBindingVerified:false`/`loaderComplete:false` where the existing conditional result requires them. Stop only unsupported proof launches; keep the assisted trial independent.
- [ ] Freeze the final measurement image/source and rerun affected actual-image gates. Construct K from real inputs; issue genuine separate prelaunch Root A for the exact profile/environment/audit set. Preserve source/launch/readback identities and failed attempts.
- [ ] Run and independently accept the frozen four-train paired canary before any bulk release. Execute the remaining fixed groups only within a funded bound; require exact 79,996-case union with no missing/duplicate/skipped outcomes and complete cleanup/original replay.
- [ ] If the required path cannot be funded or genuinely completed, record the precise remaining gap. A smaller production acceptance contract is a separate explicit design/adoption decision; this plan grants no waiver and cannot mark website admission complete.

**Acceptance:** supported, reviewed and actually accepted shared qualification, or a finite truthful blocker report. This task may run in parallel with provider/device preparation and diagnostic trials, without concurrent source writers.

## Task 6: Qualify the two capacity cases and admit only the initial configuration

**Files:** existing capacity runner/contracts/resources and their tests; `workers/restream/broadcast-capacity.mjs`; canonical quality/capacity docs and readiness ledger. Server/bridge code changes only if acceptance reveals a concrete defect.

**Interfaces:** consumes accepted shared qualification and exact final image; produces one measured `{cpuUnits,memoryMiB,evidenceId}` allocation for `720p30:false`, covering AAC160/320. No fixture evidence IDs, client/env overrides or cross-image substitution.

- [ ] Run the unchanged capacity CLI twice with `--preset 720p30 --cpu 4096 --memory 8192 --duration-seconds 300 --simulcast false --audio-bitrate 160` and then `320`, each with a fresh valid output directory/run ID and full envelope/outer deadline. Include startup/handoff/slate/cleanup outside steady time.
- [ ] Require all declared media/marker/resource/original gates: complete healthy dual decode, CPU P95 below 80%, resource coverage, memory, delay below 2 seconds, A/V at most 100 ms, PSNR at least 28, exact destinations and stopped publication/cleanup. Inspect failures before any new shape/run.
- [ ] If capacity genuinely fails, repeat the affected pair at 8192/16384 with a new funded reservation. Choose one measured shape that covers both audio settings. Preserve smaller-shape failure records.
- [ ] Add regression assertions in `tests/backend/event-broadcast-capacity-admission.test.ts` and bridge tests: admitted 720p30 primary-only works for both audio rates; every unmeasured preset/simulcast and stale/forged snapshot still rejects before writes/launch.
- [ ] Populate exactly one production entry with accepted evidence; keep all other entries absent. Update the human evidence table. Run focused admission/bridge tests, backend typecheck, full backend/scripts checks and review the map change.

**Acceptance:** the configuration has legitimate incremental admission. Success does not claim the other 22 capacity cases or full feature rollout.

## Task 7: Verify real website lifecycle and prepare a coherent release

**Files:** `scripts/verify-event-broadcast-migration-local.mjs`, migration driver/tests, existing operator view/settings/source/diagnostics components, operator/browser tests, deployment docs and existing bridge build/infra configuration as required. No second console.

**Interfaces:** consumes the real production resolver from Task 6 and compatible protocol/image; produces real whole-flow lifecycle evidence and a matched backend/dispatcher/web/image release manifest.

- [ ] Run `node --import tsx scripts/verify-event-broadcast-migration-local.mjs run` against freshly owned local state using the canonical workflow. Require the normal whole-flow result; admission-blocked mode/test resolver is insufficient.
- [ ] Verify authorized event setup, both source providers, off-lineup add/replace/remove, Start, Take/Cancel/Cut/Hold/Return/Stop, settings immutability, rejected unqualified configuration, stale hints/Unknown and actual-state versus queued-intent projection. Add a focused failing regression only for a real missing behavior.
- [ ] Use the existing operator components; if capability information is needed to prevent an unavailable configuration appearing startable, derive it from measured server authority. Keep selectors/feedback honest without a new enable toggle or invented CPU authority. Follow TS/React guidance for any code change.
- [ ] For UI changes, select existing browser/visual CI lanes and retain screenshots with VLM review. New product prose follows the repo's exact-copy rule; reuse approved labels wherever possible.
- [ ] Build the matching dispatcher bundle from the admitted-map revision; pin qualified worker digest and exact grant/secret references. Verify backend generated API/protocol and web revision. Changes to packaged runtime require renewed affected measurement, not a metadata-only release assumption.
- [ ] Run required checks and whole-branch review, publish the implementation PR and iterate until merge-ready. The current plan branch is documentation only; existing PR #388 is already merged.

**Acceptance:** real site lifecycle is locally verified and a concrete compatible release is ready; deployment is not inferred from merge.

## Task 8: Deploy and personally test one website-operated event; finish expansion

**Files:** operational release/rollback evidence and readiness ledger; the remaining measured entries/docs only after their own accepted receipts.

**Interfaces:** consumes merged/reviewed release and a selected owned timed event; produces `websitePilotReady` only after actual site-to-provider/device/Stop observations.

- [ ] Recheck zero conflicting sessions/tasks/ambiguous ownership. With starts held, deploy matching backend/bridge/web and pinned image; perform required whole-table migration with existing per-page fences. Do not delete admission reservations or blindly rerun an already-proven migration.
- [ ] Reserve an exclusive operator window. Before website Start, pre-arm a 50-minute stop through the existing emergency switch; refuse this global action if another session/publisher could be affected. Add exact-task stop as soon as its ARN is observed. Keep concurrency one; the 12-hour runtime deadline/calendar end is not a trial stop.
- [ ] Start from the real website and observe session -> dispatch -> exact task -> decoded inputs -> actual provider publication. Allow the existing minute dispatcher plus startup window; do not add a redundant instant-start toggle to hide discovery delay.
- [ ] Have BASIC perform the normal console operations and watch stable PC/browser and available physical Quest playback. Verify source identity/freshness and carry out Stop/recovery/fallback once. Retain genuine authority-expiry and actual sender-cessation evidence separately from an accepted button click.
- [ ] Confirm task/provider cessation and correct admission reconciliation, then remove owned stop automation and restore only safe compatible pre-run state. Publish exact achieved scope and device/provider gaps.
- [ ] Complete the other 22 capacity cases, admitting each key only after its two audio/output cases pass. Obtain separate Twitch output credentials/provider/device acceptance before admitting simulcast. Real Twitch input support does not require Twitch output setup.

**Acceptance:** BASIC can test the selected real event using the website and the stable VRCDN host link. Wider quality/simulcast acceptance remains explicitly incremental; every unfinished or failed case stays visible.

## Dependency and execution order

Task 1 inventory/provider/budget work and Task 5 readiness analysis can proceed
alongside the single implementation writer for Tasks 2–3. Task 4 is the earliest
personal trial and does not wait for Task 5 or the full matrix. Tasks 6–8 require
legitimate shared qualification and normal admission in that order. Never run two
publishers against one account or merge concurrent source edits blindly.

Self-review checklist: all three milestones map to tasks; all five Review Focus
items have owning tests/checks; control/stop/artifact bounds match the spec; the
single map key covers both audio rates; no assisted success claims website or
capacity acceptance; no new public control or product enable mode; no fresh-budget
assumption. Event/date and real participants remain run inputs, not guessed facts.
