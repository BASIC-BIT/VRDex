# Group telemetry collector Terraform

This stack provisions one account-scoped ECS/Fargate collector. It defaults disabled and must not be enabled until the single-account provider proof records a `go` or `adjust` disposition.

The session half of that gate was cleared by BASIC on 2026-07-27: durable VRChat service-account sessions for VRDex-owned proof accounts are accepted as a known operating pattern. That is a product-owner risk decision, not VRChat granting VRDex anything — the stop condition in `docs/planning/community-group-telemetry.md` still stands, and if VRChat objects, stop proof traffic and clear the saved session.

It creates an immutable/scanned ECR repository, ECS cluster/task/service, bounded CloudWatch logs and CPU alarm, least-privilege roles, and an SSM infrastructure kill switch. The execution role can read exactly one account secret; the normal task role cannot read Secrets Manager.

## Bootstrap

1. Create one VRDex-owned account. Keep the service disabled until a reviewed vault-to-AWS command can generate `workerApiKey` and provision `authCookie` plus optional `twoFactorAuthCookie` without displaying them. This slice intentionally ships no manual cookie-export path; never store the password or TOTP seed.
2. SHA-256 hash `workerApiKey` locally and register only the lowercase hash plus secret ARN through `communityTelemetry.registerCollectorAccount`.
3. Push an image built from `workers/group-telemetry/Dockerfile` and set `container_image` to its immutable `@sha256:` digest URI. Service enablement fails validation when the digest is absent. After the initial reviewed bootstrap below, `.github/workflows/group-telemetry-release.yml` owns routine image-only releases.
4. Supply HTTPS-egress subnets, ingress-free security groups, the Convex `*.convex.site` origin, registered account ID, and budget alert email.
5. Apply disabled, inspect IAM/task state, then enable one desired task after both provider gates.

## Recovery and cost

- Global stop: enable the Convex fleet kill switch and set desired count zero. The SSM deployment gate prevents disabled task revisions from starting after a restart.
- Account stop: quarantine or enable the account kill switch before reducing ECS count.
- Rotation: replace the one-account secret, update its hash/reference by re-registering, then restart only this service.
- Account loss: mark `auth_required` or `quarantined`, release leases, preserve the coverage gap, then reassign to a healthy account.

At 256 CPU/512 MiB, the initial cost is one small continuous Fargate task plus logs and network egress. Desired count is capped at two until measured evidence supports expansion. An AWS Budget defaults to USD 30/month and alerts at 80% forecasted and 100% actual spend for the activated `Component` cost-allocation tag.

Validate with `terraform init -backend=false` and `terraform validate`.

## Remote state and automation bootstrap

This stack declares the shared S3 backend at
`group-telemetry-collector/terraform.tfstate`. If production was previously
applied from local state, the operator holding that state must run
`terraform init -migrate-state` from a trusted machine and inspect the migrated
state before enabling automation. Never let CI create a second empty state for
an existing fleet.

The first plan after this release is deliberately a reviewed operator plan. It
adds release metadata to the task definition plus CloudWatch metric filters and
alarms for `collector_heartbeat`, `collector_auth_required`,
`collector_control_plane_failure`, and `collector_worker_restart`. The automatic plan policy rejects those
infrastructure additions. Apply them once with the existing production
variables, the exact reviewed image digest and source SHA, then enable the
routine lane.

The release job requires these GitHub settings:

| Setting | Type | Purpose |
| --- | --- | --- |
| `GROUP_TELEMETRY_RELEASE_ENABLED=true` | variable | Explicitly enables both the release and audit jobs. |
| `AWS_GROUP_TELEMETRY_RELEASE_ROLE_ARN` | variable | Main-only OIDC role for ECR upload, exact collector Terraform state, task-definition registration, and update of only the collector ECS service. |
| `AWS_GROUP_TELEMETRY_AUDIT_ROLE_ARN` | variable | Main-only OIDC role with read-only ECR and ECS inspection. |
| `GROUP_TELEMETRY_SUBNET_IDS` | variable | Non-empty JSON list passed to Terraform. |
| `GROUP_TELEMETRY_SECURITY_GROUP_IDS` | variable | Non-empty JSON list passed to Terraform. |
| `GROUP_TELEMETRY_ASSIGN_PUBLIC_IP` | variable | Exact `true` or `false` production run state. |
| `GROUP_TELEMETRY_CONVEX_SITE_URL` | variable | Production Convex HTTP action origin. |
| `GROUP_TELEMETRY_COLLECTOR_ACCOUNT_ID` | variable | Registered production collector account document ID. |
| `GROUP_TELEMETRY_ACCOUNT_SECRET_ARN` | variable | ARN only, never the secret payload. |
| `GROUP_TELEMETRY_BUDGET_ALERT_EMAIL` | variable | Existing AWS Budget recipient. |
| `CONVEX_DEPLOYMENT_PROD` | variable | Explicit production Convex deployment selector. |
| `CONVEX_DEPLOY_KEY_PROD` | secret | Production query authorization used only for the readiness check. |

Provision the two OIDC roles through a separately reviewed IAM bootstrap. The
release role needs read access to refresh this stack, ECR layer upload for only
`vrdex-group-telemetry`, `iam:PassRole` for only the existing collector task and
execution roles, task-definition register/deregister, `ecs:UpdateService` for
only the collector service, and object access only to this stack's state key and
lockfile. The audit role needs no write action. Do not reuse a broad account
deployment role simply to avoid this bootstrap.

For each successful `main` baseline, the release lane runs worker compatibility
tests, reuses or builds the immutable `git-<40-character-sha>` ECR image, creates
a saved production plan, and checks that plan before applying it. Only a task
definition replacement whose differences are the image and three release
metadata values, plus the service's task-definition pointer, is accepted.
Networking, identity, scaling, enablement, budget, alarms, secrets, and every
other infrastructure change fail closed for manual review.

Before apply, the lane records the currently serving task definition. ECS task
definition revisions use `skip_destroy`, so that revision stays runnable. If
Terraform apply, ECS identity/digest verification, or the bounded five-minute
heartbeat convergence gate fails, the workflow restores that revision, waits
for service stability, verifies the restored service pointer, and then fails.
Old inactive revisions are an operator retention concern; the automatic lane
does not deregister rollback artifacts.

The five-minute scheduled audit is read-only. It derives the expected release from the
latest successful `main` Baseline Checks run, then compares that SHA with the
ECR image, exact ECS digest, and the authoritative Convex heartbeat. A mismatch
may converge for fifteen minutes. Persistent drift, stale or missing heartbeat,
missing proof capability, `auth_required`, or any operational-readiness issue
fails the audit.
