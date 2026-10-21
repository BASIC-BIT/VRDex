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
