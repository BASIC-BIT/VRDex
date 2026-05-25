# Web App

This is the initial `Next.js` app surface for `VRDex`, now wired to the placeholder Convex runtime path.

## Commands

From the repo root:

```bash
pnpm install
pnpm bootstrap:backend:local
pnpm dev:backend:local
pnpm dev:web
```

Useful follow-up commands:

```bash
pnpm lint:web
pnpm typecheck:web
pnpm build:web
pnpm build:web:vercel
```

## Notes

- app location: `apps/web`
- framework baseline: `Next.js` App Router
- language baseline: `TypeScript`
- styling baseline: `Tailwind CSS`
- the app mounts a Convex provider baseline and the homepage performs a live `health:status` query when `apps/web/.env.local` contains `NEXT_PUBLIC_CONVEX_URL`; the local Convex bootstrap now mirrors that value automatically from the repo-root Convex bootstrap output
- the server-side Convex baseline lives at `/server-status` and uses `fetchQuery` from a server component without replacing the reactive client pattern on `/`
- the hosted deployment baseline lives at `/deployment` and reports Vercel metadata, backend URL readiness, and the current submission auth gate
- auth and billing wiring still belong to follow-on issues
