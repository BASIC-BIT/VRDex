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

`/` is the public search entry. Search for `BASICBIT` or `Afterglow` to check
real local results; new submissions open `/search?q=...`. The preview shows at
most five options and opens canonical entity pages when selected. Home links
to `/discovery` for the seeded feed; slugs such as `/playwright-dj-aurora` also
work directly.

Compatibility checks: nonempty `/?q=BASICBIT` and `/lookup?q=BASICBIT` redirect
to `/search?q=BASICBIT&view=dj`. Whitespace-only root queries stay on public
Home. `/lookup/suggest`, legacy bulk lookup and permission-scoped private seed
access remain unchanged. Public Home/search do not read lookup recents or
request private suggestions. `/discover?q=aurora` redirects to standard search.
Home also includes the continuous Schedule, Agenda, nonmodal event details,
browser-local My night and private DJ/club favorites. No sign-in is required.
Without JavaScript, the interactive schedule is hidden and GET search and
Discovery remain usable. Home also shows poster-led event and club
recommendations below Schedule, using public musical identity and browser-local
favorites. Discovery reaches future dates independently of the Schedule window.

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
it deployed, and the workflow run summary names the same commit. Push again
and the maintainer has to re-review and re-trigger,
because the workflow refuses to build a head that moved after the comment.

## License and data

Code in this repository is under the
[MIT license](https://github.com/BASIC-BIT/VRDex/blob/main/LICENSE). Directory
data served by VRDex is not covered by that license.

## Quality contract

Definition of ready, definition of done, and the evidence a pull request
carries are in
[the contributor workflow](../agentic/contributor-workflow.md).

## Optional local Convex backend pin

`CONVEX_LOCAL_BACKEND_VERSION` is forwarded unchanged to the Convex CLI only for
`dev --local`. An explicit `--local-backend-version VALUE` or
`--local-backend-version=VALUE` takes precedence. An absent/empty environment
value adds no flag. Existing ports, noninteractive force-upgrade and environment
isolation remain in effect; force-upgrade alone does not choose a version.

The dated Task 9 verification pin is exactly
`precompiled-2026-09-28-5c7cb5b`. It is an execution input, not a repository default;
do not append `600`. Verify the isolated cache before ROOT's canonical local
workflow. The CLI may download missing artifacts or manage a dashboard, so this
setting is not an offline guarantee. Record the selected native backend version
and exit status independently. `pnpm check:backend:generated` starts a backend;
run canonical generation first and account for its reviewed generated diff.
The [migration rehearsal](./event-broadcast-rehearsal.md#october-24-2026-task-9-source-prerequisites)
requires its own isolated state and temporary local bindings.

## Home timeline component fixtures

Home mounts the continuous schedule below compact public search using ordinary
public Convex queries. The gated `/playwright/home-timeline` route reuses that
exact Home composition when `VRDEX_ENABLE_PLAYWRIGHT_FIXTURES=true` in a
nonproduction web process. The browser suite exercises actual `/`.

Run its local desktop/mobile flows with:

```bash
pnpm --filter web exec playwright test home-timeline.flow.spec.ts home-discovery.flow.spec.ts --workers=2
```

`e2e/home-timeline-fixture.ts` creates a unique run through
`/api/e2e/home-timeline` and removes that exact run in fixture teardown. The
route requires loopback web and backend targets, the existing E2E browser token,
helper enablement and Convex secret; production web builds always refuse it.
The backend independently requires a deployment-owned loopback
`CONVEX_CLOUD_URL`, enablement and the secret. Convex's bundle `NODE_ENV` is not a
deployment discriminator, including for local development. No hosted fixture
path or production override exists. State-change operations cancel or hide a run-owned fixture event, suppress its
owned host, or recreate its first slot with a new stable ID, after verifying
ownership. The optional
`detail` scenario authors 81 timed slots on one event, two untimed entries and
one hidden person for continuation/privacy checks. It cleans exactly eight
events, three profiles, 87 slots and two lineup entries. Default and prefetch
runs still clean eight events, two profiles and eight slots. The `short-sets`
scenario keeps those same ownership and cleanup counts, changing only ORBIT's
two sets to authored 30-minute and 15-minute intervals for hit-target and
compact-planning checks. The `discovery`
scenario authors two events seven and forty days away, four public profiles
(two clubs and two DJs) with exact public genre assignments, and two confirmed
slots. It cleans exactly two events, four profiles and two slots.
`discovery-sparse` owns one event, four profiles and one slot. The bounded
`discovery-dense` scenario owns 246 events, eight profiles and five slots. Its
240 near-term events sit on day five, alongside day-seven/day-forty examples,
a day-120 match, a repeated host and private/suppressed variants. Its extra
public club has no event; custom public genre labels retain exact slug identity.
The `discovery-clubs` scenario places the original favorite host between 28 extra
public clubs, outside both 12-club samples. It owns exactly two events, 32 profiles
and two slots; the same lease, ownership checks and cleanup verification apply.
This exercises retaining one existing favorite-profile watch while its club
control has focus, releasing it on blur and still removing revoked public data.
The `timeline-visual` scenario adds two score-separated future recommendations
to the original eight Schedule events. It owns ten events, five profiles and ten
slots. Only its new DJ/club IDs are favorites, preserving original Schedule
geometry and favorite emphasis. The derived profile slugs stay within the
canonical 64-character limit. The shared
backend-origin lease covers each complete run through verified cleanup; future
dates must not bypass it. Reuse this helper
for Home checks; do not seed public-query responses or
add unrelated records manually.
Cleanup retries one connection reset. HTTP errors or unconfirmed cleanup counts
still preserve the blocking lease.

`eventTimeline.listPublic` pages event identities only. Its compatible
`TimelineEvent` shape starts with empty `slots` and `performers` and an initial
roster cursor bound to the event, range and chart mode. Native Convex shares the
single-pagination limit with nested queries, so the existing window controller
hydrates all roster phases through separate `listPublicRoster` client calls.
Each roster call reads at most 80 candidates and rechecks public eligibility.
An event's lineup remains partial until its roster cursor is exhausted; event
page completion alone does not establish complete lineup or favorite coverage.
This adds one client roster request per event per fetched window compared with
inline first-page hydration. The ten-page roster budget still applies, with
More for remaining pages.

The schedule's nonmodal detail panel reads canonical event poster/prose through
`events.getPublicBySlug`. `eventTimeline.listPublicRoster` accepts optional
`detail: true` for the complete mixed lineup and eligible favorite IDs, with
80 candidates per page and mode-bound cursors. The panel automatically reads
at most ten pages, then exposes More. Normal chart payloads and range filtering
are unchanged. Detail pages allow public cancelled events and recheck public
host/performer eligibility on every page. Authored rows remain intact; eligible
participant-only fallbacks deduplicate against represented people. Selected sets
can additionally resolve through the existing bounded saved-reference query.
Detail/roster requests ignore superseded selections; focus and 60-second roster
refreshes revalidate independently of the three-window chart cache.
