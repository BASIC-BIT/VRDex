# Restream Worker Packaging

## Status

Current recommendation: this is a hosted-worker packaging and benchmark scaffold, not a production media worker.

The container shape is intentionally small so ECS/Fargate infrastructure can be validated before VRDex claims hosted restreaming. It installs FFmpeg, runs a Node entrypoint, and refuses to start unless `VRDEX_RESTREAM_QUALITY_GATE=1080p60` is present.

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
- `VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS`
- `VRDEX_RESTREAM_MAX_SESSION_SECONDS`
- `VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER`
- `VRDEX_RESTREAM_SECRET_REF_NAMES`
- `CONVEX_URL`

Expected secret-reference names are supplied by Terraform through the `secret_arns` map. The worker must treat those names as operationally sensitive and must not log them. The first useful hosted benchmark should use an event-scoped output credential reference, not a raw ingest URL or stream key in plain environment variables.

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
