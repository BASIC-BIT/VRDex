# VRDex

`VRDex` is a VRChat-first scene directory product centered on people, communities, public identity pages, and an opinionated agent-first software-factory workflow.

## Repository structure

- `AGENTS.md` - repo-wide agent rules and durable workflow defaults
- `AGENTS.local.md.example` - local operator preference template for `AGENTS.local.md`
- `apps/web` - initial `Next.js` web application scaffold
- `convex` - initial Convex backend functions, schema, and generated API types
- `docs/README.md` - docs entry point
- `docs/planning/` - product, architecture, roadmap, backlog, and issue-planning docs
- `docs/agentic/` - software-factory, onboarding, and agent workflow docs
- `docs/backend/` - backend setup notes and implementation-facing docs
- `.opencode/skills/` - repo-local skills, including onboarding

## Local bootstrap

- install workspace dependencies: `pnpm install`
- install git hooks after dependency changes if needed: `pnpm prepare`
- bootstrap an anonymous local Convex deployment and run the backend health query: `pnpm bootstrap:backend:local`
- keep the local Convex backend watcher running: `pnpm dev:backend:local`
- run the Convex health query against the local backend: `pnpm run:backend:health:local`
- typecheck Convex backend files: `pnpm typecheck:backend`
- re-run the local backend verification pass: `pnpm verify:backend:local`
- confirm committed Convex codegen is current: `pnpm check:backend:generated`
- run the web app: `pnpm dev:web`
- lint the web app: `pnpm lint:web`
- typecheck the web app: `pnpm typecheck:web`
- build the web app: `pnpm build:web`
- run the baseline local verification pass: `pnpm verify`

Convex writes repo-root deployment configuration to `.env.local` during local setup and keeps anonymous local state under `.convex-home/` plus `.convex-tmp/`. Keep all of those uncommitted. The committed `convex/_generated/` files are expected to stay clean after `pnpm check:backend:generated`.

## Start here

- product/planning context: `docs/planning/README.md`
- agentic/software-factory context: `docs/agentic/README.md`
- contributor workflow contract: `docs/agentic/contributor-workflow.md`
- repo-wide agent defaults: `AGENTS.md`

## Current direction

Important planning note:

- some items in this repo are still first-pass assumptions
- where a product decision is not locked, it should be treated as a candidate direction to validate in later interviews

Currently locked stack direction:

- `Next.js`
- `TypeScript`
- `Convex`
- `AWS`
- `Stripe`
- `Docusaurus`
- `Vercel`

Currently locked product posture:

- open source
- self-hostable
- public documentation
- public-facing API with clear rate limiting
- infrastructure as code in the repo

The strongest opening is not another event calendar.

The strongest opening is a canonical public profile layer for VRChat people and communities:

- person profiles for DJs, VJs, hosts, photographers, performers, and scene staff
- community profiles for clubs, VRChat groups, Discord servers, brands, and venues
- community-created entries that can later be claimed by the actual owner
- Discord and VRChat verification so claimed profiles become trusted
- export and integration surfaces for Discord bots, booking tools, and event sites

The product can also act like a VR-native Linktree with richer identity, events, and trust signals.

Current working domain: `vrdex.net`

## Recommended starting point

If you build this as a real product next, the best local references are `D:\bench\vrchat-mcp` for VRChat integration patterns and `D:\bench\vrc-in-world-schedule` for simple public endpoints.

Do not depend on VRCTL / `vrc.tl` access from this environment.

## Suggested first build slice

1. Public person and community profile pages
2. Community submission flow
3. Claim profile with Discord OAuth
4. Claim profile with VRChat proof code
5. Discord bot commands that return profile cards
6. Field-level privacy controls and profile customization
7. Basic import/export hooks for partners
