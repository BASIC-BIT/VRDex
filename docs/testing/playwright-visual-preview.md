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
- `/p/playwright-dj-aurora`
- `/c/playwright-afterglow-social`

Screenshots are written to `apps/web/playwright-artifacts/screenshots` and attached to the Playwright report.

## CI behavior

The `Playwright Public Preview` job is advisory for now. On pull requests it:

- runs `pnpm test:e2e:visual`
- uploads `apps/web/playwright-report`, `apps/web/test-results`, and `apps/web/playwright-artifacts`
- posts or updates a PR comment with the run outcome and artifact link

This intentionally captures review evidence without blocking early UI iteration on pixel diffs. Once the public UI stabilizes, the next step is to add committed baseline snapshots and a separate diff gate.
