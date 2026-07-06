# Convex Environments

## Locked Decision

VRDex keeps four Convex execution targets separate:

- local development: anonymous local Convex from `pnpm dev:backend:local` or `pnpm verify:backend:local`
- pull request preview testing: branch-specific Convex preview deployments when a Vercel preview must exercise same-branch backend functions
- deployed smoke testing: the shared development Convex deployment
- production release: the production Convex deployment

## Current Deployments

Do not commit deploy keys. Store them in GitHub/hosting secret stores and local ignored env files only.

Current recommendation: define environment variable names and target scopes in docs or IaC first, then set secret values through provider secret stores. Manual Convex dashboard edits should be treated as bootstrap/emergency changes and followed by a reproducibility update here or in automation.

- development cloud URL: `https://scrupulous-corgi-247.convex.cloud`
- production cloud URL: `https://superb-pig-954.convex.cloud`

GitHub Actions secret names:

- `CONVEX_DEPLOY_KEY_PREVIEW`: preview deployment key used by PR Vercel previews that need same-branch backend functions
- `CONVEX_DEPLOY_KEY_DEV`: development deployment key
- `CONVEX_DEPLOY_KEY_PROD`: production deployment key used by the main-branch deploy workflow

Local ignored env names:

- `CONVEX_DEPLOY_KEY_PREVIEW`
- `CONVEX_DEPLOY_KEY_DEV`
- `CONVEX_DEPLOY_KEY_PROD`
- `CONVEX_URL_DEV`
- `CONVEX_URL_PROD`

## Pull Request Preview Backends

Baseline Checks deploys Vercel PR previews after local lint, type, docs,
contract, backend, and visual checks pass. When `CONVEX_DEPLOY_KEY_PREVIEW` is
configured, the Vercel preview job first creates or updates a Convex preview
deployment named for the PR and builds the web app with that preview Convex URL.

The `Hosted MCP Preview Smoke` job always runs `pnpm smoke:mcp-compat` against
the Vercel preview `/mcp` endpoint when the preview URL exists. CI passes that
target through `VRDEX_MCP_SMOKE_URL`; local runs can use
`pnpm smoke:mcp-compat -- --hosted-url <preview-/mcp-url>`. That keeps anonymous
hosted Streamable HTTP, OAuth metadata, and bearer-challenge behavior covered
even before a branch-specific backend is configured. Dynamic Client Registration
is enabled only when `CONVEX_DEPLOY_KEY_PREVIEW` provisions the same-branch
Convex preview backend; otherwise, the job records that DCR was not smoked
against same-branch backend functions.

Use the manual `Hosted MCP Smoke` workflow when DCR/CIMD evidence needs to come
from a staging, production-like, or otherwise Convex-backed target. Pass the
target `/mcp` URL and enable the `dcr` and `cimd` inputs for the hosted OAuth
compatibility gate.

Do not use production deploy keys for PR previews. Preview deployments are for
schema/function compatibility and hosted smoke validation before merge.

## Auth Email Environment

Convex deployments that send password or email verification messages through SES must set:

