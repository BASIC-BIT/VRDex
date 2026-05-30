# Convex Environments

## Locked Decision

VRDex keeps three Convex execution targets separate:

- local development: anonymous local Convex from `pnpm dev:backend:local` or `pnpm verify:backend:local`
- deployed smoke testing: the shared development Convex deployment
- production release: the production Convex deployment

## Current Deployments

Do not commit deploy keys. Store them in GitHub/hosting secret stores and local ignored env files only.

Current recommendation: define environment variable names and target scopes in docs or IaC first, then set secret values through provider secret stores. Manual Convex dashboard edits should be treated as bootstrap/emergency changes and followed by a reproducibility update here or in automation.

- development cloud URL: `https://scrupulous-corgi-247.convex.cloud`
- production cloud URL: `https://superb-pig-954.convex.cloud`

GitHub Actions secret names:

- `CONVEX_DEPLOY_KEY_DEV`: development deployment key
- `CONVEX_DEPLOY_KEY_PROD`: production deployment key used by the main-branch deploy workflow

Local ignored env names:

- `CONVEX_DEPLOY_KEY_DEV`
- `CONVEX_DEPLOY_KEY_PROD`
- `CONVEX_URL_DEV`
- `CONVEX_URL_PROD`

## Hosted E2E Helpers

Hosted mutation-backed Playwright runs use only the shared development/staging target. Do not enable these helpers in production.

Development/staging Convex env names:

- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_CONVEX_SECRET`: non-empty sentinel also configured in the hosted app environment

The browser-facing token stays in the web host and GitHub Actions as `VRDEX_E2E_BROWSER_TOKEN` / `VRDEX_HOSTED_E2E_BROWSER_TOKEN`; it is not needed by Convex.

## Notes

There are two similarly named Convex projects in the account history: `vrdex` and `vrdex-85631`. Current recommendation is to keep the `vrdex` line of deployments and archive/delete the other only after confirming no dashboard, env, or deployment history still depends on it.
