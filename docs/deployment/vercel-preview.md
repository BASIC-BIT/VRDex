# Vercel preview deployment

This is the first hosted deployment path for `apps/web`. It is intentionally narrow: get a live Vercel URL for every pull request, keep unsafe public states locked, and leave production-hardening for later issues.

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

## Repository secrets

Current recommendation: keep repository Actions variables and secrets reproducible through checked-in workflows/docs first, and provider APIs or CLI scripts where practical. Secret values still belong in GitHub/Vercel/Convex secret stores, but their names, scopes, and recreation path should be documented here.

The PR workflow deploys a Vercel preview only when all three repository secrets exist:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The workflow can also deploy a matching Convex preview backend when this optional repository secret exists:

- `CONVEX_DEPLOY_KEY_PREVIEW`

If any are missing, the `Vercel Preview` job passes and writes a step summary explaining that deployment is skipped. This keeps baseline CI green before the hosted project is linked, while making the missing live-deploy blocker explicit.

When `CONVEX_DEPLOY_KEY_PREVIEW` exists, the workflow runs `convex deploy --preview-create pr-<number>` before the Vercel build and writes the resulting `NEXT_PUBLIC_CONVEX_URL` into the Vercel build environment. This keeps PR previews from accidentally pointing at stale shared dev/prod Convex functions.

## Web environment

Set these in the Vercel project as needed:

- `NEXT_PUBLIC_CONVEX_URL`: optional for a shell-only preview; set to the hosted Convex deployment URL for live backend reads.
- `VRDEX_REQUIRE_CONVEX_URL=true`: optional; use when previews must fail instead of showing missing-backend states.
- `NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY=false`: legacy flag; auth-backed submissions now rely on Convex Auth configuration.

Do not set `VRDEX_ENABLE_PLAYWRIGHT_FIXTURES` in Vercel. Fixture profiles are for Playwright-only local/CI preview screenshots and must not be exposed from hosted previews.

Hosted dev/staging E2E targets must set these only on the dev/staging environment, not production:

- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_BROWSER_TOKEN`: same value as the GitHub Actions secret `VRDEX_HOSTED_E2E_BROWSER_TOKEN`
- `VRDEX_E2E_CONVEX_SECRET`: non-empty sentinel matching the Convex deployment secret name

Production should keep `VRDEX_ENABLE_E2E_HELPERS=false` or unset, and should not set `VRDEX_ALLOW_PRODUCTION_E2E_HELPERS` unless a human explicitly approves a temporary incident/debug window.

Preview deployment protection must allow unauthenticated reads if the PR preview is meant to be reviewed outside the Vercel dashboard.

## Staging Hosted E2E Environment

Locked decision: `staging` is the shared non-production Vercel custom environment for deployed mutation-backed Playwright health checks.

- target name: `staging`
- type: Preview custom environment
- branch tracking: `staging`
- stable alias: `https://vr-dex-web-env-staging-basicbit.vercel.app`
- deploy command from the repository root: `pnpm dlx vercel@54.4.1 deploy --target=staging --yes`

The `staging` Vercel environment points at the shared Convex development deployment:

- `NEXT_PUBLIC_CONVEX_URL=https://scrupulous-corgi-247.convex.cloud`
- `CONVEX_URL=https://scrupulous-corgi-247.convex.cloud`
- `VRDEX_REQUIRE_CONVEX_URL=true`
- `NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY=false`
- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_BROWSER_TOKEN`: sensitive value matching GitHub Actions secret `VRDEX_HOSTED_E2E_BROWSER_TOKEN`
- `VRDEX_E2E_CONVEX_SECRET`: sensitive value matching Convex dev env `VRDEX_E2E_CONVEX_SECRET`

GitHub Actions uses these repository settings for hosted mutation health:

- variable `VRDEX_HOSTED_E2E_BASE_URL=https://vr-dex-web-env-staging-basicbit.vercel.app`
- secret `VRDEX_HOSTED_E2E_BROWSER_TOKEN`

## Validation

The Vercel build runs `pnpm build:vercel`, which executes `apps/web/scripts/check-vercel-env.mjs` before `next build`.

The validation fails when:

- Playwright fixtures are enabled.
- public submissions are marked auth-ready before auth exists.
- `NEXT_PUBLIC_CONVEX_URL` is invalid.
- `NEXT_PUBLIC_CONVEX_URL` points at localhost during a Vercel build.
- `VRDEX_REQUIRE_CONVEX_URL=true` and `NEXT_PUBLIC_CONVEX_URL` is missing.

## Live smoke check

After a preview deployment, visit:

- `/` for the public shell
- `/deployment` for Vercel environment and commit metadata
- `/server-status` for the server-side Convex read baseline
- `/submit` to confirm signed-out users are routed to sign in before writing

The PR workflow posts a `Vercel Preview Deployment` comment with both the preview URL and `/deployment` URL once Vercel secrets are configured.
