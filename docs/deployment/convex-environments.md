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

- `CONVEX_DEPLOY_KEY_PREVIEW`: preview deployment key used by on-demand Vercel previews that need same-branch backend functions
- `CONVEX_DEPLOY_KEY_DEV`: development deployment key
- `CONVEX_DEPLOY_KEY_PROD`: production deployment key used by the main-branch deploy workflow

Local ignored env names:

- `CONVEX_DEPLOY_KEY_PREVIEW`
- `CONVEX_DEPLOY_KEY_DEV`
- `CONVEX_DEPLOY_KEY_PROD`
- `CONVEX_URL_DEV`
- `CONVEX_URL_PROD`

## Pull Request Preview Backends

PR preview backends are created only by the manual `On-Demand Vercel Preview`
workflow. Baseline Checks no longer deploys Vercel previews or Convex preview
backends. When `CONVEX_DEPLOY_KEY_PREVIEW` is
configured, the preview deploy job first creates or updates a Convex preview
deployment named for the PR with `convex deploy --preview-create` and builds the
web app with that preview Convex URL. The project-level
`CONVEX_DEPLOY_KEY_PREVIEW` remains in GitHub Actions and is never injected into
Vercel. A pull request with no requested preview has no `pr-<number>` Convex
deployment.

The `Hosted MCP Preview Smoke` job runs `pnpm smoke:mcp-compat` against
the Vercel preview `/mcp` endpoint in that same on-demand run. CI passes that
target through `VRDEX_MCP_SMOKE_URL`; local runs can use
`pnpm smoke:mcp-compat -- --hosted-url <preview-/mcp-url>`. The job is
fail-closed: it requires both a preview deployment URL and a same-branch Convex
preview backend, so a pass covers anonymous hosted Streamable HTTP, OAuth
metadata, bearer challenges, Dynamic Client Registration, and data-backed
`vrdex_search` plus `search`/`fetch` alias checks together. When
`CONVEX_DEPLOY_KEY_PREVIEW` is absent the job fails and names that prerequisite
rather than reporting reduced coverage as green.

Use the manual `Deployed Health Checks` workflow target `hosted-mcp-smoke` when
DCR/CIMD evidence needs to come from a staging, production-like, or otherwise
Convex-backed target. Pass the target `/mcp` URL as `base_url` and enable the
`mcp_dcr` and `mcp_cimd` inputs for the hosted OAuth compatibility gate.

Do not use production deploy keys for PR previews. Preview deployments are for
schema/function compatibility and hosted smoke validation before merge.

For DCR and CIMD preview smoke, the `On-Demand Vercel Preview` workflow
(`.github/workflows/vercel-preview-deploy.yml`) enables a narrow persistence
bridge with `VRDEX_DEPLOYMENT_ENV=preview`,
`VRDEX_ENABLE_PREVIEW_PERSISTENCE_BRIDGE=true`, and a random
`VRDEX_PREVIEW_PERSISTENCE_SECRET` shared only with the matching Vercel
deployment. The public bridge mutations reject every other environment and an
incorrect or missing secret. Do not replace this boundary with a preview
`CONVEX_ADMIN_TOKEN`. When the separately gated hosted E2E developer-credential
flow is enabled, the workflow also sets
`VRDEX_ENABLE_PREVIEW_OAUTH_TOKEN_BRIDGE=true` on that Convex preview. That flag
permits only client-credentials access-token record issuance and access-token
validation through the same secret-bound bridge. Authorization-code,
refresh-token, revocation, and all other internal operations remain unavailable
to the preview web runtime.

The workflow also sets `VRDEX_ENABLE_HOSTED_SMOKE_FIXTURE=true` and invokes the
internal `hostedSmokeFixtures:ensurePublicSearchFixture` mutation through the
Convex CLI admin path. The mutation creates or refreshes one deterministic fake
public community profile for search smoke coverage. Its guard permits only
`preview` or `staging`, so production cannot seed the fixture even if the flag
is accidentally present. Staging runs the same internal mutation after its
Convex deploy and before its Vercel deploy.

## Transactional Email Environment

**No deployment needs these today.** Clerk sends the verification and password
email this section used to describe, and nothing in the codebase calls SES. They
are documented for whichever feature adopts SES next.

A Convex deployment that does send through SES must set:

