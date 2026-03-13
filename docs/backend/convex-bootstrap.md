# Convex Backend Bootstrap

## Status note

This doc captures the initial Convex backend slice landed for `#54`.

It is intentionally narrow: enough structure to run Convex locally, generate typed backend helpers, and prove the backend is wired, without prematurely locking product tables or auth decisions.

## Locked decision

- the first backend surface lives in the repo-root `convex/` directory
- the initial bootstrap should stay schema-light and friendly to anonymous local development
- generated Convex types under `convex/_generated/` should be committed

## Current implementation

- `convex/schema.ts` defines an explicit empty schema so later table work starts from a typed baseline instead of ad hoc implicit tables
- `convex/health.ts` exposes a minimal public query, `health:status`, that confirms the backend is reachable without hard-coding early product domain records
- `convex.json` pins Convex to Node `22` so local backend runtime expectations stay aligned with the repo's current Node baseline
- `convex/tsconfig.json` provides the TypeScript settings Convex uses to typecheck backend source files
- `apps/web` now mounts a minimal Convex client/provider path and renders `health:status` on the landing page as the first end-to-end app read

## Local workflow

1. Install dependencies with `pnpm install`.
2. Bootstrap an anonymous local deployment and verify the health query with `pnpm bootstrap:backend:local`.
3. Keep `pnpm dev:backend:local` running while editing backend files.
4. Start the web app with `pnpm dev:web` when you want the frontend to read the local backend through the bridged `NEXT_PUBLIC_CONVEX_URL` value.
5. Run `pnpm run:backend:health:local` from a second terminal when you want the same one-shot placeholder health check without using the verify script name directly.
6. Run `pnpm typecheck:backend` before shipping backend edits.
7. Run `pnpm check:backend:generated` before pushing schema or function changes that may affect `convex/_generated/`.

If you want the full repo gate, use `pnpm verify`. If you only need the web app checks, keep using `pnpm verify:web`.

Notes:

- Convex writes deployment configuration to the repo-root `.env.local` file.
- repo-root web commands copy `CONVEX_URL` from that file into `NEXT_PUBLIC_CONVEX_URL` when available so `apps/web` can use the local backend without a duplicate env file.
- Anonymous local backend state for this repo is kept under `.convex-home/` and `.convex-tmp/` so the bootstrap does not collide with other Convex projects on the same machine.
- The current bootstrap is local-development focused. Production deploy keys, preview deployments, and server-side frontend data patterns belong to follow-on issues.
- Committed files in `convex/_generated/` are treated as checked-in build artifacts and should remain diff-free after `pnpm check:backend:generated`.

## Structure rule

Keep the initial backend slice simple:

- add new schema and functions under `convex/`
- avoid introducing product tables until the relevant issue defines the domain slice
- prefer small, typed functions over placeholder complexity

## Follow-on issues

- `#55` wires the web app to the first Convex client/runtime path
- `#64` should add the first intentional server-side `Next.js` data path into Convex
- schema, auth, billing, and production deployment posture should land in their own issues instead of bloating the bootstrap
