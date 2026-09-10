# Local development

## Purpose

How to run VRDex on your own machine with no cloud account, no shared
secret, and realistic fake data. This is the contributor path. Maintainers
use the same commands plus the hosted lanes described under
[deployment](../deployment/vercel-preview.md).

## Prerequisites

- Node 24 (`node --version` prints `v24.x`)
- pnpm 10 (`corepack enable` then `pnpm --version`)
- git
- No Convex, Vercel, or Clerk account

Windows, macOS, and Linux all work. The local Convex backend downloads its
own binary on first run.

## Five commands

```bash
pnpm install
pnpm bootstrap:backend:local
pnpm seed:local
pnpm dev:backend:local
pnpm dev:web
```

Run the last two in separate shells. The web app is at
`http://localhost:3000`. Bootstrap writes `NEXT_PUBLIC_CONVEX_URL` into
`apps/web/.env.local` for you.

Scripts refuse to run on the `main` branch. Work on a branch or a worktree;
the guard prints the command to create one.

## What works without credentials

- Every public page: profiles, communities, worlds, events, search, discovery
- The seeded dataset: twelve people, one community, one world, two events,
  all under `playwright-` slugs with `.invalid` links
- The whole check suite (see below) and the Playwright data-flow tests

## What needs something extra

- Sign-in and anything behind it: your own Clerk development instance
  (next section)
- Discord verification, VRChat proof, Twitch liveness, uploads, email, and
  rate limiting: real provider credentials. Playwright stubs cover these in
  tests; the dev server leaves them disabled.

## Adding your own Clerk instance

Create a free Clerk application, switch to its development instance, and add
a JWT template named `convex`. Then:

1. In `apps/web/.env.local` set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
   `CLERK_SECRET_KEY` from the Clerk dashboard (both `pk_test_` and
   `sk_test_`).
2. On the local backend set the issuer:

   ```bash
   pnpm cx local env set CLERK_JWT_ISSUER_DOMAIN https://<your-slug>.clerk.accounts.dev
   ```

3. Restart `pnpm dev:backend:local` and `pnpm dev:web`.

Without the issuer variable the local backend rejects every token on
purpose.

## Running checks

`pnpm verify` runs everything CI runs on a pull request. Two lanes need
tools beyond Node:

- `test:temporal-inference` needs Python 3
- `check:restream:ffmpeg` needs Docker and FFmpeg, and only runs when
  restream files change

Skip those locally if you do not have the tools. CI runs every lane on every
pull request, including ones from forks, so nothing is lost.

Useful subsets: `pnpm lint:web`, `pnpm typecheck:web`, `pnpm test:web`,
`pnpm typecheck:backend`, `pnpm test:backend`, `pnpm test:e2e`.

## Previews

Preview deployments need repository secrets, so they are not automatic for
fork pull requests. A maintainer reviews your diff and comments
`@vrdex preview` on the pull request; the bot replies with the preview URL
and the exact commit it deployed. Push again and the maintainer has to
re-review and re-trigger.

## License and data

Code in this repository is under the
[MIT license](https://github.com/BASIC-BIT/VRDex/blob/main/LICENSE). Directory
data served by VRDex is not covered by that license.

## Quality contract

Definition of ready, definition of done, and the evidence a pull request
carries are in
[the contributor workflow](../agentic/contributor-workflow.md).
