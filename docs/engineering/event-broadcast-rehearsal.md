# Isolated event broadcast rehearsal

This procedure is an approved, bounded operator experiment. Ordinary hosted output
stays disabled at `/vrdex/restream/hosted-worker/enabled=false`. The rehearsal uses
in-memory test authority and the production controller, renderer, HTTPS relay,
credential parser and required VRCDN sender. It never contacts Convex.

The sole source is `https://stream.vrcdn.live/live/basicbit1.live.ts`. The output
secret reference must be
`arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/vrcdn/basicbit-output-4AocR4`,
which the operator must verify belongs to `basicbit`. An opaque ingest key cannot
prove that account identity inside the adapter. Output playback is
`https://stream.vrcdn.live/live/basicbit.live.ts`.

The production output parser accepts exact `ingest.vrcdn.live` and one-label regional
hosts such as `uk.ingest.vrcdn.live`, in split `rtmpUrl`/`streamKey` or combined
`ingestUrl` form. RTMP/RTMPS, ports 1935/443, the `/live` application and stream-key
checks still apply. Userinfo, query, fragment, lookalike suffixes and nested regional
subdomains are rejected. The canonical-host correction passed startup validation in the third attempt below.
That attempt still failed before publication. The October 22 source-lookup correction
and its published image subsequently reached actual Fargate TCP, TLS, HTTP 200 and
decoder readiness. Publication to `basicbit` remains blocked by provider rejection
of the existing output credential. See the [current evidence](#october-22-2026-diagnostic-session).

The October 21 attempt records below retain their original approval and image
boundaries. BASIC later authorized autonomous completion within a total $20 budget,
superseding the earlier per-attempt counts, ten-minute windows and $1 target.
Production enablement remains false; each diagnostic task still needs an explicit
external deadline, exact cleanup and retained failure evidence.

## Image and permissions

The manual `Restream proof image` workflow builds an exact reviewed commit reachable
from main. Run it from main with a full 40-character `source_sha`. It has no automatic
trigger, and performs no ECS, IAM, SSM or Convex changes. It publishes immutable
`proof-<full-sha>` and records the requested source SHA, actual digest, source label,
all 13 packaged source hashes and whether the image was reused. On retry, an existing
tag must resolve to exactly one valid digest. The workflow pulls that digest for
`linux/amd64`, checks its source label, and streams each of the 13 fixed paths from
a stopped container as an uncompressed tar archive. Before parsing, it caps the
entire archive at 10 MiB, including directory contents and extra entries. The
runner accepts exactly one regular entry with the expected basename and the exact
checked-out source file size, then writes its bytes only to the fixed temporary
host destination. It rejects directories, symlinks, multiple entries, unexpected
paths and oversized archives without recursive extraction. The runner hashes the
13 validated copies against the checked-out source before syntax/import checks.
A mismatch fails closed before image code executes. On exit it attempts both
stopped-container and temporary-directory cleanup. Cleanup failure fails an
otherwise successful job; an earlier failure retains its original exit status. It never overwrites, deletes, retags or
pushes an existing image. This regenerates complete provenance without a prior
artifact, including after cancellation or artifact-upload failure following a push.
New images pass the same verification before push and record the digest returned by
ECR afterward. The default hosted-worker command stays unchanged. Inline workflow
verification remains available when the requested SHA predates this recovery change.
Workflow installation on the default branch is a prerequisite for dispatch; a
separately reviewed native AWS image-import bootstrap must record its provenance
if used before installation.

Both Terraform flags default false. Inspect a saved plan and apply only the reviewed
publisher creation/migration and rehearsal resources. The state-mgmt owner manages
`enable_restream_proof_image_permissions=true`, a dedicated role named
`vrdex-restream-proof-image` and its standalone inline ECR policy. The workflow
assumes `arn:aws:iam::079358094174:role/vrdex-restream-proof-image`. The role reuses
the existing GitHub OIDC provider and requires exact `StringEquals` matches for
`aud=sts.amazonaws.com` and `sub=repo:BASIC-BIT/VRDex:ref:refs/heads/main` with the
default repository variable. It grants registry authentication and exact-repository
push/DescribeImages rights, plus only `ecr:BatchGetImage` and
`ecr:GetDownloadUrlForLayer` on `vrdex-restream-worker` for digest-pinned recovery.
These two read actions allow the runner to verify the existing image and regenerate
missing provenance after a successful immutable push. They add no cross-repository,
secret, ECS, IAM, state or Route 53 rights. The existing Terraform role's trust and other policies
remain unchanged. Main-branch jobs can assume this role; the default GitHub subject
does not identify a single workflow. AWS IAM cannot directly constrain the arbitrary
`job_workflow_ref` claim without a separately reviewed GitHub subject-template change.

The dedicated role must be established and verified by a reviewed owner plan/apply
or bootstrap/import before workflow dispatch. This code change does not claim a
live role apply. The October 21 bootstrap instead added an ECR-only inline policy
to `vrdex-github-terraform`; the attempt records retain that history. After dedicated
role verification, the owner can retire that old grant through a reviewed migration.
If the old grant is already tracked as `aws_iam_role_policy.restream_proof_image[0]`,
the owner plan will replace that attachment. Coordinate staged bootstrap/import
and state reconciliation so the dedicated role is verified before retiring the
old grant; do not blindly apply the replacement plan. An import address must be
unbound before importing the new attachment. Do not import the old Terraform-role
policy into the new publisher attachment. Verify the final new attachment and
the old attachment's removal.

The restream-worker owner manages
`enable_rehearsal_permissions=true`, a String SSM parameter initially false, standalone
`vrdex-restream-rehearsal-source` on the execution role, and
`vrdex-restream-rehearsal-switch` on the task role. Source permission is only
GetSecretValue on `basicbit1-smoke-GWQX7c`; switch permission is only GetParameter on
`/vrdex/restream/rehearsal/enabled`. Existing output-secret access remains intact.
Do not add the source to the broader existing `execution_secret_names` policy.

If an approved operator bootstrap already created the resources, import them into
these owners before applying. Use each owner's ordinary backend and the matching
flag while importing. These commands contain references only:

```bash
terraform -chdir=infra/terraform/state-mgmt import \
  -var='enable_restream_proof_image_permissions=true' \
  'aws_iam_role.restream_proof_image[0]' 'vrdex-restream-proof-image'
terraform -chdir=infra/terraform/state-mgmt import \
  -var='enable_restream_proof_image_permissions=true' \
  'aws_iam_role_policy.restream_proof_image[0]' \
  'vrdex-restream-proof-image:vrdex-restream-proof-image'
terraform -chdir=infra/terraform/restream-worker import \
  -var='enable_rehearsal_permissions=true' \
  'aws_ssm_parameter.rehearsal_enabled[0]' '/vrdex/restream/rehearsal/enabled'
terraform -chdir=infra/terraform/restream-worker import \
  -var='enable_rehearsal_permissions=true' \
  'aws_iam_role_policy.rehearsal_source[0]' \
  'vrdex-restream-worker-execution:vrdex-restream-rehearsal-source'
terraform -chdir=infra/terraform/restream-worker import \
  -var='enable_rehearsal_permissions=true' \
  'aws_iam_role_policy.rehearsal_switch[0]' \
  'vrdex-restream-worker-task:vrdex-restream-rehearsal-switch'
```

Terraform defines the rehearsal parameter false. Do not apply while the live rehearsal
needs it true. Do not replace the existing runtime or execution policies, change
existing role trust, or grant the workflow secret access. Set both opt-in flags false for a reviewed targeted
rollback only after tasks are STOPPED and the switch is restored false. Disabling
the publisher flag removes its dedicated role and inline policy and prevents future
image publication. It does not roll the workflow back to the Terraform role or
remove an untracked historical bootstrap grant. Review that old grant separately;
keep existing Terraform state, Route 53 and other policies intact.

## Commands and configuration

Use the same reviewed `repository@sha256:...` image for all tasks. Keep the Dockerfile's
default command unchanged. The proof commands must be explicit ECS command arrays:

```json
["timeout", "--signal=TERM", "--kill-after=10s", "240s", "node", "scripts/event-proof-runner.mjs", "synthetic"]
["timeout", "--signal=TERM", "--kill-after=10s", "240s", "node", "scripts/event-vrcdn-rehearsal.mjs"]
```

Both commands require unique `VRDEX_PROOF_RUN_ID` values of 1 to 96 ASCII letters,
digits, underscores or hyphens, starting with a letter or digit, and
`VRDEX_RESTREAM_ARTIFACT_S3_URI=s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks`.
The synthetic wrapper sets `PROOF_SECONDS=120`, strips provider credentials and AWS
credential-provider environment variables from the workload subprocess, runs the
existing proof, terminates its process group, and uploads after exit. Its task's ECS
secrets list must be empty. The parent still has its normal task-role S3 access.

The provider task receives only the exact output secret as
`VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON` through ECS secret injection. Never put
that JSON, stream keys or ingest targets into proof-command arguments or diagnostics.
The unchanged trusted FFmpeg sender uses `-rtmp_playpath` inside the isolated task;
task-local process inspection can see the key. Required nonsecret
configuration is:

```text
AWS_REGION=us-east-1
VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER=/vrdex/restream/rehearsal/enabled
VRDEX_PROVIDER_REHEARSAL_CONFIRMED=true
VRDEX_PROVIDER_REHEARSAL_ATTESTATIONS_JSON={"sourceConsent":"accepted","destinationAuthority":"accepted","providerRules":"accepted","rightsClearedMedia":"accepted"}
```

Each parent CLI emits a safe `proof-start` event with the run ID, mode and UTC
`startedAt` for the external operator timeline. Synthetic stderr becomes byte counts
and fixed diagnostic flags such as `renderClockBudgetExceeded`; raw payloads are
never copied into logs or artifacts. Packet verification runs in a separate bounded
process group so timeout cleanup also terminates ffprobe.

The operator must verify each attestation before supplying it. The script rejects
missing acceptances, alternate endpoints, optional destinations, Convex authority,
wrong switch or region, and altered duration/profile. The accidental-launch guard
does not establish rights. No production bridge token is needed or permitted.
The adapter fixes 720p30 H.264/yuv420p, 1800 kbps video, AAC stereo 160 kbps/48 kHz,
and the production one-second VRCDN GOP through the existing renderer and sender.

## Bounds and observation

The initial October 21 approval allowed at most one 120-second synthetic task at
2 CPU/4 GiB, one 120-second output task at 2 CPU/4 GiB, and two sequential source
pushers at 1 CPU/2 GiB. Use existing network,
roles, log group and 40 GiB ephemeral storage. No automatic retries, concurrent media
runs or resource increases. Each task has a separate 240-second external stop deadline;
the whole attempt has a ten-minute operator deadline. Compute estimate is about $0.02,
excluding storage, logs and delivery. The $1 incremental target is not a billing cutoff.
The account budget was already exceeded when this attempt was approved. These
original attempt limits are historical. The October 22 autonomous $20 scope below
supersedes their count/window/target restrictions. Source pushers retain a
240-second external deadline. The separately bounded 300-second synthetic capacity
measurements use a 390-second inner bound and 480-second external deadline; their
4 CPU/8 GiB task is a diagnostic measurement, not a production configuration change.

The provider adapter has a 180-second internal media deadline, a 12-second startup
operation bound, the worker's unchanged 15-second publication startup guard, and an
independent 50 ms watchdog. After initial publication, the required sender must keep
advancing its reported output timestamp. A three-second gap fences the sender and
permanently fails the proof, even when the local recording remains valid or the sender
later reconnects. A dedicated switch false/unavailable or expired lease
fences through the real worker; no enable response is hardcoded. The normal workload
ends at 120 seconds, including startup. It sends an explicit hold at +20 seconds and
return at +30 seconds. Successful command acknowledgements reflect encoded output.

The operator controls source task replacement. Stop the exact source task around
+40 seconds, confirm STOPPED and ingest release, then start at most one replacement.
The adapter records only observed decoder readiness loss/recovery after its initial
return succeeds. Intentional hold/return decoder recreation does not count as source
loss. After actual recovery at or after +60 seconds it issues an explicit source return.
Readiness loss is decoder evidence and must be correlated with the independent task
and provider records before calling it source death. Missing recovery stays unobserved.

Set the dedicated switch false while the task is alive to observe actual fencing.
Toggling near +118 seconds may race normal teardown; report that outcome honestly.
A switch stop before a full sample remains nonzero, even if the fence worked. A timed
stop with no false-switch observation cannot establish the dedicated-switch acceptance.
A control flag alone does not establish stopped recording, child exit or provider ingest
release. Verify the exact ECS STOPPED state and public provider behavior independently.

## Artifacts and cleanup

After sender teardown, the finalizer uploads only bounded regular `program.ts`,
`primary.ts`, `optional-before.ts`, `optional-after.ts`, and sanitized numeric/boolean
reports under `synthetic-benchmarks/<run-id>/`. JSON is projected without raw strings;
raw logs, unknown files and symlinks are excluded. The reports preserve nonzero child
status, timeout/signal state, byte counts, numeric resource samples, acknowledgements,
readiness flags and actual stop reasons. Failed packet verification keeps media and
returns nonzero. Upload failure makes a successful workload nonzero; prior failure
codes remain intact. Interruption remains effective through cleanup, packet verification
and artifact finalization. It cancels the verifier group and current media upload,
skips remaining large uploads, and converts an otherwise successful invocation to 130.
A small bounded status write still records the interruption; a signal during that
write supersedes its earlier status snapshot once. Existing workload failures remain
unchanged. S3 failure can leave only local evidence. Media files cap at
100 MiB each; the adapter's local program recording caps at 64 MiB with a 1 MiB queue.

Keep both switches false, stop and verify all exact task ARNs, deregister only run-created
definitions, then reconcile the IaC rollback. From an authorized operator environment:

```bash
aws ssm put-parameter --region us-east-1 \
  --name /vrdex/restream/rehearsal/enabled --type String --value false --overwrite
aws ecs stop-task --cluster "$PROOF_CLUSTER" --task "$PROOF_TASK_ARN" \
  --reason 'Bounded restream proof cleanup'
aws ecs describe-tasks --cluster "$PROOF_CLUSTER" --tasks "$PROOF_TASK_ARN"
aws ecs deregister-task-definition --task-definition "$PROOF_TASK_DEFINITION_ARN"
```

Preserve existing images, evidence and unrelated policies. Two minutes is a capacity
sample, not sustained acceptance. One source cannot prove distinct-source handoff.
There is no real Convex registry/admission/lease acceptance, Twitch account acceptance,
musical silence calibration or physical PC/Quest playback acceptance in these reports.
The local program recording verifies encoder output, not provider or device playback.

## October 21, 2026 attempt record

The approved attempt produced a passing bounded Fargate synthetic capacity sample
and a short decodable public `basicbit1` source capture. It did not run the provider
output adapter. Source/hold/return, source replacement and live dedicated-switch
fencing through `basicbit` remain untested. Ordinary hosted output stays disabled.

The first RunTask request began at `22:06:48.956Z`; the ten-minute attempt deadline
was `22:16:48.956Z`. One capacity task and one source task were launched. There was
no output task and no replacement source. Adapter review correction F3 and the source
probe investigation consumed the remaining live window. A further bounded live
window is needed to finish the provider rehearsal; the plan is not complete.

### Image provenance

Both images came from the normal Dockerfile and a standard private ECR registry push
through the approved operator helper. The newly added workflow was not dispatched.
Source labels, all nine runtime hashes and four proof/helper hashes were verified.

| Use | Source commit | ECR image digest |
| --- | --- | --- |
| Capacity and source task | `16e46cbb4fcbe6bff2f36aaed88cf8d9814adf95` | `sha256:abf9bf6c6a68d44f0159386bb7d740da9df50ab0c337f536f108818014d0a6e4` |
| Corrected provider adapter, packaged and reviewed but not launched | `dcf83fe092f1c2bf3b492633516ac05b97504e0b` | `sha256:59388ac42078ba3f7ca44ce560b3e51e306f7ed460325e4855320f00f76adb23` |

The repository is
`079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker`.
The fresh images use Node `22.23.4`. Only the provider adapter changed among the
13 packaged files between these images; the nine runtime modules, synthetic proof,
metrics helper and wrapper retain their hashes. The capacity run belongs to the
first image and was not repeated on the corrected image. It remains evidence about
the unchanged synthetic workload, not a live acceptance result for the new adapter.

### Capacity result

Task `a6fd95e7753d41febad69f62f5e315de`, family
`vrdex-restream-rehearsal-capacity:1`, ran at 2 CPU/4 GiB and reached ECS STOPPED with
container exit 0 at `22:09:51.372Z`. Its 120-second synthetic workload passed:

| Measurement | Observed value |
| --- | ---: |
| Total harness wall time including verification | 121.787 s |
| Primary sender process count | 1 |
| Optional sender process attempts across intentional receiver failure/recovery | 6 |
| Maximum packet gap | 0.034 s |
| Maximum GOP | 1.000 s |
| Maximum measured sender queue | 0 bytes |
| Full worker sampled CPU | 117.17 CPU seconds |
| Full worker peak sampled summed RSS | 548,909,056 bytes |
| Synthetic generator CPU, separate from worker | 22.12 CPU seconds |
| Local receiver CPU, separate from worker | 2.34 CPU seconds |
| Lease renewals / program reports / samples | 12 / 119 / 120 |

The finalizer reported exit 0, six workload artifact uploads plus the status object,
and zero upload failures under
`synthetic-benchmarks/approved-20261021-rehearsal-capacity/` in the existing private
bucket. Workspace copies are `capacity-result.json`, `capacity-status.json` and
`capacity-rehearsal.json` under `/workspace/rehearsal-sdd/`. The three recordings and
NDJSON samples were also preserved in `capacity-cloud-artifacts/`, whose manifest
records byte counts and SHA-256 hashes. All seven cloud objects have local copies.
CPU is a sampled lower bound at process exit; RSS is a peak sampled process sum, not Fargate cgroup memory.
This generated-input/local-receiver workload excludes the production HTTPS relay,
a warm successor and provider transport. Six optional attempts include retries;
they do not represent six simultaneous outputs or six successful live publications.

### Source playback result and preserved failures

Source task `a6f0f7d3a2ad4459a5e08a8299d5ae84`, family
`vrdex-restream-rehearsal-source:1`, started at `22:11:29.229Z` at 1 CPU/2 GiB and
published only `basicbit1`. Its initial strict public decode probe, bounded to
12 seconds with `-xerror`, timed out with exit 124 and non-existing PPS/decode errors.
That probe remains failed. Its receipt and diagnostics are preserved in
`source-public-decode.json` and matching files under `/workspace/rehearsal-sdd/`.

A separate ten-second raw public MPEG-TS capture ended at its curl timeout with
exit 28 after receiving 1,914,216 bytes. Offline decoding of that retained capture
exited 0 and decoded 197 frames with 7.3 seconds of output progress. Probing identified
H.264 1280x720 at 30 fps and AAC at 48 kHz. The capture and offline decode also retain
their startup PPS warnings. This establishes a bounded decodable public source
sample; it does not erase the strict probe failure or establish clean live startup,
continuous provider output, musical quality or device playback.

The raw capture is `/workspace/rehearsal-sdd/source-public-raw.ts`. Its request receipt,
offline decode result and stream probe are `source-public-raw.json`,
`source-public-offline.json` and `source-public-probe.json`. These are retained
workspace artifacts, not public artifact URLs.

### Cleanup and unfinished gates

The operator requested source StopTask at `22:14:27.917Z`, before its external stop
deadline of `22:14:56.062Z`. Source execution stopped at `22:14:40.062Z`; ECS task
STOPPED followed at `22:15:04.466Z` with exit 143 from intentional operator termination.
That is not successful completion of the pusher's planned 180-second duration. ECS
deprovisioning reached terminal task state 8.404 seconds after its per-task deadline;
StopTask and container execution termination preceded that deadline. Both tasks were
STOPPED before the global attempt deadline.

The native cleanup readback at `22:15:47.817Z` confirmed capacity STOPPED/exit 0,
source STOPPED/exit 143, zero running tasks in the cluster, both task network interfaces
DELETED, and all three proof-only task definitions at revision 1 INACTIVE, including
the output definition that was never launched. Both
`/vrdex/restream/hosted-worker/enabled` and `/vrdex/restream/rehearsal/enabled`
remained false throughout; neither was set true. Readback versions were 1 and 2
respectively. The cleanup receipt is
`/workspace/rehearsal-sdd/final-cleanup-receipt.json`. Temporary Docker registry
credential directories were absent after publication.

The three approved standalone IAM policies remain as authorized durable tooling.
No broader rollback or removal was authorized or performed. Both images, private
capacity artifacts, failed probes and raw source evidence remain preserved.

The remaining live gates are current-controller publication to `basicbit`, independent
public output bytes/frames/audio observation, encoded source/hold/return, actual source
loss and explicit recovery after non-overlapping source replacement, and actual fencing
on the dedicated switch. This attempt also leaves distinct-source handoff, real Convex
registry/admission/leases, Twitch account acceptance, sustained capacity, musical silence
calibration and physical PC/Quest playback open. No provider-output acceptance is claimed.

## October 21, 2026 second bounded attempt

The separately approved second window began at `22:24:44.718Z`, with a global
deadline of `22:34:44.718Z`. One source and one output task launched on the corrected
adapter image from `dcf83fe092f1c2bf3b492633516ac05b97504e0b`, digest
`sha256:59388ac42078ba3f7ca44ce560b3e51e306f7ed460325e4855320f00f76adb23`.
Capacity was not rerun. There was no second source and no output retry.

Source task `60fb21f168d44aa690ad31712189959e`, definition
`vrdex-restream-rehearsal-source:2` at 1 CPU/2 GiB, produced a public `basicbit1`
capture of 2,228,224 bytes. Offline decode exited 0 with 228 frames and 8.266667 seconds
of progress. The probe identified H.264 1280x720 at 30 fps and AAC at 48 kHz. Decode
stderr was retained, so this bounded source sample does not establish clean startup
or provider-output acceptance.

Output task `a253c3007ee4447ea9295ac52a578302`, definition
`vrdex-restream-rehearsal-output:2` at 2 CPU/4 GiB, started at `22:26:24.199Z` and
execution stopped at `22:26:24.262Z`, exit 1 after 63 ms. Its only log was the safe
generic `VRCDN rehearsal failed` message. It failed before `proof-start`; no output
S3 artifacts exist. The independent public `basicbit` observer received zero bytes
and ended with `TimeoutError`, exit 1. There is no successful output, source/hold/return,
source loss/recovery or dedicated-switch fencing evidence from this attempt.

### Canonical-host diagnosis and local correction

Boolean-only native credential inspection found valid split `rtmpUrl`/`streamKey`
JSON with accepted scheme, port, application path and key characters.
`regionalProviderHost=false` and `bareProviderHost=true` isolated the incompatibility
to exact `ingest.vrcdn.live`. The working source used that same bare provider host.
The inspection returned contract booleans without exporting credential values.
`validateRehearsal` invokes the production parser before `proof-start`, reproducing
the observed early failure with synthetic data.

The approved scope amendment corrects only `parseOutputCredential` in
`workers/restream/output-sender.mjs` to accept the exact canonical host alongside
the existing single-label regional hosts. Provider/destination, protocol, port,
application path, key, userinfo, query and fragment restrictions remain in place.
Behavioral tests cover canonical split and combined forms, regional support, negative
host/URL cases and the actual rehearsal startup validation gate. This is local
acceptance of the parser change, not live acceptance by VRCDN.

The nine-runtime-files-unchanged claim applies to the original and corrected proof
images recorded above. This parser fix intentionally changes one runtime file and
is absent from both preserved images. A new reviewed image with new provenance is
required before any future provider attempt. Credentials and regional endpoints
were not rewritten. No IAM or production enablement change accompanies this fix.

### Second-attempt cleanup and retained evidence

The rehearsal switch was restored false, version 4; the production switch remained
false, version 1. Source execution stopped at `22:27:20.431Z` after operator StopTask,
with exit 143, and reached ECS STOPPED at `22:27:44.091Z`. Output reached ECS STOPPED
at `22:26:47.643Z`. Native final verification at `22:29:03.711Z` confirmed both tasks
STOPPED, zero RUNNING tasks, both task network interfaces DELETED and both revision-2
proof task definitions INACTIVE. The output had already exited before switch cleanup;
switch-caused fencing was not demonstrated.

Private workspace evidence is retained under
`/workspace/rehearsal-sdd/live-20261021T222402Z/`:

- `authorization.json`, `source-run.json`, `output-run.json` and matching
  `*-run-receipt.json` files record the bounded launch configuration and receipts.
- `source-before.capture.json`, `source-before.decode.json`,
  `source-before.probe.json` and `source-before.ts` preserve the public source sample.
- `output-public.capture.json` preserves the zero-byte failed output observation.
- `output-secret-contract.json` and `source-secret-contract.json` preserve the
  boolean-only contract inspection.
- `failure-cleanup.json` and `final-cleanup.json` preserve teardown and readback.
- `manifest.json` seals the 30 retained second-attempt files with byte counts and
  SHA-256 hashes.

No second source or output retry is authorized within this attempt. Another provider
window requires a new reviewed image and separate operator authorization. All prior
capacity, strict-probe failure, source and image evidence remains intact. Provider
output and the remaining live/device acceptance gates remain open.

The required fixed image is now published from `4d701bb05bb242cfe5dab9bbdafcba00ddbffe2e` at ECR digest
`sha256:2e121beb9ded4592c01c763c4c1cacc49cb9c522e3f661e41c7e8b10e35d88f6`.
All 13 packaged hashes match reviewed source; only `output-sender.mjs` differs from the preserved `59388ac` image, with the same base RootFS and unchanged default CMD.
Native readback at `22:40:14.127Z` confirmed ECR ACTIVE, both switches false and zero RUNNING tasks. At that readback, no live task or capacity rerun had used this image; provider acceptance remained open.
Safe receipts in `/workspace/rehearsal-sdd/` are `published-image-canonical-host.json`, `packaged-image-canonical-host-verification.json` and `canonical-image-published-verification.json`.

## October 21, 2026 third bounded attempt

The third approved window was `23:00:42.918Z` to `23:10:42.918Z`. One source and
one output used the canonical-host image from
`4d701bb05bb242cfe5dab9bbdafcba00ddbffe2e`, digest
`sha256:2e121beb9ded4592c01c763c4c1cacc49cb9c522e3f661e41c7e8b10e35d88f6`.
The output passed startup credential validation and then failed. This is not a
provider success. There was no capacity rerun, replacement source or output retry.

Source task `386351517cd84e30a1765df1aa75a83e` started at `23:01:19.130Z`.
The independent public source capture received HTTP 200 after 7.547 seconds and
retained 1,179,648 bytes. Offline decode produced 130 frames over 4.5 seconds with
AAC at 48 kHz. That independent response timing does not measure the worker's
source connection or establish which timeout governed its failure.

Output task `46b8e2e455da43c6aefb908c35477648` started at `23:02:33.671Z`,
emitted `proof-start` at `23:02:33.724Z`, execution stopped at `23:02:52.555Z`
with exit 1, and reached ECS STOPPED at `23:03:16.020Z`. The adapter recorded
15.8 seconds wall time, `published=false`, `sourceReadyObserved=false`, no hold
or return commands, and `rendererFailed=false` and `recordingFailed=false`.
Four sender attempts/restarts never advanced the destination beyond `outputMs=0`.
The 3,552,636-byte local recording decoded cleanly into 442 frames over
14.741333 seconds, with maximum gap 0.033334 seconds and one-second GOP. Visual
review identified the expected neutral hold slate. Local encoder output does not
establish source readiness or provider publication. The independent public
`basicbit` observer received zero bytes, HTTP 401 on all three requests, and exit 1.
Those responses do not establish an ingest rejection reason.

Source StopTask at `23:03:41.391Z` was cleanup after output failure. It was not the
planned controlled +40-second source loss test. Source execution stopped at
`23:03:53.843Z` and ECS STOPPED followed at `23:04:18.290Z`, exit 143. Final native
cleanup readback at `23:05:26.916Z` confirmed both tasks STOPPED, zero RUNNING tasks,
both switches false at production version 1 and rehearsal version 6, and both
revision-3 proof task definitions INACTIVE. Source/hold/return, controlled source
loss/recovery, public output and dedicated-switch fencing acceptance remain open.

Private evidence is retained in
`/workspace/rehearsal-sdd/live-canonical-20261021T225904Z/`. Four downloaded output
artifacts are hash-sealed by `downloaded-artifacts-manifest.json`; `manifest.json`
seals the 46-file overall evidence set. Prior capacity success and both earlier
attempt records remain preserved.

### Unresolved cause and passive observation scope

The live failure's root cause is unproven. Read-only local investigations are in
`/workspace/rehearsal-sdd/source-readiness-diagnosis/report.md` and
`/workspace/rehearsal-sdd/transport-diagnosis/report.md`. Immediate local source
replay became ready in 1.268 seconds, including with output publication false.
A 3.5-second upstream response delay reproduced the existing three-second relay
timeout. The worker's real source response latency was not measured.

The missing RTMP app hypothesis is refuted. The unchanged sender arguments send
`app=live`, consistent with FFmpeg 5.1.9 source. Immediate local RTMP publication
works. A delayed handshake can hit the existing two-second protocol timeout;
with that timeout extended solely in the separate diagnostic experiment, the
512 KiB queue cap fired before the six-second startup guard. That experiment did
not establish an age-limit failure. These are reproduced mechanisms, not proven
causes of the cloud failure. Local execution used host FFmpeg 7.1.5 rather than
the image's 5.1.9.

Task 5 clarifies the proof-only observation scope. The rehearsal now wraps the real
DNS lookup, HTTPS request and destination spawn through existing dependencies,
forwarding their arguments unchanged and returning the original promise, request,
response and child objects. It preserves the original HTTP callback. It records
only bounded numeric/boolean `transport` evidence, including renderer observations
and safe buffer snapshots. No response data listener is added. It neither supplies
DNS answers nor substitutes a transport, endpoint or trust configuration.

Records cap at 32 DNS attempts, 32 HTTP attempts, 16 sender attempts and 64 input
snapshots; omitted counts remain explicit. Each DNS result inspects at most 256
answers. Each sender scans at most 64 KiB of stderr in 4 KiB pieces with at most
128 bytes of transient overlap, cleared on close. Byte counts continue beyond the
scan budget; numeric counters saturate at one billion. Markers become fixed
booleans for timeout, refused/unreachable/DNS, TLS, RTMP handshake/rejection
indicators and invalid input/options. A marker is an indicator, not proof of
provider rejection. Raw stderr, arguments, environment, addresses, headers, URLs
and arbitrary exception text never enter the result. Failure counts count events,
so one underlying incident can produce several events. Teardown flags separate
cleanup events, including worker fences during awaited operations, from failures
observed before cleanup.

The new observations pass offline fakes and finalizer sanitization checks. They do
not reconstruct the failed third attempt's missing transport trace. The nine
runtime modules remain unchanged from `4d701bb`, including its already committed
parser correction. Endpoint/pinning rules, options, queues, deadlines, switching
and media lifecycle remain unchanged. The reviewed proof image is published below.
Task 5 authorizes no live retry; provider validation of the new image remains open.

### Published passive-observation image

Reviewed source `689db1b6a9fe605c8207ddf246b3d26af8daa645` is published as
`079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker@sha256:f8f833097f68cdb147cda2ed8521ce7fa50b4177c0d5833e95d3acf678c5073e`.
Its local image ID is
`sha256:85a07cd41a613182256620014edf0e3d76c4d12dd2bc18dbba74f652950bcc0e`.
All 13 packaged hashes match reviewed source. Compared with canonical-host image
`2e121beb`, only `scripts/event-vrcdn-rehearsal.mjs` changed; the other 12 packaged
files, base/runtime RootFS and default command match. Independent task re-review
and whole-branch review passed with no material findings and all 38 offline tests
passing. Earlier image provenance remains preserved.

Native readback at `23:28:05.811956Z` confirmed the new image ACTIVE, zero RUNNING
tasks and both switches false, production version 1 and rehearsal version 6.
Temporary registry credential directories were absent after publication. Safe
receipts in `/workspace/rehearsal-sdd/` are `published-image-transport.json`,
`packaged-image-transport-verification.json`,
`transport-image-difference-verification.json` and
`transport-image-published-verification.json`. The whole-branch review is
`final-with-transport-review.md`.

At the October 21 publication readback, this image had no live task or capacity
rerun. Publication and packaging alone established no provider acceptance. The
subsequent authorization and October 22 observations are recorded below.

## October 22, 2026 diagnostic session

BASIC explicitly superseded the earlier per-window and attempt-count approval caps
with up to $20 for autonomous completion. This includes measured diagnostics and
reviewed, evidence-based corrections. It does not enable ordinary hosted output,
change IAM or waive runtime guards. Source publishers remain sequential. Before
starting a replacement, the operator verifies `executionStoppedAt` and task status DEPROVISIONING or
STOPPED. Network-only deprovisioning may finish afterward; stale container status
does not override the recorded process exit. Exact
task cleanup and switch readback remain required. The longer capacity-only task
bounds above are explicit operator limits, not production timeout changes. An
independent Fargate capacity task may overlap a staged provider test because CPU,
memory, loopback receivers and test data are isolated and it carries no provider
secrets; source publishers still never overlap.

### Source lookup defect and published correction

The passive-observation image `f8f833` was used in the first October 22 attempt.
Four source requests resolved 12 public IPv4 answers each, then failed within
1 to 11 ms before TCP or TLS, with zero bytes read or written. The adapter failed
in 15.687 seconds. Its sender attempts also reported rejection indicators. This
separated a pre-connect source defect from the output-account failure; it did not
support relaxing the source response deadline. The independent source capture
retained 4,161,536 bytes and decoded 38 frames with audio. An initial 80-frame
threshold assertion failed and remains preserved. Final readback at
`00:19:36.196Z` found zero RUNNING tasks, both switches false at production /
rehearsal versions 1/8 and both revision-4 proof definitions INACTIVE. Evidence is
in `/workspace/rehearsal-sdd/live-transport-20261022T001434Z/`.

Task 6 confirmed the actual Node callback contract before modifying production.
Node family selection requests `lookup` with `all: true`, requiring an address
array. The relay had always returned a scalar address and family. On host Node
24.19.0 this produced `ERR_INVALID_IP_ADDRESS` before TCP. The exact Node 22.23.4
binary extracted from the new image archive reproduced the scalar failure in
5.03 ms with zero bytes; a singleton array connected to the loopback server in
2.95 ms. This was host execution of the extracted binary, not a full-container
acceptance claim.

Commit `33770f7723f3bdbfa80a710eda3cfa6a5287aa0a` returns a singleton array only
for `all: true` and retains the scalar callback otherwise. Both forms use only
the already validated first public IPv4. There is no new lookup, fallback address,
endpoint change or deadline relaxation. The production callback-shape test failed
before the fix; afterward 6 relay, 1 selected source-boundary and all 38 rehearsal
tests passed. Scoped and whole-branch reviews passed.

The normal image is published at
`079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker@sha256:fa5515d574355d6a647ce8390285f62edec1ad4f7e6e98956230c0b1391c2548`,
from source `33770f7`, local image ID
`sha256:af03744bea3ada3c44afaed83407b6b47d8b11f3c43aac888ec9af732a545065`.
All 13 packaged source hashes match. Only `source-relay.mjs` differs from the
passive-observation image, with the same base/runtime and default command. Native
readback at `00:34:43.182Z` confirmed ECR ACTIVE. Temporary registry authentication
directories were subsequently verified absent. Receipts are
`published-image-source-fix.json`, `packaged-image-source-fix-verification.json`,
`source-fix-image-published-verification.json`, `source-fix-registry-cleanup.json`
and `node22-image-extraction.json` in `/workspace/rehearsal-sdd/`.

### Output credential rejection and unavailable browser access

A reviewed one-off probe ran the legacy POC pusher with the existing `basicbit`
output credential, requesting 60 seconds. Its child failed naturally in 0.73
seconds with authentication, bad-name and server-rejection indicators, exit 1.
The production sender and this independent legacy path both rejected that stored
credential, while the `basicbit1` source credential worked. This is evidence of an
output credential/account rejection, not evidence for changing the sender's app,
queues or timeout guards. Cleanup at `00:27:45.648Z` confirmed the probe STOPPED,
its definition INACTIVE, dedicated switch false at version 10 and zero RUNNING.
The probe evidence is retained with the transport attempt above.

The output secret has a June 10 AWSCURRENT version and no previous-version
fallback. BASIC explicitly
authorized retrieving the current key through the logged-in browser and updating
the exact AWS output secret. The browser skill was available, but no callable
browser, browser JavaScript, computer-control or tool-search capability was exposed.
The operator could not access the dashboard or refresh the key through that surface.
No output secret was updated, and no browser cookies or alternate browser-control
route were extracted. `basicbit` provider-output acceptance remains open.

### Staged source and local-output observations

Reviewed operator-only probes outside the repository separate the real provider
source chain from the rejected output account. The hybrid uses actual provider
HTTPS and the real relay, decoder, renderer and controller, with an explicitly
local RTMP receiver. Its `publishing=true` denotes that local receiver and does
not establish public `basicbit` output.

The initial embedded hybrid task exited zero with no `proof-start`, logs or
artifacts. It executed no workload and supplied no acceptance evidence. Exact
Node 22 reproduction found a CLI entry guard comparing raw `/[eval1]` with the
URL-encoded `/%5Beval1%5D` spelling. Both hybrid and working-account hold wrappers
were corrected to compare filesystem paths. RED/GREEN tests exercised embedded
`node -e`, direct-file execution and inactive imports under Node 22.23.4 and
24.19.0. The scoped rereview passed. These are operator wrappers; no packaged
production module changed.

The first corrected hybrid ran for 120.767 seconds. It observed actual TCP in
19 to 25 ms, TLS in 53 to 69 ms and HTTP 200 headers in roughly 0.6 to 1.6 seconds,
followed by decoded source readiness. Explicit hold command 1 and return command 2
succeeded, local publication advanced, and actual readiness loss was observed.
The original rehearsal exit was zero, but the stricter wrapper retained exit 1
because recovery and command 3 were missing. Source StopTask was requested at
`00:51:11.281Z`, about +71.589 seconds rather than the planned +35/+40 seconds;
replacement was not launched before the sample ended. This operator timing failure
is preserved in `/workspace/rehearsal-sdd/live-hybrid-20261022T004742Z/`.
It does not reverse the successful source transport observation.

A second corrected hybrid also observed readiness/loss and commands 1/2 but no
recovery, so its strict wrapper retained exit 1. Its original rehearsal exit zero
is not overall acceptance. This failed attempt remains in
`/workspace/rehearsal-sdd/live-auto-hybrid-20261022T005539Z/`.

The fresh recovery run then passed with `sourceChainAccepted=true`, original and
wrapper exit 0, and 120.968 seconds wall time. It observed initial readiness,
actual readiness loss and recovery, with successful encoded hold command 1,
initial return command 2 and post-recovery return command 3. The first source's
execution stopped at `01:04:53.764Z`; the replacement was requested only at
`01:05:10.122433Z`, establishing sequential source publication. The local receiver
retained 28,973,432 bytes, and the 29,820,560-byte program recording passed packet
verification with a 33.334 ms maximum gap and one-second GOP. No receiver/cleanup
failure or child remaining after cleanup was reported. The exact result is
`/workspace/rehearsal-sdd/live-recovery-20261022T010253Z/result-and-initial-cleanup.json`.

This accepts the real provider HTTPS source chain through the current relay,
decoder, renderer, source-loss handling and explicit recovery to a local RTMP
receiver. It does not accept public `basicbit` output or independent-DJ handoff.
The separate working-account hold/fence probe also passed, as recorded below.
Real Convex authority, live Twitch and physical PC/Quest playback remain open.

### Working-account provider hold and actual switch fence

The separate `basicbit1` hold probe passed with
`holdPublishAndFenceAccepted=true`, exit 0 and 58.897 seconds wall time. It observed
55.998 seconds of advancing provider publication and actual hold output, with no
source selected. The operator set the dedicated switch false at
`01:08:21.519856Z`, about +55.74 seconds after task startup. The real worker
observed false and fenced with `stopReasons.control_failed=true`; publication and
all tracked children were gone after cleanup. Execution stopped at
`01:08:27.875Z`. Final ECS terminal state and switch inventory were verified below.

The independent public `basicbit1` capture received HTTP 200 and 3,883,008 bytes
over 20.03 wall seconds. It contains H.264 1280x720/30 fps and AAC/48 kHz with about
16.1 seconds of media. Bounded offline decode reached 120 frames and ended with
exit 0. Its 8,004 bytes of startup PPS/header warnings remain preserved; the
capture is not warning-free. Visual inspection of the extracted public frame
matched the renderer's neutral hold frame, a dark background and brighter center
rectangle. This is public working-account hold publication and actual switch
fencing, not the source-to-output two-account rehearsal or PC/Quest playback.
Receipts and observations are under
`/workspace/rehearsal-sdd/live-hold-20261022T010507Z/`, including
`result-readback.json`, `public-hold.capture.json`, `public-hold-verification.json`
and `public-hold-visual-review.md`.

### Five-minute synthetic capacity measurements

Both measurements use source `33770f7` / image `fa5515`, the existing synthetic
720p30 workload and unchanged runtime guards, with no provider secrets. The
2 CPU/4 GiB, 300-second attempt exited 1 with `renderClockBudgetExceeded` around
196 seconds. Its failure and six S3 objects remain preserved. The earlier
120-second 2 CPU success remains a shorter historical result; it does not establish
five-minute capacity.

A separately bounded 4 CPU/8 GiB measurement passed the requested 300 seconds with
301.479730396 wall seconds, exit 0, one primary process, 34 ms maximum packet gap,
one-second GOP and 562,741,248 bytes peak worker RSS. It recorded 29 renewals,
299 samples and no queue growth. The task reached ECS STOPPED at
`00:59:40.285Z`, exit 0. The six uploaded artifacts had no upload failures.
The authoritative receipt is `/workspace/rehearsal-sdd/capacity4cpu-result-receipt.json`;
the failed smaller task is in `capacity300-result-receipt.json`.

This establishes a five-minute synthetic sample at 4 CPU/8 GiB, including synthetic
optional-output behavior. It does not change the production task size, establish
long-duration capacity, validate a live Twitch account or accept the rejected
`basicbit` output credential.

### Final cleanup and remaining gates

Native readback at `01:09:32.522792Z` in
`/workspace/rehearsal-sdd/final-diagnostic-session-cleanup.json` confirmed zero
RUNNING tasks. The hold and recovery controllers were STOPPED/exit 0, both source
pushers STOPPED/exit 143 after operator cleanup, and the 4 CPU capacity task
STOPPED/exit 0. All five task network interfaces were DELETED. Working-hold
revision 1, hybrid revision 4 and source revision 5 definitions were INACTIVE;
the earlier capacity/hybrid definitions were already inactive. Production and
rehearsal switches were false at versions 1/21. The output secret's AWSCURRENT
version was unchanged.

A bounded public observer after the fence received no fresh bytes or HTTP response
and timed out after 8.195 seconds. This is not proof of an explicit provider close
or rejection. Fence acceptance rests on the observed worker fence, stopped
publication/children and exact ECS termination above.

Accepted evidence is now the repaired real provider source chain through explicit
loss/recovery to a local receiver, real working-account hold publication and switch
fencing, and a five-minute synthetic 4 CPU/8 GiB sample. Public `basicbit` output
with refreshed credentials, the complete two-account rehearsal, two independent
DJ sources, real Convex authority, live Twitch, musical-silence calibration,
physical PC/Quest playback and multi-hour capacity remain open. The plan is not
fully accepted and ordinary hosted output remains disabled.

## October 24, 2026: Task 9 source prerequisites

Historical status on October 24: source preparation only. The bounded CI mode
below separately verifies actual local migration and expected admission denial.
Whole-flow protocol lifecycle, final-image media, capacity, browser/audio and
owned-provider acceptance remain open. In-memory schema/handler tests cannot close those gates or the existing
physical PC/Quest gaps. No temporary provider task or paid operation belongs to
this source-only step (USD 0).

The import-safe driver is `scripts/event-broadcast-migration-rehearsal.ts`; its
internal fixture is `convex/localEventBroadcastRehearsal.ts`. The new manifest
stores exact run ownership and historical IDs, never secrets or allocation
substitutes. The table is empty in production. All four fixture RPCs require a
loopback deployment and a short run ID. They expose seed, fixed scenarios,
bounded inspection and owned cleanup. The driver uses `ConvexHttpClient` with
separate admin and acting-owner clients, then calls the production migration,
`events` and `eventMediaWorker` functions. No alternate admission implementation
is provided.

ROOT execution procedure (not executed by the source author):

1. Read the [cloud startup guide](./cloud-task-start.md), establish a fresh isolated
   anonymous local state directory and ports, and generate schema/functions from
   the final source. Keep it separate from the browser backend. No hosted binding,
   real account registry, dispatcher, media worker or cloud credentials belong in
   this database rehearsal. Existing `convex/crons.ts` has no event-media launch
   cron; ROOT must also verify no external bridge targets this deployment.
2. Supply `REHEARSAL_CONVEX_URL` (an explicit loopback HTTP origin),
   `REHEARSAL_CONVEX_ADMIN_KEY` (local admin credential), `REHEARSAL_RUN_ID`
   (1–32 lowercase letters/digits/hyphens, first character alphanumeric),
   `REHEARSAL_SOURCE_SHA` (the exact 40-character source commit),
   `CONVEX_LOCAL_BACKEND_VERSION`, and a unique `REHEARSAL_RECEIPT_PATH`.
   Invoke `node --import tsx scripts/event-broadcast-migration-rehearsal.ts seed`.
   This bounded bootstrap intentionally retains the owned seed for local binding.
3. From the seed receipt's `manifest.communityId`, ROOT provisions **only this
   isolated local backend's** `VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON` with one entry:
   `key: "local-rehearsal"`, `label: "Local rehearsal"`,
   `credentialRef: "local-rehearsal/output"`, `ownerCommunityProfileId` equal to
   that ID, and `playbackLinks: []`. This is a fake registry reference; no provider
   secret is provisioned. Supply a temporary local
   `VRDEX_EVENT_MEDIA_BRIDGE_TOKEN`, with the same value in the caller's
   `REHEARSAL_BRIDGE_TOKEN`. Keep admin and bridge values out of command logs.
   The driver never sets deployment environment variables.
4. After accepted real capacity evidence populates the production map, choose a
   new receipt path and invoke
   `node --import tsx scripts/event-broadcast-migration-rehearsal.ts run`.
   It reuses the same owned seed idempotently. Before the whole-table migration,
   it requires the complete sources/sessions/commands inventory to match the
   historical manifest; unrelated broadcast rows fail the run. Each migration
   page independently enforces production quiescence.
5. Retain the receipt and native process exit even on failure. `run` always
   attempts owned cleanup in `finally`; a failed assertion/timeout/cleanup is a
   failed rehearsal. For interrupted bootstrap or recovery, invoke the same
   driver with `cleanup`. ROOT independently verifies the remaining manifest,
   stops its backend, and removes the isolated state and temporary local bindings.
   A disposable state directory supplements ownership checks; it does not replace
   them. No production registry entry, grant or secret is overwritten.

The caller budget is 180 seconds plus up to 30 seconds for cleanup, with a
10-second per-call bound, at most 256 migration calls and a 512-KiB receipt cap.
There are no real-time sleeps. Lease and receipt expiry scenarios patch only the
current owned session/receipt through closed fixture actions. Receipts retain
source/backend pins, fixed scenario labels, migration request/response cursors,
nonsecret semantic snapshots and cleanup counts. Native backend version/cache
selection must also be independently recorded; the supplied pin is not proof
that a binary ran.

Historical coverage includes all six open statuses without an active pointer,
unconfirmed dispatch and queued/failed/unnamed legacy task ownership, plus
starting/running/stopping diagnostics even without a task ID,
confirmed stop, and a blocker introduced between pages. Batch size is one; every
page is replayed and a full second traversal must be semantically unchanged.
Recoverable manual revision one and observed revision two remain pinned;
ambiguous, stale, disabled, removed/hidden-link, hidden-profile, missing and
foreign sources become slate. The internal compatibility row is
`type: rtmp_source` with a canonical public VRCDN `.live.ts` URL and no canonical
`input`; it retains manual history without inventing a provider identity. This
matches `_eventBroadcastSources.ts`'s deployment-owned descriptor path and
`tests/backend/event-broadcast-sources.test.ts`'s guarded-relay compatibility
coverage. An initial noncanonical fixture URL was narrowed to that approved
shape during source review. No relay is started by these tests.

After historical migration, the real scheduling path must admit new protocol-2
sessions with automatic intent and sequence zero; omitted/0/1/3 worker versions
must fail, and historical controls must never attach. Subsequent scenarios cover
manual intent after replacement, promoting phase/target/original expiry across
replacement, coherent completion within the original budget, expired receipt
failure, Stop before/after Cut, and disabled or unauthorized destination fences
for late completion/observation. The unauthorized case changes only the owned
output's reference to a fixed **unbound** registry reference; it tests registry
lookup denial, not deployment-environment editing. Renewal/configuration are
asserted according to their actual response shapes: Stop retains its bounded
cleanup grace, disabled output disappears from configuration, and a missing
registry grant denies authority. Real sender-process cessation and provider Stop
confirmation remain independent final-image gates.

### Durable migration rehearsal in existing backend CI

The existing **Verify Backend Local** job owns the durable Linux rehearsal.
It keeps the canonical `pnpm verify:backend:local` bootstrap and generated-file
checks, using `precompiled-2026-09-28-5c7cb5b` for both bootstrap and rehearsal.
The helper requires a fresh checkout: `.convex`, `.convex-home`, `.convex-tmp`,
repository/web `.env.local`, ownership directory and artifact directory must be
absent. Unexpected state fails without deletion. A private ownership marker binds
a random run identity to the actual Git checkout SHA, CI run/attempt and separate
PR head SHA. Do not run this helper in an existing developer or browser backend.

The fixed sequence is:

```sh
node scripts/verify-event-broadcast-migration-local.mjs preflight
pnpm verify:backend:local
git diff --exit-code -- convex/_generated
node --import tsx scripts/verify-event-broadcast-migration-local.mjs run-admission-blocked
```

The job supplies `CONVEX_LOCAL_BACKEND_VERSION` and GitHub run identifiers.
The helper releases its fixed `--run-sh` command only after recording the detached
process group's native identity. The phase runs while the same anonymous backend
is alive. It reads only the exact project-local config, requires loopback ports
3210/3211 and the pinned backend, records the running executable's SHA-256, seeds
through the real admin client, and impersonates the returned manifest actor.
Installed Convex CLI commands receive the local registry grant and random bridge
token over stdin using a private mode-0600 self-hosted loopback env file. The grant
belongs only to the returned community and contains no provider credential.

The phase supervisor separately owns the workload process group. On cancellation
or interrupted work, it closes that group first, then runs independent bounded
fixture/environment recovery while `--run-sh` keeps the backend alive. Recovery
outcomes are persisted before the outer owner closes the backend group. Failed
recovery remains failed evidence. Cancellation stays authoritative through final
generated-file verification, proof writing and native process exit.

CI explicitly selects `run-admission-blocked` while the production measured
allocation map is intentionally empty. Its driver receipt has scope
`migration-admission-blocked`. It executes the same historical migration assertions,
then configures the fake output through the acting owner's production handler and
calls the real `events:scheduleEventMediaWorker`. Passing requires the exact
`Unproved broadcast configuration` rejection. Unexpected success, a different
error or any changed admission snapshot fails. The snapshot includes a SHA-256
digest of complete fixture-owned event, program, output, session, command and audit
rows, plus session/start-command IDs. Raw credential or lease fields do not enter
the receipt. The driver requires all historical sessions ended and no start
commands before the call, then checks unchanged state and no added sessions or
start commands afterward.

The default `run` and `runMigrationRehearsal` behavior still requires the entire
migration and positive protocol lifecycle when an owner is supplied. That path
remains the capacity-readiness verifier. Its acceptance requires `whole-flow`
scope and rejects the bounded CI receipt. Selecting the blocked mode also rejects
a whole-flow or historical-only receipt. Neither mode infers its scope from a
caught error. For direct driver use, choose `run-admission-blocked` in step 4 above
to exercise the bounded regression before accepted capacity receipts exist.

Both modes retain the 180-second work budget, 30-second cleanup budget, ten-second
HTTP calls, 256 migration-call cap and 512-KiB receipt. The surrounding phase
always attempts the owned recovery RPC, checks the manifest table is empty,
removes both local environment bindings and deletes the private env file. Setup
or cleanup failure remains a failed rehearsal. Convex CLI 1.32.0 reports an empty
table with native exit zero, no stdout and the exact stderr line
`There are no documents in this table.` The helper recognizes that fixed notice
incrementally without retaining stderr. Empty JSON arrays also require successful
native close and no stderr; unknown blank output, malformed/nonempty data, mixed
output, timeout or native failure cannot establish an empty manifest.

Phase/recovery receipts retain the last 16 RPC failures as allowlisted function
names and fixed reason labels, with an earlier-entry drop count. Unrecognized
functions/reasons remain `unknown`; messages, arguments, keys and returned data
are not retained. Delegation invokes each original client call once and rethrows
the same error. These records can include intentionally rejected driver calls;
acceptance comes from the driver receipt matching the explicitly selected scope.
Previously discarded actual error causes cannot be reconstructed from these labels.

A passing bounded CI run proves actual local migration and the production
admission block with owned cleanup. It does not prove positive protocol lifecycle,
measured capacity, media, provider output or rollout readiness. The production map
stays empty. Restore CI's `run` command only when accepted measured allocations
make real admission available; keep both scope checks and their negative tests.

The owner has one 330-second deadline, reserving the final 15 seconds for closure
and generated-file verification. Phase startup must leave at least 285 seconds.
The driver starts only with 275 seconds left, reserving its full 210 seconds,
five seconds of workload-group closure, 40 seconds of fixture/environment recovery
and 20 seconds for backend closure/diff.
Every CLI helper includes termination in its ten-second ceiling. Native timeout
or missing pipe EOF fails; the outer owner independently terminates its process
group with at most one second of TERM grace, then KILL, and verifies no owned live
processes or port-3210/3211 listeners remain. Signals never target process names.
The existing ten-minute job ceiling and six-minute rehearsal step remain fixed;
timings have not yet been measured by an actual CI attempt.

The seven-day `event-broadcast-migration-local-<run>-<attempt>` artifact uploads
a fresh staging directory even after a failed attempted rehearsal. Only validated
regular files from the explicit JSON allowlist are copied; rejected source paths
never reach the uploader. A generated selection receipt is uploaded even when
proof is missing or unsafe, while completeness still fails the evidence step. It
contains ownership/source pins, runtime/binary hashes, native parent and phase
close/exit evidence, the driver receipt, fixture/environment cleanup, generated
diff status and physical closure. Raw child output is discarded: logs contain
only stream byte counts and SHA-256 values. The aggregate 128-KiB output budget
is divided among the CLI owner (64 KiB), workload helpers (30 KiB), independent
recovery helpers (30 KiB), phase supervisor
(2 KiB) and outer owner/generated diff (2 KiB). Overflow fails. Missing expected
proof files fails the evidence step. Upload cannot be guaranteed after a whole-job
hard timeout or cancellation; missing evidence never counts as acceptance.

Private config, keys, env files, databases and command lines are excluded. Owned
local database/cache state is left for disposal of the ephemeral CI job, avoiding
an unbounded recursive deletion inside the deadline. The private env file is
removed explicitly, including outer recovery after a phase interruption. State
is never reused by a later rehearsal. Source/fake contract checks establish only
orchestration behavior; actual whole-flow admission, native runtime compatibility,
media, provider and physical PC/Quest acceptance remain separate gates.
