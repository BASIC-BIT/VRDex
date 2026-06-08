# Restream Worker Terraform

This stack defines the hosted restream worker benchmark foundation. It is not auto-applied by CI and should not be applied until a human approves an AWS benchmark run.

It creates or imports future resources for:

- ECR repository for `workers/restream/Dockerfile`
- ECS cluster for one task per event media session
- Fargate task definition for the `1080p60` benchmark gate
- CloudWatch log group with bounded retention
- private S3 bucket for synthetic benchmark HLS/report artifacts
- ECS execution role with optional secret-reference reads
- ECS task role for CloudWatch metrics, the SSM kill switch, and benchmark artifact uploads
- SSM kill-switch parameter, defaulting disabled
- ECR lifecycle policy for large media-worker images

## Safety Boundary

This stack stores only references and non-secret guardrails. Do not store stream keys, ingest URLs, output credentials, Convex deploy keys, provider tokens, or signed URLs in Terraform variables, docs, logs, or state.

The artifact bucket is private, blocks public access, uses AES-256 server-side encryption, and expires synthetic benchmark artifacts after `artifact_retention_days`.

The current GitHub Terraform workflow validates this stack but does not plan or apply it. Enabling provider-backed plans or applies is a separate human-approved infrastructure step.

## Local Validation

From this directory:

```powershell
terraform init -backend=false
terraform validate
```

Run `terraform fmt -check -recursive infra/terraform` from the repository root before committing changes.

## Benchmark Defaults

The first Fargate shape is intentionally conservative for CPU-only `1080p60` evidence:

- task CPU: `4096`
- task memory: `8192` MiB
- ephemeral storage: `40` GiB
- max concurrent workers: `10`
- max session duration: `43200` seconds
- quality gate: `1080p60`
- synthetic-only media generation: `true`
- artifact retention: `7` days

ECS on EC2 with GPU/NVENC remains a measured fallback if Fargate misses real-time encode, transition quality, bitrate stability, or cost headroom.
