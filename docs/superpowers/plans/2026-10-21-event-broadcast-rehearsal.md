# Event broadcast rehearsal implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute the approved rehearsal proposal; do not reopen product design or PR 377.

**Goal:** Run bounded current-worker capacity and one-source VRCDN checks while ordinary hosted event output stays disabled.

**Architecture:** Package explicit proof commands alongside the unchanged media runtime. A provider proof uses real relay/renderer/sender modules and a dedicated SSM enable check, with in-memory test authority isolated from Convex. Image publication and three narrowly scoped IAM grants are reproducible, and every task has an independent external stop deadline.

**Tech stack:** Node ESM, FFmpeg, AWS ECS/Fargate/ECR/SSM/S3, Terraform and GitHub Actions.

**Spec:** Approved `/workspace/provider-execution-proposal.md` and three `/workspace/restream-*-policy*.proposed.json` artifacts. User explicitly approved all proposed permission changes and bounded tests on October 21, 2026. The original event broadcast spec and runtime guards remain binding.

## Global constraints

- Production `/vrdex/restream/hosted-worker/enabled` remains false. Dedicated rehearsal switch `/vrdex/restream/rehearsal/enabled` defaults false and is the only switch toggled for provider proof.
- Use only existing basicbit1 source and basicbit output. No Twitch account exists. Do not claim two-independent-source live acceptance, real Convex admission/registry/leases, musical silence calibration or physical device acceptance.
- Current event profile only: 720p30 H.264/yuv420p, 1800kbps video, AAC stereo160kbps/48kHz, one-second VRCDN GOP. Keep normal runtime modules/thresholds unchanged.
- No secret values in reports, committed files, logs or new proof/runner command-line arguments. Output credential uses ECS secret injection. Source pusher receives only source credential. Synthetic task receives neither. The unchanged production FFmpeg child receives its existing private ingest arguments; do not export process command lines or claim task-local process inspection cannot see them.
- At most one 120-second synthetic task at2CPU/4GiB, one120-second output task at2CPU/4GiB, and two sequential source pushers at1CPU/2GiB per initial approved attempt. Each outer process deadline240s; run deadline ten minutes. No automatic retries or unreviewed resource escalation. Preserve failures.
- Estimated compute approximately$0.02, excluding storage/egress/logs; incremental target$1 is not a hard billing cutoff. AWS account budget already exceeded, disclosed and user approved proceeding.
- Preserve all prior evidence and images. No concurrent media runs/builds. Managed isolated checkout `/workspace/VRDex` is the documented lane; new branch `ops/event-broadcast-rehearsal` starts at merged326a38b.

Approved amendment after the second attempt: the runtime-unchanged constraint above
describes the original proof images. Correct the demonstrated canonical VRCDN host
compatibility defect only in `parseOutputCredential`. Preserve all other runtime
behavior and existing image provenance; rebuild and review a new image before any
future authorized provider attempt.

## Review focus

- Missing attestation, wrong source/output or switch name, arbitrary endpoint/credential settings: reject before provider side effects.
- Switch false/unavailable or expired authority: sender fencing uses existing checkHostedEnabled and worker watchdog; never hardcode live enable true.
- Child failure, timeout, signal and failed verification: stop publication and children, persist bounded numeric diagnostics and upload failure evidence while preserving nonzero status.
- Diagnostic/log content must not emit credentials or unbounded provider stderr/source payloads.
- Two-minute synthetic success is a bounded sample, not sustained acceptance. One VRCDN source cannot prove distinct-source handoff or Twitch acceptance.

### Task 1: Implement and review isolated proof tooling

**Files:**

- Create `scripts/event-vrcdn-rehearsal.mjs`, a small independently testable provider proof adapter.
- Create `scripts/event-proof-runner.mjs`, bounded subprocess runner and private artifact finalizer, if needed to avoid duplicated upload/cleanup logic.
- Modify `workers/restream/Dockerfile` to package proof/helper commands and consolidate explicit file copies into one worker layer and one proof layer. Default entrypoint, paths and runtime module contents remain unchanged; consolidation prevents VFS from storing a full filesystem copy per tiny file during this build.
- Create focused Node tests under `tests/scripts/` for proof guards, commands, kill-switch fencing/cleanup, failed status preservation and secret-safe reports using injected dependencies.
- Add manual image-only workflow `.github/workflows/restream-image.yml` from reviewed prototype; no automatic triggers or ECS/IAM/SSM/Convex mutations.
- Add opt-in exact IAM delta resources in existing Terraform owners, with default disabled and documented import/bootstrap path. Use standalone policy names `vrdex-restream-proof-image`, `vrdex-restream-rehearsal-source`, `vrdex-restream-rehearsal-switch` to avoid replacing any unrelated existing inline policy. Add dedicated SSM parameter definition only through opt-in rehearsal config, defaultfalse. Existing execution role output access remains intact.
- Update deployment docs with exact invocation, bounds, evidence limitations, and cleanup commands. Include permission ownership and no default production enablement.