- `AWS_SES_REGION`
- `AWS_SES_FROM_EMAIL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `VRDEX_APP_NAME` optional display name

The hosted SES baseline is documented in `docs/deployment/ses-auth-email.md` and `docs/deployment/aws-baseline.md`. Store secret values in Convex env, never in git.

## Hosted E2E Helpers

Hosted mutation-backed Playwright runs use only the shared development/staging target. Do not enable these helpers in production.

Development/staging Convex env names:

- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_CONVEX_SECRET`: non-empty sentinel also configured in the hosted app environment
- `VRDEX_ENABLE_E2E_AUTH_HELPERS=true`: optional, only when hosted auth/claim E2E is intentionally enabled
- `VRDEX_ENABLE_E2E_ADAPTER_HELPERS=true`: optional, only when hosted adapter E2E is intentionally enabled
- `SITE_URL=https://staging.vrdex.net`: required by Convex Auth OAuth and email/password redirects back to the hosted web app
- `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET`: staging Discord OAuth application credentials; the Discord redirect URI must include the active staging Convex Auth callback URL
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: staging Google OAuth application credentials; the Google redirect URI must include the active staging Convex Auth callback URL
- `JWT_PRIVATE_KEY`: Convex Auth RS256 private key, generated for the shared development deployment and never printed
- `JWKS`: Convex Auth public key set matching `JWT_PRIVATE_KEY`
- `DISCORD_API_BASE_URL`: optional hosted adapter stub base URL, usually `https://staging.vrdex.net/api/e2e/adapters/discord`
- `DISCORD_BOT_TOKEN`: staging-only adapter token matching the hosted app environment
- `VRCHAT_PROOF_ADAPTER_URL`: optional hosted adapter stub URL, usually `https://staging.vrdex.net/api/e2e/adapters/vrchat-proof`
- `VRCLINKING_PROOF_ADAPTER_URL`: optional hosted adapter stub URL, usually `https://staging.vrdex.net/api/e2e/adapters/vrchat-proof`
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`: staging-only adapter token matching the hosted app environment

The browser-facing token stays in the web host and GitHub Actions as `VRDEX_E2E_BROWSER_TOKEN` / `VRDEX_HOSTED_E2E_BROWSER_TOKEN`; it is not needed by Convex.

The shared development deployment `scrupulous-corgi-247` is the current hosted E2E backend for Vercel `staging`. The `Staging Deploy` GitHub Actions workflow deploys Convex development functions with `CONVEX_DEPLOY_KEY_DEV` before deploying Vercel `staging` and running hosted data-flow health.

Production Convex Auth env names:

- `SITE_URL=https://vrdex.net`: required by Convex Auth OAuth and email/password redirects back to the hosted web app
- `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET`: production Discord OAuth application credentials; the Discord redirect URI must include the active production Convex Auth callback URL
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: production Google OAuth application credentials; the Google redirect URI must include the active production Convex Auth callback URL
- `JWT_PRIVATE_KEY`: Convex Auth RS256 private key, generated for the production deployment and never printed
- `JWKS`: Convex Auth public key set matching `JWT_PRIVATE_KEY`
- `AWS_SES_REGION`, `AWS_SES_FROM_EMAIL`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`: production SES sender configuration for email/password verification

The production authenticated smoke lane does not require Convex E2E helpers and should not enable them in production. It reuses the normal production Auth configuration above and only supplies a pre-authenticated browser storage state from GitHub Actions.

GitHub Actions repository settings for the optional authenticated smoke:

- variable `VRDEX_PRODUCTION_SMOKE_BASE_URL=https://vrdex.net`: required so auth cookies target the stable public production domain
- optional variable `VRDEX_PRODUCTION_AUTH_SMOKE_PROVIDER`: expected linked provider, usually `discord` or `google`; if unset, the smoke accepts either provider
- secret `VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64`: base64-encoded Playwright `storageState` JSON from a dedicated production test account

The lane remains skipped unless both `VRDEX_PRODUCTION_SMOKE_BASE_URL` and `VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64` are configured. Do not store OAuth credentials in CI, and do not enable production mutation helper routes for this check.

Generate Convex Auth JWT keys through a non-printing command path and set them with stdin, because PEM values begin with dashes and can be parsed as CLI options when passed as positional arguments. For production, use `pnpm exec convex env set --prod JWT_PRIVATE_KEY` and `pnpm exec convex env set --prod JWKS` with the values piped through stdin.

PowerShell example after key generation has populated process-local variables:

```powershell
$env:CONVEX_DEPLOYMENT="prod:superb-pig-954"
node -e "process.stdout.write(process.env.VRDEX_JWT_PRIVATE_KEY)" | pnpm exec convex env set --prod JWT_PRIVATE_KEY
node -e "process.stdout.write(process.env.VRDEX_JWKS)" | pnpm exec convex env set --prod JWKS
Remove-Item Env:\VRDEX_JWT_PRIVATE_KEY, Env:\VRDEX_JWKS -ErrorAction SilentlyContinue
```

