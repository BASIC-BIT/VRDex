# Contributor Local-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Outside contributors clone VRDex, seed a local Convex backend with fake data, and run the checks with no cloud account; maintainers can preview a fork PR on demand.

**Architecture:** A loopback-gated internal mutation (`convex/localFixtures.ts`) inserts a fixed fake dataset using the `hostedSmokeFixtures` pattern, invoked through the existing local runner. The two preview workflows accept fork heads only from the maintainer comment trigger, withhold the hosted end-to-end secrets for forks, and name the deployed SHA. Docs and a generic guard message finish the contributor path. The MIT license ships as its own PR.

**Tech Stack:** Convex (local anonymous backend), convex-test with `node:test`, GitHub Actions YAML, Docusaurus docs under `docs/`, pnpm 10, Node 24.

**Spec:** `docs/planning/contributor-local-first-design-2026-09-09.md` (read it first; facts behind it are in `contributor-access-research-2026-09-09.md` and `contributor-access-recommendation-2026-09-09.md`).

## Global Constraints

- Work in the worktree `D:/bench/VRDex-wt/contributor-local-first` on branch `feat/contributor-local-first`, based on `origin/main`. Never run scripts from `D:/bench/VRDex` (the guard blocks `main`).
- Node `>=24 <25`, `pnpm@10.15.1`. Run `pnpm install` once in the worktree before any task.
- Every seeded slug starts with `playwright-`. Every seeded URL host ends with `.invalid`. The `basicbit` fixture is never seeded.
- The seed mutation must throw unless `CONVEX_CLOUD_URL` is a loopback URL.
- Never add `pull_request_target` to any workflow. Never pass `VRDEX_HOSTED_E2E_BROWSER_TOKEN` to a job step when the PR head is a fork.
- Markdown: no bare `<https://...>` autolinks (the docs build rejects them). Run `pnpm lint:markdown` after every docs change.
- Backend tests run with `pnpm test:backend`; script tests with `pnpm test:scripts` if present, otherwise `node --import tsx --test tests/scripts/<file>`. Check `package.json` for the exact script names before running.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Local Convex port 3210 is shared on this machine. If another local backend is already running, set `CONVEX_LOCAL_CLOUD_PORT=3310 CONVEX_LOCAL_SITE_PORT=3311` for manual verification steps.

---

## File map

| File | Responsibility |
| --- | --- |
| `LICENSE` (new, PR A) | MIT text, holder BASIC BIT LLC |
| `package.json`, `packages/*/package.json`, `apps/web/package.json`, `apps/docs/package.json` (PR A) | `"license": "MIT"` field |
| `scripts/guard-main-worktree.mjs` | generic worktree path in the blocked message |
| `convex/_localDeployment.ts` (new) | `requireLocalDeployment(environment)` loopback gate |
| `convex/auth.config.ts` | honour `CLERK_JWT_ISSUER_DOMAIN` on local when set |
| `convex/_localFixtures.ts` (new) | pure fixture data: people, community, world, events |
| `convex/localFixtures.ts` (new) | `ensureAll` internal mutation |
| `package.json` | `seed:local` script |
| `.github/workflows/vercel-preview-comment.yml` | drop fork rejection, pass `is_fork` |
| `.github/workflows/vercel-preview-deploy.yml` | `is_fork` output, withhold hosted secrets for forks, SHA in comment |
| `tests/backend/local-deployment.test.ts` (new) | gate tests |
| `tests/backend/local-fixtures.test.ts` (new) | data invariants and idempotent seed |
| `tests/scripts/workflow-definitions.test.ts` | fork-safety assertions |
| `docs/engineering/local-development.md` (new) | contributor page |
| `apps/docs/sidebars.js`, `docs/README.md`, `docs/engineering/README.md` | links to the new page |
| `CONTRIBUTING.md` (new) | pointer |
| `README.md` | seed step and link |
| `docs/deployment/vercel-preview.md` | "Fork pull requests" maintainer section |

---

### Task 1: MIT license (PR A, separate branch)

**Files:**

- Create: `LICENSE`
- Modify: `package.json:2-3`, `packages/api-contracts/package.json:2-4`, `packages/temporal-runtime/package.json:2-4`, `packages/vrdex-mcp/package.json:2-4`, `apps/web/package.json:2-4`, `apps/docs/package.json:2-4`

**Interfaces:**

- Consumes: nothing
- Produces: a PR BASIC merges. Task 9's contributor page links to `LICENSE` by relative path.

- [ ] **Step 1: Create a separate worktree for PR A**

```bash
git -C D:/bench/VRDex worktree add -b chore/mit-license D:/bench/VRDex-wt/mit-license origin/main
```

- [ ] **Step 2: Write `LICENSE`**

