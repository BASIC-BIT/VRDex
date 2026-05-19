# Convex Backend

This directory holds the initial Convex backend slice for `VRDex`.

- `health.ts` exposes the placeholder public query `health:status`
- `schema.ts` defines the base `profiles` table for people and communities
- `_profileSlugs.ts` contains pure slug validation, generation, and lookup helpers
- `_profileStates.ts` contains pure claim-state and trust-label helpers
- `_profilePermissions.ts` contains pure read/write permission baseline helpers
- `_profilePublic.ts` contains public profile projection helpers
- `_profileSubmissions.ts` contains community submission sanitization helpers
- `profiles.ts` exposes public profile reads and authenticated community submission mutations
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
