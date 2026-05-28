# Convex Backend

This directory holds the initial Convex backend slice for `VRDex`.

- `health.ts` exposes the placeholder public query `health:status`
- `schema.ts` defines the base `profiles` table for people/communities and the first `worlds` table
- `auth.ts` and `http.ts` configure Convex Auth providers and HTTP routes
- `accounts.ts` exposes current viewer and linked-provider helpers
- `_profileSlugs.ts` contains pure profile slug validation, generation, and lookup helpers
- `_profileStates.ts` contains pure claim-state and trust-label helpers
- `_profilePermissions.ts` contains pure profile read/write permission baseline helpers
- `_profileFieldVisibility.ts` contains public, unlisted, and private field visibility helpers
- `_profileOwnership.ts` contains profile owner singleton and claim approval helpers
- `_profilePublic.ts` contains public profile projection helpers
- `_profileSubmissions.ts` contains community submission sanitization helpers
- `profileClaims.ts` exposes claim request, Discord, and VRChat proof-code flows
- `profiles.ts` exposes public profile reads and authenticated community submission mutations
- `_worldIds.ts` contains VRChat world id and canonical URL helpers
- `_worldSlugs.ts` contains pure world slug validation, generation, and lookup helpers
- `_worldPublic.ts` contains public world projection helpers
- `worlds.ts` exposes public world reads
- `_eventSlugs.ts`, `_eventInputs.ts`, and `_eventPublic.ts` contain event slug, input, and public projection helpers
- `events.ts` exposes public event reads and authenticated event editor mutations
- `migrations.ts` contains deploy-time data backfills for schema additions
- `_searchDocuments.ts`, `_vocabulary.ts`, `search.ts`, and `suppressions.ts` contain public discovery, vocabulary, and suppression helpers
- `_generated/` contains committed Convex codegen output and should not be edited by hand
- `tsconfig.json` is the Convex-managed TypeScript config for backend functions

Use the repo-root scripts for local work:

- `pnpm bootstrap:backend:local`
- `pnpm dev:backend:local`
- `pnpm run:backend:health:local`
- `pnpm typecheck:backend`
- `pnpm check:backend:generated`

The canonical workflow notes live in `docs/backend/convex-bootstrap.md`.

The profile schema and community submission contracts live in `docs/backend/profile-schema.md` and `docs/backend/community-submissions.md`.

The slug, permission, and claim-state contracts live in `docs/backend/profile-slugs.md` and `docs/backend/profile-access-and-claims.md`.

The first world-discovery planning contract lives in `docs/planning/world-discovery.md`.

The event schema and profile-association contracts live in `docs/backend/event-schema.md`.

Search, discovery, and vocabulary contracts live in `docs/backend/search-discovery.md` and `docs/backend/vocabulary-model.md`.
