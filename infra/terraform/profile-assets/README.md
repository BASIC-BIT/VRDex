# Profile Assets Terraform

This stack provisions private S3-backed profile media-kit storage and the Vercel runtime configuration needed by `apps/web`.

It creates:

- separate private production and hosted staging S3 buckets for profile assets under `profile-assets/`
- S3 Block Public Access
- S3 Object Ownership with ACLs disabled through `BucketOwnerEnforced`
- default SSE-S3 bucket encryption
- an S3 bucket policy that denies non-TLS requests
- a Vercel OIDC identity provider in AWS IAM
- separate least-privilege IAM roles for production and staging Vercel functions
- Vercel environment variables for production and the hosted staging custom environment

## Managed Environment Variables

- `VRDEX_PROFILE_ASSET_BUCKET`
- `VRDEX_PROFILE_ASSET_REGION`
- `VRDEX_PROFILE_ASSET_ROLE_ARN`

The role ARN is not a secret, but it is stored as a sensitive Vercel environment variable so hosted runtime configuration stays consistently masked.

Production keeps the existing bucket and IAM resource addresses. The production
role trusts only the Vercel `production` subject. The staging role trusts only
`staging`, and its S3 policy is limited to the separate staging bucket. The
existing staging custom environment variable resources are updated in place to
point to that bucket and role. Staging's CORS defaults to `staging.vrdex.net`
and `*.vercel.app`. The production CORS defaults no longer include
`staging.vrdex.net`.

## Destination thumbnail cache

Profile link artwork reuses this private bucket and runtime role under
`profile-assets/destination-thumbnails/`. Each source-bound cache object contains
a sanitized static thumbnail and fetch timestamps. Daily refreshes retain the
last successful thumbnail during temporary provider failures, with hourly retry
delays. The route checks the exact profile's current public link before reading
the cache. These objects use `private, no-store` storage headers and expire after
90 inactive days through a narrowly scoped lifecycle rule. No additional provider
credentials or environment variables are required for artwork delivery.

## Bootstrap Gate

Provider-backed CI plan/apply for this stack is gated by repository variable `TERRAFORM_PROFILE_ASSETS_ENABLED=true`.

The required `direct_upload_site_origin` input adds the deployment's canonical HTTPS origin to S3 CORS. BASIC BIT CI reads `TERRAFORM_PROFILE_ASSETS_SITE_ORIGIN`, defaulting to `https://vrdex.net`; self-hosted deployments must provide their own origin.

CI reads `TERRAFORM_PROFILE_ASSETS_STAGING_SITE_ORIGIN` for staging bucket CORS, defaulting to `https://staging.vrdex.net`. Set it to the staging site's HTTPS origin when hosting staging under another domain.

Hosted staging custom environments are opt-in. Set repository variable `TERRAFORM_PROFILE_ASSETS_STAGING_CUSTOM_ENVIRONMENT_IDS` to an HCL list such as `["env_..."]` when CI should manage staging profile asset env vars.

The hosted BASIC BIT Vercel OIDC claims use the team slug `basicbit`. Do not
substitute the display name or an older hyphenated slug when configuring
`vercel_team_slug`; the issuer path, audience, and `sub` conditions must match
the claims Vercel presents at runtime.

Before enabling that gate, apply `infra/terraform/state-mgmt` so the GitHub Actions Terraform role can manage this stack's S3, IAM, and Vercel OIDC resources.

## Usage

1. Apply the updated `infra/terraform/state-mgmt` bootstrap stack from a trusted local operator machine.
2. Set GitHub repository variable `TERRAFORM_PROFILE_ASSETS_SITE_ORIGIN` to the deployment's canonical HTTPS origin.
3. Set GitHub repository variable `TERRAFORM_PROFILE_ASSETS_STAGING_SITE_ORIGIN` if the staging site uses another domain. Set `TERRAFORM_PROFILE_ASSETS_STAGING_CUSTOM_ENVIRONMENT_IDS` if hosted staging env vars should be managed.
4. Set GitHub repository variable `TERRAFORM_PROFILE_ASSETS_ENABLED=true`.
5. Run the Terraform workflow for stack `profile-assets` with `apply=true`, or let the next successful `main` baseline apply it.
6. Redeploy staging immediately after apply so its functions receive the new bucket and role. The production role's narrowed trust takes effect during apply, so existing staging deployments may briefly fail S3 requests until the staging redeploy is serving traffic. Keep the staging upload and contribution flags off during this interval.
7. Redeploy production if its environment values changed, then probe `/api/v0/profile-assets/upload-intents/probe` on both hosted environments and verify each uses its own bucket before staging uploads.

The probe is anonymous, but the standard public API rate limit and bearer-query
rejection still apply. Use it for bounded deployment checks rather than a tight
polling loop.

The Terraform workflow allows Terraform to create a missing Vercel OIDC
provider, but blocks `profile-assets` applies when the GitHub Actions Terraform
role cannot inspect a preexisting provider. Apply `infra/terraform/state-mgmt`
locally first, and import any preexisting provider into this stack's remote
state before rerunning apply.

## State Backend

Terraform state for this stack is stored in the S3 backend declared in `versions.tf`:

- bucket: `vrdex-terraform-state`
- key: `profile-assets/terraform.tfstate`
- region: `us-east-1`
- locking: S3 native lockfile (`use_lockfile = true`)

## Import Notes

If the Vercel OIDC provider or runtime role already exists in AWS, import it before planning rather than creating duplicates.

If Terraform state still tracks an older Vercel OIDC provider slug, migrate or
import the existing `basicbit` provider before applying this stack. The runtime
role trust policy must reference the same provider ARN used by the production
Vercel project.

If any managed Vercel variable already exists, import it before applying. The Vercel provider import ID is:

```text
<team_id>/<project_id>/<environment_variable_id>
```
