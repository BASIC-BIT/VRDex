# Convex Backend

This directory holds the initial Convex backend slice for `VRDex`.

- `health.ts` exposes the placeholder public query `health:status`
- `schema.ts` defines the base `profiles` table for people/communities and the first `worlds` table
- `auth.config.ts` names the Clerk issuer Convex trusts; `http.ts` registers the app's HTTP routes
- `_identity.ts` resolves a Clerk identity to a `users` row; `users.ts` provisions it on demand
- `accounts.ts` exposes current-viewer helpers and the verified-Discord lookup claiming uses
- `_profileSlugs.ts` contains pure profile slug validation, generation, and lookup helpers
- `_profileStates.ts` contains pure claim-state and trust-label helpers
- `_profilePermissions.ts` contains pure profile read/write permission baseline helpers
- `_profileFieldVisibility.ts` contains public, unlisted, and private field visibility helpers
- `_profileOwnership.ts` contains profile owner singleton and claim approval helpers
- `_profilePublic.ts` contains public profile projection helpers
- `_profileSubmissions.ts` contains community submission sanitization helpers
- `_profileLinks.ts` contains the outbound profile link type list, normalization, and the provenance-stamping sanitizer every link writer goes through
- `_inputValidation.ts` contains the shared untrusted-input primitives used by seed imports and profile link normalization
- `profileClaims.ts` exposes claim request, Discord, and VRChat proof-code flows
- `profiles.ts` exposes public profile reads and authenticated community submission mutations
- `profileMediaSubmissions.ts` keeps community-proposed profile media private until an authorized review decision
- `_worldIds.ts` contains VRChat world id and canonical URL helpers
- `_worldSlugs.ts` contains pure world slug validation, generation, and lookup helpers
- `_worldPublic.ts` contains public world projection helpers
- `worlds.ts` exposes public world reads
- `_eventSlugs.ts`, `_eventInputs.ts`, `_eventPublic.ts`, and `_vrcdnLinks.ts` contain event slug, input, public projection, and VRCDN URL helpers
- `_eventMediaControl.ts` contains event media-control command, fallback-link, worker-schedule, artifact-link, and public-state projection helpers
- `_vrcdnOutputAccounts.ts` contains configured operator-owned VRCDN output accounts and hides credential references from public account options
- `_billing.ts` contains Stripe subscription status normalization and internal entitlement-state helpers
- `events.ts` exposes public event reads, authenticated event editor mutations, and token-gated event media worker bridge mutations
- `_communityTelemetry.ts` contains group-telemetry metric, cadence, coverage, and redaction helpers
- `_communityTelemetryPublic.ts` contains the sanitized public telemetry projection shared by web, API, and MCP reads
- `communityTelemetry.ts` exposes community-authorized telemetry settings and the collector control plane
- `crons.ts` schedules bounded telemetry rollups and retention compaction
- `migrations.ts` contains deploy-time data backfills for schema additions
- `_searchDocuments.ts`, `_publicSearch.ts`, `_vocabulary.ts`, `search.ts`, and `suppressions.ts` contain public discovery, vocabulary, and suppression helpers
- `_generated/` contains committed Convex codegen output and should not be edited by hand
- `tsconfig.json` is the Convex-managed TypeScript config for backend functions

Use the repo-root scripts for local work:

- `pnpm bootstrap:backend:local`
- `pnpm dev:backend:local`
- `pnpm run:backend:health:local`
- `pnpm typecheck:backend`
- `pnpm check:backend:generated`
- `pnpm ops:event-media:ecs-bridge`

The canonical workflow notes live in `docs/backend/convex-bootstrap.md`.

The profile schema and community submission contracts live in `docs/backend/profile-schema.md` and `docs/backend/community-submissions.md`.

The slug, permission, and claim-state contracts live in `docs/backend/profile-slugs.md` and `docs/backend/profile-access-and-claims.md`.

The first world-discovery planning contract lives in `docs/planning/world-discovery.md`.

The event schema and profile-association contracts live in `docs/backend/event-schema.md`.

Search, discovery, and vocabulary contracts live in `docs/backend/search-discovery.md` and `docs/backend/vocabulary-model.md`.

The first-pass billing state and Stripe bootstrap direction live in `docs/backend/billing-foundation.md`.

The aggregate group-telemetry contracts live in `docs/planning/community-group-telemetry.md`.
