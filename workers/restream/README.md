# Restream Worker Packaging

## Status

Current recommendation: this is a hosted-worker packaging and benchmark scaffold, not a production media worker.

The container shape is intentionally small so ECS/Fargate infrastructure can be validated before VRDex claims hosted restreaming. It installs FFmpeg and AWS CLI, runs a Node entrypoint, refuses to start unless the non-secret benchmark contract is present, and writes a synthetic `1080p60` HLS artifact plus HTML/JSON reports.

## Build Shape

The intended image build context is the repository root:

```powershell
docker build -f workers/restream/Dockerfile -t vrdex-restream-worker:local .
```

The image must be published to the ECR repository defined by `infra/terraform/restream-worker` only after local media-pipeline evidence exists. Do not publish images or run ECS tasks from this scaffold without explicit operator approval.

## Runtime Configuration

The ECS task definition injects non-secret environment values and secret references. Secret values belong in AWS Secrets Manager or the equivalent provider secret store, never in git, Terraform variables, logs, or Convex event records.

Expected non-secret values:

- `VRDEX_RESTREAM_QUALITY_GATE=1080p60`
- `VRDEX_RESTREAM_BENCHMARK_MODE`
- `VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS`
- `VRDEX_RESTREAM_MAX_SESSION_SECONDS`
- `VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER`
- `VRDEX_RESTREAM_SECRET_REF_NAMES`
- `CONVEX_URL`

Expected secret-reference names are supplied by Terraform through the `secret_arns` map. The worker treats those names as operationally sensitive and logs only their count. Synthetic benchmark runs use `VRDEX_RESTREAM_SYNTHETIC_ONLY=true`, so they can prove the media pipeline without provider credentials. Non-synthetic runs must use event-scoped output credential references, not raw ingest URLs or stream keys in plain environment variables.

Useful local proof command:

```powershell
pnpm proof:restream:worker
```

That command writes a playable artifact tree under `artifacts/restream-worker-benchmark/` with `program.mp4`, `hls/program.m3u8`, transition frames, `benchmark-report.json`, and `report.html`. Open `report.html` through a local static server to watch the embedded `program.mp4` preview in the browser.

## Benchmark Gate

The benchmark profile in `benchmark-profile.1080p60.json` records the first hosted acceptance target:

- `1920x1080`
- `60 fps`
- H.264 `yuv420p`
- AAC-LC stereo at `48kHz`
- 1-second keyframe interval
- `3500`, `5000`, and `5800` Kbps video bitrate cases
- 10 concurrent workers for capacity evidence
- 12-hour maximum session cap

ECS on EC2 with GPU/NVENC stays a measured fallback. Do not promote GPU-backed hosting until Fargate CPU evidence fails the target or cost headroom.

## Artifact Uploads

If `VRDEX_RESTREAM_ARTIFACT_S3_URI` is set, the worker runs `aws s3 sync` after local artifact generation. Terraform sets this to the private benchmark artifact bucket prefix for ECS tasks. Do not make this bucket public; inspect artifacts through authenticated S3 access or short-lived presigned URLs only.