**Interfaces:**

- Imports production `createEventWorker`, `checkHostedEnabled`, `createProgramRenderer`, `createEventOutputs`, `createSourceRelay`; inject only test authority, not live transport/DNS/parser bypasses.
- Fixed real source `https://stream.vrcdn.live/live/basicbit1.live.ts`; output credential from `VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON`; required explicit nonsecret rehearsal guard plus explicit four authority/rights attestations from operator configuration.
- Dedicated switch region us-east-1, source/output fixed; no production Convex token. In-memory control emits ordinary command acknowledgements/observations but reports them as synthetic authority.
- Sample source, hold, explicit return and record source death/recovery only if actually observed. Operator controls source task replacement externally; do not fake those observations. Duration120s, internal deadline180s, outer240s. On kill switch false, record actual fencing and terminate. Bound startup publication wait and do not call no-publication success.
- Artifact finalizer may use current task role `s3:PutObject` under existing private `synthetic-benchmarks/<run-id>/`. Upload only safe allowlisted artifacts after sender teardown; preserve media and diagnostic results on failure. Never serialize env/credentials. Existing proof records are local and not evidence of provider device playback.
- Wrapper synthetic mode runs existing `event-output-local-proof.mjs` with120s, captures failure and exit accurately, then finalizes artifacts. No need to redesign its workload or claim relay/warm-successor coverage.

- [x] Write meaningful failing tests for guards, authority expiry/cleanup and failure evidence.
- [x] Implement minimal modules/configuration and package imports correctly.
- [x] Run focused tests, syntax/lint/Terraform checks appropriate to touched files. No media load test until root coordinates available Docker space.
- [x] Commit reviewed-scope changes and write full task report, commands and exact results to `/workspace/rehearsal-sdd/task-1-report.md`.

### Task 2: Approved operator execution and evidence

Root coordinates AWS changes, image transport/publication and bounded tasks. New workflow cannot be dispatched until installed on default branch; prefer a supported credential-free image artifact import via native AWS APIs if feasible, without exporting machine-role credentials or merging code without authorization. Record this bootstrap route and provenance if used.

- [x] Verify caller account, current role policies, output/source references, private artifact bucket and immutable ECR repository.
- [x] Apply only three approved additive policies and create dedicated switchfalse. Preserve exact rollback documents and read back effective changes.
- [x] Build reviewed normal Dockerfile and verify nine unchanged packaged module hashes. Publish exact image using authorized existing tool paths; no credential extraction or security bypass.
- [x] Prepare exact task definition/run objects, network/roles/log settings and external stop identifiers. Review before launch.
- [x] Run one synthetic check; inspect actual result before any provider task. If capacity fails, preserve evidence and diagnose rather than proceed blind.
- [ ] Run source and output rehearsal only if prerequisite results permit; collect real provider playback bytes/frames/audio samples with bounded observers.
- [x] Restore rehearsal switchfalse; confirm exact tasks STOPPED, no overlapping source publishers and no production enablement. Retain private evidence and document remaining acceptance limits.
- [x] Update tracked verification docs and create/attach a reviewable PR for tooling/results. No merge without existing authorization.

## Preflight consistency

| Tasks/files | Producer and consumer | Finding |
| --- | --- | --- |
| Task1 proof and runner | Runner invokes packaged proof; Dockerfile packages both plus shared helper | One writer; focused tests assert packaging/guard paths |
| Task1 workflow and IAM | Workflow uses existing GitHub OIDC role; opt-in grant covers only exact ECR repository | No trust change; no task or secret authority in image job |
| Task1 runner and Task2 tasks | Runner produces safe artifacts to allowed prefix and preserves exit status | Root uses explicit command, immutable digest and240s outer deadline |
| Task1 live adapter and Task2 switch | Adapter reads dedicated exact SSM parameter using existing worker enable authority | Production switch untouched; false/error fail closed |
| Task1 itself | No fake live transport; tests inject dependencies outside direct CLI path | Meets fixed accounts/profile and one-source limitations |
| Task2 itself | Bounded one-attempt tasks; status/evidence before any next launch | Ten-minute external run deadline; no success inference from control flags |

