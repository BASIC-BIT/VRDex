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

## Controlled event runtime (disabled pending acceptance)

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
| `VRDEX_EVENT_BROADCAST_SILENCE_CALIBRATED` | Convex deployment-only gate; defaults off |

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

`events.configureEventBroadcastPolicy` uses the existing media capability and
accepts bounded `maxOverrunMs` and optional calibrated `silence`. Silence is rejected
unless the deployment gate is on, and refresh removes it when that gate turns off.
Changing its threshold requires restarting a session to create matching decoder
analysis; it remains disabled for a mismatched active decoder. Quiet-intro,
breakdown, and actual-ending calibration evidence is still required.

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

The event CLI's supported local profile is **720p30**, H.264/yuv420p, 1800 kbps
CBR video, zero B-frames, AAC stereo 160 kbps at 48 kHz. VRCDN uses a one-second
GOP; `twitch-conservative-720p30` uses a two-second GOP. The renderer uses CBR
filler even on hold frames. Explicit VRCDN setup settings must match that profile
or the worker reports `invalid_setup`; omitted settings use the profile. Existing
renderer benchmark profiles remain available to proofs, but the event CLI does
not advertise 1080p or 60 fps acceptance. This conservative Twitch profile is an
engineering choice below the current official 3000 kbps 720p30 example, not a
claim of provider approval. The official Broadcasting Guidelines were verified
in a real browser on October 20, 2026: 25/30 fps, two-second keyframes, AAC-LC
96 kbps compatibility recommendation and 160 kbps maximum. Live ingest and
playback acceptance remain unverified; see [integration evidence](../engineering/event-broadcast-verification.md). VRCDN's combined bitrate limit is
not precisely documented; this profile reserves substantial headroom. The existing
low-latency x264 tune still requires actual AVPro playback verification.

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
These bounded controller checks complement the prior sustained media evidence;
they do not claim a new two-hour run of the changed controller. See
[event broadcast verification](../engineering/event-broadcast-verification.md).

### Event operator controls

Event editors link to `/<community>/events/<event>/operate`. The server checks
an authenticated operations query and the exact event path before rendering
private status. Staff with `view_event_operations` or `manage_events` can read
the panel with mutation controls disabled; `manage_event_media` grants control.
Public hosts use the `host` route. Mutations recheck capabilities.

Controls submit sequenced commands. Requested source and queued/claimed command
states remain separate from worker-observed source, mode, lease and destination
health. Pending Next commands are coalesced by the backend; Stop requires an
explicit confirmation and remains available during a pending switch. An expired
lease or destination observation older than 15 seconds displays unknown health.
The explicit session runtime deadline is displayed independently of calendar end.

Configure outputs through existing account setup while stopped, then select the
primary output and start. The stopped-only Twitch setup disclosure selects a
deployment-configured account and explicitly opts into simulcast through
`configureTwitchOutput`. Only account key/channel reach the selector, and malformed
optional account configuration does not hide primary status or Stop. The view
displays independent destination health. The
runtime supports the conservative 720p30 profile documented above. The policy
control sets or removes maximum overrun while stopped. Silence handoff stays
behind the deployment calibration gate; this interface does not enable it.

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
