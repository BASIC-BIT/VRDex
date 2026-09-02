# Playwright visual preview

Playwright gives VRDex a lightweight screenshot loop and a committed-baseline visual regression gate.

See `docs/testing/playwright-image-diffing.md` for the committed-baseline image diff workflow. Screenshot preview and image diffing are intentionally separate checks.

## Local commands

- Smoke public routes and run the local mutation-backed data flow: `pnpm test:e2e`
- Capture public route screenshots: `pnpm test:e2e:visual` (the signed-in
  `account-surfaces` suite shares the `@visual` tag but skips here — it needs a
  hosted target, see [Signed-in screenshots](#signed-in-screenshots))
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

The focused authentication contract is:

```powershell
pnpm test:e2e:hosted:auth-session
```

It is hosted-only. `convex/auth.config.ts` deliberately pins local deployments
to the unresolvable issuer `https://clerk-issuer.invalid`, so a local backend
rejects every Clerk token by design and no test wiring changes that — point
`PLAYWRIGHT_BASE_URL` at a hosted target and supply the Clerk keys below.

The three-browser `test:e2e:auth-session-matrix` lane was removed with #226. It
drove persistent browser profiles to exercise Convex Auth refresh-token
rotation; Clerk owns sessions now, so there is nothing of ours left in that
path to assert.

Before an authentication-sensitive release, manually check the ordinary
remembered-session and explicit-sign-out paths in current Firefox and Safari
with default privacy settings. Repeat in Firefox Strict Tracking Protection
when practical. Record the browser versions and settings used. Private
browsing, extensions, containers, enterprise policy, and Playwright WebKit are
separate environments; do not claim coverage for one from results in another.

Setting `PLAYWRIGHT_BASE_URL` switches Playwright to hosted mode and disables local web servers.

Local webserver runs set token-gated E2E helper defaults so `pnpm test:e2e` includes the mutation-backed `@flow` journey without additional env setup.

Profile screenshots use deterministic Next-server fixtures when `VRDEX_ENABLE_PLAYWRIGHT_FIXTURES=true`. Fixture profiles are disabled when `NODE_ENV=production`.

## Captured routes

- `/`
- `/submit`
- `/sign-in`
- `/account`
- `/search?q=aurora`
- `/support`
- `/privacy/suppression` (redirects to `/support?topic=owner_opt_out`)
- `/playwright/event-editor`
- `/playwright-dj-aurora`
- `/playwright-afterglow-social`
- `/playwright-neon-harbor`
- `/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions`

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

## Auth-backed E2E

Issue #226 rewired the auth half of the suite onto `@clerk/testing`. Two of the
four specs it covered were not rewired but deleted, because their subject matter
went away with Convex Auth rather than changing hands:

- `account-sessions.flow.spec.ts` drove reauthentication challenges and session
  revocation. `docs/backend/auth-sessions.md` records that the step-up was
  replaced by in-page confirmations, and nothing in `apps/web/src` mentions
  reauth any more.
- The three-browser matrix in `auth-session.flow.spec.ts` drove
  `__convexAuth` cookies and hand-seeded `absolute_expired` / `invalid_refresh`
  / `revoked` session rows. `_browserSessionAuthority.ts` records that Clerk
  collapsed `revoked` into plain `anonymous`.

What runs now:

- `auth-claim.flow.spec.ts` — person and community claiming, VRChat adapter
  claims, and the negative helper-gate check
- `developer-credentials.flow.spec.ts` — v0 bearer tokens and OAuth PKCE. Its
  `RECENT_AUTH_REQUIRED` step-up block went with the step-up itself.
- `auth-session.flow.spec.ts` — rewritten as the seam contract: whether a Clerk
  session resolves to a *verified Convex identity* on this deployment. That is
  what a `convex` JWT template missing `aud` or `email_verified`, or a
  `CLERK_JWT_ISSUER_DOMAIN` naming a different instance than the publishable
  key, actually breaks — none of which a build catches.
- `account-surfaces.visual.spec.ts` — signed-in screenshot coverage, described
  below.

### Signed-in screenshots

Every other visual spec renders a public route or a Playwright fixture route, so
the account surfaces — the ones that exist *because* somebody is signed in — had
no screenshot coverage. `account-surfaces.visual.spec.ts` captures `/account`,
`/account/privacy`, and `/developers/tokens` after signing in with a disposable
Clerk account.

It is tagged `@visual`, `@flow` **and** `@account-visual`, which is what places
it. `pnpm test:e2e:visual` runs against local servers, and a local Convex
deployment pins `clerk-issuer.invalid` so it trusts no Clerk instance — sign-in
cannot succeed there, and the suite skips.

**`pnpm test:e2e:hosted` does not run it.** That command excludes
`@account-visual`, because this is the one suite that needs both projects — the
account surfaces have a distinct mobile layout, and the hosted command pins
`--project=desktop-chromium`. Its own command runs both:

```sh
pnpm test:e2e:hosted:account-visual
```

It needs `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_SKIP_WEBSERVERS=true`,
`VRDEX_E2E_BROWSER_TOKEN`, `VRDEX_ENABLE_E2E_AUTH_HELPERS`,
`VRDEX_ENABLE_E2E_CLERK_AUTH`, and the staging Clerk pair
(`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) — a development
instance, since `clerkSetup()` refuses a production secret key. It needs no new
repository settings; CI already holds all of them.

CI runs it twice, for different reasons. `Playwright Hosted Data Flow` runs it
per PR, against staging, which serves `main` — so it catches a spec that cannot
sign in or tears down badly, but cannot vouch for how the PR's own UI renders.
`Staging Deploy` runs it after deployment, where staging holds the merged commit,
which is the run that actually photographs the revision under test.

Two switches gate it, and **they do not behave the same way**:

- `VRDEX_HOSTED_E2E_CLERK_AUTH` skips. It is the rollout switch: unset, the suite
  produces no coverage and says so. Both CI steps are additionally gated on it,
  so the step reports `skipped` rather than a `success` that photographed
  nothing.
- `VRDEX_HOSTED_E2E_AUTH_HELPERS` **fails** on a hosted target. Deliberately:
  `clerkTestAuthAvailability()` throws when Clerk auth is on and the helpers are
  off, because that combination is a request for auth coverage against a target
  that cannot provide it. With the helpers off, `DELETE /api/e2e/auth` answers
  403, so the teardown would look successful while every run left a `users` row
  keyed to a deleted Clerk identity. That is a misconfiguration to surface, not
  a state to skip over — and the throw happens at module load, before any
  `test.skip` could run.

Assertions name signed-in-only elements exactly — "Personal tokens", "No owned
profiles yet" — and assert the signed-out headings are *absent*. Loose matchers
like `/tokens/i` match "Sign in required", so they pass precisely when the
screenshot is worthless.

A fresh account owns no profile, so `/account/privacy` captures the empty state
rather than the field-visibility editor. Capturing the populated editor needs an
account that owns a profile, which is what `auth-claim.flow.spec.ts` builds.

Captures land in `apps/web/playwright-artifacts/screenshots` and upload with the
hosted data-flow artifact. They are not committed baselines: the `@snapshot` lane
diffs Linux-rendered PNGs under `apps/web/e2e/__screenshots__`, and there is
nothing to diff against until a run has produced some worth committing.

Accounts come from `apps/web/e2e/clerk-auth.ts`: the Clerk Backend API creates
the user (which arrives with its email already verified, and so with
`email_verified` in the token), `setupClerkTestingToken` bypasses bot
protection, and a one-time sign-in ticket replaces the removed form. Teardown
deletes both sides — the Clerk user and, through `/api/e2e/auth`, the Convex
rows keyed to it. Convex never hears about a Clerk deletion on its own, because
provisioning is on-demand from the client rather than webhook-driven.

These specs need Clerk credentials, so they run on hosted targets only and skip
locally. Two switches gate them, and they are deliberately separate:
`VRDEX_HOSTED_E2E_AUTH_HELPERS` says the deployment exposes `/api/e2e/auth`;
`VRDEX_HOSTED_E2E_CLERK_AUTH` says CI holds credentials for that deployment's
Clerk instance. **With the second unset the auth specs skip; with it set to
`true` and the keys missing they fail rather than skip.** That asymmetry is the
point — the removed `Playwright Auth Session Matrix` lane reported green for
months over a spec that ran nothing.

Profile submission above is unaffected and still runs locally.

The helper route is disabled unless all of these are true:

- `VRDEX_ENABLE_E2E_HELPERS=true`
- `VRDEX_E2E_BROWSER_TOKEN` is configured and matches the request cookie or header
- `VRDEX_E2E_CONVEX_SECRET` is configured for the server route and Convex helper deployment

The browser token gates the Next.js helper route. The Convex secret is never sent to the browser; the server route passes it to the public Convex E2E mutations so direct Convex calls also need the matching deployment secret.

`/api/e2e/auth` is back, narrower than before. It no longer mints accounts or
sessions — Clerk does both — and its `consume-code` and `set-session-state`
actions are gone with the Convex Auth tables they named. What is left is the
VRDex-side state a claim depends on and no external provider can seed during a
test: `link-discord` writes the Discord verification watermark,
`record-guild-proof` stands in for the Discord OAuth round-trip, and `DELETE`
tears down the Convex rows for an account. It exists as a route rather than
direct Convex calls from the specs because `VRDEX_E2E_CONVEX_SECRET` must not
reach the browser or the test runner; Playwright only ever holds the browser
token.

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

It also requires Clerk credentials in the runner, which are repository settings rather than deployment ones:

- repository variable `VRDEX_HOSTED_E2E_CLERK_AUTH=true`
- repository secrets `VRDEX_HOSTED_E2E_CLERK_PUBLISHABLE_KEY` and `VRDEX_HOSTED_E2E_CLERK_SECRET_KEY`

These must be the **development** instance backing the hosted target, not production. `clerkSetup()` rejects a production secret key outright, and `apps/web/scripts/check-vercel-env.mjs` already requires `pk_test`/`sk_test` on every non-production Vercel build, so the correct pair is the one the target itself runs on.

**Owner:** BASIC (repository owner) holds the Clerk dashboard and GitHub repository-settings access for both. There is no shared or team-held copy.

**What the secret key can do:** create, read, and delete users on the staging Clerk development instance, and mint sign-in tickets for them. It cannot touch the production tenant — a separate instance with separate keys — and it is never placed on a deployment, only in the Actions runner.

**Rotating the secret key only** — the common case, and what compromise or maintainer turnover calls for. The instance, its publishable key, and the issuer are unchanged:

1. In the Clerk dashboard, on the **development** instance for the VRDex application, open **API keys** and rotate the secret key.
2. `gh secret set VRDEX_HOSTED_E2E_CLERK_SECRET_KEY`.
3. Re-run `Deploy Staging`, then confirm with `pnpm test:e2e:hosted:auth-session`.

**Moving staging to a different Clerk instance** — a recreated instance, or a deliberate migration. This is a manual sequence, not a workflow input. It is done rarely and by hand, and automating it inside `Staging Deploy` would mean rolling back two providers and rewriting a repository variable from CI to be correct.

The order matters because the pre-deploy check compares the configured issuer against the key the deployment currently serves, and that check never skips:

1. On the new instance, create the JWT template named exactly `convex` from Clerk's Convex preset. **Templates do not carry across instances**, and no issuer check can see this — they compare hosts — so a move without it passes every comparison while Clerk cannot mint the token Convex expects.
2. Set the Vercel staging `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to the new instance's pair, and deploy Vercel so staging serves them. **Staging authentication is down from here until step 4**, because Convex still trusts the old issuer. That window is inherent to changing two providers that must agree; it is short and expected, not a fault.
3. `gh variable set VRDEX_STAGING_CLERK_JWT_ISSUER_DOMAIN --body https://<new-frontend-api-host>`, then `gh secret set` for both `VRDEX_HOSTED_E2E_CLERK_PUBLISHABLE_KEY` and `VRDEX_HOSTED_E2E_CLERK_SECRET_KEY`.
4. Run `Deploy Staging`. The pre-deploy check now compares the new issuer against the new key staging already serves, so it agrees and the deploy proceeds.
5. Confirm with `pnpm test:e2e:hosted:auth-session`. This is what actually proves the JWT template, since it asserts a Clerk session resolves to a *verified Convex identity*.

Doing step 3 before step 2 makes step 4 abort at the pre-deploy check, which is the guard working: the issuer would not match what staging serves.

Hosted developer-credential E2E additionally requires repository variable `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true`. Keep it unset until the hosted target has deployed the developer token routes, OAuth app registration routes, and OAuth token endpoints under test.

Hosted adapter E2E additionally requires `VRDEX_ENABLE_E2E_ADAPTER_HELPERS=true` in the hosted app and these Convex env values on the shared development deployment:

- `DISCORD_API_BASE_URL=<hosted app URL>/api/e2e/adapters/discord`
- `DISCORD_BOT_TOKEN=<staging-only adapter token>`
- `VRCHAT_PROOF_ADAPTER_URL=<hosted app URL>/api/e2e/adapters/vrchat-proof`
- `VRCLINKING_PROOF_ADAPTER_URL=<hosted app URL>/api/e2e/adapters/vrchat-proof`
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN=<staging-only adapter token>`
- `VRCLINKING_ADAPTER_CAPABILITY_KEY=<staging-only signing key>` — signs the
  per-delegation capability the VRCLinking adapter verifies as
  `VRDEX_VRCLINKING_CAPABILITY_KEY`. Keep it distinct from the bearer token

GitHub Actions only runs hosted extended profile, auth, adapter, and developer-credential flows when repository variables `VRDEX_HOSTED_E2E_EXTENDED_PROFILE_FLOW=true`, `VRDEX_HOSTED_E2E_AUTH_HELPERS=true`, `VRDEX_HOSTED_E2E_ADAPTER_HELPERS=true`, `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true`, and `VRDEX_HOSTED_E2E_CLERK_AUTH=true` are set. Keep the optional variables unset until the matching hosted app and Convex capabilities are configured. `VRDEX_HOSTED_E2E_CLERK_AUTH` is the one that is not merely a skip switch: once it is `true`, absent Clerk keys fail the run.

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

The final `PR Verification Report` job runs after the Playwright and Storybook jobs. It collates their results, artifact links, and changed visual baselines into one marker-based PR comment that is updated in place. Changed baselines appear as a complete inline image gallery inside a collapsed details section so reviewers can inspect every snapshot without filling the default PR view. The producer jobs do not write PR comments. The report job also removes legacy per-job comments when it first runs on an existing pull request.

The `Deployed Health Checks` workflow runs after merges to `main`, after successful GitHub deployment status events for production deployments, on a daily schedule, and through manual dispatch. It has two independent checks:

- `Hosted Data Flow Health` uses `VRDEX_HOSTED_E2E_BASE_URL` and `VRDEX_HOSTED_E2E_BROWSER_TOKEN` to run scheduled or manually dispatched mutation-backed hosted flow checks against a dev/staging target.
- `Production Smoke Health` uses the production deployment status URL when the workflow was triggered by a successful production deployment, otherwise `VRDEX_PRODUCTION_SMOKE_BASE_URL`, to run read-only public route smoke against production.

Manual dispatch can run `all`, `staging-mutation`, or `production-smoke`. The optional `base_url` override applies only when dispatching a single selected target. The deployed health workflow uploads artifacts and fails the workflow on test failure, but it does not create GitHub issues automatically.

The merge-triggered `Staging Deploy` workflow runs the auth-session contract
after the matching Convex and Vercel deployment is live, which is the point of
running it there: on a `push` it fired while those deployments were still going
out, so it asserted against the *previous* deployment and reported that as the
health of this one. Scheduled and manually dispatched staging health repeat the
same contract.

The contract asserts that a Clerk session resolves to a verified Convex identity
on that deployment. It uses only disposable `@e2e.vrdex.net` accounts created on
the staging Clerk development instance and deleted in the same run, and the
staging helper boundary. With `VRDEX_HOSTED_E2E_CLERK_AUTH` unset it skips; with
it set and the Clerk keys absent it fails.

Both staging Playwright runs write to distinct report and results directories,
because Playwright clears those when a run starts and the second invocation would
otherwise discard the first run's evidence before it was uploaded.

Production authenticated smoke is a separate manual one-shot option. Supply a
fresh base64-encoded Playwright storage state for the disposable production
test account, select `production_auth`, and discard the state after the run.
The runner performs no business/domain mutation; normal authentication refresh
rotation may still occur. Its dedicated configuration disables traces,
screenshots, video, and reports, and prints only one of:
`missing_state`, `configuration_missing`, `auth_state_rejected`, `transport_failure`,
`server_failure`, or `passed`. Do not enable it on schedules or upload its
output as an artifact.

Current hosted mutation target: `https://staging.vrdex.net`, backed by the shared Convex development deployment. The deployed health workflow run `26695304658` passed `staging-mutation` after the Vercel staging custom domain was configured.
