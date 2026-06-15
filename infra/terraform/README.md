# Terraform Stacks

VRDex keeps small infrastructure stacks separate so credentials, blast radius, and apply cadence stay clear.

- `state-mgmt/`: local-state bootstrap stack for the shared S3 Terraform state bucket.
- `ses/`: AWS SES sender identity and least-privilege Convex email credentials.
- `posthog/`: hosted PostHog project metadata for product analytics.
- `vercel/`: Vercel project environment variables for the hosted web app.
- `docs-site/`: Vercel docs project/domain and Route 53 DNS for `docs.vrdex.net`.
- `web-domains/`: Vercel web project-domain bindings and Route 53 DNS for `vrdex.net` and `www.vrdex.net`.
- `restream-worker/`: validation-only hosted restream worker benchmark foundation for ECR, ECS/Fargate, logs, roles, secret references, and the disabled kill switch.

Each non-bootstrap stack uses the shared S3 state bucket `vrdex-terraform-state` with a stack-specific state key and S3 native locking. `state-mgmt/` intentionally uses local state because it manages that bucket. Do not commit `terraform.tfvars`, local state, plans, or provider directories.

## CI/CD

`.github/workflows/terraform.yml` is the canonical CI/CD path for Terraform:

- pull requests touching `infra/terraform/**` or the Terraform workflow run `terraform fmt`, stack init, and `terraform validate`
- provider-backed plans run when the required repository settings are configured
- after `Baseline Checks` succeeds on `main`, provider-backed stacks marked for auto-apply plan and apply from CI
- `workflow_dispatch` can run one stack or all stacks, with optional apply, for manual infra operations

Required CI settings by provider:

| Setting | Type | Used by |
| --- | --- | --- |
| `AWS_TERRAFORM_ROLE_ARN` | repository variable or secret | all S3-backed stacks: `docs-site`, `ses`, `posthog`, `vercel` |
| `VERCEL_TOKEN` or `VERCEL_API_TOKEN` | repository secret | `docs-site`, `vercel` |
| `POSTHOG_API_KEY` | repository secret | `posthog` |
| `TERRAFORM_POSTHOG_PUBLIC_KEY` | repository secret | `vercel` |
| `TERRAFORM_SES_DOMAIN_NAME` | repository variable | `ses` |
| `TERRAFORM_SES_FROM_EMAIL` | optional repository variable | `ses` |
| `TERRAFORM_ROUTE53_ZONE_ID` | optional repository variable | `docs-site`, `ses` |

`state-mgmt/` is validation-only in CI because it intentionally uses local bootstrap state and owns the GitHub Actions AWS role used by the provider-backed stacks. Apply it manually when changing the shared state bucket or Terraform CI role, then store `terraform output -raw github_actions_terraform_role_arn` in GitHub variable `AWS_TERRAFORM_ROLE_ARN`.

## Stack Boundaries

The stack count is intentional, but should stay small:

- keep `state-mgmt/` separate because a stack cannot safely use the backend it creates
- keep `vercel/` separate from `docs-site/` because `vercel/` requires the hosted PostHog client key while docs DNS should not depend on analytics secrets
- keep `ses/` separate because it can create IAM access-key material and has a different blast radius from Vercel/PostHog metadata
- keep `restream-worker/` validation-only until the local `1080p60` media proof and a human-approved AWS benchmark window exist
- combine future stacks only when they share provider credentials, state ownership, and apply cadence without widening secret exposure

Current hosted-vs-self-hosted ownership guidance lives in `docs/developers/self-hosting-and-iac.md`. The first AWS service baseline, including SES and the planned private S3 asset-storage follow-up, lives in `docs/deployment/aws-baseline.md`.
