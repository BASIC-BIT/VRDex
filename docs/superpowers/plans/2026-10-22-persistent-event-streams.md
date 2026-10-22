# Persistent event streaming implementation plan

> For agentic workers: use superpowers:subagent-driven-development. Prior user authorization selects this execution method and removes repeated phase-approval prompts.

**Goal:** Keep event streaming available and make validated silence handoff part of ordinary automatic broadcasts.

**Architecture:** Scheduled singleton Lambda reuses the existing bridge for one non-draining pass. Convex supplies a calibrated default silence policy to unchanged media workers. Actual decoded-media proof precedes activation.

**Tech stack:** Node.js 22, AWS SDK v3, Lambda/EventBridge, ECS, Convex, FFmpeg, Terraform mock tests.

**Spec:** `docs/superpowers/specs/2026-10-22-persistent-event-streams-design.md`.

## Global constraints

- Preserve BITRATE/basicbit1 authority, concurrency one, exact STOPPED admission, launch client tokens, tag propagation, and the 12-hour event deadline.
- No global drain on Lambda completion, timeout or replacement. No 24-hour dispatcher expiration.
- Fifteen-second SDK/HTTP calls, 180-second Lambda, reserved concurrency one, minute schedule and 60-second event age with no failed-event retries.
- Candidate silence below -90 dBFS for 15 seconds, verified through actual AAC/MPEGTS before becoming default. Manual/hold and successor eligibility remain authoritative.
- Preserve all prior proof artifacts. No public copy changes or arbitrary event start. No dependency installation or Docker builds in the disk-constrained workspace.

## Review focus

1. Warm invocations must get distinct owner identities and refreshed token values without logging secrets.
2. Function expiration must not stop a healthy media worker or claim cleanup without STOPPED.
3. The SDK runner must preserve all CLI request semantics, including multiple task ARNs and creation tags.
4. Empty existing event policies must use the default, while maximum-overrun edits retain custom silence.
5. Real decoded quiet audio, short pauses, no successor and manual hold must not cause a silence handoff.

### Task 1: Effective silence defaults and actual media proof

**Files:** `convex/_eventBroadcastInputs.ts`, `convex/eventMediaWorker.ts`, `convex/events.ts`, `tests/backend/event-broadcast-policy.test.ts`, `tests/backend/event-broadcast-worker.test.ts`, new `scripts/event-silence-local-proof.mjs` and focused script tests if needed. Do not change media modules unless the proof exposes a concrete defect.

**Consumes:** Existing validated policy and worker projection, real renderer/supervisor APIs.
**Produces:** Central effective default silence policy, gate-free worker projection, preserved custom overrides, bounded calibration proof and receipts.

- [ ] Add failing tests for missing/empty policy defaults, legacy false calibration env, preserved custom silence on overrun edit, and unchanged manual/readiness/eligibility behavior.
- [ ] Implement central default resolution and remove calibration env gating after actual proof validates the candidate.
- [ ] Add bounded real AAC/MPEGTS worker proof with normal tone, -81 dBFS tone, digital zero, short pause/reset, pre-boundary/no-successor/manual controls, and encoded positive silence handoff.
- [ ] Run focused policy/worker tests, real proof and relevant regressions. Report failures and evidence limits exactly.
- [ ] Freeze file hashes and hand off for independent review. Root commits integrated work.

### Task 2: Scheduled bridge handler and SDK adapter

**Files:** New `scripts/event-media-lambda-bridge.mjs`, new `scripts/event-media-ecs-sdk.mjs`, new `tests/scripts/event-media-lambda-bridge.test.mjs`, new `tests/scripts/event-media-ecs-sdk.test.mjs`. Existing CLI bridge stays compatible.

**Consumes:** `loadConfig`/`runBridge`, current bridge environment excluding CLI/bootstrap/deadline variables, exact service-token secret ARN.
**Produces:** Lambda `handler`, injected request runner, token refresh, safe outcome logging, unique invocation identity and bounded calls.

- [ ] Write failing tests for exact five-operation SDK payloads, all RunTask flags, variadic DescribeTasks, unsupported arguments and request abort behavior.
- [ ] Implement `createEcsSdkRunner({client,commands,timeoutMs})` using injected SDK commands and AbortSignal timeouts. Deferred production imports use runtime SDK.
- [ ] Write handler tests proving two warm invocations use distinct IDs/fresh token, once-only ordinary reconciliation, no deadline/global drain, generic failure logging and bounded Convex fetches.
- [ ] Implement `createLambdaHandler(dependencies)` plus exported production `handler`, with exact secret references and `awsRequestId` identity.
- [ ] Run adapter/handler tests and existing 23-case lifecycle regressions. Freeze hashes and request task review.

### Task 3: Persistent dispatcher infrastructure

**Files:** `infra/terraform/restream-worker/bridge.tf`, `infra/terraform/restream-worker/tests/bridge.tftest.hcl`; root owns deployment docs and owner artifact values.

**Consumes:** Task 2 bundled ZIP containing `index.mjs` exporting `handler`; existing `event_media_bridge` configuration, with CLI archive fields removed and bundle key now `event-media-bridge/sha256/<sha>.zip`.
**Produces:** Opt-in scheduled singleton Lambda and exact IAM, retaining existing worker secret grant and worker networking/env.

- [ ] Update mock tests first for default-off, exact Lambda timeout/concurrency/environment, no drain/CLI fields, minute schedule, retry age, token-only runtime secret read and unchanged ECS ownership boundaries.
- [ ] Replace bounded ECS dispatcher definition/roles/bootstrap with dedicated Lambda role/policy/logs/function, EventBridge rule/target/permission and async invoke bounds. Runtime requires no S3 read.
- [ ] Preserve exact worker execution-role secret grant and emergency publication setting. Owner opt-in provisions the schedule with no additional runtime enable variable.
- [ ] Run native Terraform tests, validate and format. Render exact owner resources with offline mocks for root's provider bootstrap.
- [ ] Freeze files and request independent infrastructure review.

### Task 4: Integrate, verify and publish

**Owner:** Root after reviewed tasks 1–3.

- [ ] Update deployment and verification docs with current automatic behavior, cost, proof scope, timing and recovery limits.
- [ ] Bundle handler and Convex dependency as Node 22 ESM, externalizing runtime SDK; make deterministic ZIP and manifest. Upload hash-addressed private object and verify readback SHA.
- [ ] Review whole branch, run appropriate complete backend/scripts and Terraform checks using in-memory temporary fixtures to avoid overlay exhaustion.
- [ ] Bootstrap exact evaluated IaC, smoke actual Lambda SDK/secret/polls and singleton schedule. Wait for no sessions; stop legacy dispatcher and confirm STOPPED before enabling schedule. Preserve existing provider bindings and master state.
- [ ] Deploy backend policy changes after proof acceptance, remove obsolete calibration variable, and read effective production policy safely.
- [ ] Commit/push one PR, attach it, manage CI and reviewer feedback, and report concrete readiness with ongoing availability and evidence limits.
