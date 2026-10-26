# Homepage and unified search implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lookup-first homepage with compact public search and unified results with readable genres and individual link disclosure.

**Architecture:** Reuse Convex universal search and its existing visibility-filtered public projection. Share the search input and public link presentation, retain normal Next.js URLs, and preserve the separately authorized legacy lookup routes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Convex, existing shared UI tokens, Node test runner, Playwright.

**Spec:** [Approved first-slice design](../specs/2026-10-26-homepage-search-first-slice-design.md), approved by BASIC on October 26, 2026.

## Global constraints

- Node 24 and repository-pinned pnpm 10.15.1. No new dependencies.
- At most five rendered and keyboard-addressable public suggestions. Never present a bounded preview count as the total match count.
- Public Home/search never fetch or merge private seed data or reuse lookup recents.
- Entity/profile filtering stays server-side before the result limit. Exact genre filtering is deferred; no misleading client-side filter.
- Use shared charcoal-theme tokens, subtle radii, approved wordmark, public image fallbacks and viewer-local event times.
- Reuse approved utility labels. No new public prose without BASIC's exact-copy approval; no em dashes in public copy.
- Preserve `/lookup`, `/lookup/suggest`, `/search?view=dj`, `/discover` and `/discovery`. Nonempty old `/?q=...` bookmarks retain legacy lookup behavior.
- No timeline, My night, favorite persistence, discovery redesign, production seeding, hosted binding use, or external integration changes.

## Review focus

- The same text with a different entity filter must immediately hide old suggestions and invalidate their active keyboard selection; Task 2 tests this.
- Clearing and quickly retyping a query must not revive an aborted response; Task 2 tests this.
- Clipboard fallback must leave focus on the copy control and keep all expanded rows open, including on failure; Task 3 tests this.
- Browser Back/Forward can change server-rendered query props without remounting the shared input; Tasks 2 and 4 test input/URL agreement.
- A legacy lookup recent term or authorized private seed must never appear in the new public preview; Tasks 2 and 4 test this with existing private fixtures.

---

## Execution setup

- [ ] Read `AGENTS.md`, the approved spec, `.agents/skills/vrdex-cloud-start/SKILL.md`, `docs/engineering/cloud-task-start.md` and `docs/engineering/local-development.md`.
- [ ] Continue on `codex/homepage-search` in the prepared `/workspace/VRDex` checkout. The cloud guide explicitly selects that checkout; do not create a nested worktree. Refresh branch/base state without overwriting unrelated work.
- [ ] Resolve the missing documented `/workspace/vrdex-env.sh` before application verification. The retained `/workspace/.vrdex-tools/organizer-checkpoint-env.sh` currently provides Node 24.19.0 and pnpm 10.15.1 for documentation checks. Report the published-setup gap and verify the local preparation helper exists before using that recovery path. Never materialize hosted credentials for this slice.
- [ ] Use installed dependencies when their inputs are unchanged. Run the focused existing baseline: `node --import tsx --test tests/web/search-view-state.test.ts tests/web/public-search-query.test.ts tests/web/lookup-suggestion-merge.test.ts` and `node --conditions=import --import tsx --test tests/backend/search-discovery.test.ts`. Record any pre-existing failures before editing.
- [ ] Follow the cloud guide's anonymous local bootstrap and health/fixture checks before browser runs. Stop only owned watchers before Playwright starts its own servers.

## Task 1: Share complete public result data and presentation

**Files:**

- Create `apps/web/src/lib/public-search.ts`, `apps/web/src/lib/public-search-genres.ts` and `apps/web/src/app/_components/public-profile-links.tsx`.
- Modify `apps/web/src/app/_components/discovery-public-page.tsx` and `apps/web/src/app/_components/profile-lookup-page.tsx`.
- Test `tests/web/public-search-genres.test.ts`, `tests/backend/search-discovery.test.ts` and existing lookup browser coverage in `apps/web/e2e/public-routes.smoke.spec.ts`.

**Interfaces:**

- Export `PublicSearchResult` from `@/lib/public-search`, derived from `convex/_searchDocuments.ts`'s authoritative type plus `claimEntryPath?: string` added by the web server. Re-export from `discovery-public-page.tsx` for existing imports.
- Export `PublicSearchPerson = NonNullable<PublicSearchResult["person"]>` and `PublicSearchGenre = PublicSearchPerson["genres"][number]`.
- Export `publicSearchGenreLabel(genre: PublicSearchGenre): string` and `orderedPublicSearchGenres(genres: readonly PublicSearchGenre[]): PublicSearchGenre[]` from `public-search-genres.ts`. Trim custom display labels; use trimmed display name if the custom label is blank; omit entries with no readable label. Sort featured first stably without mutating input.
- Export `PublicProfileLinks({ links }: { links: PublicSearchPerson["outboundLinks"] })` from `public-profile-links.tsx`. Move the current lookup link board and its provider formatting helpers there. Preserve existing supported links, destination artwork, Discord values and VRCDN variants. Keep empty-link legacy behavior where it already exists; standard results will not render empty disclosures.

