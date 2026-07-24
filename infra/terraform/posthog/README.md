# PostHog Terraform

This stack records the hosted PostHog project used by VRDex product analytics.

- organization: `BASIC BIT LLC`
- organization ID: `019e59b2-c822-0000-8123-12efe322af2d`
- project: `VRDex Analytics`
- project ID: `447783`
- API host: `https://us.posthog.com`

## Usage

The project already exists. Import it before the first apply so Terraform manages the existing project instead of creating a duplicate:

```powershell
$env:POSTHOG_API_KEY="<personal-api-key>"
terraform init
terraform import posthog_project.vrdex 019e59b2-c822-0000-8123-12efe322af2d/447783
terraform plan
```

Do not commit PostHog personal API keys. Use PostHog OAuth/MCP for interactive analytics work and short-lived local `POSTHOG_API_KEY` only when applying this Terraform stack.

The sensitive output `posthog_project_api_token` is the client-exposed project key used by the Vercel stack as `posthog_public_key`. It is not a personal API key, but keep it out of committed defaults so forks and self-hosted installs do not accidentally send analytics into the BASIC BIT project.

## Seed lookup beta

Terraform manages the `seed-lookup-beta` feature flag. It targets authenticated people whose PostHog person property `seed_lookup_beta` is the string `true`.

Convex grants remain the authorization source of truth. The web app mirrors an active backend grant into the PostHog property for product rollout and measurement only; PostHog flag evaluation must never grant backend access.

The PostHog Terraform provider does not currently expose cohort management. An analytic cohort can be created later from the same person property if useful, but it must not sync access back into Convex.

## Temporal parsing beta

Terraform manages the `temporal-parsing-beta` feature flag. It targets people
whose `temporal_parsing_beta` property is the string `true`.

Convex's `use_temporal_parsing_beta` grant remains the authorization source of
truth. The web app mirrors an authorized result into PostHog for UI rollout and
measurement only. Never use PostHog evaluation to grant API or model access.

## Featured discovery

Terraform also manages the `featured-discovery` feature flag. It is inactive
with a zero-percent rollout so the unfinished Featured module stays hidden by
default while remaining available for deliberate product review.

## State Backend

Terraform state for this stack is stored in the S3 backend declared in `versions.tf`:

- bucket: `vrdex-terraform-state`
- key: `posthog/terraform.tfstate`
- region: `us-east-1`
- locking: S3 native lockfile (`use_lockfile = true`)
