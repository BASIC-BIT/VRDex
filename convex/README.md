# Convex Backend

This directory holds the initial Convex backend slice for `VRDex`.

- `health.ts` exposes the placeholder public query `health:status`
- `schema.ts` keeps the starting schema explicit and intentionally empty
- `_generated/` contains committed Convex codegen output and should not be edited by hand
- `tsconfig.json` is the Convex-managed TypeScript config for backend functions

Use the repo-root scripts for local work:

- `pnpm bootstrap:backend:local`
- `pnpm dev:backend:local`
- `pnpm run:backend:health:local`
- `pnpm typecheck:backend`
- `pnpm check:backend:generated`

The canonical workflow notes live in `docs/backend/convex-bootstrap.md`.