- [ ] **Write failing tests:** `genre labels prefer custom names and preserve featured order` asserts labels and order for featured/nonfeatured, blank custom labels and sparse entries; `genre ordering does not mutate public results` asserts original order remains unchanged. Extend Convex public search tests to assert `displayLabel`, `featured`, visibility-filtered outbound links and destination metadata survive projection, while hidden/private profile data stays absent.

  ```ts
  test("genre labels prefer custom names and preserve featured order", () => {
    const genres = [
      { slug: "house", displayName: "House", displayLabel: " " },
      { slug: "techno", displayName: "Techno", displayLabel: "Hard techno", featured: true },
    ];
    assert.deepEqual(orderedPublicSearchGenres(genres).map(publicSearchGenreLabel), ["Hard techno", "House"]);
    assert.deepEqual(genres.map(genre => genre.slug), ["house", "techno"]);
  });
  ```

- [ ] **Verify red:** run the new genre test and the focused Convex suite using the setup command pattern. Expected failures identify missing helpers or missing assertions' behavior, not a broken harness.
- [ ] **Implement the interfaces above:** remove the narrower manual public person type from discovery rendering. Extract the existing link board without importing legacy lookup fetching, feature grants or private adapters into public UI. Keep legacy lookup clients using the extracted board, with types derived rather than cast to fit.
- [ ] **Verify green:** run both focused suites, `pnpm typecheck:web`, `pnpm typecheck:backend`, and existing browser cases for lookup suggestions, VRCDN links and bulk deduplication. Do not alter backend ranking or visibility policy to satisfy presentation tests.
- [ ] **Commit:** `refactor(search): share public genres and profile link presentation`.

## Task 2: Build the shared compact public search control

**Files:**

- Create `apps/web/src/app/_components/public-search-control.tsx`, `apps/web/src/lib/public-search-suggestions.ts`, `tests/web/public-search-suggestions.test.ts` and `apps/web/e2e/homepage-search.flow.spec.ts`.
- Modify `apps/web/src/app/_components/use-search-suggestions.ts`, `apps/web/src/app/_components/discovery-analytics.tsx` and, only if required for route assertions, `apps/web/src/app/search/suggest/route.ts`.

**Interfaces:**

- Export `SearchSuggestion = Pick<PublicSearchResult, "entityType" | "profileType" | "routePath" | "slug" | "subtitle" | "title" | "imageUrl" | "profileImageUrl" | "logoImageUrl" | "avatarAppearance" | "trustLabel">` from `public-search-suggestions.ts` and re-export from the hook for compatibility.
- Export `parsePublicSearchSuggestions(value: unknown): SearchSuggestion[]`. Validate response shape and closed entity/profile types at the network boundary; accept only local canonical route paths, excluding protocol-relative paths. Malformed responses yield no selectable suggestions. Never use an unchecked JSON cast.
- `useSearchSuggestions(query, filter, { skipWhenEqualTo? })` keeps its public calling shape and returns the existing `activeIndex`, `setActiveIndex`, `reset`, and `suggestions`. Freshness identity includes both normalized query and filter. `reset()` invalidates active selection and in-flight results.
- Export `PublicSearchControl` with the existing `DiscoverySearchForm` props: `action?: string`, `className?: string`, `defaultQuery?: string`, `filter?: SearchResultFilter`, `surface?: "home" | "search"`, `tone?: "default" | "inverse"`. Re-export it as `DiscoverySearchForm` from `discovery-analytics.tsx` so current discovery callers keep working.

- [ ] **Write failing tests:** parser accepts canonical profile/event/world suggestions and rejects malformed payloads/unsafe routes. Browser tests on existing `/discovery` assert five visible options from eight returned suggestions, no layout shift, exactly five keyboard-addressable items, selected Enter opens the canonical route, and unselected Enter/`View all results` submit the trimmed query plus active filter. Assert the footer link is outside the combobox listbox, not a sixth option.

  ```ts
  test("unsafe or malformed suggestions cannot become navigation targets", () => {
    assert.deepEqual(parsePublicSearchSuggestions("<!doctype html>"), []);
    assert.deepEqual(parsePublicSearchSuggestions({ results: [
      { entityType: "event", slug: "unsafe", title: "Unsafe", routePath: "//example.invalid" },
    ] }), []);
  });
  // In the browser's eight-result response case:
  await expect(page.getByRole("option")).toHaveCount(5);
  await expect(page.getByRole("listbox").getByRole("link", { name: "View all results" })).toHaveCount(0);
  ```