- `AWS_SES_REGION`
- `AWS_SES_FROM_EMAIL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `VRDEX_APP_NAME` optional display name

The hosted SES baseline is documented in `docs/deployment/ses-auth-email.md` and `docs/deployment/aws-baseline.md`. Store secret values in Convex env, never in git.

## Hosted E2E Helpers

Hosted mutation-backed Playwright runs use only the shared development/staging target. Do not enable these helpers in production.

### Preview deployments need a project-level default

`convex/auth.config.ts` reads `CLERK_JWT_ISSUER_DOMAIN` on every hosted
deployment, and `convex deploy --preview-create` evaluates it while creating the
deployment. Nothing in CI can set the variable first: `convex deploy` has no
`--env` flag, and `convex env set` needs a deployment that already exists.

Set `CLERK_JWT_ISSUER_DOMAIN` as a **preview environment-variable default** on
the Convex project, from the dashboard's project settings. New previews then
inherit it at creation. Without it, `Deploy Convex preview functions` fails
before any Vercel step runs.

Development/staging Convex env names:

- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_CONVEX_SECRET`: non-empty sentinel also configured in the hosted app environment
- `VRDEX_ENABLE_E2E_AUTH_HELPERS=true`: optional, only when hosted auth/claim E2E is intentionally enabled
- `VRDEX_ENABLE_E2E_ADAPTER_HELPERS=true`: optional, only when hosted adapter E2E is intentionally enabled
- `CLERK_JWT_ISSUER_DOMAIN`: staging Clerk Frontend API origin, read by `convex/auth.config.ts`
- `SITE_URL=https://staging.vrdex.net`: builds the Discord verification callback URL
- `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET`: staging Discord credentials for the purpose-scoped community-verification round-trip. These are **not** sign-in credentials — Clerk holds those — but `convex/discordVerification.ts` still requires them
- `DISCORD_API_BASE_URL`: optional hosted adapter stub base URL, usually `https://staging.vrdex.net/api/e2e/adapters/discord`
- `DISCORD_OAUTH_AUTHORIZE_URL`: optional consent-screen override, for pointing the OAuth round-trip at a stub instead of Discord. Defaults to `https://discord.com/oauth2/authorize`. The browser follows it carrying the `state` that authorizes the round-trip, so it must be https unless it is loopback
- `DISCORD_BOT_TOKEN`: staging-only adapter token matching the hosted app environment
- `VRCHAT_PROOF_ADAPTER_URL`: optional hosted adapter stub URL, usually `https://staging.vrdex.net/api/e2e/adapters/vrchat-proof`
- `VRCLINKING_PROOF_ADAPTER_URL`: optional hosted adapter stub URL, usually `https://staging.vrdex.net/api/e2e/adapters/vrchat-proof`
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`: staging-only adapter token matching the hosted app environment
- `VRCLINKING_ADAPTER_CAPABILITY_KEY`: staging-only capability signing key, and a different value from the bearer token. Required alongside the two above, not optional with them: `getClaimJourneyContext` hides the VRCLinking method unless all three are set, so omitting this one leaves the method invisible and the hosted stub unexercised — with nothing reporting a misconfiguration, because hiding is the designed behaviour

The browser-facing token stays in the web host and GitHub Actions as `VRDEX_E2E_BROWSER_TOKEN` / `VRDEX_HOSTED_E2E_BROWSER_TOKEN`; it is not needed by Convex.

The shared development deployment `scrupulous-corgi-247` is the current hosted E2E backend for Vercel `staging`. The `Staging Deploy` GitHub Actions workflow deploys Convex development functions with `CONVEX_DEPLOY_KEY_DEV` before deploying Vercel `staging` and running hosted data-flow health.

Production Convex auth env names:

- `CLERK_JWT_ISSUER_DOMAIN=https://<clerk-frontend-api>`: production Clerk Frontend API origin, read by `convex/auth.config.ts`. Must match the issuer of the `convex` JWT template on the production Clerk instance
- `SITE_URL=https://vrdex.net`: builds the Discord verification callback URL
- `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET`: production Discord credentials for the purpose-scoped community-verification round-trip. Still required by `convex/discordVerification.ts`; they are no longer sign-in credentials

Retired when Clerk replaced Convex Auth, and safe to delete from every Convex
deployment once the cutover is verified:

- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: Google sign-in now runs through Clerk. Do not delete the Google OAuth *client* — point it at Clerk's callback URL instead
- `JWT_PRIVATE_KEY` and `JWKS`: Convex Auth signed its own tokens; Clerk signs them now
- `AWS_SES_REGION`, `AWS_SES_FROM_EMAIL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: these sent email/password verification codes. Clerk sends its own, so they are unused **unless** another feature adopts SES — check before deleting

Discord community verification needs no additional production Convex environment
variables. It reuses `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`, and `SITE_URL`
through a purpose-scoped OAuth round-trip independent of sign-in; it requires
only that
`https://vrdex.net/api/discord/verify/callback` is registered as a redirect URI
on the production Discord application.

The VRCLinking claim method needs three, and `getClaimJourneyContext` hides the
method unless **all three** are present — a deployment holding only some of them
offers nothing, rather than offering a method that throws:

