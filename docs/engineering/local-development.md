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

`/` is the lookup surface and stays empty until you search, so it is not
where you check the seed. Open `http://localhost:3000/discovery` for the
seeded feed, or a slug directly such as `/playwright-dj-aurora`.

Scripts refuse to run on the `main` branch. Work on a branch or a worktree;
the guard prints the command to create one.

## What works without credentials

- Every public page. Profiles, communities, and worlds live at their slug
  (`/playwright-dj-aurora`), events under their owner
  (`/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions`),
  and `/discovery` and `/search` list them
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

`pnpm verify` runs most of what CI runs on a pull request. Beyond Node it
needs Python 3, for the `test:temporal-inference` lane it ends with.

The restream `proof:restream:*` and `check:restream:*` scripts need FFmpeg,
because they run `ffprobe` over the recorded playlist. They are not part of
`verify`. Only the path-gated `Restream Local Checks` CI lane runs them, and
only when restream files change.

`verify` also does not cover the Playwright Data Flow and Image Diff lanes or
the three Storybook lanes. A green `verify` is a good signal, not a promise of
a green pull request. Skip the lanes whose tools you do not have; CI runs the
rest on your pull request. Two of them do not run for a fork: the hosted
Playwright lane is skipped for fork heads, and the Terraform check needs the
repository's AWS role.

Useful subsets: `pnpm lint:web`, `pnpm typecheck:web`, `pnpm test:web`,
`pnpm typecheck:backend`, `pnpm test:backend`, `pnpm test:e2e`. Stop the
backend watcher before `pnpm test:e2e`; it boots its own local Convex on port
3210 and collides with a running `pnpm dev:backend:local`.

## Previews

Preview deployments need repository secrets, so no pull request gets one
automatically, whether it comes from a fork or from a branch in this
repository. A maintainer reviews your diff and comments `@vrdex preview` on
the pull request; the bot replies with the preview URL and the exact commit
it deployed. Push again and the maintainer has to re-review and re-trigger,
because the workflow refuses to build a head that moved after the comment.

## License and data

Code in this repository is under the
[MIT license](https://github.com/BASIC-BIT/VRDex/blob/main/LICENSE). Directory
data served by VRDex is not covered by that license.

## Quality contract

Definition of ready, definition of done, and the evidence a pull request
carries are in
[the contributor workflow](../agentic/contributor-workflow.md).
