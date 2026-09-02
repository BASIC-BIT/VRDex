# Convex Environments

## Locked Decision

VRDex keeps four Convex execution targets separate:

- local development: anonymous local Convex from `pnpm dev:backend:local` or `pnpm verify:backend:local`
- pull request preview testing: branch-specific Convex preview deployments when a Vercel preview must exercise same-branch backend functions
- deployed smoke testing: the shared development Convex deployment
- production release: the production Convex deployment

## Targeting a deployment from the CLI

Use `pnpm cx -- <local|dev|prod> <convex args>`. The target is a required
positional and is never inferred:

```bash
pnpm cx -- prod run seedImports:listBatchesForReview
pnpm cx -- dev env list
pnpm cx -- local run health:status
```

`convex --prod` does not work in this repository. The repo `.env.local` sets
`CONVEX_DEPLOYMENT=anonymous:anonymous-agent` so that local development needs no
cloud project, which leaves `--prod` with no project to resolve against. The
wrapper supplies `CONVEX_DEPLOYMENT` and `CONVEX_DEPLOY_KEY` for the named
target instead.

It also clears `CONVEX_URL`, `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`, and the
self-hosted pair from the child environment before setting the target's own
values. A shell that has run `pnpm dev:backend:local` keeps `CONVEX_URL`
pointing at `127.0.0.1:3210`, which otherwise silently wins over a command line
that reads `prod`.

Cloud credentials are read from `.env.local` in the main checkout — worktrees do
not carry it, and the wrapper locates the main checkout through
`git rev-parse --git-common-dir` rather than requiring a variable. Exactly one
file is read: when the main checkout has one, a worktree copy is ignored
entirely rather than merged per key, so a credential removed by rotation stays
removed instead of being refilled from a stale worktree. Values are passed to
the Convex CLI through its environment and never printed; the banner names the
deployment and the env file only.

`local` reverses that order and reads the active worktree first, because
`pnpm dev:backend:local` writes the running backend's deployment name and port
into that worktree's own `.env.local`. Reading the main checkout first would
point `local` at a different instance, or at one that is not running. The banner
names the file it used, so the source is never a guess.

A target that is missing either of its two variables fails and names both,
rather than falling back to whichever credentials are present.

The same targeting applies to the seed operations scripts, which take
`--target` instead of the `--prod` flag they used to accept:

```bash
pnpm ops:seed-publish -- --batch-id <id> --target prod ...
pnpm ops:seed-import:json -- --file <path> --target prod ...
pnpm ops:seed-handoff:create -- --candidate-id <id> --target prod ...
```

`--target` defaults to `local`. The old `--prod` and `--deployment` flags are
rejected with an error rather than ignored, since silently falling back to
`local` would let a leftover `--prod` invocation report a successful local
publication.

`local` is pinned to an env file rather than the ambient environment, like the
cloud targets, but to the **active worktree's** `.env.local` when it has one,
falling back to the main checkout. It takes `CONVEX_DEPLOYMENT` and
`CONVEX_URL` from there, and ambient values are cleared first, so exporting a
worktree-specific `CONVEX_URL` has no effect. Change whichever file the banner
names, or start the backend with `pnpm dev:backend:local` — which writes that
worktree's file itself, and which `local` still expects to be running.

## Current Deployments

Do not commit deploy keys. Store them in GitHub/hosting secret stores and local ignored env files only.

Current recommendation: define environment variable names and target scopes in docs or IaC first, then set secret values through provider secret stores. Manual Convex dashboard edits should be treated as bootstrap/emergency changes and followed by a reproducibility update here or in automation.

- development cloud URL: `https://scrupulous-corgi-247.convex.cloud`
- production cloud URL: `https://superb-pig-954.convex.cloud`

GitHub Actions secret names:

- `CONVEX_DEPLOY_KEY_PREVIEW`: preview deployment key used by on-demand Vercel previews that need same-branch backend functions
- `CONVEX_DEPLOY_KEY_DEV`: development deployment key
- `CONVEX_DEPLOY_KEY_PROD`: production deployment key used by the main-branch deploy workflow
- `TERRAFORM_POSTHOG_PUBLIC_KEY`: hosted PostHog project key reused by the
  production workflow for Convex claim analytics; it is required whenever the
  production Convex deploy gate is enabled

Local ignored env names:

