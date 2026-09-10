# Contributor access recommendation: local-first, owner-gated previews

Decision date: 2026-09-09. Status: recommendation for BASIC, nothing changed.
Companion facts: `contributor-access-research-2026-09-09.md` (vendor docs) and the
repo survey summarised below.

## The question

Should outside contributors get scoped cloud access (push Vercel previews, read
the shared dev Convex deployment), or should fully-local development be the
first-class contributor path?

## Recommendation

Make local development the contributor contract. Keep previews owner-gated
exactly as they are today. Do not add outside contributors to the Convex,
Vercel, or Clerk teams.

## Why the cloud-access model does not fit

- **Convex cannot express "dev only".** Only two team roles exist. A
  Developer "may read data from production deployments" and is invited at the
  team level, not per project. There is no read-only credential type, and every
  deploy key in this repo is write-capable. Granting the dev database means
  granting a prod read.
- **There is no shared dev database primitive.** Convex allocates one cloud
  dev deployment per team member and each holds its own data. The thing the
  question imagines sharing is really the staging deployment behind
  `CONVEX_DEPLOY_KEY_DEV`, which `staging-deploy.yml` deploys `main` into.
- **Seats cost money and widen the blast radius.** Convex Professional is
  $25 per developer per month; a Vercel Developer seat is $20 per month and a
  Vercel Project Viewer can examine environment variables across all
  environments.
- **Clerk dev keys are still secrets.** The `sk_test_` secret key is a backend
  credential; sharing one instance is not a supported pattern.
- **House policy already says so.** The perkcord contributor handoff
  (basic-life, 2026-09-03) concluded that same-repo collaborator branches can
  reach credential-bearing preview lanes, and that contribution CI must be
  secretless with owner-gated deployments. VRDex has the same shape.

## Why local-first is the cheaper path

The repo is already most of the way there:

- `README.md` day-one path (`bootstrap:backend:local`, `dev:backend:local`,
  `dev:web`) boots with zero third-party credentials. `convex/auth.config.ts`
  substitutes a fake Clerk issuer for local deployments and the web app runs
  without `ClerkProvider` when no publishable key is set.
- The entire PR-time test suite (`baseline-checks.yml`) runs against the local
  anonymous backend on port 3210. The hosted Playwright lane auto-skips without
  secrets. Fork PRs already run under first-time-contributor approval.
- Stub adapters for Discord, VRChat, and VRCLinking proof exist as in-app
  routes and are wired by `playwright.config.mjs` and
  `scripts/sync-convex-local-env.mjs`.
- `vercel-preview-deploy.yml` refuses fork heads and the comment trigger
  requires OWNER, MEMBER, or COLLABORATOR. That is the owner gate; keep it.
- Local anonymous Convex is proven on Windows on this machine (the shared
  port 3210 note in session memory) even though Convex docs never state it.

## Gaps to close (in order)

1. **Seed command.** A fresh local backend is empty and the README never says
   so. Add `pnpm seed:local` that loads the existing obviously-fake fixture
   set (the Playwright profiles, events, and worlds) into local Convex through
   the fixture mutations already in `convex/e2e.ts`. No new data, no new
   format.
2. **CONTRIBUTING.md.** One page: prerequisites, the four commands, what runs
   without credentials, what needs a personal Clerk dev instance, how to run
   `pnpm verify`, and that previews are requested by a maintainer.
3. **Clerk for sign-in flows.** Contributors who touch auth create their own
   free Clerk dev instance and set the two keys plus
   `CLERK_JWT_ISSUER_DOMAIN` on their local Convex. Document it; do not build a
   Clerk stub.
4. **`scripts/guard-main-worktree.mjs`.** The error text hard-codes
   `D:/bench/VRDex-wt`. Make the suggested path relative or generic.
5. **Preview flow for fork PRs.** No workflow change. A maintainer who wants a
   preview of a fork PR pushes that head to a same-repo branch and comments
   `@vrdex preview`. Write that down in CONTRIBUTING.

## Decisions only BASIC can make

- **License.** The repo is public with no LICENSE file, so outside
  contributions arrive under unclear terms. Perkcord chose proprietary plus a
  signed agreement; VRDex being public suggests an OSS license. Either way,
  choose before inviting anyone.
- **Whether a trusted regular later gets COLLABORATOR.** That role unlocks the
  preview comment trigger and same-repo branches, which reach
  `CONVEX_DEPLOY_KEY_PREVIEW` and `VERCEL_TOKEN`. Treat it as a separate,
  later decision.

## Explicitly not recommended

- Sharing `CONVEX_DEPLOY_KEY_DEV` or the staging Convex URL with contributors.
- Enabling Vercel fork preview authorisation by default.
- Adding `pull_request_target` to any workflow.
- Building a mock Clerk provider.
