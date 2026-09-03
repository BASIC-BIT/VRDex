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

## Authentication session health

Terraform declares the `Authentication session health` dashboard and six
insights for restore outcomes, latency buckets, slow restores,
authenticated-to-anonymous transition intent, deployment category, and
browser family. These are aggregate health views; they must not include
tokens, user/account/session identifiers, emails, redirect URLs, or route
slugs.

This repository change does not import, plan, or apply production PostHog
state. An owner must run the documented import/plan/apply workflow after the
application event deployment is live. Treat the first 14 complete production
days as the baseline. Owner action: on 2026-08-10, or 14 complete days after
production deployment if later, record daily sample volume, authenticated
restore failure share, slow-restore share, and challenge completion share.
Review the proposed hard-liveness warning of at least three slow restores in
15 minutes only when at least ten restores completed in that window, then
activate or revise it from the observed baseline. Alert resources are not
activated by this PR.

If the provider cannot manage a desired PostHog alert, dashboard, or insight,
record the exact manual configuration and its URL in the owner follow-up
instead of silently introducing configuration drift.

## Claim adoption and verification

Terraform declares the `Claim adoption and verification` dashboard with one
journey funnel and one authoritative terminal-outcome view. The funnel groups
by an opaque random journey UUID. Events do
not contain user IDs, profile IDs or slugs, provider IDs, target IDs, proof
codes, evidence, raw errors, email addresses, or credentials.

The browser emits view, selection, and submission milestones. Convex emits
attempt creation, first verification check, and terminal resolution through a
durable deduplicated outbox. Listing coverage is not claimant conversion:
claimed seeded listings divided by all seeded listings belongs in inventory
reporting, not this adoption funnel.

Applying this stack creates dashboard metadata only. It does not send a claim
event or mutate a claim. After the application deployment, apply the stack with
a reviewed plan and reconcile a consented canary journey before treating the
dashboard as operational evidence.

## State Backend

Terraform state for this stack is stored in the S3 backend declared in `versions.tf`:

- bucket: `vrdex-terraform-state`
- key: `posthog/terraform.tfstate`
- region: `us-east-1`
- locking: S3 native lockfile (`use_lockfile = true`)
