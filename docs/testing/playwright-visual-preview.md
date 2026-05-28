# Playwright visual preview

Playwright gives VRDex a lightweight screenshot loop before full visual regression gates exist.

## Local commands

- Smoke public routes: `pnpm test:e2e`
- Capture public route screenshots: `pnpm test:e2e:visual`
- Reuse already-running local services: set `PLAYWRIGHT_REUSE_SERVER=true` and `PLAYWRIGHT_REUSE_CONVEX=true`

PowerShell data-flow run with video:

```powershell
$env:VRDEX_ENABLE_E2E_HELPERS="true"; $env:VRDEX_E2E_BROWSER_TOKEN="local-playwright-token"; $env:VRDEX_E2E_CONVEX_SECRET="local-convex-e2e-secret"; $env:PLAYWRIGHT_RECORD_VIDEO="true"; pnpm --filter web exec playwright test --grep "@flow" --project=desktop-chromium
```

POSIX shell data-flow run with video:

```sh
VRDEX_ENABLE_E2E_HELPERS=true VRDEX_E2E_BROWSER_TOKEN=local-playwright-token VRDEX_E2E_CONVEX_SECRET=local-convex-e2e-secret PLAYWRIGHT_RECORD_VIDEO=true pnpm --filter web exec playwright test --grep @flow --project=desktop-chromium
```

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

## Data-flow coverage

The `@flow` Playwright test is the first mutation-backed journey. It:

- opens `/submit` with a test-only cookie
- submits a person profile through the browser
- writes the profile into Convex through the server-gated E2E route
- reads the generated public profile page
- searches discovery for the submitted display name
- captures screenshots for both readback pages
- cleans up the E2E-created profile, search document, and audit event by slug

The helper route is disabled unless all of these are true:

- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_BROWSER_TOKEN` is configured and matches the request cookie or header
- `VRDEX_E2E_CONVEX_SECRET` is configured and matches the Convex helper mutation secret

Do not enable these helpers in production. They are for local, CI, and disposable preview/dev deployments.

## CI behavior

The `Playwright Public Preview` job is required on pull requests. It:

- runs `pnpm test:e2e:visual`
- uploads `apps/web/playwright-report`, `apps/web/test-results`, and `apps/web/playwright-artifacts`, failing if no artifact files are found
- posts or updates a PR comment with the run outcome and artifact link

This blocks PRs when public route rendering or screenshot capture fails. Pixel review is still artifact-based until committed baseline snapshots and a separate diff gate are added.

The `Playwright Data Flow` job is also required on pull requests. It runs the `@flow` test against local Convex and the local Next dev server with `PLAYWRIGHT_RECORD_VIDEO=true`, then uploads screenshots, traces, and videos as the `playwright-data-flow` artifact and posts a PR comment with the artifact link.