- `VRCLINKING_PROOF_ADAPTER_URL`: the Function URL output by
  `infra/terraform/vrclinking-adapter`
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`: the `bearerToken` field of the shared
  secret. Also read by the generic VRChat proof adapter seam, so a deployment
  running both rotates both together
- `VRCLINKING_ADAPTER_CAPABILITY_KEY`: the `capabilityKey` field of the same
  secret, and necessarily a different value from the bearer token — the adapter
  refuses to start if they match

Both come from **one** Secrets Manager object, `vrdex/vrclinking/shared`, holding
`{ "bearerToken": …, "capabilityKey": … }`. One object rather than two because
two cannot be written atomically, and a cold start landing between the writes
would cache a mismatched pair for its container's life. Provisioning two
single-value secrets instead leaves no ARN for Terraform to take, and pointing
the stack at one of them fails every cold start.

Setting these does not by itself make a claim completable: a community must also
delegate a credential, and until one has, the method is offered and every
attempt returns `unavailable`. The stack README carries the deployment and
rotation sequence. The optional bot and collector paths, and the exact operator
steps, are documented in
[`claim-verification-enablement.md`](./claim-verification-enablement.md).

Session durations are Clerk instance settings, not code and not Convex
environment variables — the constants that once owned them are deleted. Set the
session lifetime and inactivity timeout in each Clerk instance's session
settings, and the token lifetime on its `convex` JWT template, which is also the
revocation window. Verify by reading the template's lifetime in the Clerk
dashboard; nothing in this repository can assert it. See
[`docs/backend/auth-sessions.md`](../backend/auth-sessions.md).

The production authenticated smoke lane does not require Convex E2E helpers and should not enable them in production. It reuses the normal production Auth configuration above and only supplies a pre-authenticated browser storage state from GitHub Actions.

GitHub Actions repository settings for the optional authenticated smoke:

- variable `VRDEX_PRODUCTION_SMOKE_BASE_URL=https://vrdex.net`: required so auth cookies target the stable public production domain
- `VRDEX_PRODUCTION_AUTH_SMOKE_PROVIDER` is retired: the account page no longer renders linked providers, because Clerk shows them only inside its own profile modal. The smoke asserts the management affordance instead of a provider label
- secret `VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64`: base64-encoded Playwright `storageState` JSON from a dedicated production test account

The lane remains skipped unless both `VRDEX_PRODUCTION_SMOKE_BASE_URL` and `VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64` are configured. Do not store OAuth credentials in CI, and do not enable production mutation helper routes for this check.

### Setting secret values without corrupting them

Do not pipe a secret into `convex env set` from PowerShell. A PowerShell pipeline
between native commands round-trips the payload through its string pipeline and
appends a platform newline, so the stored value gains a trailing `\r`. The value
still looks correct in the dashboard and in `convex env get`, and most consumers
tolerate it, but any provider that compares the secret byte-for-byte rejects it.

This is not hypothetical. On 2026-07-28 production `AUTH_GOOGLE_SECRET` held a
35-character secret plus a trailing `\r`. Google sign-in failed at the token
exchange with `invalid_client` for weeks while consent, Discord, and staging all
worked, because the OAuth authorize step never sends the client secret.

Pass single-line secrets as a positional argument instead, from Git Bash so that
`$(...)` strips trailing newlines:

```bash
SECRET=$(python -c "import json,sys;print(json.load(open(sys.argv[1]))['web']['client_secret'],end='')" ./client_secret.json)
pnpm exec convex env set AUTH_GOOGLE_SECRET "$SECRET"
```

Always verify after writing a secret. `len` must equal the provider's documented
length and `CR` must be `0`:

```bash
pnpm exec convex env get AUTH_GOOGLE_SECRET | python -c "
import sys
b = sys.stdin.buffer.read().rstrip(b'\n')
print('CR=%d len=%d' % (b.count(b'\r'), len(b)))"
```

PEM values are the one case that needs stdin, because they begin with dashes and
would otherwise parse as CLI options. Use `cmd /c` redirection rather than a
PowerShell pipe, since `cmd` redirects bytes verbatim:

```powershell
$env:CONVEX_DEPLOYMENT="prod:superb-pig-954"
node -e "require('fs').writeFileSync(process.argv[1], process.env.VRDEX_JWT_PRIVATE_KEY)" $env:TEMP\k.pem
cmd /c "pnpm exec convex env set --prod JWT_PRIVATE_KEY < $env:TEMP\k.pem"
Remove-Item $env:TEMP\k.pem, Env:\VRDEX_JWT_PRIVATE_KEY, Env:\VRDEX_JWKS -ErrorAction SilentlyContinue
```

