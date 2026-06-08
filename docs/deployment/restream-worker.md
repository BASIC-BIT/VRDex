# Hosted Restream Worker Benchmark

## Status

Current recommendation: use this as a checked-in benchmark foundation only. Hosted output stays disabled until the `1080p60` media proof and AWS capacity benchmark both pass.

The implementation surface is split between:

- `workers/restream/`: container entrypoint, Dockerfile, and benchmark profile
- `infra/terraform/restream-worker/`: ECR, ECS/Fargate task shape, logs, roles, secret references, and kill-switch foundation

## AWS Shape

The first hosted worker path runs one ECS task per event media session. Viewer delivery should stay behind VRCDN or another destination provider; worker count scales with concurrent event programs, not viewers.

The Terraform stack defines:

- ECR repository with immutable tags, scan-on-push, AES-256 encryption, and a lifecycle policy
- ECS cluster with Container Insights enabled by default
- Fargate task definition using Linux `X86_64`, `awsvpc`, `4096` CPU units, `8192` MiB memory, and `40` GiB ephemeral storage
- CloudWatch log group with 14-day default retention
- execution role for image pulls, logs, and referenced Secrets Manager or SSM secret reads
- task role for CloudWatch custom metrics and the SSM kill switch
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
- `CONVEX_URL`

Secret values are not environment variables in git or Terraform. The `secret_arns` map supplies ECS secret references by container environment name. Use scoped, event/output-specific references for VRCDN or external RTMP credentials.

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

The checked-in entrypoint validates the kill-switch parameter name but does not call AWS SSM yet. Before any media work runs from this container, add the SSM read, control-plane lease, and max-duration enforcement that turn these hooks into runtime gates.

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
```

No AWS CLI mutation, Terraform apply, image publish, or ECS task run is part of this validation.
