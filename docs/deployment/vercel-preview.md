# Vercel preview deployment

This is the first hosted deployment path for `apps/web`. It is intentionally narrow: get a live Vercel URL for a pull request when someone asks for one, and keep unsafe public states locked. Production hardening belongs here only after an explicit follow-up issue owns it.

Preview deploys are manual. Two independent paths could create one, and both are closed:

- GitHub Actions. Nothing in `Baseline Checks` deploys to Vercel, and no `push` or `pull_request` event triggers a preview. A preview exists only after a human requests it, as described in [On-demand preview deploy](#on-demand-preview-deploy).
- The Vercel Git integration. `apps/web/vercel.json` sets `git.deploymentEnabled` to `{ "**": false, "main": true }`, so pushing a commit to any branch other than `main` creates no automatic Vercel deployment. `main` is listed explicitly because Vercel deploys a branch when it matches at least one `true` rule, and production hosting depends on the Git integration for `main`.

Two caveats on the Git-integration control. Vercel reads `vercel.json` from the commit being pushed, so a branch that does not yet carry this setting still auto-deploys until it picks the change up from `main`. And `git.deploymentEnabled` governs the Git integration only; it does not affect `vercel deploy` from the CLI, which is how the on-demand workflow and `staging-deploy.yml` deploy.

Dashboard-side state is not verifiable from this repository. If the Vercel project also has preview deployments or branch tracking configured in its dashboard settings, reconcile them with the setting above so the in-repo file stays the source of truth.

## Vercel project

Create or import one Vercel project for this repository:

- repository: `BASIC-BIT/VRDex`
- root directory: `apps/web`
- framework preset: `Next.js`
- build command: `pnpm build:vercel`
- install command: Vercel default pnpm workspace install
- output directory: Vercel default for Next.js

`apps/web/vercel.json` records the app-local build command so dashboard and CLI builds use the same deployment validation step.

Run Vercel CLI commands from the repository root once the project root directory is set to `apps/web`; running from `apps/web` will make Vercel resolve the app root twice.

## Repository variables and secrets

Current recommendation: keep repository Actions variables and secrets reproducible through checked-in workflows/docs first, and provider APIs or CLI scripts where practical. Secret values still belong in GitHub/Vercel/Convex secret stores, but their names, scopes, and recreation path should be documented here.

The on-demand preview workflow deploys a Vercel preview only when all three repository secrets exist:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The workflow can also deploy a matching Convex preview backend when this optional repository secret exists:

- `CONVEX_DEPLOY_KEY_PREVIEW`

If any of the three Vercel secrets is missing, the run fails and names the missing secrets instead of deploying partially. Because the preview is requested explicitly, failing loudly is the correct signal; there is no longer a baseline job that needs to stay green before the hosted project is linked.

`VERCEL_TOKEN` must be a Vercel account access token created from Vercel account settings. The local Vercel CLI session token from `auth.json` is not accepted by `vercel --token` in GitHub Actions and should not be stored as this secret.

When `CONVEX_DEPLOY_KEY_PREVIEW` exists, the workflow creates or updates the
`pr-<number>` Convex deployment with `convex deploy --preview-create` before the
Vercel build. It writes only the resulting `NEXT_PUBLIC_CONVEX_URL` as a step
output. The project preview deploy key remains confined to GitHub Actions and is
never injected into Vercel, written to an artifact, or posted in a PR comment.

The same workflow creates a random, masked persistence-bridge secret for that
single run. It writes the secret to the named Convex preview and injects it only
into the matching Vercel deployment. The bridge exposes only the guarded
dynamic-client persistence mutations needed by DCR and CIMD smoke checks. When
the hosted developer-credential gates are also enabled, a second Convex-side
capability flag permits the same bridge secret to issue client-credentials
access-token records. PR previews do not receive `CONVEX_ADMIN_TOKEN`; all
broader internal operations remain unavailable from the preview web runtime.

When `VRDEX_HOSTED_E2E_AUTH_HELPERS=true`,
`VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true`, and the
`VRDEX_HOSTED_E2E_BROWSER_TOKEN` repository secret are all present, that same
on-demand preview workflow also creates a separate random Convex E2E secret. It enables
the auth helper only on the named Convex preview and injects the matching helper
flags, generated Convex secret, and repository browser token only into the
matching Vercel preview. This supports temporary verified accounts and reviewed
OAuth clients for hosted MCP compatibility evidence without enabling the helper
on shared staging or production. The workflow also generates a preview-only
preview Clerk configuration and binds `SITE_URL` to the concrete Vercel
deployment URL after deployment. Separate per-preview runtime material supplies the API token pepper,
OAuth client-secret and refresh-token peppers, and OAuth access-token signing
key needed by developer credential and client-credentials flows. The token route
uses the dedicated preview capability described above instead of an admin key.
When any gate is absent, the workflow writes the Convex E2E and preview OAuth
token capability switches as `false` and omits the developer runtime secrets for
that preview.

## On-demand preview deploy

This is the only path that deploys a Vercel preview. Two workflows implement it:

- `.github/workflows/vercel-preview-comment.yml` listens for `issue_comment` and dispatches the deploy when a pull request comment contains `@vrdex preview` or `/vercel-preview`. It requires an `author_association` of `OWNER`, `MEMBER`, or `COLLABORATOR`, and refuses fork branches and non-open pull requests.
- `.github/workflows/vercel-preview-deploy.yml` performs the deploy. Its only triggers are `workflow_dispatch` and `workflow_call`, so it cannot fire on `push` or `pull_request`. The `workflow_call` interface exposes a `deployment_url` output so a calling workflow can capture the link.

So a preview deploy happens only when a person comments `@vrdex preview` or `/vercel-preview` on a pull request, or runs the `On-Demand Vercel Preview` workflow from the Actions tab or `gh workflow run`. Pushing another commit to a pull request does not redeploy; request a fresh preview when you want one to match new commits.

This path reuses the existing `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` repository secrets and adds no new ones.

The deploy job runs the full preview pipeline: `vercel pull`, the optional `pr-<number>` Convex preview backend with its runtime flags and smoke fixture, a local `vercel build`, and `vercel deploy --prebuilt` with the preview-only environment values. The local prebuilt build is what lets the Convex preview URL reach the client bundle through `NEXT_PUBLIC_CONVEX_URL`; a remote Vercel build would use the project's own Preview environment instead.

### Hosted MCP preview smoke

`.github/workflows/vercel-preview-deploy.yml` also runs the `Hosted MCP Preview Smoke` job after a successful deploy. It targets `<deployment-url>/mcp` and is fail-closed: it requires both a deployment URL and a same-branch Convex preview backend, so a pass covers data-backed public reads, Dynamic Client Registration, and Client ID Metadata Document authorization.

Because this workflow is dispatched rather than triggered by `pull_request`, its jobs do not appear as pull request status checks, so a failure cannot turn the pull request red. Two things compensate. The preview comment links the workflow run so the smoke result stays one click from the pull request. And when the smoke fails, the smoke job posts its own `Hosted MCP preview smoke failed` comment on the pull request and reacts `confused` to the requesting comment, so a failure is never silent even though the preview deploy itself succeeded. A later passing run rewrites that same comment in place to `Hosted MCP preview smoke passed`, so a stale failure never outlives the run that cleared it.

## Web environment

Set these in the Vercel project as needed:

- `NEXT_PUBLIC_CONVEX_URL`: optional for a shell-only preview; set to the hosted Convex deployment URL for live backend reads.
- `CONVEX_ADMIN_TOKEN`: server-only Convex admin/deploy token for route handlers that call internal Convex functions, currently needed by developer credential inventory API routes.
- `VRDEX_REQUIRE_CONVEX_URL=true`: optional; use when previews must fail instead of showing missing-backend states.
- `NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY=false`: legacy flag; auth-backed submissions now rely on Clerk configuration.
- `NEXT_PUBLIC_POSTHOG_KEY`: optional public PostHog project key; BASIC BIT hosted deployments should set this through `infra/terraform/vercel` for PostHog project `447783`.
- `NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com`: optional PostHog ingestion host; also managed through `infra/terraform/vercel` for hosted deployments.

Public API, OAuth, and hosted MCP runtime routes also need the server-side
variables inventoried in `docs/developers/self-hosting-and-iac.md`, including
`VRDEX_API_TOKEN_PEPPER`, `VRDEX_OAUTH_CLIENT_SECRET_PEPPER`,
`VRDEX_OAUTH_REFRESH_TOKEN_PEPPER`, OAuth access-token signing keys, issuer and
resource URLs, and the selected rate-limit backend settings. Keep secret values
in Vercel or the deployment secret store; commit only variable names, scope, and
rotation guidance.

`VRDEX_ENABLE_PREVIEW_PERSISTENCE_BRIDGE` and
`VRDEX_PREVIEW_PERSISTENCE_SECRET` are CI-owned preview-only values. Do not set
them in shared staging or production environments.

Do not set `VRDEX_ENABLE_PLAYWRIGHT_FIXTURES` in Vercel. Fixture profiles are for Playwright-only local/CI preview screenshots and must not be exposed from hosted previews.

Hosted dev/staging E2E targets must set these only on the dev/staging environment, not production:

- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_BROWSER_TOKEN`: same value as the GitHub Actions secret `VRDEX_HOSTED_E2E_BROWSER_TOKEN`
- `VRDEX_E2E_CONVEX_SECRET`: non-empty sentinel matching the Convex deployment secret name
- `VRDEX_ENABLE_E2E_AUTH_HELPERS=true`: optional staging-only switch for auth/claim E2E helper routes; keep unset until that flow is intentionally enabled
- `VRDEX_ENABLE_E2E_ADAPTER_HELPERS=true`: optional staging-only switch for Discord and VRChat/VRCLinking adapter stubs; keep unset until that flow is intentionally enabled
- `DISCORD_BOT_TOKEN`: optional staging-only adapter token when hosted adapter E2E is enabled
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`: optional staging-only adapter token when hosted adapter E2E is enabled

Production should keep `VRDEX_ENABLE_E2E_HELPERS=false` or unset, should keep `VRDEX_ENABLE_E2E_AUTH_HELPERS` and `VRDEX_ENABLE_E2E_ADAPTER_HELPERS` unset, and should not set `VRDEX_ALLOW_PRODUCTION_E2E_HELPERS` unless a human explicitly approves a temporary incident/debug window.

Preview deployment protection must allow unauthenticated reads if the PR preview is meant to be reviewed outside the Vercel dashboard.

## Hosted production domain

Locked decision: the hosted BASIC BIT production web app uses the apex domain `https://vrdex.net`.

Current recommendation: keep both the Vercel project-domain bindings and Route 53 DNS records in `infra/terraform/web-domains` so production web hosting does not depend on dashboard-only state.

- primary URL: `https://vrdex.net`
- secondary URL: `https://www.vrdex.net`
- Vercel project: `vr-dex-web`
- Route 53 hosted zone: `vrdex.net`
- Route 53 records: `A vrdex.net 76.76.21.21` and `A www.vrdex.net 76.76.21.21`
- GitHub production smoke variable after DNS is active: `VRDEX_PRODUCTION_SMOKE_BASE_URL=https://vrdex.net`

Production deployment status events can still report the generated Vercel deployment URL. Scheduled and push-triggered production smoke should use `VRDEX_PRODUCTION_SMOKE_BASE_URL` so the stable public domain stays under health coverage.

## Hosted staging E2E environment

Locked decision: `staging` is the shared non-production Vercel custom environment for deployed mutation-backed Playwright health checks.

- target name: `staging`
- type: Preview custom environment
- branch tracking: `staging`
- primary URL: `https://staging.vrdex.net`
- Vercel environment alias: `https://vr-dex-web-env-staging-basicbit.vercel.app`
- deploy command from the repository root: `pnpm dlx vercel@54.4.1 deploy --target=staging --yes`

DNS for `staging.vrdex.net` is managed in the Route 53 public hosted zone for `vrdex.net`:

- record: `staging.vrdex.net CNAME 0d67c3b757aeccf9.vercel-dns-016.com`
- Vercel domain binding: project `vr-dex-web`, custom environment `staging`

The `staging` Vercel environment points at the shared Convex development deployment:

- `NEXT_PUBLIC_CONVEX_URL=https://scrupulous-corgi-247.convex.cloud`
- `CONVEX_URL=https://scrupulous-corgi-247.convex.cloud`
- `VRDEX_REQUIRE_CONVEX_URL=true`
- `NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY=false`
- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_BROWSER_TOKEN`: sensitive value matching GitHub Actions secret `VRDEX_HOSTED_E2E_BROWSER_TOKEN`
- `VRDEX_E2E_CONVEX_SECRET`: sensitive value matching Convex dev env `VRDEX_E2E_CONVEX_SECRET`
- `VRDEX_ENABLE_E2E_AUTH_HELPERS=true`: enabled for hosted auth/claim E2E
- `VRDEX_ENABLE_E2E_ADAPTER_HELPERS=true`: enabled for hosted adapter E2E
- `DISCORD_BOT_TOKEN`: staging-only adapter token matching Convex dev env `DISCORD_BOT_TOKEN`
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`: staging-only adapter token matching Convex dev env `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`

The staging workflow checks configured Vercel variable names before deployment
without printing their values. It reads the custom-environment listing and
ignores any branch-specific record whose `gitBranch` metadata is not `main`.
Every staging deployment requires the Convex
URLs, E2E helper contract, deployment environment, and Redis REST rate-limit
variables listed in `STAGING_BASE_ENVIRONMENT_NAMES` in
`scripts/check-staging-runtime-env.mjs`. When repository variable
`VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true`, the preflight also requires
`CONVEX_ADMIN_TOKEN`, the API and OAuth peppers, the access-token signing key,
and the explicit issuer, API, and MCP resource URLs. Missing names fail the
deployment before either Convex or Vercel is mutated; value correctness remains
a provider bootstrap and hosted-smoke responsibility.
Optional defaults such as `VRDEX_RATE_LIMIT_REDIS_PREFIX` and enforcement
switches such as `VRDEX_REQUIRE_CONVEX_URL` remain documented but are not
treated as required names by this preflight.

The non-Redis developer runtime bootstrap is reproducible through
`pnpm ops:bootstrap-staging-developer-runtime`. It requires an ignored env file
containing a deployment-scoped `CONVEX_DEPLOY_KEY`, a Vercel-linked directory,
and the process-local `VERCEL_API_TOKEN`. The command generates independent
peppers and an RSA signing key, streams every value to Vercel over stdin, and
prints variable names only:

```powershell
pnpm ops:bootstrap-staging-developer-runtime -- --apply `
  --convex-token-env-file <ignored-token-env-file> `
  --linked-vercel-directory <vercel-linked-directory>
```

This command intentionally does not manage the Redis variables. Those remain
owned by `infra/terraform/rate-limit-redis` so the Upstash database, endpoint,
token, and Vercel bindings stay one Terraform state boundary.

Convex no longer serves auth callbacks on staging either. The HTTP Actions custom domain `https://db.staging.vrdex.net` remains verified and `scrupulous-corgi-247` selects it as `CONVEX_SITE_URL`; sign-in runs through the staging Clerk instance.

Current ownership: staging E2E helper variables and non-Redis developer runtime
variables are bootstrap-managed Vercel settings; the checked-in bootstrap above
recreates the developer runtime subset. `infra/terraform/rate-limit-redis` owns
the shared Redis variables, `infra/terraform/web-domains` owns production web
domains, and `infra/terraform/vercel` owns hosted PostHog client variables for
production, default preview, and configured staging custom environment IDs.
Update this document and the matching reproducible owner whenever scopes change,
and never commit secret values.

GitHub Actions uses these repository settings for hosted mutation health:

- variable `VRDEX_HOSTED_E2E_BASE_URL=https://staging.vrdex.net`
- variable `VRDEX_HOSTED_E2E_EXTENDED_PROFILE_FLOW=true`
- variable `VRDEX_HOSTED_E2E_AUTH_HELPERS=true`
- variable `VRDEX_HOSTED_E2E_ADAPTER_HELPERS=true`
- variable `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true`: optional; keep unset until staging has the developer token, OAuth app, and OAuth token endpoints under test
- secret `VRDEX_HOSTED_E2E_BROWSER_TOKEN`

`VRDEX_HOSTED_E2E_BROWSER_TOKEN` is a staging-only shared secret that authorizes
the bounded E2E helper routes; it is not a user or provider credential. A
repository administrator owns it. Store it only as the GitHub Actions
repository secret and the matching Vercel staging
`VRDEX_E2E_BROWSER_TOKEN`. Rotate it by replacing the Vercel value first, then
the GitHub secret, and rerun staging deployment. Revoke it by disabling the
hosted auth-helper variable and removing both stored values.

The `Staging Deploy` workflow runs after `Baseline Checks` succeeds on `main` and can also be run manually. It requires these settings:

- secret `CONVEX_DEPLOY_KEY_DEV`: deploys functions/schema to `scrupulous-corgi-247`
- secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`: deploy Vercel `staging`
- variable `VRDEX_HOSTED_E2E_BASE_URL`: hosted health target, currently `https://staging.vrdex.net`
- secret `VRDEX_HOSTED_E2E_BROWSER_TOKEN`: browser token for hosted E2E helper calls

If any required GitHub deployment setting is missing, the workflow writes a skip summary and exits successfully instead of partially deploying staging. When enabled, the workflow first audits the Vercel staging variable-name contract, then deploys Convex development functions, deploys Vercel `staging`, and runs `pnpm test:e2e:hosted` against `VRDEX_HOSTED_E2E_BASE_URL`. Because GitHub Actions snapshots secrets and variables when a run starts, rerun the workflow after completing provider bootstrap.

## Hosted production environment

Production Vercel hosting uses the same `vr-dex-web` project with the production domain `https://vrdex.net` and Convex production deployment `superb-pig-954`.

- `NEXT_PUBLIC_CONVEX_URL=https://superb-pig-954.convex.cloud`
- `CONVEX_URL=https://superb-pig-954.convex.cloud`
- `VRDEX_REQUIRE_CONVEX_URL=true`
- `VRDEX_ENABLE_E2E_HELPERS=false` or unset
- `VRDEX_ENABLE_E2E_AUTH_HELPERS` unset
- `VRDEX_ENABLE_E2E_ADAPTER_HELPERS` unset

Production must set the same API/OAuth/MCP runtime variables for any enabled
developer API, OAuth issuer, or hosted MCP surface.

Convex no longer serves auth callbacks. Clerk hosts sign-in, and `CONVEX_SITE_URL` on `superb-pig-954` stays `https://db.vrdex.net` for the HTTP Actions the app still uses.

Production auth status, pending cutover:

- Clerk is the sign-in provider. The production Clerk instance needs its own `convex` JWT template, its own keys, and its own Google and Discord OAuth credentials pointed at Clerk's callback URLs.
- The existing Google and Discord OAuth clients are reused by repointing their redirect URIs at Clerk. Do not delete them — the Discord client is also used by community verification, which is independent of sign-in.
- `CLERK_JWT_ISSUER_DOMAIN` on Convex must match the issuer of that template.
- `JWT_PRIVATE_KEY` and `JWKS` are retired; Clerk signs tokens now.
- Session lifetime is Clerk's, documented in [`docs/backend/auth-sessions.md`](../backend/auth-sessions.md). The previous 30-day inactivity / 90-day cap contract is not reproduced.

### Production authenticated account smoke

The `Deployed Health Checks` workflow always runs the production read-only route smoke when `VRDEX_PRODUCTION_SMOKE_BASE_URL` or a deployment status URL is available. It can also run a gated authenticated account smoke when the repository has an explicit stable production base URL and a pre-authenticated production test-account storage state.

Repository settings for the authenticated lane:

- variable `VRDEX_PRODUCTION_SMOKE_BASE_URL=https://vrdex.net`: required so auth cookies target the stable public domain instead of a generated Vercel deployment URL
- optional variable `VRDEX_PRODUCTION_AUTH_SMOKE_PROVIDER`: expected linked provider, usually `discord` or `google`; if unset, the smoke accepts either provider
- secret `VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64`: base64-encoded Playwright `storageState` JSON from a dedicated production test account that has completed OAuth sign-in

This smoke does not enable production E2E helpers, does not mutate data, and does not store OAuth provider passwords in CI. It checks that the pre-authenticated production account can load `/account`, sees a sign-out control, and has at least one linked OAuth provider. Refresh the storage-state secret by manually signing in as the dedicated test account and exporting Playwright storage state before the session expires or after OAuth/provider/callback changes.

This lane validates the signed-in production account path and linked-provider rendering. It is not a full automated provider-login robot; provider credential entry and fresh OAuth consent should remain manual or use a provider-approved non-interactive test-account mechanism.

## Validation

The Vercel build runs `pnpm build:vercel`, which executes `apps/web/scripts/check-vercel-env.mjs` before `next build`.

The validation fails when:

- Playwright fixtures are enabled.
- Any E2E helper switch is enabled for a production Vercel build.
- public submissions are marked auth-ready before auth exists.
- `NEXT_PUBLIC_CONVEX_URL` is invalid.
- `NEXT_PUBLIC_CONVEX_URL` points at localhost during a Vercel build.
- `VRDEX_REQUIRE_CONVEX_URL=true` and `NEXT_PUBLIC_CONVEX_URL` is missing.

## Live smoke check

After a preview deployment, visit:

- `/` for the public shell
- `/deployment` for Vercel environment and commit metadata
- `/submit` to confirm signed-out users are routed to sign in before writing

The on-demand preview workflow posts an `On-demand Vercel preview` comment with the preview URL, the `/deployment` URL, and a link to the workflow run that carries the hosted MCP smoke result.