```text
MIT License

Copyright (c) 2026 BASIC BIT LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Add the license field to all six manifests**

In each file, insert `"license": "MIT",` on the line directly after `"name": "...",` (line 2). Example for the root:

```json
{
  "name": "vrdex",
  "license": "MIT",
  "private": true,
```

- [ ] **Step 4: Verify every manifest parses and carries the field**

Run from `D:/bench/VRDex-wt/mit-license`:

```bash
for f in package.json packages/*/package.json apps/web/package.json apps/docs/package.json; do node -e "const p=require('./$f'); if(p.license!=='MIT') process.exit(1); console.log(p.name, p.license)"; done
```

Expected: six lines, each ending in `MIT`, exit 0.

- [ ] **Step 5: Commit and open the PR**

```bash
git add LICENSE package.json packages/*/package.json apps/web/package.json apps/docs/package.json
git commit -m "chore: add MIT license

Copyright holder BASIC BIT LLC. License field added to every workspace
manifest so a future publish carries it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin chore/mit-license
gh pr create --title "Add MIT license" --body "Adds the MIT LICENSE (BASIC BIT LLC) and a license field on every workspace manifest. Decision record: docs/planning/contributor-local-first-design-2026-09-09.md section 1 on the feat/contributor-local-first branch.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Do not merge. BASIC merges this one.

---

### Task 2: Generic worktree guard message

**Files:**

- Modify: `scripts/guard-main-worktree.mjs:56-58`

**Interfaces:**

- Consumes: nothing
- Produces: nothing other tasks rely on

- [ ] **Step 1: Replace the two hardcoded lines**

Current lines 56-58:

```js
console.error("Create a feature worktree under D:/bench/VRDex-wt instead:");
console.error(
  "  git worktree add -b codex/<branch-name> D:/bench/VRDex-wt/<name> origin/main",
);
```

Replace with:

```js
console.error("Create a feature worktree next to this checkout instead:");
console.error(
  "  git worktree add -b <branch-name> ../VRDex-wt/<name> origin/main",
);
```

- [ ] **Step 2: Verify the guard still blocks on main and passes elsewhere**

```bash
cd D:/bench/VRDex && node scripts/guard-main-worktree.mjs; echo "exit=$?"
```

Expected: the message prints with `../VRDex-wt/<name>` and `exit=1` if the shared checkout is on `main`, otherwise `exit=0`. Then:

```bash
cd D:/bench/VRDex-wt/contributor-local-first && node scripts/guard-main-worktree.mjs; echo "exit=$?"
```

Expected: no output, `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add scripts/guard-main-worktree.mjs
git commit -m "chore(scripts): make worktree guard hint machine-neutral

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `requireLocalDeployment` gate

**Files:**

- Create: `convex/_localDeployment.ts`
- Test: `tests/backend/local-deployment.test.ts`

**Interfaces:**

- Produces: `requireLocalDeployment(environment?: Record<string, string | undefined>): void` and `isLocalDeploymentUrl(url: string): boolean`. Task 5 calls `requireLocalDeployment()`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLocalDeploymentUrl, requireLocalDeployment } from "../../convex/_localDeployment";

describe("local deployment gate", () => {
  it("accepts loopback cloud URLs", () => {
    for (const url of [
      "http://127.0.0.1:3210",
      "http://localhost:3210",
      "http://[::1]:3210",
      "http://127.0.0.2:3210",
    ]) {
      assert.equal(isLocalDeploymentUrl(url), true, url);
      assert.doesNotThrow(() => requireLocalDeployment({ CONVEX_CLOUD_URL: url }));
    }
  });

  it("rejects cloud, lookalike, empty, and unparseable URLs", () => {
    for (const url of [
      "https://scrupulous-corgi-247.convex.cloud",
      "https://superb-pig-954.convex.cloud",
      "http://localhost.example.com:3210",
      "http://127.0.0.1.example.com",
      "",
      "not a url",
    ]) {
      assert.equal(isLocalDeploymentUrl(url), false, url);
      assert.throws(
        () => requireLocalDeployment({ CONVEX_CLOUD_URL: url }),
        /Local fixtures only run on a local deployment/,
        url,
      );
    }
    assert.throws(() => requireLocalDeployment({}), /Local fixtures only run on a local deployment/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/backend/local-deployment.test.ts`
Expected: FAIL, cannot find module `../../convex/_localDeployment`.

- [ ] **Step 3: Write the implementation**

```ts
// convex/_localDeployment.ts
//
// Convex sets CONVEX_CLOUD_URL on every deployment, including the throwaway
// one `convex dev --local` creates. Anything that must never touch a hosted
// deployment gates on the URL being loopback, the same test auth.config.ts
// uses to pick the placeholder Clerk issuer.

export type LocalDeploymentEnvironment = Record<string, string | undefined>;

export function isLocalDeploymentUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname;
  if (host === "localhost" || host === "[::1]" || host === "::1") {
    return true;
  }
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function requireLocalDeployment(
  environment: LocalDeploymentEnvironment = process.env,
): void {
  const cloudUrl = environment.CONVEX_CLOUD_URL ?? "";
  if (!isLocalDeploymentUrl(cloudUrl)) {
    throw new Error(
      "Local fixtures only run on a local deployment (CONVEX_CLOUD_URL must be loopback).",
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/backend/local-deployment.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add convex/_localDeployment.ts tests/backend/local-deployment.test.ts
git commit -m "feat(convex): add loopback deployment gate for local fixtures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Honour a contributor's Clerk issuer on local deployments

**Files:**

- Modify: `convex/auth.config.ts:19-21`

**Interfaces:**

- Consumes: nothing
- Produces: nothing programmatic; Task 9 documents `CLERK_JWT_ISSUER_DOMAIN` as the variable to set on the local deployment.

- [ ] **Step 1: Change the issuer selection**

Current lines 19-21:

```ts
const issuerDomain = isLocalDeployment
  ? "https://clerk-issuer.invalid"
  : process.env.CLERK_JWT_ISSUER_DOMAIN;
```

Replace with:

```ts
// On a local deployment a contributor may point the backend at their own
// Clerk development instance by setting CLERK_JWT_ISSUER_DOMAIN on it. When
// it is unset the placeholder keeps every token rejected.
const issuerDomain = isLocalDeployment
  ? (process.env.CLERK_JWT_ISSUER_DOMAIN ?? "https://clerk-issuer.invalid")
  : process.env.CLERK_JWT_ISSUER_DOMAIN;
```

Also update the header comment's second paragraph (lines 10-12) to read:

```ts
// The local placeholder is an unresolvable host on purpose. No Clerk instance
// can issue tokens for it, so a local backend without CLERK_JWT_ISSUER_DOMAIN
// rejects every token instead of trusting some other issuer.
```

- [ ] **Step 2: Verify the local backend still deploys with the variable unset**

Run: `pnpm verify:backend:local`
Expected: exit 0, health query output printed. If port 3210 is busy, prefix with `CONVEX_LOCAL_CLOUD_PORT=3310 CONVEX_LOCAL_SITE_PORT=3311`.

- [ ] **Step 3: Verify the override is honoured**

```bash
pnpm cx -- local env set CLERK_JWT_ISSUER_DOMAIN https://example-issuer.clerk.accounts.dev
pnpm verify:backend:local
pnpm cx -- local env remove CLERK_JWT_ISSUER_DOMAIN
```

Expected: both commands exit 0 and the second push does not complain about the issuer. Leave the variable removed.

- [ ] **Step 4: Commit**

```bash
git add convex/auth.config.ts
git commit -m "feat(auth): honour CLERK_JWT_ISSUER_DOMAIN on local deployments

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Fixture data module

**Files:**

- Create: `convex/_localFixtures.ts`
- Test: `tests/backend/local-fixtures.test.ts` (data invariants part; Task 6 adds the seed test to the same file)
- Read only: `apps/web/src/convex/playwright-fixtures.ts` (lines 159-273 DJ Aurora, 392-512 long name, 484-511 genre sets, 513-599 generated seeds, 604-689 generated link and profile builders, 694-734 sparse and max-share-card, 736-785 community, 786-915 world, 916-1027 and 1028-1100 events), `convex/schema.ts:641-780` (profiles), `:971-1023` (worlds), `:1027-1081` (events)

**Interfaces:**

- Produces, all exported from `convex/_localFixtures.ts`:
  - `LOCAL_FIXTURE_MARKER = "vrdex-local-fixture"`
  - `LOCAL_FIXTURE_SLUG_PREFIX = "playwright-"`
  - `localPersonFixtures: LocalPersonFixture[]` (12 records)
  - `localCommunityFixture: LocalCommunityFixture`
  - `localWorldFixture: LocalWorldFixture`
  - `localEventFixtures(now: number): LocalEventFixture[]` (2 records)
  - the four `Local*Fixture` types below
  - `allLocalFixtureUrls(now: number): string[]` and `allLocalFixtureSlugs(now: number): string[]` for tests

- [ ] **Step 1: Write the failing data-invariant tests**

```ts
// tests/backend/local-fixtures.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOCAL_FIXTURE_SLUG_PREFIX,
  allLocalFixtureSlugs,
  allLocalFixtureUrls,
  localCommunityFixture,
  localEventFixtures,
  localPersonFixtures,
  localWorldFixture,
} from "../../convex/_localFixtures";

const now = Date.UTC(2026, 8, 10, 12, 0, 0);

describe("local fixture data", () => {
  it("has the expected record counts", () => {
    assert.equal(localPersonFixtures.length, 12);
    assert.equal(localEventFixtures(now).length, 2);
    assert.equal(localCommunityFixture.profileType, "community");
    assert.equal(localWorldFixture.publicationState, "published");
  });

  it("keeps every slug under the playwright- prefix and unique", () => {
    const slugs = allLocalFixtureSlugs(now);
    assert.equal(new Set(slugs).size, slugs.length);
    for (const slug of slugs) {
      assert.ok(slug.startsWith(LOCAL_FIXTURE_SLUG_PREFIX), slug);
      assert.notEqual(slug, "basicbit");
    }
  });

  it("keeps every URL on an .invalid host", () => {
    const urls = allLocalFixtureUrls(now);
    assert.ok(urls.length > 20);
    for (const url of urls) {
      assert.ok(new URL(url).hostname.endsWith(".invalid"), url);
    }
  });

  it("puts one event ahead of now and one behind", () => {
    const [upcoming, past] = localEventFixtures(now);
    assert.ok(upcoming.startAt > now);
    assert.ok((past.endAt ?? past.startAt) < now);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/backend/local-fixtures.test.ts`
Expected: FAIL, cannot find module `../../convex/_localFixtures`.

- [ ] **Step 3: Write the data module**

The module is pure data plus two small builders. Types mirror the schema table shapes minus the fields the mutation fills (`sortName`, timestamps, `publicationState`, `publicSurfacing*`, `creationSource`).

```ts
// convex/_localFixtures.ts
//
// Fake dataset for a local anonymous Convex deployment. Ported from
// apps/web/src/convex/playwright-fixtures.ts; every slug starts with
// "playwright-" and every URL host ends in ".invalid" so nothing here can be
// mistaken for, or link to, a real person.

export const LOCAL_FIXTURE_MARKER = "vrdex-local-fixture";
export const LOCAL_FIXTURE_SLUG_PREFIX = "playwright-";

type Confidence = "high" | "medium" | "low";

export type LocalGenre = {
  slug: string;
  displayName: string;
  displayLabel?: string;
  featured?: boolean;
  source: "manual_review";
  confidence: Confidence;
  explicit: boolean;
};

export type LocalProfileLink = {
  type:
    | "vrchat_profile" | "vrcdn" | "discord" | "soundcloud" | "mixcloud" | "twitch"
    | "youtube" | "spotify" | "bandcamp" | "instagram" | "website" | "commissions";
  label: string;
  url: string;
  handle?: string;
  presentation?: "icon" | "copy";
  source: "reviewed";
};

type SharedFixture = {
  slug: string;
  displayName: string;
  aliases: string[];
  searchAliases?: string[];
  tags: string[];
  genres?: LocalGenre[];
  headline?: string;
  bio?: string;
  about?: string;
  region?: string;
  timezone?: string;
  outboundLinks: LocalProfileLink[];
};

export type LocalPersonFixture = SharedFixture & {
  profileType: "person";
  person: { pronouns?: string; roleTags: string[] };
};

export type LocalCommunityFixture = SharedFixture & {
  profileType: "community";
  community: { subtype?: string; categoryTags: string[] };
};

export type LocalWorldFixture = {
  slug: string;
  displayName: string;
  tags: string[];
  summary: string;
  description: string;
  vrchatWorldId: string;
  canonicalVrchatWorldUrl: string;
  sourceUrl: string;
  visibilityStatus: "public";
  platformCompatibility: Array<"pc" | "android" | "ios">;
  publicationState: "published";
  creatorAttributions: Array<{
    role: "world_author" | "media_credit";
    displayName: string;
    profileSlug: string;
    profileType: "person" | "community";
    sourceLabel: string;
  }>;
  outboundLinks: Array<{
    type: "gumroad" | "commissions";
    label: string;
    url: string;
    source: "reviewed";
  }>;
};

export type LocalEventFixture = {
  slug: string;
  title: string;
  startAt: number;
  doorsOpenAt: number;
  endAt: number;
  timezone: string;
  communitySlug: string;
  worldSlug: string;
  performerSlugs: string[];
  summary: string;
  sourceLabel: string;
  sourceUrl: string;
  watchSurfaceEnabled: boolean;
  mediaLinks: Array<{
    type: "watch" | "vrcdn";
    label: string;
    url: string;
    presentation: "open" | "copy";
  }>;
};

function genre(slug: string, displayName: string, featured = false, displayLabel?: string): LocalGenre {
  return {
    slug,
    displayName,
    ...(displayLabel ? { displayLabel } : {}),
    ...(featured ? { featured: true } : {}),
    source: "manual_review",
    confidence: "high",
    explicit: true,
  };
}

const genreSets = {
  bass: [genre("bass-music", "Bass Music", true), genre("dubstep", "Dubstep"), genre("space-bass", "Space Bass")],
  dnb: [genre("drum-and-bass", "Drum and Bass", true, "DnB"), genre("liquid-drum-and-bass", "Liquid Drum and Bass", false, "Liquid DnB"), genre("jungle", "Jungle")],
  house: [genre("house", "House", true), genre("bass-house", "Bass House"), genre("garage-house", "Garage House")],
  techno: [genre("techno", "Techno", true), genre("hardgroove", "Hardgroove"), genre("electro", "Electro")],
  trance: [genre("trance", "Trance", true), genre("progressive-trance", "Progressive Trance"), genre("breaks", "Breaks")],
} as const;

const linkLabels: Record<LocalProfileLink["type"], string> = {
  vrchat_profile: "VRChat profile",
  vrcdn: "VRCDN stream",
  discord: "Discord",
  soundcloud: "SoundCloud",
  mixcloud: "Mixcloud",
  twitch: "Twitch",
  youtube: "YouTube",
  spotify: "Spotify",
  bandcamp: "Bandcamp",
  instagram: "Instagram",
  website: "Website",
  commissions: "Bookings",
};

function link(slug: string, type: LocalProfileLink["type"], extra: Partial<LocalProfileLink> = {}): LocalProfileLink {
  return {
    type,
    label: linkLabels[type],
    url: `https://${type.replace(/_/g, "-")}.example.invalid/${slug}`,
    source: "reviewed",
    ...extra,
  };
}