- [ ] **Add race/access tests:** delay an old query response and resolve a newer one first; switch filters without changing text; clear and retype; exercise Escape, outside click, focus/blur, touch selection and IME Enter. Assert stale options cannot be clicked or selected. Seed only `vrdex.lookup.recentSearches` with a private term and assert the public control never reads/displays it or requests `/lookup/suggest`.
- [ ] **Verify red:** run parser tests and the new flow spec with `pnpm --filter web exec playwright test homepage-search.flow.spec.ts --project=desktop-chromium`. Use network interception only for external response timing/failure, not to replace the public data-path acceptance tests.
- [ ] **Implement the interfaces above:** retain debounce/abort protection, cap options before rendering and keyboard indexing, and preserve IME behavior. Synchronize input with URL-driven `defaultQuery` changes, reset selection on query/filter changes, support clear, and dismiss predictably. The overlay is absolutely positioned; identity uses shared image fallbacks and a quiet Person/Community/Event/World label. Keep raw query data out of analytics.
- [ ] **Preserve progressive enhancement:** explicit GET form action is `/search`; include `type` only when nondefault. Empty input does not fetch/enumerate suggestions. A suggestion failure still permits explicit submission. Place `View all results` outside listbox semantics and do not show a fabricated total count.
- [ ] **Verify green:** parser tests plus desktop/mobile flow cases and existing stale-suggestion/filter smoke tests pass; typecheck and focused lint pass.
- [ ] **Commit:** `feat(search): add compact public search suggestions`.

## Task 3: Add progressive disclosure to unified results

**Files:**

- Create `apps/web/src/app/_components/public-search-result-details.tsx`.
- Modify `apps/web/src/app/_components/discovery-public-page.tsx`, `apps/web/src/app/_components/search-view-shell.tsx`, `apps/web/src/app/_components/lookup-copy-button.tsx` and `apps/web/e2e/homepage-search.flow.spec.ts`.
- Update mode-switch assumptions in `apps/web/e2e/public-routes.smoke.spec.ts`; preserve its legacy permission/bulk assertions.

**Interfaces:**

- Export `PublicSearchResultDetails({ person }: { person: PublicSearchPerson })`. Use Task 1's genre helpers and `PublicProfileLinks`. Render at most three genre names, an independent `+N` disclosure for remaining genres, and a separately controlled `Links` disclosure only when links exist. Do not nest interactive controls inside a profile link.
- Preserve `LookupCopyButton({ className?, label?, value })`'s interface. Add accessible success/failure status using existing utility labels; maintain original control focus through clipboard fallback and clean up fallback DOM/timers.
- Keep `SearchViewShell`'s calling props compatible with legacy lookup. Standard search uses `Search results`; remove the visible mode-switch navigation. The legacy DJ surface can provide a plain return-to-search link preserving the query without advertising a DJ mode on primary public search.

- [ ] **Write failing browser cases:** two public people can have their Links panels open simultaneously; closed rows expose identity, public role/genres and profile navigation without copy actions. Opening `+N` must not open links. Sparse people have neither empty genre overflow nor empty link disclosure. Events, communities and worlds retain their metadata, canonical destinations and event-local date rendering.

  ```ts
  // Scope both rows by their canonical identity links in the fixture-backed test.
  await expect(firstRow.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await firstRow.getByText("Links", { exact: true }).click();
  await secondRow.getByText("Links", { exact: true }).click();
  await expect(firstRow.getByRole("button", { name: "Copy", exact: true }).first()).toBeVisible();
  await expect(secondRow.getByRole("button", { name: "Copy", exact: true }).first()).toBeVisible();
  ```

- [ ] **Add copy cases:** successful Clipboard API copy, rejected Clipboard API with successful fallback, and complete copy failure keep both panels open, leave the URL unchanged and return focus to the copy button. Assert appropriate accessible status. Clipboard APIs are the external boundary that may be stubbed.
- [ ] **Verify red:** run the new result-focused flow cases against current standard search, expecting missing disclosures/genre behavior. Existing legacy cases remain enabled.
- [ ] **Implement the interfaces above:** compose details beneath the existing identity link, use plain wrapping genre text, preserve verified/unclaimed/source and claim-entry treatment, and keep state local per result. Do not expose exact genre filters or operator copy clusters in collapsed rows.
- [ ] **Verify green:** new flow cases, genre unit tests, search/lookup smoke tests, web typecheck and focused lint pass. Verify legacy provider link formatting still agrees with standard expanded links for the same public record.
- [ ] **Commit:** `feat(search): disclose profile links within unified results`.

