# Terraform Stacks

VRDex keeps small infrastructure stacks separate so credentials, blast radius, and apply cadence stay clear.

- `state-mgmt/`: local-state bootstrap stack for the shared S3 Terraform state bucket.
- `ses/`: AWS SES sender identity and least-privilege Convex email credentials.
- `posthog/`: hosted PostHog project metadata for product analytics.
- `vercel/`: Vercel project environment variables for the hosted web app.
- `rate-limit-redis/`: Upstash Redis database and Vercel runtime env vars for hosted API/MCP rate-limit counters.
- `profile-assets/`: private S3 profile media-kit asset bucket, Vercel OIDC runtime role, and hosted web env vars for profile asset storage.
- `docs-site/`: Vercel docs project/domain and Route 53 DNS for `docs.vrdex.net`.
- `web-domains/`: Vercel web project-domain bindings and Route 53 DNS for `vrdex.net` and `www.vrdex.net`.
- `restream-worker/`: validation-only hosted restream worker benchmark foundation for ECR, ECS/Fargate, logs, roles, secret references, and the disabled kill switch.
- `group-telemetry-collector/`: validation-only account-scoped collector fleet foundation with one-secret isolation, bounded compute, startup gate, logs, task-health alarms, and an optional tagged cost budget.

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
| `AWS_TERRAFORM_ROLE_ARN` | repository variable or secret | all S3-backed stacks: `docs-site`, `ses`, `posthog`, `vercel`, `rate-limit-redis`, `profile-assets` |
| `VERCEL_TOKEN` or `VERCEL_API_TOKEN` | repository secret | `docs-site`, `vercel`, `rate-limit-redis`, `profile-assets` |
| `POSTHOG_API_KEY` | repository secret | `posthog` |
| `TERRAFORM_POSTHOG_PUBLIC_KEY` | repository secret | `vercel` |
| `TERRAFORM_UPSTASH_EMAIL` | repository variable or secret | `rate-limit-redis` |
| `TERRAFORM_UPSTASH_API_KEY` or `UPSTASH_API_KEY` | repository secret | `rate-limit-redis` |
| `TERRAFORM_RATE_LIMIT_STAGING_CUSTOM_ENVIRONMENT_IDS` | optional repository variable | `rate-limit-redis`; HCL list of Vercel custom environment IDs, for example `["env_..."]` |
| `TERRAFORM_RATE_LIMIT_MANAGE_PREVIEW_ENVIRONMENT=true` | optional repository variable | `rate-limit-redis`; opt default PR previews into the shared hosted Redis store |
| `TERRAFORM_SES_DOMAIN_NAME` | repository variable | `ses` |
| `TERRAFORM_SES_FROM_EMAIL` | optional repository variable | `ses` |
| `TERRAFORM_ROUTE53_ZONE_ID` | optional repository variable | `docs-site`, `ses` |
| `TERRAFORM_PROFILE_ASSETS_ENABLED=true` | repository variable | `profile-assets` after `state-mgmt` has been applied with profile asset permissions |
| `TERRAFORM_PROFILE_ASSETS_STAGING_CUSTOM_ENVIRONMENT_IDS` | optional repository variable | `profile-assets`; HCL list of Vercel custom environment IDs, for example `["env_..."]` |
| `TERRAFORM_PROFILE_ASSETS_VERCEL_TEAM_SLUG` | optional repository variable | `profile-assets`; defaults to `basicbit` for the hosted Vercel OIDC provider guard |

`state-mgmt/` is validation-only in CI because it intentionally uses local bootstrap state and owns the GitHub Actions AWS role used by the provider-backed stacks. Apply it manually when changing the shared state bucket or Terraform CI role, then store `terraform output -raw github_actions_terraform_role_arn` in GitHub variable `AWS_TERRAFORM_ROLE_ARN`.

The `profile-assets` apply path checks whether a preexisting Vercel OIDC
provider is readable before planning an apply. A missing provider is allowed so
Terraform can create it on first run. If the guard fails for any other reason,
apply `state-mgmt/` locally from a trusted operator machine and import any
preexisting OIDC provider into the `profile-assets` remote state before
rerunning the stack.

## Stack Boundaries

The stack count is intentional, but should stay small:

- keep `state-mgmt/` separate because a stack cannot safely use the backend it creates
- keep `vercel/` separate from `docs-site/` because `vercel/` requires the hosted PostHog client key while docs DNS should not depend on analytics secrets
- keep `rate-limit-redis/` separate from `vercel/` because it can create a billable Upstash database and writes runtime secrets derived from that database
- keep `ses/` separate because it can create IAM access-key material and has a different blast radius from Vercel/PostHog metadata
- keep `profile-assets/` separate because it owns an AWS S3 bucket, AWS IAM OIDC role, and the Vercel env vars that expose that role to the web runtime
- keep `restream-worker/` validation-only until the local `1080p60` media proof and a human-approved AWS benchmark window exist
- keep `group-telemetry-collector/` validation-only until the real single-account VRChat provider proof has a documented go or adjust disposition and VRChat explicitly approves durable service-account sessions
- combine future stacks only when they share provider credentials, state ownership, and apply cadence without widening secret exposure

`rate-limit-redis/` is intentionally plan/manual-apply in CI. Creating or
changing the hosted Upstash database affects cost and production rate-limit
posture, so apply it through `workflow_dispatch` after reviewing the plan.

Before the first `rate-limit-redis` apply, a BASIC BIT operator must accept the
Upstash Marketplace terms from their own interactive terminal:

```sh
pnpm dlx vercel@54.4.1 integration accept-terms upstash --scope basicbit
```

Vercel rejects Marketplace term acceptance when it detects an AI agent. Do not
bypass that gate. The command installs the integration only; Terraform remains
the owner of the database resource and Vercel runtime bindings.

### Rate-limit Redis first apply and recovery

The stack also requires these repository settings before it can plan:

- variable `TERRAFORM_UPSTASH_EMAIL`
- secret `TERRAFORM_UPSTASH_API_KEY` or `UPSTASH_API_KEY`
- variable or secret `AWS_TERRAFORM_ROLE_ARN`
- secret `VERCEL_API_TOKEN` or `VERCEL_TOKEN`

After accepting the Marketplace terms, configure the Upstash settings from an
operator terminal without printing their values. Then dispatch the dedicated
stack and request an apply:

```sh
gh workflow run terraform.yml -f stack=rate-limit-redis -f apply=true
```

An explicitly selected stack fails when required settings are missing instead
of reporting a successful skipped plan. Review the plan and apply output before
redeploying the Vercel production environment; Vercel environment changes only
reach new deployments. The Vercel production build rejects a missing or
non-shared rate-limit store before traffic can reach the deployment. The
production smoke then verifies an anonymous `/api/v0/search` request and its
response body. A configured deployment must return `200`, while a missing shared
store remains fail-closed.

Current hosted-vs-self-hosted ownership guidance lives in `docs/developers/self-hosting-and-iac.md`. The first AWS service baseline, including SES and the planned private S3 asset-storage follow-up, lives in `docs/deployment/aws-baseline.md`.
