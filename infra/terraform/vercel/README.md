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
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` when the matching Clerk pair is set, per environment

The PostHog project key is client-exposed once deployed, but keep the value out of git so forks and self-hosted installs do not accidentally send analytics into the BASIC BIT project.

`TEMPORAL_INPUT_HASH_KEY` is a server-only HMAC key used for non-reversible
temporal input hashes and request fingerprints. Generate 32 independent
cryptographically random bytes and encode them as base64:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Store the result in the ignored `terraform.tfvars`. Rotate it by updating that
value and applying this stack. Rotation invalidates outstanding idempotency
comparisons but does not expose prior input.

The Twitch values are server-only credentials for an app owned by the VRDex operator. Rotate the secret in the Twitch developer console, update the ignored `terraform.tfvars`, and apply this stack. Omitting either Terraform input leaves both Twitch environment variables unmanaged and the UI simply omits provider-confirmed live state.

The Clerk values are the app's authentication credentials, and unlike every other variable here they are **not** one value applied to each target: Clerk instances are per-environment, so `clerk_production_*` carries the live pair and `clerk_preview_*` carries the development instance's test pair, which is reused for preview and the `staging` custom environment. `apps/web/scripts/check-vercel-env.mjs` fails a production build that has no keys or a non-`pk_live_` publishable key, so a wrong-tier value fails loudly rather than authenticating against the wrong instance.

Both pairs default to `null` and manage nothing when unset. These variables already exist in the Vercel dashboard, so supplying them here without importing first will fail with a duplicate — follow the import step under "Existing Variables" before the first apply.

Profile asset storage variables are owned by `infra/terraform/profile-assets`, not this stack, because that stack owns the paired S3 bucket and Vercel OIDC runtime role.

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Set `posthog_public_key` from the PostHog project settings for project `447783` or from the sensitive `infra/terraform/posthog` output `posthog_project_api_token`.
3. Generate and set an independent `temporal_input_hash_key` using the CSPRNG command above.
4. Optionally set `twitch_client_id` and `twitch_client_secret` from the operator-owned Twitch application.
5. Optionally set the Clerk pairs from each instance's API keys page. Import the existing Vercel values first; see "Existing Variables".
6. If managing the Vercel `staging` custom environment, add its custom environment ID to `staging_custom_environment_ids`.
7. Export a Vercel token for Terraform: `VERCEL_API_TOKEN=<token>`. If reusing the GitHub secret value locally, set `VERCEL_API_TOKEN` to the same value as `VERCEL_TOKEN`.
8. Run `terraform init`.
9. Run `terraform plan` and review Vercel environment variable changes.
10. Apply only after confirming the target project and environment scopes.

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