- `CONVEX_DEPLOY_KEY_PREVIEW`
- `CONVEX_DEPLOY_KEY_DEV`
- `CONVEX_DEPLOY_KEY_PROD`
- `CONVEX_URL_DEV`
- `CONVEX_URL_PROD`

`pnpm cx` and the `ops:seed-*` scripts additionally need the deployment name for
each target they can reach. Both are the deployment's own identifier, not a URL:

- `CONVEX_DEPLOYMENT_DEV=dev:scrupulous-corgi-247`
- `CONVEX_DEPLOYMENT_PROD=prod:superb-pig-954`

A target is only usable when both of its variables are present. `dev` needs
`CONVEX_DEPLOYMENT_DEV` and `CONVEX_DEPLOY_KEY_DEV`; `prod` needs
`CONVEX_DEPLOYMENT_PROD` and `CONVEX_DEPLOY_KEY_PROD`. Supplying one without
the other fails naming both, rather than falling back to the other target's
credentials.

The pair is also checked for agreement. A deploy key carries its own deployment
ahead of the `|`, and the CLI will follow the key rather than
`CONVEX_DEPLOYMENT`, so a dev deployment name accidentally paired with a
production key would reach production while the banner read "development". A
mismatch fails naming both deployments; the secret after the `|` is never read
or printed.

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

**The support digest needs these.** Clerk sends the verification and password
email this section used to describe, so SES is out of the auth path, but the
hourly `internal.supportRequestDigest.sendSupportDigest` cron mails new
`/support` requests through it.

A Convex deployment that sends through SES must set:

- `AWS_SES_REGION`
- `AWS_SES_FROM_EMAIL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `VRDEX_APP_NAME` optional display name
- `VRDEX_SUPPORT_DIGEST_TO`: the mailbox the `/support` digest is delivered to.
  Without it the cron sends nothing and reports `configured: false`, which is
  the correct state for a deployment with no operator mailbox. Requests keep
  their unset `notifiedAt` in the meantime, so setting this later delivers the
  backlog rather than starting from whatever arrives next.

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

### Staging provisions it in the workflow

The shared development/staging deployment already exists, so `convex env set`
does work there — and `staging-deploy.yml` runs it from
`vars.VRDEX_STAGING_CLERK_JWT_ISSUER_DOMAIN` in a `Provision Convex auth
configuration` step placed **before** `convex deploy`. Ordering is the point:
`auth.config.ts` is evaluated at push time and the CLI refuses to push while the
variable is unset, so setting it after the deploy never runs at all.

This used to be a hand-set dashboard value, and that is what failed. Nobody set
it when Clerk replaced Convex Auth in #224. Every staging deploy failed from that
merge onward with:

```text
✖ Environment variable CLERK_JWT_ISSUER_DOMAIN is used in auth config file
  but its value was not set.
