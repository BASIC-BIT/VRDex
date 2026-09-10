# Contributor local-first design

Date: 2026-09-09, seed section revised 2026-09-10. Status: approved design.
Decided with BASIC in a grilling session; the facts behind each choice are in
`contributor-access-research-2026-09-09.md` and the rationale in
`contributor-access-recommendation-2026-09-09.md`.

## Goal

Outside contributors can clone VRDex, run it with realistic data, make a
change, and run the checks, without any cloud account or shared secret.
Maintainers can preview a fork pull request on demand without widening who
holds credentials.

## Decisions

### 1. License: MIT, holder BASIC BIT LLC

- Root `LICENSE` file, MIT text, copyright line `BASIC BIT LLC`.
- `"license": "MIT"` added to the root manifest and to every workspace
  package manifest so a future publish of the MCP package carries it.
- No contributor agreement and no DCO. GitHub's terms supply inbound-equals-
  outbound for any repository carrying a license notice.
- No data license now. The contributor page states in one line that MIT
  covers the code and that directory data is not covered by it.
- Ships as its own pull request, authored and merged by BASIC.

Rejected: Apache-2.0 (patent grant and NOTICE obligations buy nothing for a
community project), AGPL (copyleft on code protects nothing VRDex values;
the value is the data and the hosted service), staying unlicensed (blocks
the first outside PR from being safely merged).

### 2. Seed: `pnpm seed:local`

- A new internal mutation `localFixtures:ensureAll` inserts a fake dataset
  straight into the tables, copying the pattern of
  `convex/hostedSmokeFixtures.ts`: lookup by slug, insert or patch, refuse a
  slug owned by a non-fixture record, write the search document, write one
  audit row on creation.
- Dataset: the Playwright fixture people, community, world, and two events,
  ported field for field into table shapes. The `basicbit` fixture is left
  out because it is a real profile; every seeded slug starts with
  `playwright-`. Every outbound URL uses an `.invalid` host.
- Event times are relative to seed time, one event a week ahead and one a
  month behind, so the upcoming lane is never empty no matter when the seed
  runs.
- The mutation refuses to run unless the deployment URL is loopback, via a
  new `requireLocalDeployment` helper, so it cannot touch a cloud deployment
  even if invoked there.
- `pnpm seed:local` runs the existing local runner with `--once --run
  localFixtures:ensureAll`. It is a separate command, not part of
  `bootstrap:backend:local`, because bootstrap doubles as CI's generated-code
  check.
- Idempotent: a second run patches the same records and adds nothing.
- Growing the dataset is a follow-up, driven by which screens contributors
  report as empty.

Rejected after fact-finding: the permissioned seed-import pipeline (person
profiles only, eleven allowed fields, refuses files inside the repo, lands
private, and needs hand-run review mutations to publish); a committed
`convex export` archive (stale binary).

### 3. Auth: bring your own Clerk dev instance

- Contributors who touch sign-in create a free Clerk development instance
  and set the publishable key and secret key in `apps/web/.env.local`, and
  the JWT issuer domain on the local Convex deployment.
- The contributor page names the three variables and where each goes.
- `convex/auth.config.ts` currently pins local deployments to an
  unresolvable issuer. It changes to use `CLERK_JWT_ISSUER_DOMAIN` when set
  on a local deployment and the unresolvable placeholder otherwise, so the
  default still rejects every token and a contributor who sets the variable
  gets a working sign-in.
- No shared Clerk instance, no auth stub. Everything else runs with Clerk
  absent, which the app already supports.

### 4. Fork previews: maintainer-triggered

- The existing comment trigger (`@vrdex preview` or `/vercel-preview`, posted
  by an OWNER, MEMBER, or COLLABORATOR) becomes the way a fork PR gets a
  preview. The fork-head rejection is removed from the trigger path.
- The deploy job still uses the existing Vercel token, org and project IDs,
  and the Convex preview deploy key. For fork heads it withholds the hosted
  end-to-end browser token and the auth and adapter helper flags, so the
  preview exists but the hosted test lane does not run against untrusted
  code.
- The workflow resolves the PR head SHA at trigger time, checks out exactly
  that SHA, and the result comment names it. Nothing else changes about the
  comment.
- `pull_request_target` is not introduced anywhere.
- Maintainer guidance is a new "Fork pull requests" section on the existing
  preview deployment page: read the whole diff including lockfile and
  scripts before triggering; the deployed SHA is the one named in the
  comment; the Vercel token can reach every project in the team; re-review
  after every push before triggering again.

### 5. Worktree guard: keep, make the message generic

- `scripts/guard-main-worktree.mjs` keeps blocking scripts on `main`.
- The suggested worktree path in its message becomes a generic relative
  example instead of a machine-specific absolute path.

### 6. Contributor documentation

- New published page `docs/engineering/local-development.md` with these
  sections in order: prerequisites (Node 24, pnpm 10, git, no cloud
  accounts); the five commands (install, bootstrap, seed, backend, web);
  what works with no credentials and what does not; adding your own Clerk
  dev instance; running checks, naming which lanes need Python or Docker
  and that CI runs everything on every PR; how previews happen; the one-line
  license and data note; a link to the existing contributor-workflow
  quality contract.
- New root `CONTRIBUTING.md`, under ten lines, pointing at that page.
- `README.md` getting-started block gains the seed step and a link to the
  page. No other README changes.
- No `verify:contrib` script. The page documents subsets instead.

### 7. Delivery

- PR A: LICENSE and manifest license fields. BASIC's.
- PR B: seed file and script, preview workflow changes, guard message,
  contributor page, CONTRIBUTING.md, README edit, preview-page maintainer
  section, and these three planning documents. Agent PR to READY with review
  iteration; VRDex is not a never-merge repo, but merge waits for BASIC.

## Testing

- Seed: a convex-test test runs the mutation twice and asserts record counts
  are unchanged the second time and that the public profile, world, upcoming
  event, and discovery queries return the fixtures. A data test asserts every
  seeded URL host ends in `.invalid` and every slug starts with `playwright-`.
  A guard test asserts `requireLocalDeployment` rejects cloud URLs.
- Guard: existing behaviour unchanged; a test only if one already exists
  for the script.
- Preview workflows: no fork can be exercised from CI. Verification is a
  maintainer-triggered dry run on a same-repo branch confirming the SHA
  appears in the comment and the hosted lane is skipped when the fork-head
  condition is forced true, plus `actionlint` if the repo already runs it.
- Docs: existing markdownlint and Verify Docs lanes. Bare autolinks are
  rejected by the docs build, so links use bracket syntax.

## Out of scope

- A data license.
- A mock Clerk provider.
- Curating good-first-issue labels.
- Granting any outside contributor COLLABORATOR.
- Any change to production, staging, or the Convex and Vercel teams.