function slugify(name: string): string {
  return LOCAL_FIXTURE_SLUG_PREFIX + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type GeneratedSeed = {
  displayName: string;
  aliases: string[];
  genres: keyof typeof genreSets;
  region?: string;
  timezone?: string;
  links: Array<LocalProfileLink["type"]>;
};

// Mirrors generatedPersonSeeds in the Playwright fixture file.
const generatedSeeds: GeneratedSeed[] = [
  { displayName: "Moth", aliases: ["m0th"], genres: "techno", links: ["vrchat_profile", "discord", "twitch"] },
  { displayName: "Velvet Circuit", aliases: ["VCircuit", "Velvet"], genres: "dnb", region: "NA", timezone: "UTC-5", links: ["vrchat_profile", "discord", "website", "vrcdn", "soundcloud", "twitch"] },
  { displayName: "DJ Night Market", aliases: ["Night Market"], genres: "house", region: "APAC", timezone: "UTC+9", links: ["vrchat_profile", "discord", "website", "vrcdn", "soundcloud", "mixcloud", "instagram", "commissions"] },
  { displayName: "The Lavender Subwoofer Disaster", aliases: ["Lavender Subwoofer", "LSDJ"], genres: "bass", links: ["discord", "website"] },
  { displayName: "0xLuma", aliases: ["Luma"], genres: "trance", region: "EU", timezone: "UTC+1", links: ["vrchat_profile", "website", "vrcdn", "youtube"] },
  { displayName: "Courier of the Low End", aliases: ["Low End Courier"], genres: "bass", links: ["vrchat_profile", "discord", "vrcdn", "bandcamp", "spotify"] },
  { displayName: "Solaris and the Breakbeat Weather System", aliases: ["Solaris Weather", "Breakbeat Weather"], genres: "dnb", region: "Global", timezone: "UTC", links: ["vrchat_profile", "discord", "website", "twitch", "mixcloud", "youtube", "instagram"] },
  { displayName: "Nia Nova", aliases: ["Nova"], genres: "house", links: ["discord", "soundcloud", "twitch"] },
];

function generatedPerson(seed: GeneratedSeed): LocalPersonFixture {
  const slug = slugify(seed.displayName);
  return {
    profileType: "person",
    slug,
    displayName: seed.displayName,
    aliases: seed.aliases,
    searchAliases: ["lineup", "fixture lineup", seed.displayName, ...seed.aliases],
    tags: ["DJ", "VRDJ", "Fixture lineup"],
    genres: [...genreSets[seed.genres]],
    headline: `${seed.displayName} fixture profile for lookup density checks.`,
    bio: "Generated fixture data for testing varied lookup names, colors, avatars, and links.",
    ...(seed.region ? { region: seed.region } : {}),
    ...(seed.timezone ? { timezone: seed.timezone } : {}),
    outboundLinks: seed.links.map((type) =>
      link(slug, type, type === "discord" ? { handle: slug.replace(/-/g, "_") } : {}),
    ),
    person: { roleTags: ["DJ", "VRDJ"] },
  };
}

const auroraSlug = "playwright-dj-aurora";
const communitySlug = "playwright-afterglow-social";
const worldSlug = "playwright-neon-harbor";

export const localPersonFixtures: LocalPersonFixture[] = [
  {
    profileType: "person",
    slug: auroraSlug,
    displayName: "DJ Aurora",
    aliases: ["Aurora", "Auralight"],
    tags: ["DJ", "Melodic House", "EU"],
    genres: [genre("melodic-house", "Melodic House", true)],
    headline: "Melodic house sets for late-night VRChat floors.",
    bio: "Melodic house DJ playing warm, vocal-led sets across VRChat club nights.",
    about: "Aurora plays warm, vocal-led melodic house for late-night VRChat floors and hosts a monthly residency.",
    region: "EU",
    timezone: "UTC+1",
    outboundLinks: [
      link(auroraSlug, "vrchat_profile"),
      link(auroraSlug, "discord", { handle: "dj_aurora" }),
      link(auroraSlug, "soundcloud"),
      link(auroraSlug, "twitch"),
      link(auroraSlug, "vrcdn"),
      link(auroraSlug, "commissions"),
    ],
    person: { pronouns: "she/they", roleTags: ["DJ", "Producer", "Host"] },
  },
  {
    profileType: "person",
    slug: "playwright-princess-starlight-interstellar-bassline",
    displayName: "Princess Starlight Interstellar Bassline Orchestra",
    aliases: ["Starlight Bassline", "PSIBO"],
    tags: ["DJ", "Long-name test", "VRDJ"],
    genres: [...genreSets.dnb],
    headline: "Long-form display name fixture for lookup layout checks.",
    bio: "Fixture profile used to make sure dense lookup rows survive surprisingly long DJ names.",
    outboundLinks: [
      link("playwright-princess-starlight-interstellar-bassline", "vrchat_profile"),
      link("playwright-princess-starlight-interstellar-bassline", "discord", { handle: "starlight_bassline" }),
      link("playwright-princess-starlight-interstellar-bassline", "website"),
    ],
    person: { roleTags: ["DJ", "VRDJ"] },
  },
  {
    profileType: "person",
    slug: "playwright-sparse-import",
    displayName: "Sparse Import",
    aliases: [],
    searchAliases: ["sparse imported entry"],
    tags: [],
    outboundLinks: [],
    person: { roleTags: [] },
  },
  {
    profileType: "person",
    slug: "playwright-max-share-card",
    displayName: "W".repeat(80),
    aliases: [],
    tags: [],
    headline: "W".repeat(200),
    outboundLinks: [],
    person: { roleTags: [] },
  },
  ...generatedSeeds.map(generatedPerson),
];

export const localCommunityFixture: LocalCommunityFixture = {
  profileType: "community",
  slug: communitySlug,
  displayName: "Afterglow Social",
  aliases: ["Afterglow", "AGS"],
  tags: ["Club", "Weekend", "Friends"],
  headline: "A warm VRChat club night for music-first communities.",
  bio: "Afterglow Social runs weekend club nights with rotating residents and guest DJs.",
  about: "Founded as a friends-first dance floor, Afterglow now hosts a weekly session and a monthly showcase.",
  region: "Global",
  timezone: "UTC",
  outboundLinks: [
    { type: "website", label: "Afterglow event archive", url: "https://example.invalid/afterglow-events", source: "reviewed" },
  ],
  community: { subtype: "Club night", categoryTags: ["Music", "Dancing", "Social"] },
};

export const localWorldFixture: LocalWorldFixture = {
  slug: worldSlug,
  displayName: "Neon Harbor",
  tags: ["Club world", "Cyberpunk", "Dance floor"],
  summary: "A neon-lit harbor club with a floating dance floor.",
  description: "Neon Harbor is a cyberpunk waterfront club world built for late-night sets, with a main floor, a chill deck, and a DJ booth over the water.",
  vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
  canonicalVrchatWorldUrl: "https://vrchat.example.invalid/home/world/wrld_00000000-0000-4000-8000-000000000001",
  sourceUrl: "https://vrchat.example.invalid/home/world/wrld_00000000-0000-4000-8000-000000000001",
  visibilityStatus: "public",
  platformCompatibility: ["pc", "android"],
  publicationState: "published",
  creatorAttributions: [
    { role: "world_author", displayName: "Afterglow Social", profileSlug: communitySlug, profileType: "community", sourceLabel: "Community credit" },
    { role: "media_credit", displayName: "DJ Aurora", profileSlug: auroraSlug, profileType: "person", sourceLabel: "Community credit" },
  ],
  outboundLinks: [
    { type: "gumroad", label: "Neon Harbor prefab", url: "https://example.invalid/neon-harbor-prefab", source: "reviewed" },
    { type: "commissions", label: "World commissions", url: "https://example.invalid/world-commissions", source: "reviewed" },
  ],
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function localEventFixtures(now: number): LocalEventFixture[] {
  const upcomingStart = now + 7 * DAY;
  const pastStart = now - 30 * DAY;
  return [
    {
      slug: "playwright-afterglow-harbor-sessions",
      title: "Afterglow Harbor Sessions",
      startAt: upcomingStart,
      doorsOpenAt: upcomingStart - HOUR / 2,
      endAt: upcomingStart + 3 * HOUR,
      timezone: "America/New_York",
      communitySlug,
      worldSlug,
      performerSlugs: [auroraSlug],
      summary: "Late-night harbor club session with house, trance, and warm social energy.",
      sourceLabel: "Afterglow event listing",
      sourceUrl: "https://example.invalid/events/afterglow-harbor-sessions",
      watchSurfaceEnabled: false,
      mediaLinks: [
        { type: "watch", label: "Watch room", url: "https://example.invalid/events/afterglow-watch", presentation: "open" },
        { type: "vrcdn", label: "VRCDN stream", url: "https://vrcdn.example.invalid/live/playwright-afterglow-harbor-sessions.live.ts", presentation: "copy" },
      ],
    },
    {
      slug: "playwright-afterglow-watch-room",
      title: "Afterglow Watch Room",
      startAt: pastStart,
      doorsOpenAt: pastStart - HOUR / 2,
      endAt: pastStart + 3 * HOUR,
      timezone: "America/New_York",
      communitySlug,
      worldSlug,
      performerSlugs: [auroraSlug],
      summary: "Live room for the Afterglow set stream.",
      sourceLabel: "Afterglow event listing",
      sourceUrl: "https://example.invalid/events/afterglow-watch-room",
      watchSurfaceEnabled: true,
      mediaLinks: [
        { type: "watch", label: "Watch room", url: "https://example.invalid/events/afterglow-watch", presentation: "open" },
      ],
    },
  ];
}

export function allLocalFixtureSlugs(now: number): string[] {
  return [
    ...localPersonFixtures.map((p) => p.slug),
    localCommunityFixture.slug,
    localWorldFixture.slug,
    ...localEventFixtures(now).map((e) => e.slug),
  ];
}

export function allLocalFixtureUrls(now: number): string[] {
  return [
    ...localPersonFixtures.flatMap((p) => p.outboundLinks.map((l) => l.url)),
    ...localCommunityFixture.outboundLinks.map((l) => l.url),
    localWorldFixture.canonicalVrchatWorldUrl,
    localWorldFixture.sourceUrl,
    ...localWorldFixture.outboundLinks.map((l) => l.url),
    ...localEventFixtures(now).flatMap((e) => [e.sourceUrl, ...e.mediaLinks.map((l) => l.url)]),
  ];
}
```

- [ ] **Step 4: Run the data tests**

Run: `node --import tsx --test tests/backend/local-fixtures.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck the backend**

Run: `pnpm typecheck:backend`
Expected: exit 0. If a literal union in this file disagrees with `convex/schema.ts`, fix the fixture type to match the schema, never the schema.

- [ ] **Step 6: Commit**

```bash
git add convex/_localFixtures.ts tests/backend/local-fixtures.test.ts
git commit -m "feat(convex): add fake local fixture dataset

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `localFixtures:ensureAll` mutation

**Files:**

- Create: `convex/localFixtures.ts`
- Modify: `tests/backend/local-fixtures.test.ts` (append the seed describe)
- Read only: `convex/hostedSmokeFixtures.ts` (whole file, the pattern), `convex/_searchDocuments.ts:213,337,383,560` (`createProfileSearchDocument`, `createWorldSearchDocument`, `createEventSearchDocument`, `upsertSearchDocument`), `convex/_globalSlugs.ts:368` (`findSlugOwner`), `convex/_profileLinkDestinationCache.ts` (`queueProfileLinkDestinations`), `convex/schema.ts:1082-1153` (join tables)

**Interfaces:**

- Consumes: Task 3 `requireLocalDeployment()`, Task 5 data exports.
- Produces: `internal.localFixtures.ensureAll` with args `{}` returning `{ profiles: number; worlds: number; events: number; created: number; updated: number }`. Task 7 invokes it as `localFixtures:ensureAll`.

- [ ] **Step 1: Append the failing seed tests**

Add to `tests/backend/local-fixtures.test.ts`:

```ts
import { after, before } from "node:test";
import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/localFixtures.ts": () => import("../../convex/localFixtures"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
  "../../convex/worlds.ts": () => import("../../convex/worlds"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/search.ts": () => import("../../convex/search"),
};
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

describe("local fixture seed", () => {
  let previousCloudUrl: string | undefined;
  before(() => {
    previousCloudUrl = process.env.CONVEX_CLOUD_URL;
    process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
  });
  after(() => {
    if (previousCloudUrl === undefined) delete process.env.CONVEX_CLOUD_URL;
    else process.env.CONVEX_CLOUD_URL = previousCloudUrl;
  });

  async function countTables(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => ({
      profiles: (await ctx.db.query("profiles").collect()).length,
      worlds: (await ctx.db.query("worlds").collect()).length,
      events: (await ctx.db.query("events").collect()).length,
      eventWorlds: (await ctx.db.query("eventWorlds").collect()).length,
      eventParticipants: (await ctx.db.query("eventParticipants").collect()).length,
      worldProfileCredits: (await ctx.db.query("worldProfileCredits").collect()).length,
      searchDocuments: (await ctx.db.query("searchDocuments").collect()).length,
    }));
  }

  it("seeds every fixture and is idempotent", async () => {
    const t = convexTest({ schema, modules });
    const first = await t.mutation(internal.localFixtures.ensureAll, {});
    assert.equal(first.profiles, 13);
    assert.equal(first.worlds, 1);
    assert.equal(first.events, 2);
    assert.equal(first.created, 16);
    const afterFirst = await countTables(t);
    assert.equal(afterFirst.profiles, 13);
    assert.equal(afterFirst.worlds, 1);
    assert.equal(afterFirst.events, 2);
    assert.equal(afterFirst.eventWorlds, 2);
    assert.equal(afterFirst.eventParticipants, 2);
    assert.equal(afterFirst.worldProfileCredits, 2);
    assert.equal(afterFirst.searchDocuments, 16);

    const second = await t.mutation(internal.localFixtures.ensureAll, {});
    assert.equal(second.created, 0);
    assert.equal(second.updated, 16);
    assert.deepEqual(await countTables(t), afterFirst);
  });

  it("makes the fixtures publicly visible", async () => {
    const t = convexTest({ schema, modules });
    await t.mutation(internal.localFixtures.ensureAll, {});

    const person = await t.query(api.profiles.getPublicBySlug, { slug: "playwright-dj-aurora" });
    assert.equal(person?.displayName, "DJ Aurora");

    const world = await t.query(api.worlds.getPublicBySlug, { slug: "playwright-neon-harbor" });
    assert.equal(world?.displayName, "Neon Harbor");

    const upcoming = await t.query(api.events.listPublicUpcoming, { now: Date.now(), limit: 8 });
    assert.ok(upcoming.some((e: { slug?: string }) => e.slug === "playwright-afterglow-harbor-sessions"));
  });

  it("refuses to run against a non-local deployment", async () => {
    const t = convexTest({ schema, modules });
    process.env.CONVEX_CLOUD_URL = "https://scrupulous-corgi-247.convex.cloud";
    try {
      await assert.rejects(
        () => t.mutation(internal.localFixtures.ensureAll, {}),
        /Local fixtures only run on a local deployment/,
      );
    } finally {
      process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
    }
  });
});
```

Check the exact argument and return shapes of `api.profiles.getPublicBySlug` (`convex/profiles.ts:446`), `api.worlds.getPublicBySlug` (`convex/worlds.ts:9`), and `api.events.listPublicUpcoming` (`convex/events.ts:2050`) before running and adjust the three assertions to the real field names. If `listPublicUpcoming` requires a viewer argument, pass the public one the other tests use.

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/backend/local-fixtures.test.ts`
Expected: the three new tests FAIL because `internal.localFixtures` does not exist. The four data tests still pass.

- [ ] **Step 3: Write the mutation**

```ts
// convex/localFixtures.ts
//
// Seeds a local anonymous deployment with the fake dataset in
// _localFixtures.ts. Mirrors hostedSmokeFixtures.ensurePublicSearchFixture:
// lookup by slug, insert or patch, refuse slugs owned by non-fixture records,
// write search documents, one audit row per created profile. Gated to
// loopback deployments so it can never run against a hosted backend.
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { findSlugOwner } from "./_globalSlugs";
import { queueProfileLinkDestinations } from "./_profileLinkDestinationCache";
import {
  createEventSearchDocument,
  createProfileSearchDocument,
  createWorldSearchDocument,
  upsertSearchDocument,
} from "./_searchDocuments";
import { requireLocalDeployment } from "./_localDeployment";
import {
  LOCAL_FIXTURE_MARKER,
  localCommunityFixture,
  localEventFixtures,
  localPersonFixtures,
  localWorldFixture,
  type LocalCommunityFixture,
  type LocalPersonFixture,
} from "./_localFixtures";

type Counters = { created: number; updated: number };

function sortName(displayName: string): string {
  return displayName.toLowerCase();
}

async function ensureProfile(
  ctx: MutationCtx,
  fixture: LocalPersonFixture | LocalCommunityFixture,
  now: number,
  counters: Counters,
): Promise<Doc<"profiles">> {
  const existing = await ctx.db
    .query("profiles")
    .withIndex("by_slug", (q) => q.eq("slug", fixture.slug))
    .unique();

  const shared = {
    slug: fixture.slug,
    displayName: fixture.displayName,
    sortName: sortName(fixture.displayName),
    aliases: fixture.aliases,
    ...(fixture.searchAliases ? { searchAliases: fixture.searchAliases } : {}),
    tags: fixture.tags,
    ...(fixture.genres ? { genres: fixture.genres } : {}),
    ...(fixture.headline ? { headline: fixture.headline } : {}),
    ...(fixture.bio ? { bio: fixture.bio } : {}),
    ...(fixture.about ? { about: fixture.about } : {}),
    ...(fixture.region ? { region: fixture.region } : {}),
    ...(fixture.timezone ? { timezone: fixture.timezone } : {}),
    outboundLinks: fixture.outboundLinks,
    claimState: "unclaimed" as const,
    publicationState: "published" as const,
    publicSurfacingState: "public" as const,
    publicSurfacingUpdatedAt: now,
    publicSurfacingReason: LOCAL_FIXTURE_MARKER,
    creationSource: "moderator" as const,
    publishedAt: now,
    updatedAt: now,
  };
  const fields =
    fixture.profileType === "person"
      ? { ...shared, profileType: "person" as const, person: fixture.person }
      : { ...shared, profileType: "community" as const, community: fixture.community };

  let profileId: Id<"profiles">;
  if (existing === null) {
    const owner = await findSlugOwner(ctx.db, fixture.slug);
    if (owner !== null) {
      throw new Error(`Local fixture slug ${fixture.slug} is owned by a ${owner.kind}.`);
    }
    profileId = await ctx.db.insert("profiles", fields);
    counters.created += 1;
    await ctx.db.insert("profileAuditEvents", {
      profileId,
      action: "local_fixture_created",
      sourceType: "moderator",
      note: "Fake profile created by the local fixture seed.",
      createdAt: now,
    });
  } else {
    if (existing.publicSurfacingReason !== LOCAL_FIXTURE_MARKER) {
      throw new Error(`Local fixture slug ${fixture.slug} is owned by a non-fixture profile.`);
    }
    profileId = existing._id;
    await ctx.db.patch(profileId, fields);
    counters.updated += 1;
  }

  const profile = await ctx.db.get(profileId);
  if (profile === null) throw new Error(`Local fixture profile ${fixture.slug} could not be loaded.`);
  await queueProfileLinkDestinations(ctx, profile, now, { previousProfile: existing ?? undefined });
  await upsertSearchDocument(ctx.db, createProfileSearchDocument(profile));
  return profile;
}

async function ensureWorld(
  ctx: MutationCtx,
  profilesBySlug: Map<string, Doc<"profiles">>,
  now: number,
  counters: Counters,
): Promise<Doc<"worlds">> {
  const fixture = localWorldFixture;
  const existing = await ctx.db
    .query("worlds")
    .withIndex("by_slug", (q) => q.eq("slug", fixture.slug))
    .unique();

  const fields = {
    slug: fixture.slug,
    displayName: fixture.displayName,
    sortName: sortName(fixture.displayName),
    tags: fixture.tags,
    summary: fixture.summary,
    description: fixture.description,
    vrchatWorldId: fixture.vrchatWorldId,
    canonicalVrchatWorldUrl: fixture.canonicalVrchatWorldUrl,
    sourceUrl: fixture.sourceUrl,
    visibilityStatus: fixture.visibilityStatus,
    platformCompatibility: fixture.platformCompatibility,
    media: [],
    creatorAttributions: fixture.creatorAttributions.map((attribution) => ({
      ...attribution,
      profileId: profilesBySlug.get(attribution.profileSlug)?._id,
    })),
    outboundLinks: fixture.outboundLinks,
    publicationState: "published" as const,
    creationSource: "moderator" as const,
    sourceAttribution: { sourceType: "moderator" as const, label: LOCAL_FIXTURE_MARKER, confirmedAt: now },
    publishedAt: now,
    updatedAt: now,
  };

  let worldId: Id<"worlds">;
  if (existing === null) {
    const owner = await findSlugOwner(ctx.db, fixture.slug);
    if (owner !== null) throw new Error(`Local fixture slug ${fixture.slug} is owned by a ${owner.kind}.`);
    worldId = await ctx.db.insert("worlds", fields);
    counters.created += 1;
  } else {
    if (existing.sourceAttribution?.label !== LOCAL_FIXTURE_MARKER) {
      throw new Error(`Local fixture slug ${fixture.slug} is owned by a non-fixture world.`);
    }
    worldId = existing._id;
    await ctx.db.patch(worldId, fields);
    counters.updated += 1;
  }

  // Credits: replace the fixture world's rows wholesale so re-runs converge.
  const credits = await ctx.db.query("worldProfileCredits").withIndex("by_worldId", (q) => q.eq("worldId", worldId)).collect();
  for (const credit of credits) await ctx.db.delete(credit._id);
  for (const attribution of fixture.creatorAttributions) {
    await ctx.db.insert("worldProfileCredits", {
      worldId,
      profileSlug: attribution.profileSlug,
      profileType: attribution.profileType,
      role: attribution.role,
      sourceLabel: attribution.sourceLabel,
      updatedAt: now,
    });
  }

  const world = await ctx.db.get(worldId);
  if (world === null) throw new Error("Local fixture world could not be loaded.");
  await upsertSearchDocument(ctx.db, createWorldSearchDocument(world));
  return world;
}

async function ensureEvents(
  ctx: MutationCtx,
  profilesBySlug: Map<string, Doc<"profiles">>,
  world: Doc<"worlds">,
  now: number,
  counters: Counters,
): Promise<number> {
  let count = 0;
  for (const fixture of localEventFixtures(now)) {
    const community = profilesBySlug.get(fixture.communitySlug);
    if (community === undefined) throw new Error(`Local fixture event ${fixture.slug} references missing community.`);
    const existing = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", fixture.slug))
      .unique();

    const fields = {
      slug: fixture.slug,
      title: fixture.title,
      sortTitle: sortName(fixture.title),
      startAt: fixture.startAt,
      doorsOpenAt: fixture.doorsOpenAt,
      endAt: fixture.endAt,
      timezone: fixture.timezone,
      communityProfileId: community._id,
      communityName: community.displayName,
      summary: fixture.summary,
      watchSurfaceEnabled: fixture.watchSurfaceEnabled,
      mediaLinks: fixture.mediaLinks,
      sourceType: "manual" as const,
      sourceLabel: fixture.sourceLabel,
      sourceUrl: fixture.sourceUrl,
      eventStatus: "scheduled" as const,
      publicationState: "published" as const,
      publishedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    let eventId: Id<"events">;
    if (existing === null) {
      eventId = await ctx.db.insert("events", fields);
      counters.created += 1;
    } else {
      if (existing.sourceLabel !== fixture.sourceLabel) {
        throw new Error(`Local fixture slug ${fixture.slug} is owned by a non-fixture event.`);
      }
      eventId = existing._id;
      await ctx.db.patch(eventId, fields);
      counters.updated += 1;
    }

    const joinFields = {
      eventId,
      eventStartAt: fixture.startAt,
      eventEndAt: fixture.endAt,
      eventPublicationState: "published" as const,
      eventStatus: "scheduled" as const,
      sourceType: "manual" as const,
      confirmationState: "confirmed" as const,
      confirmedAt: now,
      updatedAt: now,
    };

    for (const row of await ctx.db.query("eventWorlds").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).collect()) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.insert("eventWorlds", { ...joinFields, worldId: world._id, confidence: 1 });

    for (const row of await ctx.db.query("eventParticipants").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).collect()) {
      await ctx.db.delete(row._id);
    }
    for (const performerSlug of fixture.performerSlugs) {
      const performer = profilesBySlug.get(performerSlug);
      if (performer === undefined) throw new Error(`Local fixture event ${fixture.slug} references missing performer.`);
      await ctx.db.insert("eventParticipants", {
        ...joinFields,
        personProfileId: performer._id,
        roleLabel: "Performer",
        sourceLabel: "Afterglow lineup",
      });
    }

    const event = await ctx.db.get(eventId);
    if (event === null) throw new Error("Local fixture event could not be loaded.");
    await upsertSearchDocument(
      ctx.db,
      createEventSearchDocument(event, { community, world, roleLabels: ["Performer"] }),
    );
    count += 1;
  }
  return count;
}

export const ensureAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireLocalDeployment();
    const now = Date.now();
    const counters: Counters = { created: 0, updated: 0 };
    const profilesBySlug = new Map<string, Doc<"profiles">>();

    for (const fixture of [...localPersonFixtures, localCommunityFixture]) {
      profilesBySlug.set(fixture.slug, await ensureProfile(ctx, fixture, now, counters));
    }
    const world = await ensureWorld(ctx, profilesBySlug, now, counters);
    const events = await ensureEvents(ctx, profilesBySlug, world, now, counters);

    return { profiles: profilesBySlug.size, worlds: 1, events, ...counters };
  },
});
```

Check three things against the real code before running: the exact option names `createEventSearchDocument` accepts at `convex/_searchDocuments.ts:383` (the fact pass saw `{ community?, world?, roleLabels? }`); whether `eventWorlds.confidence` is a number in `[0,1]` or a percent (schema says `v.number()`, use `1`); and whether `profileAuditEvents.action` is a free string or a literal union (if a union, use the nearest existing literal and drop `local_fixture_created`).

- [ ] **Step 4: Run the tests**

Run: `node --import tsx --test tests/backend/local-fixtures.test.ts`
Expected: PASS, 7 tests. If `searchDocuments` count is not 16, inspect which entity was not indexed and fix the create call; do not loosen the assertion.

- [ ] **Step 5: Typecheck and regenerate**

Run: `pnpm typecheck:backend && pnpm check:backend:generated`
Expected: both exit 0. If `check:backend:generated` shows a diff under `convex/_generated`, stage it; it is the new module being registered.

- [ ] **Step 6: Commit**

```bash
git add convex/localFixtures.ts convex/_generated tests/backend/local-fixtures.test.ts
git commit -m "feat(convex): add localFixtures:ensureAll seed mutation

Loopback-gated, idempotent, mirrors the hosted smoke fixture pattern.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `pnpm seed:local`

**Files:**

- Modify: `package.json` (scripts, next to `verify:backend:local` at line 175-176)
- Modify: `README.md:18-41`

**Interfaces:**

- Consumes: Task 6 `localFixtures:ensureAll`
- Produces: the `seed:local` script Task 9 documents

- [ ] **Step 1: Add the script pair**

Insert after the `verify:backend:local` line:

```json
    "preseed:local": "node scripts/guard-main-worktree.mjs",
    "seed:local": "node scripts/run-convex-local.mjs dev --local --once --run localFixtures:ensureAll --tail-logs disable",
```

- [ ] **Step 2: Run it against a local backend**

Run: `pnpm seed:local` (prefix with the alternate ports from Global Constraints if 3210 is busy).
Expected: exit 0 and a printed result object with `profiles: 13, worlds: 1, events: 2, created: 16, updated: 0`. Run it a second time: `created: 0, updated: 16`.

If the CLI refuses to `--run` an internal function, change `ensureAll` in `convex/localFixtures.ts` from `internalMutation` to `mutation` (import `mutation` from `./_generated/server`), keep `requireLocalDeployment()` as the first line, update the two test references from `internal.localFixtures.ensureAll` to `api.localFixtures.ensureAll`, and note the reason in the commit body. The loopback gate is the real guard either way.

- [ ] **Step 3: Confirm the web app shows the data**

Start `pnpm dev:backend:local` in one shell and `pnpm dev:web` in another, open `http://localhost:3000/playwright-dj-aurora`, `http://localhost:3000/playwright-neon-harbor`, and the home page.
Expected: the profile and world pages render with the fixture content; the home page lists "Afterglow Harbor Sessions" as upcoming. If the home page shows nothing, check `convex/search.ts:83` (`listDiscovery`) for the `publicState` the seeded search documents carry.

- [ ] **Step 4: Update the README bootstrap list**

In `README.md`, after the line `- keep the local Convex backend watcher running: \`pnpm dev:backend:local\`` add:

```markdown
- seed the local backend with fake profiles, a world, and events: `pnpm seed:local`
```

And after the list (before the `.env.local` paragraph at line 39) add:

```markdown
New here? Read [docs/engineering/local-development.md](docs/engineering/local-development.md) for the full contributor setup, including what needs no credentials and how to add your own Clerk instance.
```

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint:markdown
git add package.json README.md
git commit -m "feat: add pnpm seed:local for the local backend

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Fork-aware preview workflows

**Files:**

- Modify: `.github/workflows/vercel-preview-comment.yml:48-53` (fork rejection), `:83-92` (dispatch inputs)
- Modify: `.github/workflows/vercel-preview-deploy.yml:4-27` (inputs), `:48-53` (outputs), `:76-92` (resolve step), `:167-206` (runtime configure step), `:223-236` (deploy env), `:316-327` (comment body), `:412-486` (smoke job)
- Test: `tests/scripts/workflow-definitions.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces: `deploy-preview` job output `is_fork` (`"true"` or `"false"`), used by later steps and the smoke job

- [ ] **Step 1: Write the failing workflow assertions**

Append to `tests/scripts/workflow-definitions.test.ts` (reuse its existing YAML loader and helpers; the file already parses every workflow):

```ts
describe("fork-aware preview workflows", () => {
  const comment = loadWorkflow(".github/workflows/vercel-preview-comment.yml");
  const deploy = loadWorkflow(".github/workflows/vercel-preview-deploy.yml");
  const deploySteps = deploy.jobs["deploy-preview"].steps as Array<{ name?: string; if?: string; env?: Record<string, string>; with?: Record<string, string> }>;
  const raw = {
    comment: readFileSync(".github/workflows/vercel-preview-comment.yml", "utf8"),
    deploy: readFileSync(".github/workflows/vercel-preview-deploy.yml", "utf8"),
  };

  it("no longer rejects fork heads", () => {
    assert.ok(!raw.comment.includes("Mirror a fork PR"));
    assert.ok(!raw.deploy.includes("Mirror a fork PR"));
  });

  it("never uses pull_request_target", () => {
    assert.ok(!raw.comment.includes("pull_request_target"));
    assert.ok(!raw.deploy.includes("pull_request_target"));
  });

  it("exposes is_fork from the resolve step", () => {
    assert.equal(deploy.jobs["deploy-preview"].outputs.is_fork, "${{ steps.pr.outputs.is_fork }}");
  });

  it("withholds hosted e2e secrets from fork heads", () => {
    for (const step of deploySteps) {
      const usesHostedToken = JSON.stringify(step.env ?? {}).includes("VRDEX_HOSTED_E2E_BROWSER_TOKEN");
      if (!usesHostedToken) continue;
      assert.ok(step.if?.includes("steps.pr.outputs.is_fork == 'false'"), `${step.name} must gate on is_fork`);
    }
    const smoke = deploy.jobs["hosted-mcp-preview-smoke"];
    assert.ok(String(smoke.if).includes("needs.deploy-preview.outputs.is_fork == 'false'"));
  });

  it("names the deployed SHA in the preview comment", () => {
    const post = deploySteps.find((s) => s.name === "Post preview comment");
    assert.ok(post);
    assert.ok(JSON.stringify(post).includes("head_sha"));
  });
});
```

If the existing file has no `loadWorkflow` helper, define one at the top with the YAML library the file already imports.

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/scripts/workflow-definitions.test.ts`
Expected: FAIL on "no longer rejects fork heads", "exposes is_fork", "withholds hosted e2e secrets", and "names the deployed SHA".

- [ ] **Step 3: Edit `vercel-preview-comment.yml`**

Delete the fork-rejection block at lines 48-53 (the `if (pull.head.repo?.full_name !== ...)` check and its `core.setFailed(...)` with the "Mirror a fork PR" message). Keep the open-PR check and the author_association allowlist untouched. Nothing else changes; the fork decision moves to the deploy workflow.

- [ ] **Step 4: Edit `vercel-preview-deploy.yml`**

In the "Resolve pull request" step (`id: pr`, lines 56-92), replace the fork rejection at lines 76-81 with:

```js
            const isFork = pull.head.repo?.full_name !== `${context.repo.owner}/${context.repo.repo}`;
            core.setOutput('is_fork', isFork ? 'true' : 'false');
            if (isFork) {
              core.notice(`Fork head ${pull.head.repo?.full_name}@${pull.head.sha}: hosted E2E helpers withheld.`);
            }
```

Add to the job `outputs` block (lines 48-53):

```yaml
      is_fork: ${{ steps.pr.outputs.is_fork }}
```

On the "Configure Convex preview runtime and smoke fixture" step (line 167), the "Deploy Vercel preview output" step (line 223), and any other step whose `env` references `VRDEX_HOSTED_E2E_BROWSER_TOKEN`, `VRDEX_HOSTED_E2E_AUTH_HELPERS`, or `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS`: split so that the hosted-only env is provided only when `steps.pr.outputs.is_fork == 'false'`. The simplest correct split for the configure step is two steps: keep the existing step unchanged but add `if: steps.pr.outputs.is_fork == 'false'` alongside its current condition, and add a sibling step "Configure Convex preview runtime (fork head)" with `if: steps.pr.outputs.is_fork == 'true'` that carries only `CONVEX_DEPLOY_KEY_PREVIEW`, sets the same preview env vars from lines 180-183, skips the developer-runtime secrets and the E2E helper flags, and still runs the `hostedSmokeFixtures:ensurePublicSearchFixture` line so the preview has its search fixture. For the deploy step, remove `VRDEX_HOSTED_E2E_BROWSER_TOKEN` from its `env` when `is_fork == 'true'` by using the expression form:

```yaml
          VRDEX_HOSTED_E2E_BROWSER_TOKEN: ${{ steps.pr.outputs.is_fork == 'false' && secrets.VRDEX_HOSTED_E2E_BROWSER_TOKEN || '' }}
```

and add `if: steps.pr.outputs.is_fork == 'false'` is not required there since the value is blanked; the test above accepts either a gated step or a blanked value, so if you use the blanked form, adjust the test's fourth assertion to also accept `env` values containing `is_fork == 'false' &&`.

On the `hosted-mcp-preview-smoke` job (line 412), extend its `if` (line 418) to:

```yaml
    if: ${{ !cancelled() && needs.deploy-preview.outputs.deployment_url != '' && needs.deploy-preview.outputs.is_fork == 'false' }}
```

In the "Post preview comment" step body (lines 316-327), change the branch line to include the SHA:

```js
              `Branch \`${headRef}\` at \`${headSha}\`${isFork ? ' (fork head; hosted E2E lane skipped)' : ''}`,
```

reading `headSha` from `'${{ steps.pr.outputs.head_sha }}'` and `isFork` from `'${{ steps.pr.outputs.is_fork }}' === 'true'` the same way the step already reads `headRef`.

- [ ] **Step 5: Run the workflow tests**

Run: `node --import tsx --test tests/scripts/workflow-definitions.test.ts`
Expected: PASS, including the pre-existing "parses every workflow" test.

- [ ] **Step 6: Dry-run the trigger on this branch**

Push the branch, open the PR (Task 10 opens it properly; a draft is fine here), and comment `@vrdex preview` as the maintainer. Expected: the preview comment appears with `Branch \`feat/contributor-local-first\` at \`<sha>\`` and the hosted smoke job runs, since this is not a fork. A fork cannot be exercised without an outside PR; record that in the PR body.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/vercel-preview-comment.yml .github/workflows/vercel-preview-deploy.yml tests/scripts/workflow-definitions.test.ts
git commit -m "ci(preview): allow maintainer-triggered previews for fork heads

Fork heads get a preview but no hosted E2E token or helper flags, and the
comment names the deployed SHA.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Contributor documentation

**Files:**

- Create: `docs/engineering/local-development.md`
- Create: `CONTRIBUTING.md`
- Modify: `apps/docs/sidebars.js:37-40` (engineering list), `docs/README.md:11-32`, `docs/engineering/README.md:35-37`
- Modify: `docs/deployment/vercel-preview.md` (new section after `## On-demand preview deploy`, before line 105 `### Hosted MCP preview smoke`)

**Interfaces:**

- Consumes: Task 7 `pnpm seed:local`, Task 4 variable name, Task 8 behaviour, Task 1 `LICENSE`
- Produces: nothing programmatic

- [ ] **Step 1: Write `docs/engineering/local-development.md`**

Match the house style: H1, then `## Purpose`, no front matter.

````markdown
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
   pnpm cx -- local env set CLERK_JWT_ISSUER_DOMAIN https://<your-slug>.clerk.accounts.dev
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

Code in this repository is under the [MIT license](../../LICENSE). Directory
data served by VRDex is not covered by that license.

## Quality contract

Definition of ready, definition of done, and the evidence a pull request
carries are in
[the contributor workflow](../agentic/contributor-workflow.md).
````

- [ ] **Step 2: Write `CONTRIBUTING.md`**

```markdown
# Contributing to VRDex

Everything runs locally with no cloud account. Start with
[docs/engineering/local-development.md](docs/engineering/local-development.md):
prerequisites, the five commands, what needs credentials, checks, and how
previews work.

Code is MIT licensed (see [LICENSE](LICENSE)). Open a pull request from a
fork; CI runs on it, and a maintainer can deploy a preview on request.
```

- [ ] **Step 3: Wire the sidebar and indexes**

In `apps/docs/sidebars.js`, add `"engineering/local-development"` directly after `"engineering/README"` (line 38).

In `docs/README.md` `## Current Sections`, add a bullet for `docs/engineering/local-development.md` next to the `service-map` bullet (line 24), and in "Useful starting points" (lines 34-39) add it as the first entry for new contributors.

In `docs/engineering/README.md`, add a link line beside the service-map link (line 35):

```markdown
- [Local development](local-development.md): contributor setup with no cloud account.
```

Match the exact bullet style already used in each file.

- [ ] **Step 4: Add the maintainer section to `docs/deployment/vercel-preview.md`**

Insert before `### Hosted MCP preview smoke` (line 105):

```markdown
### Fork pull requests

The comment trigger deploys fork heads too. The job runs the fork's code with
the Vercel token, org and project IDs, and the Convex preview deploy key in
scope. The hosted E2E browser token and helper flags are withheld for fork
heads and the hosted MCP smoke job is skipped.

Before commenting `@vrdex preview` on a fork pull request:

- Read the whole diff, including `pnpm-lock.yaml`, `package.json` scripts,
  anything under `scripts/`, and `.github/`. A `postinstall` or build script
  runs with the secrets above.
- Note the head commit. The bot comment names the SHA it deployed; anything
  pushed after that is unreviewed.
- Remember the Vercel token has no per-project scope. It can deploy or read
  any project in the team, including the docs site.
- After any new push, review again before triggering again.
```

- [ ] **Step 5: Lint and build the docs**

```bash
pnpm lint:markdown
pnpm verify:docs
```

Expected: both exit 0. A broken link or bare autolink fails the docs build; fix the link, not the check.

- [ ] **Step 6: Commit**

```bash
git add docs/engineering/local-development.md CONTRIBUTING.md apps/docs/sidebars.js docs/README.md docs/engineering/README.md docs/deployment/vercel-preview.md
git commit -m "docs: add contributor local-development guide and fork preview guidance

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Full verification and PR B

**Files:**

- None new. The three planning docs are already committed on this branch.

- [ ] **Step 1: Run the verification lanes that do not need Python or Docker**

```bash
pnpm verify:api-contracts && pnpm verify:vrdex-mcp && pnpm verify:docs && pnpm verify:web && pnpm check:backend:generated && pnpm typecheck:backend && pnpm test:backend && pnpm test:group-telemetry && pnpm test:vrclinking-adapter && pnpm test:temporal-runtime
```

Expected: exit 0. If Python 3 is installed also run `pnpm test:temporal-inference`.

- [ ] **Step 2: Run the local Playwright data-flow lane**

Run: `pnpm test:e2e`
Expected: PASS. It boots its own local Convex on 3210, so stop any other local backend first.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/contributor-local-first
gh pr create --title "Local-first contributor path: seed, fork previews, docs" --body-file - <<'EOF'
## What

- `pnpm seed:local`: loopback-gated `localFixtures:ensureAll` seeds 12 people, 1 community, 1 world, 2 events into the local backend, idempotent.
- `convex/auth.config.ts` honours `CLERK_JWT_ISSUER_DOMAIN` on local deployments when set.
- Preview workflows accept fork heads from the maintainer comment trigger only, withhold hosted E2E secrets for forks, and name the deployed SHA.
- `docs/engineering/local-development.md`, `CONTRIBUTING.md`, README seed step, maintainer fork checklist on the preview page.
- Worktree guard message is machine-neutral.
- Planning docs: research, recommendation, design, plan.

## Why

Design record: `docs/planning/contributor-local-first-design-2026-09-09.md`. Convex has no prod-blind role and no shared dev database primitive, so contributors work locally and previews stay owner-gated.

## Verification

- `pnpm test:backend` (new: local-deployment, local-fixtures)
- `tests/scripts/workflow-definitions.test.ts` fork-safety assertions
- `pnpm seed:local` run twice against a local backend: 16 created, then 16 updated
- `@vrdex preview` dry run on this branch (same-repo head; a true fork head cannot be exercised from inside the repo)
- `pnpm verify:docs`, `pnpm lint:markdown`

Depends on nothing. The MIT LICENSE ships separately in the `chore/mit-license` PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 4: Iterate on review threads to READY**

Address every AI review thread on the PR against the actual diff, reply in-thread, and resolve. Do not merge; report the packet and wait.

---

## Self-review

- **Spec coverage:** §1 license → Task 1. §2 seed → Tasks 3, 5, 6, 7. §3 auth → Task 4 and Task 9 Clerk section. §4 fork previews → Task 8 and Task 9 step 4. §5 guard → Task 2. §6 docs → Tasks 7 (README) and 9. §7 delivery → Tasks 1 and 10. Testing section → Tasks 3, 5, 6, 8, 9 step 5.
- **Placeholders:** none. Two conditional fallbacks are stated with their exact alternative (Task 6 step 3 field checks, Task 7 step 2 internal-vs-public mutation).
- **Type consistency:** `requireLocalDeployment` (Task 3) is what Task 6 imports; `LOCAL_FIXTURE_MARKER`, `localPersonFixtures`, `localCommunityFixture`, `localWorldFixture`, `localEventFixtures(now)` (Task 5) are what Task 6 imports; `ensureAll` return shape `{profiles, worlds, events, created, updated}` matches Task 6's test and Task 7's expected output; `is_fork` output name is the same in Task 8's edits and tests.
