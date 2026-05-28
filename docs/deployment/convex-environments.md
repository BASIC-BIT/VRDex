# Convex Environments

## Locked Decision

VRDex keeps three Convex execution targets separate:

- local development: anonymous local Convex from `pnpm dev:backend:local` or `pnpm verify:backend:local`
- deployed smoke testing: the shared development Convex deployment
- production release: the production Convex deployment

## Current Deployments

Do not commit deploy keys. Store them in GitHub/hosting secret stores and local ignored env files only.

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

## Notes

There are two similarly named Convex projects in the account history: `vrdex` and `vrdex-85631`. Current recommendation is to keep the `vrdex` line of deployments and archive/delete the other only after confirming no dashboard, env, or deployment history still depends on it.
