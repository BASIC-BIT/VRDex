# Playwright visual preview

Playwright gives VRDex a lightweight screenshot loop and a committed-baseline visual regression gate.

See `docs/testing/playwright-image-diffing.md` for the committed-baseline image diff workflow. Screenshot preview and image diffing are intentionally separate checks.

## Local commands

- Smoke public routes and run the local mutation-backed data flow: `pnpm test:e2e`
- Capture public route screenshots: `pnpm test:e2e:visual`
- Compare public route screenshots against baselines: `pnpm test:e2e:snapshots`
- Update public route screenshot baselines: `pnpm test:e2e:snapshots:update`
- Reuse already-running local services: set `PLAYWRIGHT_REUSE_SERVER=true` and `PLAYWRIGHT_REUSE_CONVEX=true`
- Run the mutation-backed flow against a hosted dev/staging target: set `PLAYWRIGHT_BASE_URL` and `VRDEX_E2E_BROWSER_TOKEN`, then run `pnpm test:e2e:hosted`
- Run read-only smoke against a hosted production target: set `PLAYWRIGHT_BASE_URL`, then run `pnpm test:e2e:hosted:smoke`. Hosted smoke covers production-safe public routes only; fixture-backed profile/search expectations stay local because Vercel must not expose Playwright fixtures.

PowerShell data-flow run with video:

```powershell
$env:VRDEX_ENABLE_E2E_HELPERS="true"; $env:VRDEX_E2E_BROWSER_TOKEN="local-playwright-token"; $env:VRDEX_E2E_CONVEX_SECRET="local-convex-e2e-secret"; $env:PLAYWRIGHT_RECORD_VIDEO="true"; pnpm --filter web exec playwright test --grep "@flow" --project=desktop-chromium
```

POSIX shell data-flow run with video:

```sh
VRDEX_ENABLE_E2E_HELPERS=true VRDEX_E2E_BROWSER_TOKEN=local-playwright-token VRDEX_E2E_CONVEX_SECRET=local-convex-e2e-secret PLAYWRIGHT_RECORD_VIDEO=true pnpm --filter web exec playwright test --grep @flow --project=desktop-chromium
```

PowerShell hosted dev/staging data-flow run:

```powershell
$env:PLAYWRIGHT_BASE_URL="https://dev.example.test"; $env:PLAYWRIGHT_SKIP_WEBSERVERS="true"; $env:VRDEX_E2E_BROWSER_TOKEN="<browser-token>"; $env:VRDEX_E2E_RUN_ID="manual-$(Get-Date -Format yyyyMMddHHmmss)"; pnpm test:e2e:hosted
```

POSIX shell hosted dev/staging data-flow run:

```sh
PLAYWRIGHT_BASE_URL=https://dev.example.test PLAYWRIGHT_SKIP_WEBSERVERS=true VRDEX_E2E_BROWSER_TOKEN=<browser-token> VRDEX_E2E_RUN_ID="manual-$(date +%Y%m%d%H%M%S)" pnpm test:e2e:hosted
```

PowerShell hosted production smoke run:

```powershell
$env:PLAYWRIGHT_BASE_URL="https://vrdex.net"; $env:PLAYWRIGHT_SKIP_WEBSERVERS="true"; pnpm test:e2e:hosted:smoke
```

POSIX shell hosted production smoke run:

```sh
PLAYWRIGHT_BASE_URL=https://vrdex.net PLAYWRIGHT_SKIP_WEBSERVERS=true pnpm test:e2e:hosted:smoke
```

The local Playwright suite starts a local Convex backend and Next dev server by default.

Setting `PLAYWRIGHT_BASE_URL` switches Playwright to hosted mode and disables local web servers.

Local webserver runs set token-gated E2E helper defaults so `pnpm test:e2e` includes the mutation-backed `@flow` journey without additional env setup.

Profile screenshots use deterministic Next-server fixtures when `VRDEX_ENABLE_PLAYWRIGHT_FIXTURES=true`. Fixture profiles are disabled when `NODE_ENV=production`.

## Captured routes