Self-review: approved proposal requirements are covered by Tasks1–2. Existing startup failures, optional SPS warnings, unavailable Twitch/second source and lack of physical observers remain explicit limitations.

## October 21 execution status

Tooling and evidence review: [PR 378](https://github.com/BASIC-BIT/VRDex/pull/378).

Task 1 implementation and both scoped correction reviews are complete through
`dcf83fe`; 28 focused tests pass. Task 2 is partial. The 120-second 2 CPU/4 GiB
Fargate synthetic run passed on image `sha256:abf9bf6c6a68d44f0159386bb7d740da9df50ab0c337f536f108818014d0a6e4`
from `16e46cb`. A bounded public `basicbit1` capture decoded offline, while the
initial strict live probe failed and remains preserved. The corrected provider image
`sha256:59388ac42078ba3f7ca44ce560b3e51e306f7ed460325e4855320f00f76adb23`
from `dcf83fe` was verified and published but not launched.

The attempt window was `22:06:48.956Z` to `22:16:48.956Z`. Review correction and
source diagnostics used the available window. No output task, second source, live
source/hold/return, source loss/recovery or dedicated-switch fencing occurred. Both
switches remained false. Source StopTask was requested at `22:14:27.917Z`; execution
stopped at `22:14:40.062Z` and ECS STOPPED followed at `22:15:04.466Z`, exit 143 from
operator termination. Native cleanup verification at `22:15:47.817Z` confirmed both
tasks STOPPED, zero running tasks, both network interfaces DELETED and all three
proof-only definitions INACTIVE. The three approved IAM policies remain as durable
tooling. A further bounded live window is required. Do not mark the
plan complete or infer output/provider/device acceptance from source or capacity evidence.
See [the attempt record](../../engineering/event-broadcast-rehearsal.md#october-21-2026-attempt-record).

## Second bounded attempt and Task 4 scope amendment

The separately approved second window began at `22:24:44.718Z`, with a global
deadline of `22:34:44.718Z`. One source and one output used the existing corrected
image from `dcf83fe092f1c2bf3b492633516ac05b97504e0b`, digest
`sha256:59388ac42078ba3f7ca44ce560b3e51e306f7ed460325e4855320f00f76adb23`.
No capacity rerun, second source or output retry occurred. The public source sample
decoded 228 frames over 8.266667 seconds with audio. Output exited 1 after 63 ms,
before `proof-start`; its observer received zero bytes with `TimeoutError`, and no
output S3 artifacts exist.

The valid split output credential uses exact `ingest.vrcdn.live`. Boolean-only native
inspection isolated the old regional-only parser restriction; the successful source
uses the same canonical host. Root approved the narrow production parser correction
because retaining this demonstrated incompatibility blocks real provider validation.
The scope expands accepted destinations only to the exact known canonical host,
with negative tests preventing suffix, nested-subdomain and URL bypasses. No IAM,
credential rewrite, endpoint substitution or production enablement change is included.

- [x] Reproduce the canonical split/combined rejection with synthetic credentials
  before changing production code.
- [x] Accept exact canonical and existing one-label regional hosts; retain provider,
  protocol, port, application path, key and URL restrictions.
- [x] Verify parser behavior and the actual rehearsal startup gate locally, then run
  focused non-media output, worker, restream configuration/control and rehearsal suites.
- [x] Preserve the initial attempt and append second-attempt evidence to engineering
  rehearsal and verification docs.
- [ ] Build and review a new image before any future separately authorized provider
  window. This is outside Task 4 and is not live acceptance of the parser fix.

Final native verification at `22:29:03.711Z` found source STOPPED at `22:27:44.091Z`,
exit 143 from operator termination; output STOPPED at `22:26:47.643Z`, exit 1; zero
RUNNING tasks; both revision-2 proof definitions INACTIVE; and both switches false,
production version 1 and rehearsal version 4. Output exited before switch cleanup,
so actual switch fencing remains unproven. Private evidence is under
`/workspace/rehearsal-sdd/live-20261021T222402Z/`. See the
[second-attempt record](../../engineering/event-broadcast-rehearsal.md#october-21-2026-second-bounded-attempt).
Task 2 provider-output acceptance remains incomplete. No further source or output
retry is authorized within this attempt.
