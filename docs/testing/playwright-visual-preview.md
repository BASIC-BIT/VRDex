# Playwright visual preview

Playwright gives VRDex a lightweight screenshot loop before full visual regression gates exist.

## Local commands

- Smoke public routes: `pnpm test:e2e`
- Capture public route screenshots: `pnpm test:e2e:visual`
- Reuse already-running local services: set `PLAYWRIGHT_REUSE_SERVER=true` and `PLAYWRIGHT_REUSE_CONVEX=true`

The visual suite starts a local Convex backend and Next dev server by default. Profile screenshots use deterministic Next-server fixtures when `VRDEX_ENABLE_PLAYWRIGHT_FIXTURES=true`, while `/server-status` still exercises the real local Convex health query. Fixture profiles are disabled when `NODE_ENV=production`.

## Captured routes

- `/`
- `/submit`
- `/server-status`
- `/deployment`
- `/p/playwright-dj-aurora`
- `/c/playwright-afterglow-social`
- `/w/playwright-neon-harbor`

Screenshots are written to `apps/web/playwright-artifacts/screenshots` and attached to the Playwright report.

## CI behavior

The `Playwright Public Preview` job is required on pull requests. It:

- runs `pnpm test:e2e:visual`
- uploads `apps/web/playwright-report`, `apps/web/test-results`, and `apps/web/playwright-artifacts`, failing if no artifact files are found
- posts or updates a PR comment with the run outcome and artifact link

This blocks PRs when public route rendering or screenshot capture fails. Pixel review is still artifact-based until committed baseline snapshots and a separate diff gate are added.
