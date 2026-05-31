# Vercel Web Terraform

This stack manages Vercel project environment variables for the hosted VRDex web app.

It currently creates PostHog analytics variables for the existing Vercel project:

- project: `vr-dex-web`
- team: `team_GoHh5xUc96fAIAqJoG55A71S`
- PostHog project: `447783` (`VRDex Analytics`)
- PostHog ingestion host: `https://us.i.posthog.com`

## Managed Environment Variables

- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_HOST`

The PostHog project key is client-exposed once deployed, but keep the value out of git so forks and self-hosted installs do not accidentally send analytics into the BASIC BIT project.

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Set `posthog_public_key` from the PostHog project settings for project `447783` or from the sensitive `infra/terraform/posthog` output `posthog_project_api_token`.
3. If managing the Vercel `staging` custom environment, add its custom environment ID to `staging_custom_environment_ids`.
4. Export a Vercel token for Terraform: `VERCEL_API_TOKEN=<token>`. If reusing the GitHub secret value locally, set `VERCEL_API_TOKEN` to the same value as `VERCEL_TOKEN`.
5. Run `terraform init`.
6. Run `terraform plan` and review Vercel environment variable changes.
7. Apply only after confirming the target project and environment scopes.

## State Backend

Terraform state for this stack is stored in the S3 backend declared in `versions.tf`:

- bucket: `vrdex-terraform-state`
- key: `vercel/terraform.tfstate`
- region: `us-east-1`
- locking: S3 native lockfile (`use_lockfile = true`)

## Existing Variables

If any managed variable already exists in Vercel, import it before applying rather than creating a duplicate. The Vercel provider import ID is:

```text
<team_id>/<project_id>/<environment_variable_id>
```

Find the Vercel environment variable ID in the dashboard network tab or through the Vercel API.
