# Event broadcast rehearsal implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute the approved rehearsal proposal; do not reopen product design or PR 377.

**Goal:** Run bounded current-worker capacity and one-source VRCDN checks while ordinary hosted event output stays disabled.

**Architecture:** Package explicit proof commands alongside the unchanged media runtime. A provider proof uses real relay/renderer/sender modules and a dedicated SSM enable check, with in-memory test authority isolated from Convex. Image publication and three narrowly scoped IAM grants are reproducible, and every task has an independent external stop deadline.

**Tech stack:** Node ESM, FFmpeg, AWS ECS/Fargate/ECR/SSM/S3, Terraform and GitHub Actions.

**Spec:** Approved `/workspace/provider-execution-proposal.md` and three `/workspace/restream-*-policy*.proposed.json` artifacts. User explicitly approved all proposed permission changes and bounded tests on October 21, 2026. The original event broadcast spec and runtime guards remain binding.

## Global constraints

The following count, window and cost limits describe the original October 21
approval. BASIC later superseded those limits with autonomous completion within
$20, as recorded in the October 22 amendment below. Production disablement, secret
handling, measured evidence and exact cleanup remain binding.

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
- Add opt-in exact IAM delta resources in existing Terraform owners, with default disabled and documented import/bootstrap path. Create a dedicated main-only GitHub OIDC publisher role `vrdex-restream-proof-image` with its standalone ECR-only inline policy. Use standalone policy names `vrdex-restream-rehearsal-source` and `vrdex-restream-rehearsal-switch` on the existing worker roles. Preserve unrelated policies and the Terraform role trust; retire its historical ECR-only bootstrap grant through a reviewed owner migration after dedicated-role verification. Add dedicated SSM parameter definition only through opt-in rehearsal config, defaultfalse. Existing execution role output access remains intact.
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
| Task1 workflow and IAM | Workflow uses dedicated `vrdex-restream-proof-image` role; exact STS audience and repository main subject; ECR-only policy | Existing Terraform role trust unchanged; main-only boundary does not isolate a single workflow; owner provisioning required before dispatch |
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
- [x] Build and review canonical-host image `2e121beb` from `4d701bb` before the
  separately authorized third window. Credential validation passed there; output publication failed.

