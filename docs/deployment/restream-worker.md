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

The stack does not define an ECS service. Scheduled or operator-triggered runs should start one task per approved event media session after the control-plane lease and benchmark gates exist.

## Runtime Guardrails

The task definition injects these non-secret values, and the current entrypoint refuses to start unless they are present and syntactically valid:

- `VRDEX_RESTREAM_QUALITY_GATE=1080p60`
- `VRDEX_RESTREAM_BENCHMARK_MODE=ecs-fargate`
- `VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS=10`
- `VRDEX_RESTREAM_MAX_SESSION_SECONDS=43200`
- `VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER=/vrdex/restream/hosted-worker/enabled`
- `VRDEX_RESTREAM_SECRET_REF_NAMES`
- `VRDEX_RESTREAM_SYNTHETIC_VARIANT=static-transition`
- `VRDEX_RESTREAM_TRANSITION_FADE_MS=500`
- `VRDEX_RESTREAM_HOLD_SLATE_AUDIO_DELAY_MS=750`
- `CONVEX_URL`

Secret values are not environment variables in git or Terraform. The `secret_arns` map supplies ECS secret references by container environment name. Synthetic benchmark tasks set `VRDEX_RESTREAM_SYNTHETIC_ONLY=true`, so they can produce media evidence without provider credentials. Use scoped, event/output-specific references for any non-synthetic VRCDN or external RTMP credential.

## Visible Benchmark Output

The worker benchmark entrypoint generates a synthetic 12-second `1080p60` program with source, hold-slate, and source-switch transitions. The default `static-transition` variant generates the hold slate once as static artwork, then loops it through the timed fade section to keep the benchmark focused on the live encode path. The `live-control` variant starts FFmpeg once and drives the same source/hold/source sequence through runtime filter commands. It also gates on near real-time pace and timed frame classification so wall-clock source commands cannot silently drift earlier in the output timeline. A successful run writes:

- `program.mp4`, embedded in `report.html` for browser playback
- `hls/program.m3u8` and HLS `.ts` segments
- transition frames for `source-a`, `hold-slate`, and `source-b`
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

Convex remains the authoritative control plane for event media session state, command outcomes, heartbeats, and audit events.

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
```

No AWS CLI mutation, Terraform apply, image publish, or ECS task run is part of this validation.
