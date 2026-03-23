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
```

## Notes

- app location: `apps/web`
- framework baseline: `Next.js` App Router
- language baseline: `TypeScript`
- styling baseline: `Tailwind CSS`
- the app mounts a Convex provider baseline and the homepage performs a live `health:status` query when repo-root `.env.local` contains `CONVEX_URL`; `NEXT_PUBLIC_CONVEX_URL` can override it explicitly if needed
- auth, billing, and deployment wiring still belong to follow-on issues
