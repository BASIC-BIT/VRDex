# Club invitation browser flow

`apps/web/e2e/club-invitation.flow.spec.ts` exercises real Clerk sessions, Convex authorization and the production route components. It does not intercept authentication or substitute fixture query responses.

The test checks an anonymous private-route redirect, authenticated nonstaff page and query denial, an anonymous invitation page, the sign-in link's exact return destination, automatic navigation back after sign-in, acceptance, subsequent workspace access, and expired/revoked/consumed token denial. Invitations are created and revoked through the ordinary owner API. Only expiry time is adjusted by test support.

## Execution prerequisites

Use a local Convex backend or the designated staging backend `https://scrupulous-corgi-247.convex.cloud`. The fixture helper rejects every other deployment using Convex's deployment-owned `CONVEX_CLOUD_URL`; there is no production override. The Next route also rejects `VERCEL_ENV=production`.

The target must run this revision's web application and backend functions. Configure these before running:

- A Clerk **development** instance, its publishable key and secret key, and the `convex` JWT template with audience `convex`. Runner variables: `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
- The same publishable key on Next, plus the matching `CLERK_JWT_ISSUER_DOMAIN` on Convex. Local Convex permits this explicit development issuer; its default invalid issuer cannot authenticate this test.
- Both `VRDEX_ENABLE_E2E_HELPERS=true` and `VRDEX_ENABLE_E2E_AUTH_HELPERS=true` on Next and Convex.
- A matching `VRDEX_E2E_CONVEX_SECRET` on Next and Convex. Keep this server-side.
- `CONVEX_ADMIN_TOKEN` (or the existing supported admin-token alias) on Next for the internal fixture calls. Keep this server-side.
- `VRDEX_E2E_BROWSER_TOKEN` on Next and the runner.
- Runner flags `VRDEX_ENABLE_E2E_CLERK_AUTH=true` and `VRDEX_E2E_CLUB_INVITATIONS=true`. An enabled test fails if prerequisites are absent; the default disabled test is skipped, not proof of coverage.
- `PLAYWRIGHT_BASE_URL` pointing at the running web server, and `PLAYWRIGHT_CONVEX_URL` pointing at its matching backend. Set both explicitly even for a local server to avoid the default config starting a different backend.

From `apps/web`, run:

```powershell
node node_modules/@playwright/test/cli.js test club-invitation.flow.spec.ts --project=desktop-chromium --reporter=list
```

The test creates two disposable `+clerk_test@e2e.vrdex.net` users, which suppress Clerk email delivery. It seeds one private `e2e-club-*` profile with an exact provenance marker and records the run ID as a test annotation. No group connection or VRChat operation occurs. Traces, screenshots and video are disabled for this test because URLs contain invitation tokens.

Cleanup resolves the exact seeded profile even if its creation response was lost, then deletes only its bounded role, assignment, invitation, visibility, action-log and ownership rows. Cleanup refuses a fixture with a group connection or event. It then invokes the existing disposable account cleanup and removes the Clerk users. A cleanup failure fails the run; preserve the annotated run ID for recovery.

## Local verification without Clerk credentials

```powershell
node --conditions=import --import tsx --test tests/backend/e2e-club-staff.test.ts tests/backend/club-staff-review.test.ts tests/web/club-workspace-model.test.ts
```

These verify the fixture guard, exact-target cleanup, backend acceptance boundaries, middleware invitation exception and return-path encoding. They do not establish that Clerk redirects correctly in a browser. The authenticated browser segment still needs the configured development instance above.

## Authenticated analytics navigation

`apps/web/e2e/club-analytics.flow.spec.ts` uses the same real Clerk setup and additionally requires `VRDEX_E2E_CLUB_ANALYTICS=true` on the runner and `VRDEX_ENABLE_E2E_ANALYTICS_HELPERS=true` on the local backend. This fixture rejects hosted deployments, including staging. Run it by substituting `club-analytics.flow.spec.ts` in the command above.

The synthetic integration is blocked, kill-switched, and has no collector account or lease. Its group/world/instance identifiers are explicit test markers, not provider identifiers. It cannot be collected or execute provider work. Eighteen marked observation rows and one closed session supply deterministic chart data. Analytics cleanup validates the exact profile provenance, integration marker and inactive configuration, session identity, and bounded observation counts before deletion. Ordinary fixture cleanup continues refusing integrations and events; the analytics fixture must be removed first.

The test exercises personal dashboard persistence across reload, month/day navigation with native browser back/forward, instance drilldown, and field-level staff category restrictions through real authenticated backend queries. It creates disposable development users and cleans them and the exact fixture afterwards. Browser captures are disabled; Playwright page snapshots are also suppressed because authentication and invitation URLs may contain tokens.