```

Staging kept serving a pre-cutover build — with the removed email/password
sign-in form — for three days while `main` moved on, and nothing surfaced it
because the failure was inside a workflow nobody was watching.
`tests/scripts/staging-runtime-env.test.ts` pins the ordering.

**An unset variable fails the job; it does not skip it.** The other entries in
the gate's `missing` list mean "this repository is not set up to deploy staging
at all", which is a legitimate skip. This one means staging *is* set up and is
missing a setting its own auth config requires — so skipping would report a green
workflow while staging silently stopped updating, which is a quieter version of
the same outage.

### The issuer is checked against the key Vercel will serve

Convex's issuer and the web publishable key are configured in different places —
a repository variable and the Vercel project — and nothing compared them. A stale
or cross-instance issuer deploys cleanly and then rejects every signed-in
request, because Convex validates the issuer it was *told* about rather than the
one the browser authenticated against. The `Audit Vercel staging runtime
variable names` step cannot catch it: it reads names, never values.

So the issuer is checked twice, both through
`scripts/check-clerk-issuer-match.mjs`, plus a format check that runs on every
path. Before the `convex env set`, the issuer is compared against the key the
current deployment serves; after the Vercel deploy, against what actually
shipped. Both decode the key's base64-encoded host and fail on a mismatch, and
both reject a `pk_live_` key outright so the staging and production tenants
cannot be crossed. `production-promote.yml` does the same for the live tenant.

The format check is separate and unconditional, because `auth.config.ts` takes
the value verbatim: a bare host or a trailing slash matches no token issuer, and
no path that can write the variable may skip that.

**Rotating staging to a different Clerk instance** is a manual sequence rather
than a workflow input, documented in
[`playwright-visual-preview.md`](../testing/playwright-visual-preview.md). Vercel
is updated and deployed first, then the issuer variable, then a normal staging
deploy — so the pre-deploy comparison agrees by the time it runs and never has
to be skipped. There is a short window between those steps where staging auth is
down, which is inherent to changing two providers that must agree.

A dispatch input that skipped the comparison existed briefly and was removed.
Three rounds of review found a fresh hole in it each time: it bypassed the
format validation, then left the rollback unreachable on the path it created,
and would finally have needed Vercel deployment rollback and repository-variable
writes from CI to be correct. That is a two-provider migration system inside a
deploy workflow, for an operation performed by hand about once a year.

If a run changes the issuer and then fails, the previous value is restored in
two cases, and both mean Convex is ahead of what staging serves: the Vercel
deploy did not succeed, or the post-deploy comparison reported a **confirmed
mismatch** — the deployed key naming a different Clerk instance than the issuer
just written.

Keyed on that confirmation rather than on the step failing, because a transient
fetch error fails the step too and proves nothing about the pairing; rolling back
on one would break a pairing that is very likely correct. The script exits 2 for
a mismatch and 1 for everything else so the two can be told apart. The
pre-deploy comparison can also be inconclusive — a target serving no key at
all — so a mismatch reaching the post-deploy check is not unreachable merely
because the earlier one passed.

The restore re-pushes functions only when the Convex deploy had itself
succeeded. If it had not, nothing carrying the new issuer was ever published, so
putting the variable back is the whole repair — and re-pushing there would
publish the functions that just failed their typecheck.

The value is not a secret. A Clerk Frontend API origin is public — it is encoded
in the publishable key every browser downloads — so it lives in a repository
variable rather than a repository secret, where it can be read and audited.

Development/staging Convex env names:

- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_CONVEX_SECRET`: non-empty sentinel also configured in the hosted app environment
- `VRDEX_ENABLE_E2E_AUTH_HELPERS=true`: optional, only when hosted auth/claim E2E is intentionally enabled
- `VRDEX_ENABLE_E2E_ADAPTER_HELPERS=true`: optional, only when hosted adapter E2E is intentionally enabled
- `CLERK_JWT_ISSUER_DOMAIN`: staging Clerk Frontend API origin, read by `convex/auth.config.ts`. **Provisioned by `staging-deploy.yml`, not by hand** — see below
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

The four `AWS_SES_*` and `AWS_*` credentials are **no longer on that list**. They
sent email/password verification codes, which Clerk now handles, but the hourly
support digest has since adopted them. Deleting them stops `/support` requests
from reaching anyone, and stops it quietly.

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
pnpm cx -- prod env set AUTH_GOOGLE_SECRET "$SECRET"
```

Always verify after writing a secret. `len` must equal the provider's documented
length and `CR` must be `0`:

```bash
pnpm --silent cx -- prod env get AUTH_GOOGLE_SECRET | python -c "
import sys
b = sys.stdin.buffer.read().rstrip(b'\n')
print('CR=%d len=%d' % (b.count(b'\r'), len(b)))"
```

PEM values are the one case that needs stdin, because they begin with dashes and
would otherwise parse as CLI options. No Convex variable currently holds a PEM —
`JWT_PRIVATE_KEY` and `JWKS` were the only ones, and Clerk signs tokens now — so
this is recorded as technique rather than as a step to run. Use `cmd /c`
redirection rather than a PowerShell pipe, since `cmd` redirects bytes verbatim,
and substitute the real variable name:

```powershell
node -e "require('fs').writeFileSync(process.argv[1], process.env.VRDEX_PEM_VALUE)" $env:TEMP\k.pem
cmd /c "pnpm cx -- prod env set SOME_PEM_VARIABLE < $env:TEMP\k.pem"
Remove-Item $env:TEMP\k.pem, Env:\VRDEX_PEM_VALUE -ErrorAction SilentlyContinue
```

Setting `CONVEX_DEPLOYMENT` by hand first is no longer needed, and is now
actively counterproductive: `cx` clears ambient Convex variables before
applying the target's own.

Apply the same `CR=0` verification afterwards. A trailing `\r` is harmless for
some consumers, so check the byte count rather than assuming a working
deployment proves a clean value.

Manual fallback if the workflow is unavailable:

```powershell
pnpm cx -- dev dev --once --typecheck=try --tail-logs=disable
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