## Task 4: Promote public search to Home and deliver the slice

**Files:**

- Create `apps/web/src/app/_components/home-search-page.tsx`.
- Modify `apps/web/src/app/page.tsx`, `apps/web/e2e/homepage-search.flow.spec.ts`, `apps/web/e2e/public-routes.ts` and route expectations in `apps/web/e2e/public-routes.smoke.spec.ts`.
- Update existing Home/search committed screenshots under `apps/web/e2e/__screenshots__/{desktop-chromium,mobile-chromium}/` only after reviewing actual captures.
- Update `docs/planning/product-direction.md`, `docs/planning/homepage-discovery-direction.md`, `docs/planning/unified-search-views.md`, `docs/backend/search-discovery.md`, `docs/engineering/local-development.md` and the supersession note in `docs/superpowers/specs/2026-10-21-homepage-search-schedule-design.md`.

**Interfaces:**

- Export server-renderable `HomeSearchPage()` using existing brand/account navigation, `PageShell`/`PageContainer`, and `PublicSearchControl` with `surface="home"`, `tone="default"`, `action="/search"` and no default query/filter.
- `Home({ searchParams })` trims `q`: nonempty values redirect with the existing `searchHref({ query, view: "dj" })`; empty values render `HomeSearchPage` without fetching legacy lookup or private data.

- [ ] **Write failing acceptance tests:** `/` renders `DJs, clubs & events` with public search; typed submission reaches `/search?q=...` without `view=dj`; `/?q=BASICBIT` redirects to legacy DJ lookup and whitespace-only `q` renders Home. Assert `/lookup?q=...`, `/lookup/suggest`, `/search?view=dj`, `/discover?q=...` and `/discovery` retain their contracts and no primary public DJ mode switch appears.

  ```ts
  test("new Home submissions and old root bookmarks retain distinct destinations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: /Search/i }).fill("BASICBIT");
    await page.getByRole("combobox", { name: /Search/i }).press("Enter");
    await expect(page).toHaveURL(/\/search\?q=BASICBIT$/);
    await page.goto("/?q=BASICBIT");
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
  });
  ```

- [ ] **Add navigation/privacy cases:** submit from Home, change entity filter, refresh, Back and Forward; assert input query, active filter and result identity agree. Open canonical person/community/event/world destinations from previews. Use real local Convex public fixtures to verify server filtering and hidden/private exclusions; keep existing authorized private bulk behavior tests on legacy routes. No new Home/search request may target a private suggestion endpoint.
- [ ] **Verify red:** run the new Home cases and focused route smoke tests before changing root routing.
- [ ] **Implement Home and routing:** reuse approved label/navigation patterns, keep `/discovery` reachable and omit unfinished timeline/discovery/favorites placeholders. Add no fake records or new promotional text. Update the route documentation together with the implementation, marking earlier whole-home mockups as broader/later reference rather than shipped behavior.
- [ ] **Verify green:** run `pnpm lint:web`, `pnpm typecheck:web`, `pnpm test:web`, `pnpm typecheck:backend`, and `pnpm test:backend`. Run `pnpm --filter web exec playwright test homepage-search.flow.spec.ts public-routes.smoke.spec.ts --project=desktop-chromium --project=mobile-chromium`. Browser infrastructure must use the anonymous local lane.
- [ ] **Visually verify:** capture Home at rest, five-option preview, full results, expanded genres/links and sparse results at desktop and mobile widths. Inspect the images directly, check long names/URLs and narrow widths, then update only changed Home/search baselines using the documented snapshot command. Run the affected snapshot comparisons and `pnpm build:web`; finish with `pnpm lint:markdown` and `git diff --check`.
- [ ] **Commit:** `feat(home): make unified public search the root entry`.
- [ ] **Review and publish the branch:** invoke Superpowers requesting-code-review and verification-before-completion. Resolve actionable findings and rerun affected checks. Push the explicit `codex/homepage-search` branch, open a focused PR with `ci:browsers` and `ci:visuals`, and report its URL plus meaningful test/visual evidence. Do not merge, request a hosted preview deployment or change production data as part of this plan.

## Plan self-review

The four tasks cover the approved scope: public projection and genre/link reuse
in Task 1, preview/keyboard/freshness in Task 2, full result disclosure and mode
removal in Task 3, and root routing/compatibility/privacy/docs/visual evidence in
Task 4. Exact genre filtering and the remaining homepage modules are explicitly
deferred. Each Review Focus condition has an owning browser case. No new public
sentence or persistence contract is introduced by the plan.
