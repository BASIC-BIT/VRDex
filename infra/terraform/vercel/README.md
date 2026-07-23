# Vercel Web Terraform

This stack manages shared Vercel project environment variables for the hosted VRDex web app.

It manages shared application variables for the existing Vercel project:

- project: `vr-dex-web`
- team: `team_GoHh5xUc96fAIAqJoG55A71S`
- PostHog project: `447783` (`VRDex Analytics`)
- PostHog ingestion host: `https://us.i.posthog.com`

## Managed Environment Variables

- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_HOST`
- `TEMPORAL_INPUT_HASH_KEY`
- `TWITCH_CLIENT_ID` when both optional Twitch variables are set
- `TWITCH_CLIENT_SECRET` when both optional Twitch variables are set

The PostHog project key is client-exposed once deployed, but keep the value out of git so forks and self-hosted installs do not accidentally send analytics into the BASIC BIT project.

`TEMPORAL_INPUT_HASH_KEY` is a server-only HMAC key used for non-reversible
temporal input hashes and request fingerprints. Generate an independent random
secret of at least 32 characters, store it in the ignored `terraform.tfvars`,
and rotate it by updating that value and applying this stack. Rotation
invalidates outstanding idempotency comparisons but does not expose prior input.

The Twitch values are server-only credentials for an app owned by the VRDex operator. Rotate the secret in the Twitch developer console, update the ignored `terraform.tfvars`, and apply this stack. Omitting either Terraform input leaves both Twitch environment variables unmanaged and the UI simply omits provider-confirmed live state.

Profile asset storage variables are owned by `infra/terraform/profile-assets`, not this stack, because that stack owns the paired S3 bucket and Vercel OIDC runtime role.

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Set `posthog_public_key` from the PostHog project settings for project `447783` or from the sensitive `infra/terraform/posthog` output `posthog_project_api_token`.
3. Generate and set an independent `temporal_input_hash_key` with at least 32 random characters.
4. Optionally set `twitch_client_id` and `twitch_client_secret` from the operator-owned Twitch application.
5. If managing the Vercel `staging` custom environment, add its custom environment ID to `staging_custom_environment_ids`.
6. Export a Vercel token for Terraform: `VERCEL_API_TOKEN=<token>`. If reusing the GitHub secret value locally, set `VERCEL_API_TOKEN` to the same value as `VERCEL_TOKEN`.
7. Run `terraform init`.
8. Run `terraform plan` and review Vercel environment variable changes.
9. Apply only after confirming the target project and environment scopes.

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
