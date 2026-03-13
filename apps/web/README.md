# Web App

This is the initial `Next.js` scaffold for `VRDex`.

## Commands

From the repo root:

```bash
pnpm install
pnpm dev:backend:local
pnpm dev:web
```

Useful follow-up commands:

```bash
pnpm bootstrap:backend:local
pnpm lint:web
pnpm typecheck:web
pnpm build:web
```

## Notes

- app location: `apps/web`
- framework baseline: `Next.js` App Router
- language baseline: `TypeScript`
- styling baseline: `Tailwind CSS`
- repo-root web commands bridge `CONVEX_URL` from `.env.local` into `NEXT_PUBLIC_CONVEX_URL` when local Convex bootstrap has run
- the homepage now renders the placeholder public query `health:status` from `convex/`
- auth, billing, deployment hardening, and server-side Convex patterns still belong to follow-on issues
