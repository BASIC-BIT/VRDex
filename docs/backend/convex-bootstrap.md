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
- the web app consumes `health:status` as the first real `Next.js -> Convex` runtime path, mounting a client-side provider baseline and surfacing the result in the homepage without inventing early product schema
- the web app also exposes `/server-status`, where a server component uses `fetchQuery` against the same `health:status` function as the initial server-side baseline

## Local workflow

1. Install dependencies with `pnpm install`.
2. Bootstrap an anonymous local deployment and verify the health query with `pnpm bootstrap:backend:local`.
3. Keep `pnpm dev:backend:local` running while editing backend files.
4. Run `pnpm run:backend:health:local` from a second terminal when you want the same one-shot placeholder health check without using the verify script name directly.
5. Run `pnpm dev:web` if you want to confirm the homepage can render the live `health:status` response through the web app.
6. Run `pnpm typecheck:backend` before shipping backend edits.
7. Run `pnpm check:backend:generated` before pushing schema or function changes that may affect `convex/_generated/`.

If you want the full repo gate, use `pnpm verify`. If you only need the web app checks, keep using `pnpm verify:web`.

Notes:

- Convex writes deployment configuration to the repo-root `.env.local` file.
- The local Convex wrapper mirrors the repo-root `CONVEX_URL` into `apps/web/.env.local` as `NEXT_PUBLIC_CONVEX_URL` so the web app can follow the normal client-side Convex + Next.js convention without leaking a non-public variable through server props.
- That same `NEXT_PUBLIC_CONVEX_URL` value is also what `fetchQuery` uses for the current server-side baseline route, so local client and server reads share one deployment setting.
- Anonymous local backend state for this repo is kept under `.convex-home/` and `.convex-tmp/` so the bootstrap does not collide with other Convex projects on the same machine.
- The current bootstrap is local-development focused. Production deploy keys, preview deployments, and frontend environment wiring belong to follow-on issues.
- Committed files in `convex/_generated/` are treated as checked-in build artifacts and should remain diff-free after `pnpm check:backend:generated`.

## Structure rule

Keep the initial backend slice simple:

- add new schema and functions under `convex/`
- avoid introducing product tables until the relevant issue defines the domain slice
- prefer small, typed functions over placeholder complexity

## Follow-on issues

- `#55` wires the web app to the first Convex client/runtime path using `health:status`
- `#64` adds the first server-side `Next.js -> Convex` data path with `fetchQuery` on `/server-status`
- schema, auth, billing, and production deployment posture should land in their own issues instead of bloating the bootstrap

## App Router baseline

The current rule is intentionally narrow:

- use `useQuery` inside client components when the UI should stay reactive after first render
- use `fetchQuery` inside server components when the page only needs a server-side read
- defer `preloadQuery` until a real feature needs server-rendered first paint plus a hydrated reactive handoff

This keeps the first App Router pattern copyable without introducing multiple competing baselines before auth and domain work arrive.