Apply the same `CR=0` verification to `JWT_PRIVATE_KEY` and `JWKS`. A trailing
`\r` on those two is currently harmless, so check the byte count rather than
assuming a working deployment proves a clean value.

Manual fallback if the workflow is unavailable:

```powershell
$env:CONVEX_DEPLOYMENT="dev:scrupulous-corgi-247"; $env:CONVEX_SELF_HOSTED_URL=""; pnpm exec convex dev --once --typecheck=try --tail-logs=disable
```

## Custom Domains

Current recommendation: keep client API traffic on the Convex cloud URL unless a separate API custom domain is configured, and use readable Convex Cloud HTTP Actions domains for the HTTP Actions the app still serves.

- development/staging Convex API: `https://scrupulous-corgi-247.convex.cloud`
- development/staging Convex HTTP Actions: `https://db.staging.vrdex.net`
- production Convex API: `https://superb-pig-954.convex.cloud`
- production Convex HTTP Actions: `https://db.vrdex.net`

**Convex no longer serves sign-in callbacks.** `convex/http.ts` dropped
`/api/auth/*` when Clerk replaced Convex Auth, so the OAuth redirect URIs below
that name `db.vrdex.net/api/auth/callback/...` are historical. Following them
during cutover would point a Google or Discord client at a 404. Register Clerk's
callback URLs on those OAuth clients instead — Clerk's dashboard shows the exact
values per instance — and keep the custom domains only for the HTTP Actions the
app still uses.

Convex Cloud custom domains are configured from each deployment's dashboard settings and require a Convex Pro plan. Do not create Route 53 records alone; Convex must first provide the deployment-specific DNS records and certificate binding.

Staging HTTP Actions domain bootstrap, started 2026-06-15:

1. In the Convex dashboard for `scrupulous-corgi-247`, request `db.staging.vrdex.net` with request destination `HTTP Actions`.
2. Copy only the exact DNS records Convex provides into Route 53 for the public hosted zone `vrdex.net`.
3. Current Convex-provided records:
   - `db.staging.vrdex.net CNAME convex.domains`
   - `_convex_domains.db.staging.vrdex.net TXT scrupulous-corgi-247`
4. Wait for Convex certificate/domain status to become active.
5. Historical, do not follow: staging OAuth redirect URIs used to be
   `https://db.staging.vrdex.net/api/auth/callback/{discord,google}`. Those
   routes no longer exist. Point the staging OAuth clients at the staging Clerk
   instance's callback URLs.
6. Historical: the legacy `convex.site/api/auth/callback/...` redirects are also gone with Convex Auth.
7. Override the staging deployment's `CONVEX_SITE_URL` to `https://db.staging.vrdex.net` in the Convex custom domain settings.
8. Rerun staging auth smoke checks from `https://staging.vrdex.net/sign-in`.

Current status: `db.staging.vrdex.net` is configured and verified for the staging deployment and staging `CONVEX_SITE_URL` is selected as `https://db.staging.vrdex.net`. The Convex-hosted sign-in callbacks it once served are gone; staging sign-in runs through the staging Clerk instance.

Production HTTP Actions domain bootstrap, completed 2026-06-16:

1. In the Convex dashboard/API for `superb-pig-954`, request `db.vrdex.net` with request destination `HTTP Actions`.
2. Copy only the exact DNS records Convex provides into Route 53 for the public hosted zone `vrdex.net`.
3. Current Convex-provided records:
   - `db.vrdex.net CNAME convex.domains`
   - `_convex_domains.db.vrdex.net TXT superb-pig-954`
4. Wait for Route 53 to report the change as `INSYNC` and for Convex certificate/domain status to become active.
5. Historical, do not follow: production OAuth redirect URIs used to be
   `https://db.vrdex.net/api/auth/callback/{google,discord}`. Those routes no
   longer exist. Point the production OAuth clients at the production Clerk
   instance's callback URLs.
6. Historical: the legacy `convex.site/api/auth/callback/...` redirects are also gone with Convex Auth.
7. Select `https://db.vrdex.net` as the production deployment's canonical `CONVEX_SITE_URL`.
8. Rerun production auth smoke checks from `https://vrdex.net/sign-in`.

Current production status: `db.vrdex.net` is configured and verified for the production deployment and production `CONVEX_SITE_URL` is selected as `https://db.vrdex.net`. Sign-in no longer runs through it: the Convex auth callbacks were removed with Convex Auth, and production sign-in is pending the Clerk cutover.

## Notes

Resolved 2026-06-15: the duplicate Convex project `vrdex-85631` was deleted after confirming the active project is `vrdex`, the duplicate deployments had no env variables or custom domains, and their `profiles` tables were empty.
