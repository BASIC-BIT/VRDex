# Hosted Restream Worker Benchmark

## Status

Current recommendation: use this as a checked-in benchmark foundation only. Hosted output stays disabled until the `1080p60` media proof and AWS capacity benchmark both pass.

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

The stack does not define an ECS service. Scheduled or operator-triggered runs start one task per approved event media session through the operator bridge in `scripts/event-media-ecs-bridge.mjs`.

## Runtime Guardrails

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

Current recommendation: run `pnpm ops:event-media:ecs-bridge` from an operator-controlled environment with AWS credentials that can register task definitions, run tasks, describe tasks, stop tasks, and deregister the bridge-created task definitions. The bridge polls Convex for queued `start_program` and `stop_program` commands, starts or stops one Fargate task, then records task status back into Convex for the private event editor.

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
- `VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON`, a JSON object that maps Convex output-account credential references to AWS Secrets Manager or SSM parameter ARNs

Optional bridge configuration includes `VRDEX_EVENT_MEDIA_BRIDGE_WORKER_ID`, `VRDEX_EVENT_MEDIA_ECS_CONTAINER`, `VRDEX_EVENT_MEDIA_ECS_COMMAND_JSON`, `VRDEX_EVENT_MEDIA_ECS_CPU`, `VRDEX_EVENT_MEDIA_ECS_MEMORY`, `VRDEX_EVENT_MEDIA_ECS_EPHEMERAL_STORAGE_GIB`, `VRDEX_EVENT_MEDIA_ECS_ASSIGN_PUBLIC_IP`, `VRDEX_EVENT_MEDIA_ECS_LOG_STREAM_PREFIX`, `VRDEX_EVENT_MEDIA_ECS_BASE_ENV_JSON`, `VRDEX_EVENT_MEDIA_OUTPUT_SECRET_ENV`, and `VRDEX_EVENT_MEDIA_BRIDGE_POLL_MS`. Use `VRDEX_EVENT_MEDIA_ECS_COMMAND_JSON` when the selected image needs a command override, for example `["node","workers/restream/vrcdn-poc.mjs"]` for the VRCDN POC entrypoint.

Use `VRDEX_EVENT_MEDIA_ECS_BRIDGE_CONFIG_CHECK_ONLY=true` for a local configuration parse check that does not call Convex or AWS. Use `--once` when running the bridge from a scheduler or smoke test; omit it for a long-running operator loop.

Do not put stream keys, combined ingest URLs, provider tokens, signed URLs, or secret JSON in the bridge environment except through ECS secret references. `VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON` contains only references to secret store records, not secret values.

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

Current recommendation: prepare a three-account VRCDN test harness before running non-synthetic output. Two accounts act as source feeds and one account acts as the watched output target.

Required operator-provided inputs for the first full POC:

- source A public playback link
- source B public playback link
- output public watch link
- secret reference for source A synthetic-pusher ingest credentials
- secret reference for source B synthetic-pusher ingest credentials
- secret reference for output ingest credentials

Do not paste stream keys, ingest URLs with embedded keys, provider tokens, signed URLs, or account passwords into chat, docs, git, Terraform variables, Convex event records, or logs. Store secret values only in Secrets Manager or the approved secret store, then pass reference names through Terraform or the control plane. The POC should first push local synthetic audio/video into source A and source B, restream the public playback links through the worker, push to the output account, and watch the output account's public playback page or HLS URL for validation.

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

Next provider test should move to the full three-account source A/source B/output POC when another source account is available. Confirm the panel preview during the live task window and keep using stored secret references instead of pasting secret values into chat or docs.

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

Convex remains the authoritative control plane for event media session state, command outcomes, heartbeats, task status, private artifact links, and audit events. The current backend schedule defaults start workers at `T-5 minutes` and requires readiness by `T-2 minutes`; artifact links stored in Convex must be private `s3://` URIs or HTTPS URLs without embedded credentials or query strings. The authenticated event editor shows the private worker status and artifact links for operators; public event pages only see ready or active playback links.

## Budget And Kill Switch

Current recommendation: require all three controls before hosted benchmarking beyond a single manually observed task:

- max concurrent workers, default `10`
- max session duration, default `12` hours
- SSM kill switch, default disabled

Before production testing, add provider-backed budget alerts for expected worker-hour and egress spend. The current Terraform foundation records the resource tags and guardrails needed for that follow-up, but it intentionally does not auto-apply budget resources from CI.

The checked-in entrypoint validates the kill-switch parameter name but does not call AWS SSM yet. Synthetic benchmark runs are allowed through this scaffold; before any non-synthetic media work runs from this container, add the SSM read, control-plane lease, and max-duration enforcement that turn these hooks into runtime gates.

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