- `/`
- `/submit`
- `/sign-in`
- `/account`
- `/search?q=aurora`
- `/privacy/suppression`
- `/events/new`
- `/events/playwright-afterglow-harbor-sessions/edit`
- `/deployment`
- `/p/playwright-dj-aurora`
- `/c/playwright-afterglow-social`
- `/w/playwright-neon-harbor`
- `/e/playwright-afterglow-harbor-sessions`

Legacy `/discover?q=...` URLs redirect to `/search?q=...`; plain `/discover` redirects to `/`.

Screenshots are written to `apps/web/playwright-artifacts/screenshots` and attached to the Playwright report.

## Data-flow coverage

The `@flow` Playwright test is the first mutation-backed journey. It:

- opens `/submit` with a test-only cookie
- verifies helper POST/DELETE calls are rejected without the Playwright token
- submits a person profile through the browser
- writes the profile into Convex through the server-gated E2E route
- captures the post-submit success state
- reads the generated public profile page
- searches discovery for the submitted display name
- captures screenshots for both readback pages
- cleans up the E2E-created profile, search document, and audit event by slug

The local `@flow` suite also covers the first auth/claim path without real OAuth or SES:

- creates an `@e2e.vrdex.local` email/password account through the sign-in UI
- captures the one-time verification code through a token-gated E2E auth helper
- verifies the email with Convex Auth
- links a Discord account through a token-gated E2E helper
- claims an E2E-created person profile through the account UI
- verifies the public profile moves to the `Claimed` trust label
- cleans up the test user, auth records, profile owner, claim request, and E2E profile

The helper route is disabled unless all of these are true:

- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_BROWSER_TOKEN` is configured and matches the request cookie or header
- `VRDEX_E2E_CONVEX_SECRET` is configured for the server route and Convex helper deployment

The browser token gates the Next.js helper route. The Convex secret is never sent to the browser; the server route passes it to the public Convex E2E mutations so direct Convex calls also need the matching deployment secret.

Auth helper routes also require `VRDEX_ENABLE_E2E_AUTH_HELPERS=true` and only accept `@e2e.vrdex.local` emails. Local Playwright webserver runs set this automatically; hosted staging must opt in explicitly before hosted auth/claim flows run.

Adapter helper routes require `VRDEX_ENABLE_E2E_ADAPTER_HELPERS=true` and are used only by Convex actions during E2E tests. Local Playwright webserver runs point Convex at local Discord and VRChat/VRCLinking adapter stubs so the UI exercises the real claim actions without real Discord, VRChat, or VRCLinking calls.

Do not enable these helpers in production. They are for local, CI, and disposable preview/dev deployments.

Hosted dev/staging targets must be configured outside this repository before running `pnpm test:e2e:hosted`:

- Next/Vercel env: `VRDEX_ENABLE_E2E_HELPERS=true`
- Next/Vercel env: `VRDEX_E2E_BROWSER_TOKEN=<same value used by Playwright>`
- Next/Vercel env: `VRDEX_E2E_CONVEX_SECRET=<non-empty sentinel>`
- Convex env: `VRDEX_ENABLE_E2E_HELPERS=true`
- Convex env: `VRDEX_E2E_CONVEX_SECRET=<non-empty sentinel>`

Hosted extended profile field-visibility E2E additionally requires repository variable `VRDEX_HOSTED_E2E_EXTENDED_PROFILE_FLOW=true`. Keep it unset until the hosted target has deployed the E2E profile helper version that accepts aliases, bio, role tags, and `fieldVisibility` in helper payloads.

Hosted auth/claim E2E additionally requires `VRDEX_ENABLE_E2E_AUTH_HELPERS=true` in both the hosted app and Convex deployment. Keep it unset until the staging auth flow is intentionally enabled; production must never enable it.

Hosted developer-credential E2E additionally requires repository variable `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true`. Keep it unset until the hosted target has deployed the developer token routes, OAuth app registration routes, and OAuth token endpoints under test.

Hosted adapter E2E additionally requires `VRDEX_ENABLE_E2E_ADAPTER_HELPERS=true` in the hosted app and these Convex env values on the shared development deployment:

- `DISCORD_API_BASE_URL=<hosted app URL>/api/e2e/adapters/discord`
- `DISCORD_BOT_TOKEN=<staging-only adapter token>`
- `VRCHAT_PROOF_ADAPTER_URL=<hosted app URL>/api/e2e/adapters/vrchat-proof`
- `VRCLINKING_PROOF_ADAPTER_URL=<hosted app URL>/api/e2e/adapters/vrchat-proof`
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN=<staging-only adapter token>`

