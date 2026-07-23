# Group telemetry collector Terraform

This stack provisions one account-scoped ECS/Fargate collector. It defaults disabled and must not be enabled until the single-account provider proof records a `go` or `adjust` disposition and VRChat explicitly approves durable service-account sessions.

It creates an immutable/scanned ECR repository, ECS cluster/task/service, bounded CloudWatch logs and CPU alarm, least-privilege roles, and an SSM infrastructure kill switch. The execution role can read exactly one account secret; the normal task role cannot read Secrets Manager.

## Bootstrap

1. Create one VRDex-owned account. Keep the service disabled until VRChat approves hosted sessions and a reviewed vault-to-AWS command can generate `workerApiKey` and provision `authCookie` plus optional `twoFactorAuthCookie` without displaying them. This slice intentionally ships no manual cookie-export path; never store the password or TOTP seed.
2. SHA-256 hash `workerApiKey` locally and register only the lowercase hash plus secret ARN through `communityTelemetry.registerCollectorAccount`.
3. Push an image built from `workers/group-telemetry/Dockerfile` and set `container_image` to its immutable `@sha256:` digest URI. Service enablement fails validation when the digest is absent.
4. Supply HTTPS-egress subnets, ingress-free security groups, the Convex `*.convex.site` origin, registered account ID, and budget alert email.
5. Apply disabled, inspect IAM/task state, then enable one desired task after both provider gates.

## Recovery and cost

- Global stop: enable the Convex fleet kill switch and set desired count zero. The SSM deployment gate prevents disabled task revisions from starting after a restart.
- Account stop: quarantine or enable the account kill switch before reducing ECS count.
- Rotation: replace the one-account secret, update its hash/reference by re-registering, then restart only this service.
- Account loss: mark `auth_required` or `quarantined`, release leases, preserve the coverage gap, then reassign to a healthy account.

At 256 CPU/512 MiB, the initial cost is one small continuous Fargate task plus logs and network egress. Desired count is capped at two until measured evidence supports expansion. An AWS Budget defaults to USD 30/month and alerts at 80% forecasted and 100% actual spend for the activated `Component` cost-allocation tag.

Validate with `terraform init -backend=false` and `terraform validate`.