Manual fallback if the workflow is unavailable:

```powershell
$env:CONVEX_DEPLOYMENT="dev:scrupulous-corgi-247"; $env:CONVEX_SELF_HOSTED_URL=""; pnpm exec convex dev --once --typecheck=try --tail-logs=disable
```

## Custom Domains

Current recommendation: keep client API traffic on the Convex cloud URL unless a separate API custom domain is configured, and use readable Convex Cloud HTTP Actions domains for Auth callback URLs.

- development/staging Convex API: `https://scrupulous-corgi-247.convex.cloud`
- development/staging Convex HTTP Actions and Auth callbacks: `https://db.staging.vrdex.net`
- production Convex API: `https://superb-pig-954.convex.cloud`
- production Convex HTTP Actions and Auth callbacks: `https://db.vrdex.net`

Convex Cloud custom domains are configured from each deployment's dashboard settings and require a Convex Pro plan. Do not create Route 53 records alone; Convex must first provide the deployment-specific DNS records and certificate binding.

Staging HTTP Actions domain bootstrap, started 2026-06-15:

1. In the Convex dashboard for `scrupulous-corgi-247`, request `db.staging.vrdex.net` with request destination `HTTP Actions`.
2. Copy only the exact DNS records Convex provides into Route 53 for the public hosted zone `vrdex.net`.
3. Current Convex-provided records:
   - `db.staging.vrdex.net CNAME convex.domains`
   - `_convex_domains.db.staging.vrdex.net TXT scrupulous-corgi-247`
4. Wait for Convex certificate/domain status to become active.
5. Add staging OAuth redirect URIs for both providers:
   - `https://db.staging.vrdex.net/api/auth/callback/discord`
   - `https://db.staging.vrdex.net/api/auth/callback/google`
6. Keep the legacy `https://scrupulous-corgi-247.convex.site/api/auth/callback/...` redirects until the custom callback host is verified in end-to-end sign-in.
7. Override the staging deployment's `CONVEX_SITE_URL` to `https://db.staging.vrdex.net` in the Convex custom domain settings.
8. Rerun staging auth smoke checks from `https://staging.vrdex.net/sign-in`.

Current status: `db.staging.vrdex.net` is configured and verified for the staging deployment, Google and Discord both allow the new callback URLs, and staging `CONVEX_SITE_URL` is selected as `https://db.staging.vrdex.net`.

Production HTTP Actions domain bootstrap, completed 2026-06-16:

1. In the Convex dashboard/API for `superb-pig-954`, request `db.vrdex.net` with request destination `HTTP Actions`.
2. Copy only the exact DNS records Convex provides into Route 53 for the public hosted zone `vrdex.net`.
3. Current Convex-provided records:
   - `db.vrdex.net CNAME convex.domains`
   - `_convex_domains.db.vrdex.net TXT superb-pig-954`
4. Wait for Route 53 to report the change as `INSYNC` and for Convex certificate/domain status to become active.
5. Add production OAuth redirect URIs for each configured provider:
   - `https://db.vrdex.net/api/auth/callback/google`
   - `https://db.vrdex.net/api/auth/callback/discord`
6. Keep the legacy `https://superb-pig-954.convex.site/api/auth/callback/...` redirects until the custom callback host is verified in end-to-end sign-in.
7. Select `https://db.vrdex.net` as the production deployment's canonical `CONVEX_SITE_URL`.
8. Rerun production auth smoke checks from `https://vrdex.net/sign-in`.

Current production status: `db.vrdex.net` is configured and verified for the production deployment, Google and Discord allow the new callback URLs, production `CONVEX_SITE_URL` is selected as `https://db.vrdex.net`, and Google and Discord sign-in from `https://vrdex.net/sign-in` return to an authenticated `/account` session.

## Notes

Resolved 2026-06-15: the duplicate Convex project `vrdex-85631` was deleted after confirming the active project is `vrdex`, the duplicate deployments had no env variables or custom domains, and their `profiles` tables were empty.
