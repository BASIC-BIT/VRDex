# Hosted Restream Worker Benchmark

The required **Restream Local Checks** CI job builds the current worker image
and runs all 132 deterministic transport cases with `--network none`. Its
native timing suite is packaged from `tests/native`, while the full host
MCP/script suite remains required. See [native CI coverage](../engineering/event-broadcast-quality-capacity.md#required-native-ci-coverage)
for the fresh-image, receipt, deadline and cleanup contract. This CI check does
not admit a Fargate capacity profile or authorize deployment.

## Status

The current implementation provides persistent event dispatch through a scheduled
singleton Lambda. Hosts use the existing Start/Stop, automatic/manual, Next and
Hold controls after configuring an authorized destination. No daily dispatcher
renewal or host enable toggle is required. The production Lambda cutover and
bounded silence proof passed on October 22. The backend policy is deployed and
the obsolete calibration gate was removed. No event was started to observe a
production worker applying that policy. The dated records below retain
the earlier bounded ECS deployment evidence. General hosted rollout and the `1080p60` quality
gate remain separate from BITRATE's limited deployment.

The implementation surface is split between:

- `workers/restream/`: container entrypoint, Dockerfile, synthetic benchmark runner, and benchmark profile
- `infra/terraform/restream-worker/`: ECR, ECS/Fargate task shape, logs, private benchmark artifact bucket, roles, secret references, and kill-switch foundation

## AWS Shape

The first hosted worker path runs one ECS task per event media session. Viewer delivery should stay behind VRCDN or another destination provider; worker count scales with concurrent event programs, not viewers.

The Terraform stack defines:

- ECR repository with immutable tags, scan-on-push, AES-256 encryption, and a lifecycle policy
- ECS cluster with Container Insights enabled by default
- Fargate task definition using Linux `X86_64`, `awsvpc`, `4096` CPU units, `8192` MiB memory, and `40` GiB ephemeral storage
- CloudWatch log group with 14-day default retention
- private S3 artifact bucket with public access blocked, AES-256 encryption, and lifecycle expiration
- execution role for image pulls, logs, and referenced Secrets Manager or SSM secret reads
- task role for CloudWatch custom metrics, the SSM kill switch, and prefix-scoped benchmark artifact uploads
- SSM parameter `/vrdex/restream/hosted-worker/enabled`, defaulting to `false`

The stack does not define an ECS service. The minute Lambda schedule starts one task per approved event media session through the existing bridge state machine. The CLI bridge remains available for operator recovery.

## Runtime Guardrails

The base benchmark task defaults below include a ten-worker benchmark cap. The
production event bridge overrides that cap to one. New sessions snapshot their
selected event profile; the 12-hour session bound remains the same.

The task definition injects these non-secret values, and the current entrypoint refuses to start unless they are present and syntactically valid:

- `VRDEX_RESTREAM_QUALITY_GATE=1080p60`
- `VRDEX_RESTREAM_BENCHMARK_MODE=ecs-fargate`
- `VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS=10`
- `VRDEX_RESTREAM_MAX_SESSION_SECONDS=43200`
- `VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER=/vrdex/restream/hosted-worker/enabled`
- `VRDEX_RESTREAM_SECRET_REF_NAMES`
- `VRDEX_RESTREAM_SYNTHETIC_VARIANT=static-transition`
- `VRDEX_RESTREAM_LIVE_CONTROL_SCHEDULE=output-timeline`
- `VRDEX_RESTREAM_LIVE_CONTROL_MODE=overlay-alpha-volume-fade`
- `VRDEX_RESTREAM_X264_PRESET=veryfast`
- `VRDEX_RESTREAM_SYNTHETIC_DURATION_SECONDS=12`
- `VRDEX_RESTREAM_MAX_LIVE_DELAY_MS=10000`
- `VRDEX_RESTREAM_TRANSITION_FADE_MS=500`
- `VRDEX_RESTREAM_HOLD_SLATE_AUDIO_DELAY_MS=750`
- `CONVEX_URL`

Secret values are not environment variables in git or Terraform. The `secret_arns` map supplies ECS secret references by container environment name. The `execution_secret_names` and `execution_secret_arns` variables grant the ECS execution role permission to read secrets used by bridge-created task definitions. Keep those variables empty by default for portable planning; operator deployments should set only their own secret names or ARNs in local ignored Terraform variables, for example `execution_secret_names = ["event-media/vrcdn/basicbit-output"]` for the current BASIC-BIT VRCDN output account. Synthetic benchmark tasks set `VRDEX_RESTREAM_SYNTHETIC_ONLY=true`, so they can produce media evidence without provider credentials. Use scoped, event/output-specific references for any non-synthetic VRCDN or external RTMP credential.

## Runtime Bridge

Normal dispatch uses `scripts/event-media-lambda-bridge.mjs`. Each minute invocation runs one ordinary pass of the existing bridge, discovering queued `start_program` and `stop_program` commands and reconciling exact Fargate task status in Convex. The optional `pnpm ops:event-media:ecs-bridge` CLI uses the same state machine for operator recovery. Its operator environment needs AWS credentials to register task definitions, run tasks, describe tasks, stop tasks and deregister the bridge-created definitions. The configuration below describes that CLI environment; Lambda receives the non-secret values from Terraform and reads its token separately.

The bridge and worker do not own event media-control policy. Convex remains the source of truth for manual commands, candidate automatic-rule output, source routing state, and audit records. A worker receives only the selected source/output/session payload required for the command it claimed; it must not infer broader event permissions or publish private source-health detail to public pages.

Required non-secret bridge configuration:

- `CONVEX_URL`
- `VRDEX_EVENT_MEDIA_BRIDGE_TOKEN`, matching the Convex deployment's `VRDEX_EVENT_MEDIA_BRIDGE_TOKEN`
- `VRDEX_EVENT_MEDIA_ECS_REGION`
- `VRDEX_EVENT_MEDIA_ECS_CLUSTER`
- `VRDEX_EVENT_MEDIA_ECS_IMAGE`
- `VRDEX_EVENT_MEDIA_ECS_EXECUTION_ROLE_ARN`
- `VRDEX_EVENT_MEDIA_ECS_TASK_ROLE_ARN`
- `VRDEX_EVENT_MEDIA_ECS_LOG_GROUP`
- `VRDEX_EVENT_MEDIA_ECS_SUBNETS`, comma-separated subnet ids
- `VRDEX_EVENT_MEDIA_ECS_SECURITY_GROUPS`, comma-separated security group ids
- `VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON`, a JSON object that maps Convex output-account credential references to AWS Secrets Manager or SSM parameter ARNs for the selected output; optional destinations require exact Secrets Manager ARNs

Event-worker CPU and memory come exclusively from the immutable session allocation. Remove `VRDEX_EVENT_MEDIA_ECS_CPU` and `VRDEX_EVENT_MEDIA_ECS_MEMORY` from dispatcher configuration; either variable now rejects startup. The shared bridge validates settings, frozen destination membership and measured evidence before registration, then sets both task and container resources. See [quality and capacity](../engineering/event-broadcast-quality-capacity.md).

Optional bridge configuration includes `VRDEX_EVENT_MEDIA_BRIDGE_WORKER_ID`, `VRDEX_EVENT_MEDIA_ECS_CONTAINER`, `VRDEX_EVENT_MEDIA_ECS_COMMAND_JSON`, `VRDEX_EVENT_MEDIA_ECS_EPHEMERAL_STORAGE_GIB`, `VRDEX_EVENT_MEDIA_ECS_ASSIGN_PUBLIC_IP`, `VRDEX_EVENT_MEDIA_ECS_LOG_STREAM_PREFIX`, `VRDEX_EVENT_MEDIA_ECS_BASE_ENV_JSON`, `VRDEX_EVENT_MEDIA_OUTPUT_SECRET_ENV`, and `VRDEX_EVENT_MEDIA_BRIDGE_POLL_MS`. Use `VRDEX_EVENT_MEDIA_ECS_COMMAND_JSON` when the selected image needs a command override, for example `["node","workers/restream/vrcdn-poc.mjs"]` for the VRCDN POC entrypoint.

Use `VRDEX_EVENT_MEDIA_ECS_BRIDGE_CONFIG_CHECK_ONLY=true` for a local configuration parse check that does not call Convex or AWS. Use `--once` when running the bridge from a scheduler or smoke test; omit it for a long-running operator loop.

Do not put stream keys, combined ingest URLs, provider tokens, signed URLs, or secret JSON in the bridge environment except through ECS secret references. `VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON` contains only references to secret store records, not secret values.

## Persistent event dispatcher deployment

`bridge.tf` provisions an opt-in Node.js 22 Lambda with 256 MiB memory, a
180-second timeout and reserved concurrency one. Set
`enable_event_media_bridge=true` and supply `event_media_bridge` through an
owner-managed variable file. The object contains `convex_url`, a digest-pinned
worker `image` from this stack's repository, `bundle_key`, `bundle_sha256`,
`token_secret_arn`, the exact `credential_refs` map, `subnet_ids` and
`security_group_ids`. `assign_public_ip` defaults to `ENABLED`; use worker
networking with no inbound rules. Keep `max_concurrent_workers=1` and
`VRDEX_EVENT_BROADCAST_MAX_CONCURRENT=1` in Convex. Values contain secret
references only. There are no CLI archive fields or dispatcher bootstrap.

Provisioning the configured bridge enables its `rate(1 minute)` EventBridge rule.
EventBridge delivery and Lambda asynchronous events both have a 60-second maximum
age and zero retry attempts. A later tick discovers and reconciles current work
rather than replaying a failed invocation. The schedule controls dispatcher
availability; no additional runtime enable variable or host gate is required.
Start dispatch can take up to one minute plus scheduler jitter, then ECS startup.
Running Next, Hold, automatic/manual and source controls remain worker-driven.

Each invocation uses a unique worker identity, `once: true` and no drain deadline.
Completion, timeout or function replacement never triggers global media drain.
Workers retain their own leases, authorization checks, internal SSM emergency
publication control and 12-hour event-session limit. The currently deployed
reviewed image uses 720p30 with 4 CPU/8 GiB and admission cap one. Updating that
image for additional presets requires the separate capacity proofs.
The emergency switch is an internal operations control, not a host prerequisite.
Preserve its current value during migration.

### Lambda artifact and runtime grants

Bundle `scripts/event-media-lambda-bridge.mjs` and Convex as Node 22 ESM,
externalizing the SDK supplied by the Lambda runtime. Package `index.mjs`, which
exports `handler`, in a deterministic ZIP. From a pinned checkout with frozen
dependencies and the installed bundler:

```bash
node --input-type=module - <<'JS'
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const result = await build({ metafile: true, entryPoints: ['scripts/event-media-lambda-bridge.mjs'],
  outfile: '/tmp/index.mjs', bundle: true, external: ['@aws-sdk/*'],
  platform: 'node', target: 'node22', format: 'esm' });
await (await import('node:fs/promises')).writeFile('/tmp/event-media-lambda-inputs.json', JSON.stringify(result.metafile, null, 2));
JS
python3 - <<'PYZIP'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
entry = ZipInfo('index.mjs', date_time=(1980, 1, 1, 0, 0, 0))
entry.create_system = 3
entry.external_attr = 0o100644 << 16
entry.compress_type = ZIP_DEFLATED
with ZipFile('/tmp/event-media-lambda-bridge.zip', 'w') as archive:
    archive.writestr(entry, Path('/tmp/index.mjs').read_bytes())
PYZIP
sha256sum /tmp/event-media-lambda-bridge.zip
```

Record checkout, lockfile, bundler and ZIP-tool versions, input hashes and ZIP
SHA256. Upload to the private artifact bucket at
`event-media-bridge/sha256/<zip-sha256>.zip`, read it back and compare the hash.
Use that exact key and hash in the owner values. Verify deployed Lambda
`CodeSha256` against the base64 SHA256 of the local ZIP. Do not put credentials in
the bundle or metadata. Lambda loads the ZIP through the service; its runtime
role requires no S3 read access or AWS CLI installation. A deployed smoke check
must verify the deferred runtime SDK v3 imports and an ordinary Convex poll.

The dedicated Lambda runtime role reads only the exact configured bridge-token
Secrets Manager ARN. The handler fetches that token on every invocation,
including warm reuse; its value is never stored in Terraform or Lambda
configuration. ECS SDK, secret and Convex HTTP operations have 15-second bounds.
The SDK adapter preserves launch client tokens, ownership tags and all task ARNs.
It can launch only the event-worker family in the existing cluster, observe and
stop ownership-tagged tasks, and pass only the existing worker roles. AWS requires
an unconditional `Resource: "*"` grant for `ecs:DeregisterTaskDefinition`; verified
bridge code limits cleanup to recorded event-worker definitions. The additive
worker execution-role grant reads only the token and exact configured output
credential ARNs. Invocation logs are in `/aws/lambda/<name-prefix>-event-bridge`.

### Migration, recovery and cost

Before cutover, confirm no active sessions. Stop the old standalone ECS dispatcher
and confirm actual STOPPED before enabling the new schedule. Preserve BITRATE's
exclusive `basicbit1` ownership, primary credential, cap one, emergency-switch
value and unchanged worker image. Verify scheduled invocations, runtime SDK
support, secret access and ordinary polls. Do not start an event without an
explicit selection. Preserve the owner opt-in and emergency-switch value in
subsequent Terraform plans; default-off values would remove the dispatcher or
reset the switch. Use the evaluated Lambda, IAM, log, schedule and permission
resources from `bridge.tf` for any bootstrap/import, rather than the superseded
ECS dispatcher addresses.

A failed tick does not erase launch ambiguity. Pre-existing starts without a
recorded task ARN and stale claimed commands require operator investigation and
recovery. Inspect exact event/session/dispatch ownership and ECS task identities;
never delete admission records, mark cleanup complete without actual STOPPED or
blindly retry Start. The optional CLI is a recovery tool, not a daily service
renewal step. Disabling the schedule stops new dispatcher passes without draining
healthy workers. Emergency publication shutdown still uses the retained SSM
control; inspect and stop exact tasks and confirm STOPPED before releasing
admission or authorizing replacements.

At one invocation per minute and 256 MiB, estimated idle Lambda cost is about
$0.19/month for one-second passes or $0.92/month for five-second passes, outside
free allowances and excluding ancillary charges. This replaces approximately
$12.66/month for the always-running idle ECS dispatcher. Active 4 CPU/8 GiB media
workers remain approximately $0.1975/hour plus egress and ancillary charges.
These are estimates, not measured bills or dollar-denominated runtime limits.

### Automatic silence policy

The implementation resolves missing or empty stored policies to silence below
-90 dBFS continuously for 15 seconds. The bounded decoded-media proof passed;
the backend policy is deployed and the obsolete calibration variable was read
back absent. No calibration environment toggle or host activation step remains.
Optional maximum overrun stays unset unless explicitly configured. Healthy media
may continue beyond its authored end; a timetable boundary alone never switches.

Silence handoff requires automatic mode, fresh matching progressing current A/V,
sustained decoded analysis and an eligible fresh decoded-ready successor. Manual
selection and Hold remain authoritative. Reconnect/failure clears silence
evidence, silence without a ready successor retains the current source, and last
slot silence cannot invent a successor. Qualifying silence can switch when
eligibility arrives without a new post-boundary grace. A changed threshold still
requires a session restart for matching decoder analysis. The 85.561-second local
proof passed at 320x180/15fps with actual AAC/MPEGTS through the unchanged factory
decoder and AAC 160 kbps/48 kHz stereo. The -81 dBFS quiet tone stayed selected for
16.068 seconds after the boundary; digital zero qualified for the 15-second rule
and produced encoded blue B, followed by final manual slate. Higher-resolution
attempts and a slate-to-auto decoder restart hit resource bounds. The final proof
placed slate last, so it does not establish recovery from that restart failure.
No media module changed, and no real-music false-positive rate is measured. Full
measurements, hashes and failed-attempt limits are in
[integration verification](../engineering/event-broadcast-verification.md#october-22-decoded-silence-proof).

### October 22 persistent dispatcher cutover

Production preflight at 15:53:46 UTC confirmed zero active sessions. The old idle
ECS dispatcher, task ID prefix `91e599`, reached actual STOPPED at
15:55:03.348 UTC with exit 0 before the new schedule was enabled.
`vrdex-restream-worker-event-bridge` now runs Node.js 22 with 256 MiB memory,
180-second timeout and reserved concurrency one. The minute schedule is enabled;
both EventBridge and Lambda asynchronous delivery were read back with maximum
age 60 seconds and retries zero.

The 47,168-byte deterministic ZIP has SHA256
`d05875a95e5edd25a28bc51aa34085f17be627e2313a95f86fde82bd6a30cdb6`.
The esbuild 0.28.0 manifest records 63 input hashes and the external runtime SDK
imports. Its SHA-addressed S3 object readback and deployed `CodeSha256` matched
`0Fh1qV5e3SWii8Uao0CF8XvmJ+IxOpX4b96CvWowzbY=`. A manual ordinary poll completed
at 15:56:20.866 UTC, exercising the actual runtime SDK imports and secret fetch.
The first observed scheduled poll completed at 15:58:07.905 UTC; the warm
invocation took 1.408 seconds and used at most 116 MiB. The next scheduled polls
at 15:59:06.701 and 16:00:08.748 UTC also completed, establishing three consecutive
scheduled passes. No event was selected or
started. ECS running tasks were zero, and the production emergency master remained
`true`, version 2. BITRATE ownership, primary credential and media image remained
unchanged.

After nine completed scheduled polls, the superseded dispatcher definition
was made inactive and its two unused IAM roles were removed. Worker roles and
the new Lambda role remain in place.

Nine resources were bootstrapped from evaluated IaC; Terraform state import is
still required. The owner values at
`/workspace/rehearsal-sdd/persistent-dispatcher-owner-config.tfvars.json` are outside
git and retain the enabled SSM value. Keep that file selected for import and later
plans. The bundle manifest is retained at
`/workspace/rehearsal-sdd/persistent-dispatcher/manifest.json`.

The backend policy deployed to `https://superb-pig-954.convex.cloud` with Convex
CLI exit 0, schema validation and no index deletion. At
`2026-10-22T16:04:06.604Z`, `VRDEX_EVENT_BROADCAST_SILENCE_CALIBRATED` was read back
absent; concurrency one and session bound 43,200 seconds were unchanged. The
silence default is supported by deployed source and tests. There were zero
sessions and no event was started, so no direct worker-configuration observation
or production silence handoff is claimed. See
[integration verification](../engineering/event-broadcast-verification.md#october-22-backend-deployment-and-verification)
for the retained full-suite failure and successful isolated rerun.

### October 22 BITRATE enablement

Historical bounded ECS deployment receipt. The persistent dispatcher above
supersedes its 24-hour lifecycle and daily renewal instructions. The timestamps,
artifacts and silence-off state below describe that earlier deployment, not the
new Lambda cutover.

The initial deployment uses the reviewed `fa5515d5…` worker image and dispatcher
bundle `9a13bee0…`, built from merged source `db7f2c6f…`. The production token
binding, concurrency cap and 12-hour deadline were installed and read back.
The first dispatcher started at 05:07:08 UTC on October 22, 2026. BASIC
subsequently assigned `basicbit1` exclusively to BITRATE. That destination
binding was installed and read back at 06:30:17 UTC. The initial dispatcher was
stopped for the reviewed ownership-tag and graceful-drain corrections.

That deployment used dispatcher bundle `24d9a1c1…` and pinned AWS CLI 2.38.4 archive
`10ab32a9…`. A bounded live permission probe confirmed owned task launch,
observation, stop and definition cleanup, plus denied observation/stop of an
unrelated task. Both probe tasks are STOPPED and their interfaces are DELETED.
The first corrected dispatcher successfully polled production before enablement.
Subsequent shutdown fixes cover refresh transitions and polling within the
forced-stop grace. Idle predecessors stopped with exit 0 and their interfaces
were deleted before replacement. The recorded task definition
`vrdex-restream-worker-event-bridge:4` started at 07:36:56 UTC. The master
parameter was first enabled and read back as `true`, version 2, at 07:04:37 UTC on
October 22. That receipt recorded concurrency one and automatic silence off.

This enabled operator-started broadcasts for BITRATE's configured `basicbit1`
destination. No event was selected or started during enablement. That dispatcher
had a hard deadline around 07:37 UTC on October 23 and required
a separate operator launch to continue. The persistent schedule replaces that
renewal requirement. Enablement and the permission probe do not
establish a live event or complete provider acceptance for every media path.

## Visible Benchmark Output

The worker benchmark entrypoint generates a synthetic program at the selected quality gate with source, hold-slate, and source-switch transitions. The default duration is 12 seconds, and longer sustained probes use `VRDEX_RESTREAM_SYNTHETIC_DURATION_SECONDS`. The default `static-transition` variant generates the hold slate once as static artwork, then loops it through the timed fade section to keep the benchmark focused on the live encode path. The `live-control` variant starts FFmpeg once and drives the same source/hold/source sequence through runtime filter commands. It schedules commands against FFmpeg output progress by default, then gates on timed frame classification so source commands cannot silently drift earlier in the output timeline when encoding falls behind real time. Live-control reports near-real-time pace as diagnostics and records max, average, final, and growth-rate delay metrics against `VRDEX_RESTREAM_MAX_LIVE_DELAY_MS`; `static-transition` remains the throughput gate. The `wall-clock` schedule remains available only as a diagnostic comparison mode. The `hard-switch` control mode is the simple source-selection baseline; `overlay-alpha-volume-fade` is optional polish. A successful run writes:

- `program.mp4`, embedded in `report.html` for browser playback
- `hls/program.m3u8` and HLS `.ts` segments
- transition frames for `source-a`, `hold-slate`, and `source-b`
- `progress-samples.json` for live-control runs
- `benchmark-report.json`
- `report.html`

Local proof command from the repository root:

```powershell
pnpm proof:restream:worker
```

Local worker live-control proof command from the repository root:

```powershell
pnpm proof:restream:worker:live-control
```

Longer live-control delay probe example:

```powershell
pnpm proof:restream:worker:live-control hard-switch ultrafast 1080p60 180 10000
```

Local benchmark matrix command from the repository root:

```powershell
pnpm proof:restream:worker:matrix
```

Approved ECS benchmark tasks upload the same artifact tree under the private `artifact_s3_uri` Terraform output. Keep the bucket private and use authenticated S3 reads or short-lived presigned URLs for review.

To watch local artifacts, serve the ignored artifact directory and open the report page:

```powershell
python -m http.server 4174 --bind 127.0.0.1 --directory artifacts
```

Then open `http://127.0.0.1:4174/restream-worker-benchmark/<timestamp>/report.html` or `http://127.0.0.1:4174/restream-ecs-benchmark/<timestamp>/report.html`.

## Live Control Proof

The local live-control proof validates that FFmpeg can be started once and steered while it runs:

```powershell
pnpm proof:restream:live-control
```

The proof uses FFmpeg's `zmq` command filter plus command-capable filter instances. The local command sender requires Python with `pyzmq`. The controller accepts semantic source-change commands, then expands them into eased, frame-ish runtime commands for source A, hold slate, source B, overlay alpha, and audio source volumes. The generated report classifies output frames, scans transition windows for blended frames, and checks audio windows to verify source-to-slate-to-source switching, runtime-programmed fades, and the delayed hold-slate audio path.

Current recommendation: use overlay alpha plus per-source volume commands for runtime fades. Do not rely on runtime `mix` or `amix` `weights`; this FFmpeg build returned `Function not implemented` for those commands during diagnosis.

Current recommendation: treat `hard-switch` as the first production baseline. It keeps one semantic operator timeline but uses direct commandable video and audio source selection, reducing the synthetic runtime command count from 194 to 8. Do not add fades or slate polish back into the production path until the simple source-selection path has realtime headroom.

## Quality And Cost Ladder

Current recommendation: evaluate capability in this order and prefer reliable source selection over polished transitions:

- `1080p60`: locked aspirational target for premium live output if cost and headroom are acceptable
- `1080p30`: first fallback if resolution matters more than motion smoothness
- `720p60`: fallback if motion smoothness matters more than resolution
- `720p30`: lowest acceptable hosted proof tier before considering the pipeline not viable on CPU Fargate

The first pass should compare `hard-switch` plus `ultrafast` across the ladder before adding fade or slate polish back into the runtime path. Fades can remain a later capability flag rather than a requirement for the initial restreamer.

Observed hosted synthetic results from 2026-06-08:

| Shape | Variant | Quality | Realtime factor | Result |
| --- | --- | --- | ---: | --- |
| `4096` CPU / `8192` MiB | `live-control` | `1080p60` | `0.676x` | Not viable |
| `4096` CPU / `8192` MiB | `live-control` | `1080p30` | `0.974x` | Near realtime, no strict headroom |
| `4096` CPU / `8192` MiB | `live-control` | `720p60` | `0.984x` | Near realtime, no strict headroom |
| `4096` CPU / `8192` MiB | `live-control` | `720p30` | `0.978x` | Near realtime, no strict headroom |
| `8192` CPU / `16384` MiB | `live-control` | `1080p60` | `0.979x` | Near realtime, no strict headroom |
| `8192` CPU / `16384` MiB | `live-control` | `1080p30` | `0.965x` | Near realtime, no strict headroom |
| `8192` CPU / `16384` MiB | `live-control` | `720p60` | `0.981x` | Near realtime, no strict headroom |
| `8192` CPU / `16384` MiB | `live-control` | `720p30` | `0.969x` | Near realtime, no strict headroom |
| `16384` CPU / `32768` MiB | `live-control` | `1080p60` | `0.967x` | More CPU did not improve this short diagnostic run |
| `8192` CPU / `16384` MiB | `static-transition` | `1080p60` | `3.843x` | Throughput gate passes |
| `8192` CPU / `16384` MiB | `static-transition` | `1080p30` | `4.750x` | Throughput gate passes |
| `8192` CPU / `16384` MiB | `static-transition` | `720p60` | `7.951x` | Throughput gate passes |
| `8192` CPU / `16384` MiB | `static-transition` | `720p30` | `12.399x` | Throughput gate passes |
| `512` CPU / `2048` MiB | `live-control`, 180 seconds | `720p30` | `0.439x` | Delay SLA fails: max `230.417s` |
| `1024` CPU / `2048` MiB | `live-control`, 180 seconds | `720p30` | `0.998x` | Delay SLA passes: max `0.307s`, average `0.253s` |
| `2048` CPU / `4096` MiB | `live-control`, 180 seconds | `720p30` | `0.999x` | Delay SLA passes: max `0.246s`, average `0.191s` |
| `1024` CPU / `2048` MiB | `live-control`, 600 seconds | `720p30` | `1.000x` | Delay SLA passes: max `0.274s`, average `0.234s` |
| `4096` CPU / `8192` MiB | `live-control`, 180 seconds | `1080p60` | `0.729x` | Delay SLA fails: max `66.820s` |
| `4096` CPU / `8192` MiB | `live-control`, 180 seconds | `1080p30` | `0.998x` | Delay SLA passes: max `0.303s`, average `0.253s` |
| `4096` CPU / `8192` MiB | `live-control`, 180 seconds | `720p60` | `0.999x` | Delay SLA passes: max `0.207s`, average `0.176s` |
| `4096` CPU / `8192` MiB | `live-control`, 180 seconds | `720p30` | `0.999x` | Delay SLA passes: max `0.265s`, average `0.229s` |
| `8192` CPU / `16384` MiB | `live-control`, 180 seconds | `1080p60` | `0.998x` | Delay SLA passes: max `0.276s`, average `0.232s` |

Interpretation: the static encode path has strong CPU Fargate headroom at `8192` CPU / `16384` MiB, including `1080p60`. The live-control path validates timed source selection but its short synthetic realtime diagnostic hovers just under strict realtime across most lower gates and is not improved by a one-off `16384` CPU override. Because live-control inputs are intentionally realtime-paced with FFmpeg, do not use a short-run `0.96x` to `0.98x` factor alone to trigger GPU work. The stronger SLA is max live delay from raw input to output: target less than 10 seconds at every point, including after long sustained runs. Use the real VRCDN live-output POC and longer sustained synthetic runs to decide whether CPU Fargate has enough operational headroom.

Current recommendation: keep `8192` CPU / `16384` MiB as the `1080p60` CPU-Fargate baseline for the VRCDN POC. Do not use `4096` CPU / `8192` MiB for `1080p60`; it accumulated delay quickly in the 180-second sustained probe. If cost pressure requires the lower Fargate shape, `4096` CPU / `8192` MiB has 180-second synthetic delay headroom at `1080p30`, `720p60`, and `720p30`; choose the first acceptable fallback in the ladder and revalidate it in the real VRCDN POC. For a cheap `720p30` tier, `1024` CPU / `2048` MiB is the current synthetic baseline: it passed a 600-second probe with max delay under `0.3s`. Do not use `512` CPU / `2048` MiB for `720p30`; it fell far below realtime and failed the delay SLA.

## VRCDN Live-Output POC Harness

Historical June 2026 POC plan: prepare a three-account VRCDN test harness before running non-synthetic output. Two accounts act as source feeds and one account acts as the watched output target.

Required operator-provided inputs for the first full POC:

- source A public playback link
- source B public playback link
- output public watch link
- secret reference for source A synthetic-pusher ingest credentials
- secret reference for source B synthetic-pusher ingest credentials
- secret reference for output ingest credentials

Do not paste stream keys, ingest URLs with embedded keys, provider tokens, signed URLs, or account passwords into chat, docs, git, Terraform variables, Convex event records, or logs. Store secret values only in Secrets Manager or the approved secret store, then pass reference names through Terraform or the control plane. The POC should first push local synthetic audio/video into source A and source B, restream the public playback links through the worker, push to the output account, and validate the output using its public MPEG-TS URL and separate PC/Quest links. The originally proposed derived HLS URL returned 404 and is not supported; the browser uses the existing MPEG-TS transport.

The checked-in POC entrypoint is `workers/restream/vrcdn-poc.mjs`. It has three modes:

- `VRDEX_VRCDN_POC_MODE=source-pusher`: pushes a labeled synthetic feed into one VRCDN source account.
- `VRDEX_VRCDN_POC_MODE=output-restream`: pulls source A and source B public playback links, hard-switches source A to hold slate to source B, and pushes the result into the output VRCDN account.
- `VRDEX_VRCDN_POC_MODE=single-output-smoke`: pushes synthetic source A to hold slate to source A directly into one VRCDN output account. Use this when only one VRCDN account is available.

Shared non-secret settings:

- `VRDEX_RESTREAM_QUALITY_GATE`, using the same `1080p60`, `1080p30`, `720p60`, `720p30` ladder.
- `VRDEX_RESTREAM_X264_PRESET`, defaulting to `ultrafast` for the POC.
- `VRDEX_VRCDN_POC_DURATION_SECONDS`, defaulting to `600`.
- `VRDEX_RESTREAM_ARTIFACT_ROOT` and optional `VRDEX_RESTREAM_ARTIFACT_S3_URI` for private no-secret POC reports.

Output POC artifact directories include `report.html`, `vrcdn-poc-report.json`, and `frames/hold-slate-input.png`. The HTML report is an operator index for the public watch target, run settings, command timeline, and hold-slate frame; it does not include ingest URLs, stream keys, or secret JSON.

Source pusher settings:

- `VRDEX_VRCDN_POC_SOURCE_KEY=source-a` or `source-b`.
- `VRDEX_VRCDN_POC_INGEST_URL`, injected only from a Secrets Manager or SSM reference. This value is a secret and must not be logged or pasted.
- `VRDEX_VRCDN_POC_INGEST_SECRET_JSON`, alternative injected secret JSON with `ingestUrl`, or with `rtmpUrl` and `streamKey` fields.

Output restream settings:

- `VRDEX_VRCDN_POC_SOURCE_A_PLAYBACK_URL`, a stable public playback URL with no query string, userinfo, or signature.
- `VRDEX_VRCDN_POC_SOURCE_B_PLAYBACK_URL`, a stable public playback URL with no query string, userinfo, or signature.
- `VRDEX_VRCDN_POC_OUTPUT_WATCH_URL`, the public output watch URL used for human/browser validation.
- `VRDEX_VRCDN_POC_OUTPUT_INGEST_URL`, injected only from a Secrets Manager or SSM reference. This value is a secret and must not be logged or pasted.
- `VRDEX_VRCDN_POC_OUTPUT_INGEST_SECRET_JSON`, alternative injected secret JSON with `ingestUrl`, or with `rtmpUrl` and `streamKey` fields.

Single-output smoke settings:

- `VRDEX_VRCDN_POC_OUTPUT_WATCH_URL`, the public output preview URL used for human/browser validation.
- `VRDEX_VRCDN_POC_OUTPUT_INGEST_URL` or `VRDEX_VRCDN_POC_OUTPUT_INGEST_SECRET_JSON`, injected only from a Secrets Manager or SSM reference.

Run order for the first provider POC:

1. Start `source-pusher` for source A.
2. Start `source-pusher` for source B.
3. Confirm both source public playback links are live enough for FFmpeg to open.
4. Start `output-restream` with the two public playback URLs and the output ingest secret.
5. Watch `VRDEX_VRCDN_POC_OUTPUT_WATCH_URL` and verify the visible sequence is source A, hold slate, then source B.
6. Capture CloudWatch logs and private POC report artifacts by event names only; never copy secret values into reports.

Run order for the one-account smoke POC:

1. Store the VRCDN ingest server and stream key in Secrets Manager as JSON with `rtmpUrl` and `streamKey` fields.
2. Start `single-output-smoke` with the public output watch URL and the injected JSON secret.
3. Watch `VRDEX_VRCDN_POC_OUTPUT_WATCH_URL` and verify the visible sequence is synthetic source A, hold slate, then synthetic source A again.

VRCDN-specific URL notes:

- Browser preview pages use `https://panel.vrcdn.live/preview/<stream-name>`.
- Ingest uses the VRCDN ingest server plus stream key. Do not confuse it with playback URLs.
- Playback URLs such as RTMP, RTSPT, MPEG-TS, FMP4, FLV, and FLV/WebSocket are viewer/player outputs, not ingest servers.

Current provider account references:

- Source/smoke secret name: `event-media/vrcdn/basicbit1-smoke`.
- Source/smoke browser preview URL: `https://panel.vrcdn.live/preview/basicbit1`.
- Source/smoke public MPEG-TS playback URL: `https://stream.vrcdn.live/live/basicbit1.live.ts`.
- Output secret name: `event-media/vrcdn/basicbit-output`.
- Output browser preview URL: `https://panel.vrcdn.live/preview/basicbit`.
- Output public MPEG-TS playback URL: `https://stream.vrcdn.live/live/basicbit.live.ts`.
- Stored secret fields: `provider`, `label`, `purpose`, `previewUrl`, `rtmpUrl`, `streamKey`, `playback`, `createdBy`, and `notes`.
- 2026-06-10 attempt: `single-output-smoke`, `720p30`, `1024` CPU / `2048` MiB, 180 seconds. The worker started but FFmpeg produced no output progress; public HLS stayed `404`.
- 2026-06-10 retry: same account with split RTMP app/playpath handling and a 60-second startup timeout. The task failed closed with no FFmpeg output progress.
- 2026-06-10 corrected retry: same account after fixing the stored ingest server to distinguish VRCDN ingest from playback URLs. `single-output-smoke`, `720p30`, `1024` CPU / `2048` MiB, 120 seconds. The task completed with exit `0`, `8` runtime commands, and `120000ms` final output progress. Private JSON report uploaded to `s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks/2026-06-10T04-40-37-650Z/`; future runs also write `report.html` beside the JSON report.
- 2026-06-10 two-account relay: source pusher streamed synthetic source A into `basicbit1`; output restream pulled `https://stream.vrcdn.live/live/basicbit1.live.ts`, inserted the hold slate, then pushed to `basicbit`. `output-restream`, `720p30`, `1024` CPU / `2048` MiB, 120 seconds. The task completed with exit `0`, `8` runtime commands, and `119978ms` final output progress. Private artifacts uploaded to `s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks/2026-06-10T05-43-45-393Z/`, including `report.html`, `vrcdn-poc-report.json`, and the hold-slate frame. A manual overlapping retry failed with VRCDN `403 Stream is locked` because the output account was already occupied by the successful relay.
- 2026-06-10 longer two-account relay: source pusher streamed synthetic source A into `basicbit1` for `1920.839` seconds; output restream pulled `https://stream.vrcdn.live/live/basicbit1.live.ts`, inserted the hold slate, then pushed to `basicbit`. `output-restream`, `720p30`, `1024` CPU / `2048` MiB, 1800 seconds. The output task completed with exit `0`, `8` runtime commands, `3575` progress samples, `1799.641` elapsed seconds, and `1799979ms` final output progress. Private artifacts uploaded to `s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks/vrcdn-long-20260610T170000Z/2026-06-10T17-01-31-107Z/`, including `report.html`, `vrcdn-poc-report.json`, and the hold-slate frame.

As of the June 2026 POC, the next provider test required a third account for source A/source B/output. For the current October event worker, fresh two-source acceptance remains required; the historical POC is not that acceptance. Confirm the panel preview during the live task window and keep using stored secret references instead of pasting secret values into chat or docs.

## Logs And Metrics

Workers should log structured operational events without stream keys, full ingest URLs, signed URLs, or private setup notes.

Minimum CloudWatch or custom metric dimensions for the first benchmark:

- active worker count
- session runtime seconds
- current source and output labels without private URLs
- output bitrate
- audio-present state
- dropped or retried segment counts
- command latency and command outcome

Convex remains the authoritative control plane for event media session state, command outcomes, heartbeats, task status, private artifact links, and audit events. The backend schedule defaults start workers at `T-5 minutes` and requires readiness by `T-2 minutes`. Operator Start uses `scheduleEventMediaWorker` with `startImmediately: true`: server time becomes the start time and readiness is due three minutes later. This supports late starts and replacement after failure, including after the event calendar end. Immediate requests cannot also specify `scheduledStartAt` or `readyDeadlineAt`; ordinary scheduled requests retain pre-event validation. The worker still enforces its twelve-hour session maximum. Artifact links stored in Convex must be private `s3://` URIs or HTTPS URLs without embedded credentials or query strings. The authenticated event editor shows the private worker status and artifact links for operators; public event pages only see ready or active playback links.

## Historical Benchmark Budget And Kill Switch

The June 2026 standalone benchmark scaffold recommended: require all three controls before hosted benchmarking beyond a single manually observed task:

- max concurrent workers, default `10`
- max session duration, default `12` hours
- SSM kill switch, default disabled

Before production testing, add provider-backed budget alerts for expected worker-hour and egress spend. The current Terraform foundation records the resource tags and guardrails needed for that follow-up, but it intentionally does not auto-apply budget resources from CI.

The standalone synthetic benchmark entrypoint validates the kill-switch parameter
name but does not itself read SSM. This historical scaffold is separate from the
current event-worker mode below: event admission defaults to one worker, and the
real controller reads SSM, renews its lease and enforces maximum session duration.
Its ten-second enable authority expires closed; refresh begins after five seconds.

## GPU Fallback Decision

Fargate CPU is the first benchmark path because it avoids EC2 fleet management.

Use ECS on EC2 with GPU/NVENC only if measured Fargate runs fail any `1080p60` acceptance criterion:

- sustained real-time encode with headroom
- stable bitrate under provider caps
- no output stalls or segment gaps
- audio stays present and synchronized
- keyframe cadence remains correct
- source-to-slate-to-source switching is clean
- worker-hour cost has usable pricing headroom

Do not publish hosted `1080p60` availability, pricing, or concurrency until this decision has benchmark evidence.

## Validation

Local validation for this scaffold:

```powershell
terraform init -backend=false
terraform validate
```

Run from `infra/terraform/restream-worker`. From the repository root, also run:

```powershell
terraform fmt -check -recursive infra/terraform
pnpm lint:markdown
docker build -f workers/restream/Dockerfile -t vrdex-restream-worker:local .
pnpm proof:restream:worker
pnpm proof:restream:worker:live-control
pnpm proof:restream:worker:matrix
```

No AWS CLI mutation, Terraform apply, image publish, or ECS task run is part of this validation.

## Controlled event runtime

`workers/restream/event-worker.mjs` is the event-session entry point. The bridge
creates a per-session task definition with explicit event/session identity and
selects it explicitly. The image default and static Terraform task retain the
synthetic benchmark; no static event-command switch is supported. The runtime
installs independent destination senders; fresh provider rehearsal and operational
acceptance remain rollout gates.

The controller acquires a fenced 30-second lease, renews after 10 seconds, and polls
configuration and commands every second. An independent 50ms watchdog immediately
unsubscribes output and calls the sender's synchronous `stopNow()` before waiting
for decoder cleanup. Control calls time out after three seconds. Lease deadlines
use monotonic request-start time plus the server's remaining lease, minus a 250ms
margin; wall-clock skew cannot extend authority. Schedule time advances from the
last server-time sample anchored at response receipt, a conservative lower bound.
Request-start anchoring is used only for lease authority, never schedule eligibility. Event calendar end does not stop a healthy set.

Explicit Next follows the adjacent authored slot when one is current. From slate,
a synthetic manual source or a removed current slot, it selects the available
current half-open interval, otherwise the first available future slot. It fails
after the final interval. Previous still requires an authored current slot.
An explicit operator command may select a future slot early; automatic promotion
retains its boundary check. Source acknowledgements require encoded publication,
including when an unavailable current source has been fenced to slate.

Worker polls query queued/claimed commands through status-and-sequence indexes,
claim at most 20 in order and stop at an earlier command's future availability.
Acknowledgements query only earlier pending rows. Legacy and sessionless intent
is attached/numbered in 20-row chunks before newer intent, with further polls
draining the backlog. Completed history does not enter those scans. Lease
acquisition queries at most two unexpired candidates for each of the six
nonterminal session statuses; any other unexpired session denies acquisition,
including when the program's active pointer is inconsistent.

Each session persists a 12-hour maximum deadline on first acquisition. A deployment
can shorten it with `VRDEX_RESTREAM_MAX_SESSION_SECONDS` (1..86400); replacement
workers retain the backend deadline. The private operations projection includes
`runtimeDeadlineAt`, `broadcastMode`, and `epoch`. An expired or rejected lease,
failed control refresh, renderer failure, cancellation, deadline, or kill-switch
failure fences publication. Process status from ECS is separate from media status.

The bridge reserves global capacity through `eventMediaWorker.admitDispatch`
**before** registering/running a task. Set Convex
`VRDEX_EVENT_BROADCAST_MAX_CONCURRENT` to the intended cap (default 1, maximum 100)
and keep Terraform `max_concurrent_workers` consistent. ECS RunTask uses the
reservation identity as its client token. An ambiguous failed launch keeps its
reservation: inspect ECS and confirm termination before repairing/retrying it.
Do not clear reservations based on time alone. A confirmed stopped task updates
process state and frees capacity. Terminal media status alone never releases a
reservation. Managed reservations use `dispatchStopConfirmedAt`, which only the
verified process-status path can set after ECS reports STOPPED. Legacy failure
status and manual media closure cannot set it or release capacity, even before
worker acquisition. Outstanding tasks remain in bridge reconciliation after media ends;
confirmed stopped tasks remain queryable until task-definition cleanup succeeds.
Ambiguous launches without task ARNs stay visible and reserved for investigation. Rehearsal must also verify that an old task has
lost provider ingest ownership before authorizing replacement publication.

Required event runtime configuration:

| Variable | Owner and scope |
| --- | --- |
| `CONVEX_URL` | Deployment control endpoint; no deployment admin key |
| `VRDEX_EVENT_MEDIA_EVENT_ID`, `VRDEX_EVENT_MEDIA_SESSION_ID` | Bridge-provided session identity |
| `VRDEX_EVENT_MEDIA_WORKER_TOKEN_SECRET_ARN` | Bridge configuration: reference injected as `VRDEX_EVENT_MEDIA_BRIDGE_TOKEN` through ECS secrets |
| `VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER`, `AWS_REGION` | Runtime reads SSM every 5 seconds with 10-second authority; exact `true` enables |
| `VRDEX_RESTREAM_MAX_SESSION_SECONDS` | Maximum runtime, defaults to 43200 |
| `VRDEX_EVENT_MEDIA_SOURCE_ENDPOINTS_JSON` | Optional exact deployment-owned HTTPS MPEGTS endpoint allowlist |

Grant the execution role read access only to the referenced bridge-token/output
secrets, and the task role read access to the configured SSM switch. Optional destination
secret access is separately scoped through `optional_output_secret_arns`. The
existing bridge token is a trusted service credential with global bridge authority;
worker/session/epoch fencing supplies ownership, not per-session authentication.
Rotate it through the secret store and backend binding together, then replace tasks.
Never place token values in base environment JSON, Terraform values, logs, or event
records. Output secrets remain event/output-owned references.

Sources refresh from authoritative event slots and currently public performer
stream choices. Each appearance retains its event-slot identity. Revoked/private
links and disabled sources become unavailable. Profile-derived sources retain
explicit provenance; detaching a performer invalidates its old projection.
Transient link availability is stored separately from source state, so profile
refresh never clears an explicit disable. Separately authored manual sources
retain their own authorization. Production ingestion supports
canonical VRCDN HTTPS MPEGTS and explicitly allowlisted operator HTTPS MPEGTS;
Twitch playback extraction and arbitrary event URLs are refused. A local relay
pins each upstream connection to validated public IPv4, refuses redirects, and
feeds forced MPEGTS into the decoder. Loopback, private, link-local, multicast,
IPv6 and unsupported transports are refused upstream. Synthetic test endpoints
exist only through injected test dependencies.

The pinned lookup returns only the first validated public IPv4. When Node requests
`all: true` for family selection, the callback returns that single address in an
array; other calls retain the scalar address and family callback. Neither form
performs another DNS lookup or exposes additional addresses for fallback.

`events.configureEventBroadcastPolicy` uses the existing media capability and
accepts bounded `maxOverrunMs` and validated explicit `silence`. Missing or empty
stored policy resolves centrally to the -90 dBFS/15-second default described
above. Updating maximum overrun preserves custom silence. Changing the silence
threshold requires restarting a session to create matching decoder analysis; a
mismatched active decoder cannot silently activate a different threshold. Synthetic
proof does not measure real-music false positives.

`hold_current` retains the selected healthy source in manual mode.
`switch_hold` selects the neutral slate; `show_hold_scene` supports only an
unconfigured neutral hold-slate scene. Unsupported custom scenes fail rather than
claiming to render them. `set_automatic_mode` resumes automatic following. Source
switches are acknowledged only when both encoded slot and source match, and the
required output is publishing. Autonomous observations are fenced and audited
separately from command acknowledgements.

The required output must begin actual encoded publication within 15 seconds of
worker startup. Permanent `invalid_setup` immediately fences publication; failure
to publish by the deadline also stops the renderer and senders. The CLI then
releases its local resources and exits, with no further lease renewal. Optional
setup/network failures remain isolated. A worker error does not release dispatch
admission: the bridge must confirm the actual ECS task is STOPPED first.

Worker configuration reads current slot sources and unbound manual sources
through a program/slot index. Detached projections are retained but excluded from
the source limit; they cannot hide later eligible sources. The 64-source bound
still rejects eligible overflow, alongside the existing slot, scene and output
bounds. Disabling or revoking a source still removes it from configuration.

The worker emits JSON `event_worker_heartbeat` (encoded `outputMs`, remaining
runtime), `event_worker_command` (sequence, latency, outcome), and
`event_worker_stopped` (bounded reason) metrics without source or output URLs.
Create CloudWatch metric filters/alarms for missing heartbeats, command latency,
failed dispatch, and forced stops before rollout. Use ECS task duration for worker
hours and provider/network byte accounting for egress; multiply measured hours by
the chosen Fargate CPU/memory rates. Configure an AWS Budget and owner notification
for the expected event spend, then rehearse its alarm path. No budget alarm or
provider acceptance is implied by these configuration examples.

Local control-loop proof: `node scripts/event-worker-local-proof.mjs`. It runs a
real synthetic UDP publisher, waits for encoded selection, kills that publisher,
checks progressing hold output, then verifies publication fencing at the deadline.
Its output sink is local and is not provider acceptance. Also run
`PROOF_SECONDS=60 node scripts/event-broadcast-failure-proof.mjs` for timestamp,
GOP, color and audio checks. The tested quality is 720p30; 1080p60 has not passed
the local processing-delay budget.

Both output setup mutations reject writes, including unchanged saves, while a
session is scheduled, starting, live, holding, in fallback, or stopping. Terminal
sessions with an unconfirmed dispatch or a still-running task also block writes.
The editor and operator panel use the same backend configuration lock. Configure
accounts after the session and its reservation have stopped, then start again.
Refresh still fences changed destination configuration or revoked authorization
before the old sender can be reported under a new output identity. An optional sender's transient failure is separate from this
configuration-change rule and must not interrupt a healthy required destination.
For a source URL change under the same source ID, the worker restarts the decoder
and waits for encoded hold before accepting the replacement input's acknowledgement.

An explicit dispatch admission denial creates no reservation for that attempt.
The bridge records a failed command/session, allowing an operator to Start again
after capacity becomes available. There is no automatic requeue. A thrown,
malformed or lost admission response retains the claimed start and any reservation
until reconciled. New fenced-v1 admissions can release only with backend-atomic
proof that no launch marker won, including configuration/registration failure.
After a launch marker or any RunTask attempt, only actual ECS STOPPED confirmation
releases capacity; retrying cannot bypass this safeguard.

### Independent event destinations (default-off)

The event CLI now installs `createEventOutputs`. Publication still requires the
existing SSM enable switch, lease, source authorization and compliance gates;
this change does not enable hosted output. The selected `session.outputId` is the
required destination. `events.configureTwitchOutput` creates an operator-owned
`external_rtmp` record with `twitchSetup` and an explicit `simulcastEnabled` flag
(default false). It never changes the selected output or public VRCDN links.
Disabled optional Twitch destinations are omitted from public event links; an
explicitly selected primary Twitch output retains its existing watch behavior.
Both VRCDN and Twitch setup enforce eight total output records per program before
insertion. Existing records remain editable at that limit while sessions are stopped.
Only one optional Twitch output can be enabled. VRCDN and Twitch configuration
reject cross-provider key reuse symmetrically; use a distinct output key. Setup writes require stopped sessions, including enabling/disabling optional
publication. Registry revocation still fences an existing session on refresh.

The mutation uses existing media-management authorization and accepts
`currentSlug`, `key`, `label`, `channel`, optional `credentialRef` or
`outputAccountKey`, optional `simulcastEnabled`, and the four existing consent,
destination-authority, provider-rules and rights-cleared acceptance booleans.
It stores references only. Deployment owners may define
`VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON` on Convex as an array of
`{key, channel, credentialRef, ownerCommunityProfileId, authorizedCommunityProfileIds?}`.
`ownerCommunityProfileId` is the destination-owning community's exact Convex
profile ID in this deployment. The optional ID array grants that destination to
specific additional event-owning communities. It defaults to no additional
grants. These bindings are deployment-owned; event operators cannot grant their
own community destination access through the setup form or its checkbox.

The default registry is empty. Existing entries must acquire an explicit owner
binding before use. Unbound/invalid rows grant no authority; malformed JSON or
duplicate keys/credential references fail closed. Match the current event's
community profile ID, including when it differs between local/staging/production;
slugs and individual user identity are not binding substitutes. Both account-key
and direct credential-reference setup require the same current binding. New
outputs persist the registry account key in `twitchSetup.accountKey`; legacy rows
without it require an authorized registry entry matching reference and channel.
No legacy ready-state exemption exists. Do not put stream keys in this registry.

Listing, setup, scheduling, bridge dispatch, dispatch admission and worker authority
revalidate the binding. Removing an entry or a community grant revokes existing
ready outputs too. Selected Twitch revocation denies acquisition, renewal,
nonterminal acknowledgement and configuration refresh. Optional Twitch revocation
removes that destination from dispatch/refresh configuration; the existing worker
then fences the whole program on the destination-configuration change and needs
a restart. This authorization/configuration fence can interrupt the primary.
Optional Twitch network/credential failures still use the independent sender
isolation documented above. Revocation takes effect on the next bounded worker
control check, with existing lease/watchdog limits during network loss.

Account owners rotate values in Secrets Manager;
reference-to-ARN bindings remain in `VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON` on the
bridge. The execution role reads required startup secrets; the task role reads
only explicitly granted optional destination Secrets Manager ARNs.

The bridge preserves its legacy selected-output secret injection. Enabled optional
credentials are **not** essential container `secrets`: the bridge passes only
`VRDEX_EVENT_MEDIA_OPTIONAL_SECRET_ARNS_JSON`, a reference-to-ARN map, as ordinary
configuration. Optional reads happen inside the already running worker with a
two-second deadline, abort on stop, and fixed `invalid_setup` errors. Missing,
deleted, denied or hung optional retrieval cannot delay required VRCDN startup.
Late resolution after `stopNow()` cannot spawn an output. Successful credentials
are cached only in worker memory for reconnects; restart to rotate credentials.

Optional bindings require exact Secrets Manager secret ARNs in the worker's
region and a string-valued complete secret; SSM and ECS JSON-key selector suffixes
remain supported only by the legacy selected-output ECS injection. Configure
Terraform `optional_output_secret_arns` with exact optional ARNs: it grants
`secretsmanager:GetSecretValue` only on those resources to the **task role**, not
the execution role. The default empty list grants nothing and creates no policy.
For customer-managed encryption, `optional_output_kms_key_arns` adds `kms:Decrypt`
only on exact keys, conditioned on Secrets Manager via-service and the configured
secret ARN encryption contexts. Cross-account secrets also require matching
operator-managed resource/key policies. Do not grant wildcard secret/key access or
add optional credentials to the static `secret_arns` ECS startup map. These local
IaC definitions do not apply permissions or change hosted enablement by themselves.

The secret JSON is `{rtmpUrl, streamKey}` or legacy `{ingestUrl}`. The worker accepts
VRCDN regional `*.ingest.vrcdn.live/live` and Twitch `live.twitch.tv/app` endpoints
(and subdomains of that Twitch hostname), RTMP/RTMPS, default ports or 1935/443.
It rejects credentials embedded in authority, arbitrary/private hosts, URL queries,
fragments and malformed keys. Provider diagnostics and FFmpeg stderr are discarded;
only fixed status codes cross the worker boundary. Keys necessarily reach the
isolated FFmpeg process arguments; do not expose process inspection to tenants.

Each destination has its own FFmpeg process, pipe, reconnect timer, and queue.
Pending data is capped at 512 KiB and two seconds, including Node's writable
buffer. Slow/stalled destinations are killed, their backlog discarded, and they
rejoin current program packets with 0.5–8 second reconnect backoff. Publishing
requires advancing FFmpeg output timestamps within two seconds; process existence
or queued bytes alone cannot mark an output live. VRCDN remuxes the program's
H.264/AAC; Twitch independently transcodes for its distinct GOP. Primary progress
alone determines worker `publishing`,so optional failure never changes VRCDN's process or blocks its writes.
`stopNow()` is synchronous, terminal and idempotent.

Event sessions support six H.264/yuv420p presets with zero B-frames:

| Preset | Dimensions | Frame rate | Video bitrate |
| --- | --- | --- | --- |
| `480p30` | 854x480 | 30 fps | 1000 kbps |
| `480p60` | 854x480 | 60 fps | 1500 kbps |
| `720p30` | 1280x720 | 30 fps | 1800 kbps |
| `720p60` | 1280x720 | 60 fps | 2500 kbps |
| `1080p30` | 1920x1080 | 30 fps | 3000 kbps |
| `1080p60` | 1920x1080 | 60 fps | 3500 kbps |

`broadcast-profiles.mjs` owns these formats. The renderer uses CBR filler even
on hold frames. VRCDN remuxes the selected program with a one-second GOP and
AAC stereo at 48 kHz, with either 160 or 320 kbps audio. Newly created media
programs default to `720p30`/320; rows without stored settings retain
`720p30`/160. Higher output audio bitrates cannot restore detail lost upstream.
Explicit VRCDN setup values must match the selected profile or that sender
reports `invalid_setup`.

Twitch retains the selected video dimensions, frame rate and bitrate, encodes a
two-second GOP, and uses 160-kbps AAC stereo at 48 kHz regardless of the VRCDN
audio choice. New Twitch output records use `twitch-selected-video`; the legacy
`twitch-conservative-720p30` marker remains readable and no longer constrains
video selection. These are initial encodings. Short local format tests do not
establish provider acceptance, visual quality, sustained capacity or AVPro
playback acceptance. Those require the separate capacity/provider proofs before
merge. VRCDN's combined bitrate limit remains imprecisely documented.

Run `pnpm proof:event-broadcast:formats` serially for the short local format
proof. It encodes audible independent stereo noise for both audio choices and
all six presets using the production encoder arguments, runs each destination
codec path, and uses `ffprobe` plus full decoding to verify dimensions, frame
rate, channels, sample rate, audio bitrate tolerance and GOP intervals. It runs
offline and establishes no real-time throughput or provider acceptance.

`eventMediaSettings.configure` requires `manage_event_media`. Settings changes
apply to the next session, including changes made while a broadcast is on air.
Session creation stores immutable `mediaSettings`, `destinationProfiles` and
`controlProtocolVersion: 2`. Worker acquisition and refresh use those snapshots;
a next-start setting or simulcast checkbox change cannot resize, restart or
reconfigure an on-air encoder or sender. Publication authority and credentials
are still checked against current destination grants. Deploy the protocol
migration only with no active sessions. The control status query exposes program
settings alongside each session's active settings for the operator console.

### Control protocol 2 activation

Hold new starts during deployment. Drain every scheduled, starting, live, hold,
fallback and stopping session, including scheduled sessions that have not yet
acquired a worker. Reconcile each reserved or dispatched provider task to
confirmed STOPPED before retiring its ownership. An ended media session or a
failed task diagnostic alone does not establish that its process stopped.

Deploy the backend schema/functions and a worker that sends `protocolVersion: 2`
on every session request. With starts still held, run the internal
`eventMediaControlMigration:backfill` mutation against the explicitly selected
deployment, initially with `{"batchSize":100}`. Persist its returned `phase` and
`cursor`, and pass them back on each call until `done` is true. Batch size is
bounded to 1–100. Every page independently checks quiescence through indexed
session/task lookups; replaying a page is safe. Resume starts only after all
pages and the compatible worker rollout have completed. This is deployment
sequencing, not an operator feature toggle. Keep the dispatcher's separate
`launchProtocol: "fenced-v1"` contract unchanged.

The migration normalizes canonical source references and positive revisions,
preserves disabled sources and deployment-owned internal endpoint descriptors,
and never recreates removed profile links. Legacy automatic intent stays
automatic and hold becomes slate. A recorded manual source is retained only
when its revision is recoverable and still authorized. Revision 1 is recoverable
for unchanged legacy rows; later revisions need recorded observation evidence.
Ambiguous, disabled or revoked manual state becomes slate. Historical controls
are settled, never attached to a new session. Existing explicit migrated intent,
terminal command history, sequences and acknowledgments remain intact.

New sessions start with automatic `committedIntent`, `intentSequence: 0` and no
pending operation. Same-session takeover retains the original command, phase,
pinned revision and preparation expiry. The session stores only a
`pendingControlCommandId`; its command owns target, prior intent, phase and
expiry. `queueEventMediaCommand` and `cancelEventMediaOperation` require a caller
generated idempotency key scoped to event, session and stable actor. Retrying the
same normalized payload returns the original receipt; reusing its key for a
different payload is rejected. Browser preview does not enqueue a command.

`beginPreparation` starts the persisted 15-second preparation-through-confirmation
budget once. `promoteOperation` validates authority and the pinned target, then
commits intent before granting renderer selection. Cancel is available only
while preparing. Cut commits slate immediately and supersedes ordinary pending
controls. Terminal Stop rejects subsequent controls and outranks Cut. Removing
a source disables it and cancels its pending preparation or commits slate in the
same transaction, including a manual desired source currently showing fallback.
Actor revocation blocks preparation/promotion, while an already committed intent
survives that revocation. Destination revocation always fences publication.

Control transitions return `ok`, `superseded`, `cancelled`,
`failed` (`expired`, `source_unavailable`, `actor_revoked`), or
`fenced` (`lease`, `destination`, `stopped`). Only `fenced` stops publication;
ordinary operation failures settle while retaining committed intent. Acquisition,
renewal, dispatch and terminal lifecycle operations retain their existing lease
and cleanup contracts. Protocol 2 rejects omitted or older worker versions at
the request boundary.

Program observations and successful nonterminal acknowledgments include
`intentSequence`, `outputMs`, the selected output ID and one coherent rendered
source ID/revision/slot snapshot, or no source fields for slate. The renderer
carries the submitted revision through encoded-output acknowledgment; do not
substitute a newly refreshed revision for older encoded media. Stale intent,
regressing output progress, conflicting equal-watermark identity and inconsistent
target evidence cannot update publication observations. Exact completion retries
are read-only. Fallback observations do not erase durable manual intent.

The branch implements the protocol adapter and nonblocking acquisition/controller.
Final reviewed-image proof of Cut latency during blocked acquisition, sender
termination and measured capacity remains required before feature rollout.

`eventMediaWorker.observeOutputs` persists only bounded numeric health and fixed
statuses under the same session/epoch/lease fence. Authenticated
`getEventMediaControlStatus` exposes `outputs[].twitchSetup`, `simulcastEnabled`,
and `sessions[].outputHealth` with `outputHealthObservedAt`. Health entries have
`outputId`, `destination`, `status`, `publishing`, `queueBytes`, `outputMs`, and
`restarts`. Treat old timestamps as stale; health is not a public projection.
This does not change legacy `output`, selected-output commands, PC/Quest links,
Twitch embeds, or supported watch modes.

Run the credential-free failure proof locally with:

```bash
node scripts/event-output-local-proof.mjs
```

It starts two loopback RTMP receivers, drives a real 720p30 test-pattern/audio
program, kills the optional receiver one third into a 60-second run, restores it
halfway through, and verifies primary progress, packet timestamps, GOP, memory,
and optional recovery. Local destination rewriting exists only in the proof's
injected process factory. The production credential parser has no local bypass.
Each run writes JSON, streaming resource samples and media to its own
`/tmp/event-output-<unique>/` directory (or `PROOF_DIRECTORY_PREFIX`). The final
JSON prints that directory. `PROOF_SECONDS=7200` requests two real wall-clock
hours; the default remains sixty seconds.

The final Node24 local run measured 0.44 CPU-seconds for primary remux and 13.43
CPU-seconds for the additional Twitch sender processes over 60 wall seconds
(including downtime/retries), with 14,830,604 primary and 11,944,610 optional FLV
application bytes. The extra sender averaged 0.224 CPU cores over that failure
scenario; this excludes the shared renderer/input decoding and is not a Fargate
capacity guarantee. Measured optional application egress was 1.59 Mbps averaged
across the run including downtime; active configured media is about 1.96 Mbps
before container/network overhead (roughly 0.88 GB/hour per destination).
FFmpeg progress counts FLV bytes, excluding TCP/TLS overhead and provider billing.
The primary used one process, max packet gap was 34 ms and max GOP was 1 second.
Synthetic evidence is not provider acceptance or a sustained capacity benchmark.
Fresh two-source provider rehearsal, rights/account verification, sustained
quality/CPU/egress measurements, budget alerts and provider
playback checks remain rollout gates. Do not enable hosted output from this proof.

The Task 6 packaged Node 22.23.3/bookworm image also passed the 60-second proof in
`--network none` with loopback receivers. It retained one primary process and the
same 34 ms packet-gap/one-second-GOP bounds. Sender CPU was 0.66 seconds primary
and 13.89 seconds optional; application egress was 14,770,299 and 11,954,114 bytes.
The separate sender test suite passed all eight tests on Node 22 as well.

The October 20 review follow-up changed only `event-worker.mjs` among the nine
packaged runtime modules. Local image
`sha256:143cbd55aa8b1f4a5c55706ff58fa42e2b6b8660ee24e89f5fadf0d78901c3dd`
(Node 22.23.3) passed `node scripts/event-startup-local-proof.mjs`: actual CLI
primary-invalid termination, healthy primary with invalid optional setup, and
primary-unreachable startup deadline. The same image passed the 40-second
`event-output-local-proof.mjs` dual-output outage/recovery proof. Both ran with
no external network, read-only root and two-CPU/four-GiB limits. Their exact image,
launch configuration, packaged hashes, logs and media hashes are retained.
The following review and rehearsal records retain their original deployment
states. Statements that hosted output or automatic silence remained disabled are
historical; current implementation, cutover and backend rollout status are above.

These bounded controller checks complement the prior sustained media evidence;
they do not claim a new two-hour run of the changed controller. See
[event broadcast verification](../engineering/event-broadcast-verification.md).

### Event operator controls

Event editors link to `/<community>/events/<event>/operate`. The server checks
an authenticated operations query and the exact event path before rendering
private status. Staff with `view_event_operations` or `manage_events` can read
the panel with mutation controls disabled; `manage_event_media` grants control.
Public hosts use the `host` route. Mutations recheck capabilities.

Controls submit sequenced commands. Committed intent, pending preparation and
encoded source/revision observations remain distinct. Cancel is available only
while preparing. Cut to slate remains independent of pending ordinary requests;
confirmed Stop takes priority over source controls. See the
[console integration contract](../engineering/event-broadcast-operator-console.md)
for source authorization, status windows, settings, editor selection and local
preview ownership. An expired
lease or destination observation older than 15 seconds displays unknown health.
The explicit session runtime deadline is displayed independently of calendar end.

Configure outputs through existing account setup while stopped, then select the
primary output and start. The stopped-only Twitch setup disclosure selects a
deployment-configured account and explicitly opts into simulcast through
`configureTwitchOutput`. Only account key/channel reach the selector, and malformed
optional account configuration does not hide primary status or Stop. The view
displays independent destination health. The
runtime uses the session profiles documented above. The policy
control sets or removes maximum overrun while stopped. Ordinary automatic
operation uses the effective silence policy without a host calibration toggle.

The local operator browser fixture exercises controls without provider or Clerk
accounts. It does not verify a signed-in Clerk server-route journey. Real Convex
identity tests cover command permission, revocation and read-only operations
access; the anonymous browser test verifies the route redirects before rendering.

### Observed-state freshness and terminal cleanup

`eventMediaSessions.programObservedAt` is optional for migration. Only an accepted
actual program observation or successful observed command acknowledgement stamps
it. Lease renewal, process status, generic heartbeat and destination reports do
not refresh it. New epoch acquisition clears it and destination-health observations
so a replacement cannot inherit a previous publisher's fresh state.

Operator headlines and destination rows use server time plus browser monotonic
elapsed time, the current lease and an observation less than 15 seconds old.
Unobserved/stale source and mode show Unknown. Terminal worker status remains
ended/error while its old source/mode remain Unknown. A fresh lease by itself does
not establish progressing media. Stop stays available for stale nonterminal
sessions, including while another command request is unresolved.

The existing Stop mutation rejects ended/error sessions; this interface does not
provide terminal Stop. A terminal media record does not prove an ECS task stopped.
For managed tasks the bridge's `refreshSessions` describes tasks, records confirmed
STOPPED, and deregisters task definitions with retry. It does not call StopTask
merely because a record is terminal. The worker's own publication fence is separate
from ECS process termination. If a terminal record still has a running task, use
the existing infrastructure operations path to inspect the exact task identity,
request ECS StopTask, and confirm DescribeTasks reports STOPPED. Until that
confirmation, retain its reservation. Ambiguous reservations without a task ARN
require investigation; do not delete them or mark cleanup complete to free capacity.
No provider termination was exercised by the local operator fixture tests.

## VRCDN destination registry migration

The October event worker requires deployment-owned destination entitlement for
VRCDN as well as Twitch. The old globally available hardcoded `basicbit` account
has been removed. Configure `VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON` in the intended
Convex deployment with an array of records:

```json
[
  {
    "key": "organizer-output",
    "label": "Organizer output",
    "credentialRef": "event-media/vrcdn/organizer-output",
    "ownerCommunityProfileId": "EXACT_OWNER_PROFILE_ID_IN_THIS_DEPLOYMENT",
    "authorizedCommunityProfileIds": [],
    "playbackLinks": [
      { "platform": "browser", "url": "https://stream.vrcdn.live/live/organizer.live.ts" },
      { "platform": "standalone", "url": "https://stream.vrcdn.live/live/organizer.live.ts" },
      { "platform": "pc", "url": "rtspt://stream.vrcdn.live/live/organizer" }
    ]
  }
]
```

The deployment operator owns this non-secret environment configuration. Verify
provider account ownership and the exact event-owning community profile ID
before adding the binding; local/staging/production IDs differ. Optional grants
name additional exact community IDs. A community operator's checkbox or generic
event-management capability cannot add grants. Secret values remain in the
existing approved store; the ECS bridge's reference-to-secret-ARN mapping must
match. This adds no credential-issuance service or provider account pool.

Migration order: keep hosted output disabled, inventory the intended existing
output references without reading secret values, verify each owner/grant,
configure these bindings in the intended deployment, and confirm authorized
listing/setup/dispatch plus cross-community denial before enabling any run.
An existing `basicbit` output can retain its reference only after its verified
owner binding is explicitly installed; there is no inferred owner or fallback.
Rotation keeps the reference binding and existing Secrets Manager rotation path;
changing the reference requires updating both registry and bridge mapping and
reconfiguring the output. Revocation removes the entry or specific grant.

`events.listVrcdnOutputAccounts({currentSlug})` authenticates and requires the
current event's media-management capability, then returns only entitled account
keys, labels and public links. Legacy calls without a slug return an empty list.
The editor queries after the event exists. `configureVrcdnOutput` accepts the
existing key or direct-reference arguments, but both require the same entitlement.
A setup with no credential/account remains a non-publishing draft. Unbound
references, malformed configuration and duplicate keys/references fail closed.
Existing ready rows are revalidated at scheduling, dispatch, admission and every
worker authority boundary; ready state does not grandfather permission.

Managed public-watch links, including cached program links, are withdrawn on
revocation for either provider. Separately authored direct event/DJ links remain.
This means malformed registry configuration can interrupt managed browser
playback through its normal public revalidation. A selected-output revocation
fences streaming publication on the next bounded worker authority refresh. Cleanup retains exact-task ownership until ECS confirms STOPPED; do not erase
admission records to bypass capacity. Durable Stop intent is retried by the
bridge as described below.

See [integration verification](../engineering/event-broadcast-verification.md)
for tested behavior, resource methods, historical/current evidence and rollout gates.

### Review follow-up: terminal recovery, initial selection and host status

Terminal worker observations and actual task STOPPED reconciliation settle all
queued and claimed commands for that session. Error outcomes fail outstanding
commands; normal completion cancels remaining work. Retries converge without
releasing admission early. The operator's Start control also waits for confirmed
task stop; command settlement alone does not free a held output or reservation.

Public managed output links include the selected required VRCDN destination and
enabled, entitled optional Twitch destinations. Other configured VRCDN accounts
remain private configuration choices. Direct performer fallback links remain
available.

Initial automatic selection uses authored half-open slot intervals. Missing
ends extend to the next authored start, or indefinitely for the last slot.
Fresh/replacement startup stays on slate in gaps or after an explicit final end,
even when configuration remembers an old source. Future sources may prepare
within the existing two-minute window and cannot promote before their boundary.
A healthy source already selected by this worker may continue its set; calendar
end is not a media cutoff. Explicit operator selection remains separate.

Host status spends at most four probes on current/upcoming performers, sharing a
four-probe process-wide concurrency bound and cache. It waits at most ten seconds
for observations and returns partial results without queuing background work.
Unprobed links stay unknown; all authored roster links remain accessible. The
client gives requests twelve seconds and schedules its next refresh thirty
seconds after completion, avoiding overlapping refreshes.

The third review image
`sha256:1810e5e35e2707af0d735370c0ff1ae817b07fd9cffe32fa7c8a9646c288c1c3`
(Node 22.23.3) passed `event-join-local-proof.mjs` and the existing startup proof.
The join proof covers actual media through gap, boundary, healthy overrun and
replacement after explicit end. Prior sustained media evidence remains scoped to
its original image; see the verification page for current hashes and limits.

### Review follow-up: failed commands and authorized rehearsals

A source switch commits only after encoded publication; failure restores the
previous authorized source or slate. Return to auto from manual/hold reconciles
the current authored interval, including slate in a schedule gap. Ordinary
healthy automatic overrun remains allowed. Unchanged profile stream projections
no longer create per-second writes.

Unusable pre-dispatch starts now terminate their sessions and clear active intent.
Held dispatch reservations remain held until actual ECS STOPPED. The bridge can
claim Stop after worker acquisition and repeats durable Stop intent for the exact
task during reconciliation, including after request failure or late ARN arrival.
A failed start with a held task also retains cleanup intent. Destination
revocation cannot prevent this process cleanup; it grants no new publication
permission. No Stop claim or request fabricates a STOPPED observation.

Host page, live updates and bounded status probes permit authorized operations
readers to access draft rehearsals. Public events retain anonymous access.
Private status responses are never shared between viewers. This grants no
additional command capability.

Fourth-review Node 22 image `952affdbf9ee` and controller `44694eb903d2` passed
fresh real-media command failure/recovery and Return-to-auto proof. Its 24.5-second
scope, full hashes and prior-snapshot attribution are recorded in
[integration verification](../engineering/event-broadcast-verification.md).
The prior two-hour result is historical; rollout gates remain unchanged.

### Review follow-up: relay lifetime and cleanup isolation

Relay routes track current/prepared decoders, including pending manual switches
and rollback. Stale routes and their connections are retired before allocating
replacements; retained streams stay connected and the live route cap remains 64.
Source URL rotations keep their revision barrier and exact HTTPS/DNS validation.
Per-task definition cleanup failures remain pending and retry without stopping
other task/command reconciliation. Confirmed ECS STOPPED still releases admission.

Selected destinations now follow accepted fenced live/hold and terminal media
observations and acknowledgements, without reviving disabled/revoked outputs or
changing a replacement session's destination. Sessionless pending commands no
longer block operator Start; backend scheduling attaches them in order.

Local Node 22 image `f9f13a9c002b` passed the 26.8-second actual relay/media proof.
Disk exhaustion required one local layer over retained image `952affdbf9ee`;
this was not a completed production-Dockerfile rebuild. Controller and relay
changed; seven runtime modules retain their prior identity. Exact provenance,
recording hash, browser fixture limits and historical two-hour attribution are
in [integration verification](../engineering/event-broadcast-verification.md).
Hosted output, automatic silence and optional maximum overrun remain disabled.

Legacy cleanup-only retries do not replay publication status. First delayed
legacy status reports also check active-session ownership before changing shared
program/output state, so retiring an old task cannot fence its live replacement.
The old task's own process status and cleanup remain independently reconcilable.

An abrupt exact-task ECS STOPPED observation also returns the owned selected
output to ready if the worker could not report media completion. Replacement
Start then works without re-saving the destination, independently of pending
task-definition cleanup. The update preserves disabled/revoked records, other
outputs and any different active replacement session; admission still requires
actual STOPPED rather than a Stop request or media-terminal observation.

The seventh-review controller proof uses Node 22 image `cb3cd0cc174f` and the
actual packaged media path. It covers schedule-aware Next from slate and from
unavailable/removed current slots, failed selection rollback, retry and automatic
gap slate. All eight other runtime modules match image `f9f13a9c002b`; its older
recording remains historical for the controller. The new local image adds one
controller layer to that verified base, while a fresh normal Dockerfile build
remains a remote CI gate. Full hashes, decoded recording evidence, isolated
container limits and acceptance boundaries are recorded in
[integration verification](../engineering/event-broadcast-verification.md).

### Review follow-up: live lineup edits and unlaunched admission

Automatic playback whose current slot identity disappears resolves the available
current half-open interval, then the first available future slot. An expired
first slot is never the fallback. The removed slot's old end does not delay its
replacement, and a gap stays on slate until the future boundary. An authored
current slot retains normal adjacency and healthy overrun. Revocation fences the
current publication immediately while automatic reconciliation preserves a warm
successor decoder across polls.

New bridge admissions use `fenced-v1`. Before any ECS RunTask, the bridge must win
a durable launch-attempt marker for the exact event, session, dispatch and claimed
Start owner. The atomic alternative releases a provably unlaunched reservation,
settles its failed session/commands and permits a fresh Start. Marker and release
cannot both succeed. Configuration and task-definition registration failures can
use this release. Legacy unmarked reservations, ambiguous marker responses,
RunTask attempts and lost task-registration responses retain capacity. A launched
task still releases capacity only after exact ECS STOPPED.

Known unused task definitions from Stop before the marker retry deregistration
through durable cleanup discovery. Cleanup failure does not prevent admission
release or replacement Start. A competing bridge's unused definition never
overwrites the winner's session definition. If best-effort loser deregistration
fails, the private audit action `worker_unused_definition_manual_cleanup` and
bridge diagnostic identify its bounded nonsecret ARN. Operators must deregister
that exact unused definition manually after checking the winning session's ARN.
Provider exception text and credentials are not recorded. A lost task-definition
registration response can leave an unused definition with no known ARN. Admission
release is still safe before a launch marker, but operators must inspect the
session-specific task-definition family for that registration artifact. Automatic
cleanup cannot identify it from a response that was never received.

Host source labels preserve missing and stale observations as Unknown. A fresh
explicit failed observation remains Unavailable; fresh Twitch Offline remains
independent of scheduled-current and selected-source indicators. The bounded
four-probe reader preserves original observation timestamps.

The eighth-review verification adds a fresh normal checked-in Dockerfile build
and a bounded local lineup-edit media proof. The previous two-hour run remains
historical for its old controller and relay; its raw files were lost in the
workspace reset. See [integration verification](../engineering/event-broadcast-verification.md)
for current evidence and limits. Hosted output, silence and maximum overrun
remain disabled.

Same-key authored source replacement also preserves the previous source identity
until the new source is eligible and decoded-ready. The replacement's decoder
can warm under that key while publication stays on slate before its boundary.
Expired replacements remain excluded. Manual Next uses the removed-current
fallback instead of skipping the replacement; an operator may still select it
early explicitly. The corrected controller and policy have fresh packaged proof
attribution in the verification page. Previous snapshots retain their original
scope, and hosted enablement still requires capacity and provider acceptance.

### Proof image publisher prerequisite

The manual `Restream proof image` workflow requires the dedicated
`vrdex-restream-proof-image` OIDC role before dispatch from main. The state-mgmt
owner provisions it with `enable_restream_proof_image_permissions=true`, default
false. Its exact repository-main subject and STS audience permit ECR authentication
and exact-repository push/DescribeImages, plus `ecr:BatchGetImage` and
`ecr:GetDownloadUrlForLayer` on the same repository. Retry recovery pulls the
existing immutable digest for `linux/amd64` and verifies the source label and all
files in `workers/restream/packaging-manifest.json` on the runner before executing syntax/import checks.
It regenerates provenance without a prior artifact and never pushes or retags an
existing image. Mismatches fail closed. Other eligible main-branch jobs share that
trust boundary; it does not isolate one workflow. The Terraform role's broader permissions
are separate. A reviewed owner migration can retire its historical ECR-only bootstrap
grant after the dedicated role is verified. This change does not claim live IAM
provisioning. See [permissions, import and rollback](../engineering/event-broadcast-rehearsal.md#image-and-permissions).

### October 22 isolated rehearsal findings

During the isolated rehearsal, ordinary hosted output remained disabled.
BASIC's autonomous $20 completion scope
supersedes the original attempt-count and ten-minute approval caps. Individual
tasks still require explicit external deadlines and exact cleanup. Source pushers
retain 240-second bounds; the 300-second synthetic measurement has a declared
390-second inner and 480-second external bound. Source replacement requires
`executionStoppedAt` and task status DEPROVISIONING or STOPPED, confirming process
exit while allowing network-only cleanup to finish afterward.

The reviewed proof image is
`079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker@sha256:fa5515d574355d6a647ce8390285f62edec1ad4f7e6e98956230c0b1391c2548`,
source `33770f7723f3bdbfa80a710eda3cfa6a5287aa0a`, with 13 matching packaged
hashes. Its source callback correction was reproduced under Node 22.23.4; actual
Fargate source TCP/TLS, HTTP 200 and readiness/loss/recovery to a local RTMP receiver
subsequently passed. The rejected `basicbit` credential still blocks that account's
public output. Authorized browser retrieval could not proceed because callable
browser controls were unavailable; no secret was updated.

A 2 CPU/4 GiB, 300-second synthetic run failed with `renderClockBudgetExceeded`.
The same workload passed five minutes at 4 CPU/8 GiB. This is a bounded measurement,
not a production resource change. A separate real `basicbit1` hold/fence probe
passed with public decoded slate bytes, observed dedicated-switch false and actual
worker fencing. Final readback at `01:09:32.522792Z` confirmed zero RUNNING,
all five final tasks STOPPED, their interfaces DELETED, latest proof definitions
INACTIVE and both switches false at production/rehearsal versions 1/21. The output
secret remains unchanged; the full provider and rollout gates remain open. See the [rehearsal record](../engineering/event-broadcast-rehearsal.md#october-22-2026-diagnostic-session)
for exact metrics, provenance, retained failures and remaining gates.

## Diagnostics provenance and compute estimates

The existing authenticated dispatch handshake now stores region, Linux/x86
platform and On-Demand purchase model for the returned task. Region is checked
against both task and task-definition ARNs. On-Demand follows the bridge's
explicit `--launch-type FARGATE` request without a capacity-provider strategy;
generic Fargate metadata alone does not supply pricing provenance. Older sessions
without that handshake retain an unknown estimate.

Recreate region through the existing Terraform bridge configuration
(`VRDEX_EVENT_MEDIA_ECS_REGION` and worker `AWS_REGION` in `bridge.tf`). OS,
architecture and purchase model come from the checked-in task-definition and
launch code. No new environment variables or dashboard settings are required.
Deploy the protocol migration with no active sessions. Changes apply to new
sessions and never resize or restart an on-air worker.

Authorized console readers receive the latest cgroup observation through the
existing renewal path, with a 30-second freshness limit. Compute uses the dated
October 22, 2026 Linux/x86 us-east-1 On-Demand rates: approximately USD 0.19748/hour
for four vCPUs/eight GiB and USD 0.39496/hour for eight vCPUs/sixteen GiB. Estimates
exclude transfer, IPv4, logs, extra storage, provider subscriptions, taxes and
discounts. See [the diagnostics contract](../engineering/event-broadcast-resources.md)
for source rates, provenance, failure behavior and the pending final-image proof.

## October 24 Task 9 rollout readiness

Source plumbing is available; actual whole-flow acceptance remains open. Backend
CI explicitly runs the separate `migration-admission-blocked` scope while the
production measured allocation map is empty. It proves actual local historical
migration, the exact production admission rejection, unchanged admission state,
no session/start-command writes and owned cleanup. This bounded pass supplies no
positive protocol lifecycle or capacity-readiness acceptance. The default `run`
mode still requires whole-flow admission and lifecycle success. Run the
[isolated migration rehearsal](../engineering/event-broadcast-rehearsal.md#october-24-2026-task-9-source-prerequisites)
after accepted capacity receipts populate the measured map. Its internal fixture
module and manifest require canonical Convex generation. Never populate admission
from historical fixture inserts or in-memory test allocations.

Hold starts and confirm all provider tasks stopped before deploying protocol 2 or
running the production whole-table backfill. Preserve account grants, credential
definitions, emergency SSM state, fenced-v1 dispatcher lifecycle and concurrency
cap. Each migration page checks open sessions and unconfirmed provider ownership.
New settings apply to the next session; do not restart or resize an on-air worker.
The DB rehearsal proves authority denial, while final-image evidence must prove
actual sender-process cessation. Deployment stays blocked until those distinct
gates and the remaining provider/browser evidence are accepted.