GitHub Actions only runs hosted extended profile, auth, adapter, and developer-credential flows when repository variables `VRDEX_HOSTED_E2E_EXTENDED_PROFILE_FLOW=true`, `VRDEX_HOSTED_E2E_AUTH_HELPERS=true`, `VRDEX_HOSTED_E2E_ADAPTER_HELPERS=true`, and `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true` are set. Keep the optional variables unset until the matching hosted app and Convex capabilities are configured.

`VERCEL_ENV=production` blocks the E2E route unless `VRDEX_ALLOW_PRODUCTION_E2E_HELPERS=true` is explicitly set. Keep that override unset for VRDex production.

Each data-flow run uses a unique `VRDEX_E2E_RUN_ID` prefix and creates only `e2e:`-attributed profiles. Cleanup deletes by slug on the happy path and can fall back to deleting profiles for the run ID if the slug was not captured.

## CI behavior

The required `Playwright Public Preview` job:

- runs `pnpm test:e2e:visual`
- uploads `apps/web/playwright-report`, `apps/web/test-results`, and `apps/web/playwright-artifacts`, failing if no artifact files are found

This blocks PRs when public route rendering or screenshot capture fails. Pixel review is still artifact-based until committed baseline snapshots and a separate diff gate are added.

The required `Playwright Image Diff` job runs the `@snapshot` suite against committed PNG baselines under `apps/web/e2e/__screenshots__` and uploads expected/actual/diff artifacts on failure.

The required `Playwright Data Flow` job runs the `@flow` test against local Convex and the local Next dev server with `PLAYWRIGHT_RECORD_VIDEO=true`, then uploads screenshots, traces, and videos as the `playwright-data-flow` artifact.

The optional `Playwright Hosted Data Flow` job runs on pull requests only when both repository settings are present:

- repository variable `VRDEX_HOSTED_E2E_BASE_URL`
- repository secret `VRDEX_HOSTED_E2E_BROWSER_TOKEN`

When configured, the job runs `pnpm test:e2e:hosted` with `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_SKIP_WEBSERVERS=true`, `PLAYWRIGHT_RECORD_VIDEO=true`, and a GitHub Actions run-scoped `VRDEX_E2E_RUN_ID`. Extended profile, auth, adapter, and developer-credential flows skip unless `VRDEX_HOSTED_E2E_EXTENDED_PROFILE_FLOW`, `VRDEX_HOSTED_E2E_AUTH_HELPERS`, `VRDEX_HOSTED_E2E_ADAPTER_HELPERS`, and `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS` are explicitly set to `true`.

The final `PR Verification Report` job runs after the Playwright, Storybook, and Vercel preview jobs. It collates their results, artifact links, deployment URLs, and changed visual baselines into one marker-based PR comment that is updated in place. The producer jobs do not write PR comments. The report job also removes legacy per-job comments when it first runs on an existing pull request.

The `Deployed Health Checks` workflow runs after merges to `main`, after successful GitHub deployment status events for production deployments, on a daily schedule, and through manual dispatch. It has two independent checks:

- `Hosted Data Flow Health` uses `VRDEX_HOSTED_E2E_BASE_URL` and `VRDEX_HOSTED_E2E_BROWSER_TOKEN` to run the mutation-backed hosted flow against a dev/staging target.
- `Production Smoke Health` uses the production deployment status URL when the workflow was triggered by a successful production deployment, otherwise `VRDEX_PRODUCTION_SMOKE_BASE_URL`, to run read-only public route smoke against production.

Manual dispatch can run `all`, `staging-mutation`, or `production-smoke`. The optional `base_url` override applies only when dispatching a single selected target. The deployed health workflow uploads artifacts and fails the workflow on test failure, but it does not create GitHub issues automatically.

Current hosted mutation target: `https://staging.vrdex.net`, backed by the shared Convex development deployment. The deployed health workflow run `26695304658` passed `staging-mutation` after the Vercel staging custom domain was configured.
