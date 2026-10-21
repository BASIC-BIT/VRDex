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
subdomains are rejected. The canonical-host correction below has local test evidence
only and requires a new image before another provider attempt.

## Image and permissions

The manual `Restream proof image` workflow builds an exact reviewed commit reachable
from main. Run it from main with a full 40-character `source_sha`. It has no automatic
trigger, and performs no ECS, IAM, SSM or Convex changes. It publishes immutable
`proof-<full-sha>` and records the digest, source label and nine runtime module hashes.
An existing tag fails closed, requiring inspection of prior provenance. The push-only
policy cannot pull an old image for verification. Workflow installation on the default
branch is a prerequisite for dispatch; a separately reviewed native AWS image-import
bootstrap must record its provenance if used before installation.

Both Terraform flags default false. Inspect a saved plan and apply only the approved
additive resources. The state-mgmt owner manages
`enable_restream_proof_image_permissions=true` and standalone inline policy
`vrdex-restream-proof-image` on the existing `vrdex-github-terraform` role. Its existing
repository-wide OIDC trust remains unchanged. The restream-worker owner manages
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
  'aws_iam_role_policy.restream_proof_image[0]' \
  'vrdex-github-terraform:vrdex-restream-proof-image'
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
needs it true. Do not replace the existing runtime or execution policies, change trust,
or grant the workflow secret access. Set both opt-in flags false for a reviewed targeted
rollback only after tasks are STOPPED and the switch is restored false.

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

Run at most one 120-second synthetic task at 2 CPU/4 GiB, one 120-second output task
at 2 CPU/4 GiB, and two sequential source pushers at 1 CPU/2 GiB. Use existing network,
roles, log group and 40 GiB ephemeral storage. No automatic retries, concurrent media
runs or resource increases. Each task has a separate 240-second external stop deadline;
the whole attempt has a ten-minute operator deadline. Compute estimate is about $0.02,
excluding storage, logs and delivery. The $1 incremental target is not a billing cutoff.
The account budget was already exceeded when this attempt was approved.

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
Native readback at `22:40:14.127Z` confirmed ECR ACTIVE, both switches false and zero RUNNING tasks. No live task or capacity rerun used this image; provider acceptance remains open.
Safe receipts in `/workspace/rehearsal-sdd/` are `published-image-canonical-host.json`, `packaged-image-canonical-host-verification.json` and `canonical-image-published-verification.json`.