Final native verification at `22:29:03.711Z` found source STOPPED at `22:27:44.091Z`,
exit 143 from operator termination; output STOPPED at `22:26:47.643Z`, exit 1; zero
RUNNING tasks; both revision-2 proof definitions INACTIVE; and both switches false,
production version 1 and rehearsal version 4. Output exited before switch cleanup,
so actual switch fencing remains unproven. Private evidence is under
`/workspace/rehearsal-sdd/live-20261021T222402Z/`. See the
[second-attempt record](../../engineering/event-broadcast-rehearsal.md#october-21-2026-second-bounded-attempt).
Task 2 provider-output acceptance remains incomplete. No further source or output
retry is authorized within this attempt.

## Third bounded attempt and Task 5 observation clarification

The third separately approved window was `23:00:42.918Z` to `23:10:42.918Z`.
One source and one output used `4d701bb` / `sha256:2e121beb9ded4592c01c763c4c1cacc49cb9c522e3f661e41c7e8b10e35d88f6`.
The canonical parser passed validation; output failed after 15.8 adapter seconds,
exit 1, with no publication or source readiness and no hold/return commands. Four
sender attempts/restarts reported zero output progress. The local hold recording
decoded 442 frames over 14.741333 seconds; the external output observer received
zero bytes and HTTP 401 three times. Source capture decoded 130 frames over 4.5
seconds with AAC at 48 kHz after a 7.547-second HTTP 200 response delay.

Source StopTask at `23:03:41.391Z` was cleanup after output failure, not controlled
source loss. No replacement or output retry occurred. At `23:05:26.916Z`, both
tasks were STOPPED, zero were RUNNING, both switches were false at production /
rehearsal versions 1/6 and both revision-3 definitions were INACTIVE. Evidence and
hash manifests remain in `/workspace/rehearsal-sdd/live-canonical-20261021T225904Z/`.
See the [third-attempt record](../../engineering/event-broadcast-rehearsal.md#october-21-2026-third-bounded-attempt).
Task 2's live acceptance remains incomplete.

The live cause remains unproven. Immediate local source replay, including with
publication false, works; a 3.5-second delay hits the existing three-second relay
timeout. Actual worker source response latency is unknown. The missing RTMP app
theory is refuted, including by FFmpeg 5.1.9 source. Delayed local handshakes can
hit the two-second protocol timeout or, with a diagnostic-only longer timeout,
the 512 KiB queue cap before the six-second startup guard. The latter measurement
did not establish an age-limit failure. Local tests used host FFmpeg 7.1.5.
These are mechanisms, not a confirmed cause or an authorized runtime fix.

Task 5 permits passive proof observation through existing dependencies. This
clarifies the original no-bypass scope: wrappers call actual DNS lookup, HTTPS
request and destination spawn with unchanged arguments and preserve the original
promise/request/response/child objects and HTTP callback. Existing renderer callbacks
and safe snapshots add readiness/progress metadata. No production module or new
production seam is required. All nine runtime files retain their `4d701bb` content,
including the prior canonical parser change. Timeouts, queues, pinning, endpoints,
options, switching and media flow remain unchanged.

- [x] Write failing offline tests for forwarding/object identity, fixed safe fields,
  split stderr markers, bounded floods, cleanup classification and finalizer retention.
- [x] Implement capped proof-only observation inline in the packaged rehearsal script.
- [x] Verify the existing 29 lifecycle tests alongside the observation tests and
  appropriate script/Markdown checks; retain prior attempt records and uncertainty.
- [x] Build, independently review, verify and publish the source-matched transport
  proof image. Root completed this separate publication step as recorded below.
- [ ] Complete provider acceptance. At Task 5 publication no further live task
  was authorized; the later October 22 autonomous scope supersedes that limit.

### Transport image publication status

Root published reviewed source `689db1b6a9fe605c8207ddf246b3d26af8daa645` as
`079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker@sha256:f8f833097f68cdb147cda2ed8521ce7fa50b4177c0d5833e95d3acf678c5073e`,
local image ID
`sha256:85a07cd41a613182256620014edf0e3d76c4d12dd2bc18dbba74f652950bcc0e`.
All 13 packaged hashes match source. Only `scripts/event-vrcdn-rehearsal.mjs`
changed from canonical-host image `2e121beb`; the other 12 packaged files,
base/runtime RootFS and default command match. Task re-review and final whole-branch
review passed with all 38 offline tests and no material findings.

Native readback at `23:28:05.811956Z` confirmed ACTIVE, zero RUNNING tasks and both
switches false, production version 1 and rehearsal version 6. Temporary registry
directories were absent. Publication, packaging, image-difference and readback
receipts are `published-image-transport.json`,
`packaged-image-transport-verification.json`,
`transport-image-difference-verification.json` and
`transport-image-published-verification.json` in `/workspace/rehearsal-sdd/`;
`final-with-transport-review.md` records whole-branch review.

This completed the image gate only. At publication, the image had no live task,
capacity rerun or provider validation. The October 22 amendment and subsequent
evidence follow below. Historical capacity and image records remain preserved.

## October 22 autonomous diagnostic scope and Tasks 6 to 8

BASIC explicitly authorized autonomous completion within $20, superseding earlier
per-attempt counts, ten-minute windows and the $1 target. Production disablement,
rights/account checks, runtime guards, sequential source publishers, exact cleanup
and failure preservation remain binding. Replacement requires `executionStoppedAt`
and task status DEPROVISIONING or STOPPED, confirming process exit while network
cleanup may continue. Source pushers retain 240-second bounds; the explicit
300-second synthetic measurement uses a 390-second inner and 480-second external
bound with no provider secrets or production resource configuration change. Its
independent Fargate resources may overlap a staged provider test; source publishers
remain sequential.

### Task 6: Correct demonstrated source lookup callback contract

- [x] Isolate the pre-TCP zero-byte failures and reproduce the `all: true` scalar
  callback defect under Node 24 and the exact extracted image Node 22.23.4.
- [x] Observe RED, fix only the callback shape while retaining the first validated
  public IPv4, and pass 6 relay, 1 source-boundary and 38 rehearsal tests.
- [x] Independently review, package, verify and publish source
  `33770f7723f3bdbfa80a710eda3cfa6a5287aa0a` as image
  `sha256:fa5515d574355d6a647ce8390285f62edec1ad4f7e6e98956230c0b1391c2548`.
  All 13 packaged hashes match; only the relay differs from `f8f833`.
- [x] Observe actual Fargate TCP/TLS, HTTP 200 and decoded readiness after the fix.

### Task 7: Separate staged source and output-account diagnostics

- [x] Preserve the independent legacy POC's natural 0.73-second authentication/
  bad-name output rejection. Confirm no prior output-version fallback. Authorized browser retrieval lacks callable
  controls; no output key was updated.
- [x] Review operator-only hybrid/hold probes, preserve the initial embedded CLI
  no-op, correct its entry guard with Node 22/24 RED/GREEN tests and rereview.
- [x] Preserve both partial hybrids as failed despite original rehearsal exit zero.
- [x] Pass actual source readiness/loss/recovery and encoded commands 1/2/3 in
  the fresh 120.968-second hybrid, original/wrapper exit 0. Verify sequential source
  replacement and local packet output. This is not public `basicbit` output.
- [x] Verify real `basicbit1` provider hold advancement and dedicated-switch fence.
  The probe passed exit 0, 55.998 seconds advancing, actual false observation and
  `control_failed` fence, with publication/children gone after cleanup. Public
  HTTP 200 media decoded and visually matched the neutral slate; warnings retained.
- [ ] Complete public `basicbit` output acceptance after credential refresh.

### Task 8: Measure five-minute capacity and reconcile evidence

- [x] Preserve the 2 CPU/4 GiB 300-second attempt's clock-budget failure around
  196 seconds; do not extend the earlier 120-second success claim.
- [x] Pass the same synthetic workload at 4 CPU/8 GiB for 300 seconds, actual wall
  301.479730396 seconds, exit 0, one primary process, 34 ms maximum packet gap,
  one-second GOP and 562,741,248 bytes peak worker RSS. Six artifacts uploaded.
- [x] Record final cleanup at `01:09:32.522792Z`: zero RUNNING, all five final tasks
  STOPPED, five interfaces DELETED, latest proof definitions INACTIVE and both
  switches false at production/rehearsal versions 1/21. Output secret unchanged.
- [x] Incorporate final ECS/switch cleanup receipts and prepare the PR 378 evidence
  update. Final review and publication remain tracked in the operator ledger.

These bounded results do not change production task size or establish the original
two-account output rehearsal, independent-DJ handoff, real Convex authority, live
Twitch, musical-silence calibration, multi-hour capacity or physical-device
acceptance. The plan remains partially accepted. See the
[October 22 evidence record](../../engineering/event-broadcast-rehearsal.md#october-22-2026-diagnostic-session)
and `/workspace/rehearsal-sdd/capacity4cpu-result-receipt.json`.

## Task 9 publisher role review correction

The image workflow previously assumed the broad `vrdex-github-terraform` role.
An ECR-only additional policy did not remove that role's existing IAM, state and
Route 53 rights. The reviewed fix creates a dedicated opt-in main-only publisher
role and points the workflow to it. Native mock-provider plan tests cover disabled
and enabled resources, decoded trust and the complete ECR-only policy; CI runs
them without AWS credentials. Existing image provenance and attempt evidence keep
their original scope. No live role apply is claimed. The state-mgmt owner must
verify the new role and review retirement of the historical ECR grant before
future publication. See [the permission procedure](../../engineering/event-broadcast-rehearsal.md#image-and-permissions).

## Task 10 immutable publisher retry recovery

A successful immutable push followed by cancellation or artifact-upload failure
left retries unable to recover missing provenance. The workflow now reuses only
an existing tag's single valid digest, pulled for `linux/amd64`. It compares the
source label and all 13 packaged files against the checked-out reviewed main SHA.
File hashes come from runner copies taken from a stopped container. Each Docker
copy streams an uncompressed tar archive capped at 10 MiB before host parsing.
The runner accepts exactly one regular entry with the expected basename and exact
checked-out file size, writing only to a fixed destination. Directories, symlinks,
multiple entries, unexpected paths and oversized archives fail without recursive
extraction. Existing syntax/import checks run only after source verification.
On exit both container and temporary-directory cleanup are attempted. Cleanup
failure fails an otherwise successful job and preserves any earlier failure. New images
pass the same checks before push. Both paths record the actual digest, requested
SHA, source label, expected and actual hashes, and reuse status in provenance.
Recovery does not require a prior artifact or execute a helper from the requested
SHA. It never pushes, overwrites, deletes or retags an existing image.

The default-false dedicated main-only role adds exactly `ecr:BatchGetImage` and
`ecr:GetDownloadUrlForLayer` on the same `vrdex-restream-worker` repository.
These read actions are required to recover evidence after a completed immutable
push. No cross-repository, IAM, ECS, secret, state or Route 53 authority is added.
Native mock-provider plans assert the full policy; fake Docker/AWS regression tests
execute the real workflow with runner hashing, including missing-artifact recovery,
all 13 source mismatches, label/digest failures, nonregular files, fresh publication
and cleanup. Historical execution and published-image evidence above is unchanged.
