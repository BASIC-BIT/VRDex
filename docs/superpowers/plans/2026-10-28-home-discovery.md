# Home discovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add poster-led Home discovery that mixes familiar DJs/clubs with relevant unfamiliar events and communities, independently of tonight's timeline.

**Architecture:** Bounded public candidate and signal queries feed a pure browser-side recommendation selector. A small shared Home controller supplies one event inspector and the existing browser-local preference store to Schedule and discovery. Candidate sampling spans future date bands, while ranking uses public genre identities, favorite identities and stable variety rather than soonest-first ordering.

**Tech Stack:** Existing Next.js, React, TypeScript, Convex, shared UI/media primitives, Node tests and Playwright. Node 24, pinned pnpm 10.15.1, no new dependencies or services.

**Spec:** [Approved corrected discovery design](../specs/2026-10-28-home-discovery-design.md), approved by BASIC on October 28, 2026. The defaults below make that direction executable and are explicitly subject to plan review.

## Global constraints

- Two event cards and two similarly sized club cards, with sparse results allowed. Posters lead; familiar names and readable genres support decisions.
- No seven-day eligibility cutoff, ongoing-first/soonest-first recommendation order, fabricated aesthetic scores or requirement that clubs have an upcoming event.
- Aim for one familiar connection and one discovery when the available candidates support both; this is a starting heuristic, not a permanent ratio.
- Preserve one event panel, the existing preference store, 200 My night references and 500 favorite profile IDs. No preference schema migration or public-content persistence.
- Genre affinity uses exact public assignment slugs. No substring taxonomy, event-tag substitution, private genres or inferred community assignments.
- Preserve Home search, GET navigation, `/discovery`, `/lookup`, legacy root-query redirects and `/search?view=dj`.
- Preserve authored dates, viewer-local times, timeline packing, pending-pan history flushing and Back behavior.
- Use shared charcoal tokens, subtle radii, purple My night and contained transparent logos. No unapproved prose, em dashes or fake sample text.
- Local authorized fixtures only. No hosted seed data, billing, production broadcasting changes, external publishing or new engagement tracking.

## Review focus

- A favorite DJ can be outside a bounded roster sample. Task 1 tests positive-only evidence and explicit partial coverage; no sampled absence becomes a claim that the DJ is absent.
- A far-future event can be buried behind hundreds of near-term events. Task 1 proves date-band retrieval reaches it before ranking; Task 2 proves chronological proximity does not outweigh the recommendation criteria.
- Different profiles can use the same genre label with different slugs. Tasks 1 and 2 prove visibility-aware exact identity matching and no string-based merging.
- Favoriting a discovery card can alter the result while its inspector is open. Tasks 3 and 4 preserve selection and usable focus when the original card disappears.
- Suppression can arrive after cards were ranked or during a refresh failure. Tasks 1, 3 and 5 prove reactive invalidation, stale-response rejection and removal of obsolete public data.

## Implementation defaults and file boundaries

Public sampling is a contextual recommendation pool, not an exhaustive public directory. Use four future bands relative to viewer-local today: days 0–6, 7–29, 30–89 and day 90 onward with no upper cutoff. These boundaries give nearby, next-month and distant events independent sampling opportunities; they are not eligibility deadlines. Timed eligibility starts at actual now, not today's midnight. Date-only eligibility starts at authored today. Already-started open-ended and ongoing timed events stay in Schedule rather than leading this upcoming discovery section.

For each band and each schedule kind, sample both ascending and descending edges. Each stream returns up to two eligible identities after at most three pages of 12 raw rows, using the existing scheduled/published start-time or event-date indexes. Only one database pagination context runs per query. This yields at most 32 distinct event candidates before deduplication. Keep each stream's cursor and complete/partial status; do not claim completeness after a client budget ends. The sample is intentionally bounded and does not guarantee that every future record appears. No automatic full-history scan or rotation promise beyond the sampled pool.

Clubs are independently sampled from public community profiles using the existing profile-type/publication index in both directions, at most three pages of 12 raw rows per direction, retaining up to 12 public identities each. They need no event. Merge in currently eligible favorite communities from the public favorite-signal response, so a club favorite is not dependent on where it falls in the generic sample. A community's own public genres provide its musical context.

Resolve event recommendation signals for at most four event IDs per call. Recheck event and host eligibility. Inspect at most eight rows plus a coverage probe from each of confirmed slots, authored lineup and confirmed participants, using their existing event indexes. Respect authored position/time order, deduplicate linked public profiles by ID and project only names and public genres. Participants qualify as musical evidence only when their existing role is explicitly DJ; an unrelated host/photographer is not a DJ recommendation signal. Manual lineup labels can display but never match a favorite or supply genres. Missing or truncated associations contribute no negative evidence.

Resolve favorite public profile signals in batches of at most 50 unique IDs, at most 500 IDs overall. Invalid, suppressed, private or missing profiles return no metadata. These are ordinary public reads of identities already stored locally; do not persist or log the preference list on the server. Use a three-request concurrency limit for candidate continuations and signal batches. Load discovery when it approaches the viewport, keeping search/Schedule interactive. Measure requests and latency with the dense fixture before finalizing; reduce unnecessary hydration, not privacy checks or distant-date coverage.

Pure selection uses one point per exact genre slug per unique favorite profile to form affinity weights. Candidate event genres come from eligible linked DJ/performer assignments, with provenance retained; they never become stored event genres. Candidate club genres come only from that club. Direct favorite DJ matches make an event familiar; a favorite host club also makes it familiar. Select one familiar event by favorite-DJ count, favorite-host presence and genre affinity, then one unfamiliar event by genre affinity. A complete roster with no favorite match is unfamiliar; a partial roster with no match has unknown familiarity and is available as fallback rather than proof of unfamiliarity. Prefer different host IDs whenever an alternative exists. If either group is empty, fill from remaining eligible candidates, preferring affinity then variety. Clubs use the same familiar/unfamiliar split with direct favorite IDs and their own genre affinity. Never duplicate an entity or leave a slot empty merely because its intended category is unavailable.

Break equal scores using a deterministic hash of a browser-session seed, viewer-local date and entity ID. Keep the seed in sessionStorage, with an in-memory fallback if storage is blocked; it contains no content or preference history. Do not use `Math.random()` during render, timestamp proximity, image dimensions or a popularity score as ranking inputs. Keep the current selection stable during backend refresh; only replace the card list once the refreshed ranking is ready.

Backend modules own eligibility and bounded public joins. `apps/web/src/lib/discovery/` owns transport-independent sampling/ranking lifecycle. `apps/web/src/app/_components/discovery/` owns rendering and hooks. A shared Home controller owns panel selection and current timezone; existing Schedule retains timeline navigation and geometry. Avoid growing `convex/events.ts` or the public event page into discovery implementations.

## Task 1: Bounded public discovery candidates and signals

**Files:** Create `convex/homeDiscovery.ts`, `convex/_homeDiscovery.ts`, `convex/_homeDiscoveryTypes.ts`, `tests/backend/home-discovery.test.ts`. Modify only necessary shared projection helpers in `convex/_profilePublic.ts` and `convex/_eventPublic.ts`; update `docs/backend/search-discovery.md`. Generate API declarations with documented local tooling.

**Interfaces:** Export the following shared types from `_homeDiscoveryTypes.ts`, deriving schedule/public-genre shapes from existing authoritative types:

- `DiscoveryEventCandidate`: `id`, `slug`, canonical `href`, `title`, public `host` with `id/slug/displayName`, existing `TimelineSchedule` and optional public `posterImageUrl`.
- `DiscoveryProfileSignal`: `id`, `slug`, `displayName`, `profileType: "person" | "community"`, and public `genres` with exact `slug/displayName/displayLabel?/featured?`. Community variants also carry optional approved image/banner URLs.
- `DiscoveryEventSignal`: `eventId`, `performers: DiscoveryProfileSignal[]`, `manualLabels: string[]`, `coverage: "complete" | "partial"`. Only eligible performer signals enter the array.
- `DiscoveryPage<T>`: `items: T[]`, `cursor: string | null`, `complete: boolean`. Cursor scope binds the full request identity.
- `homeDiscovery.listEvents({ now, timeZone, band: 0|1|2|3, kind: "timed"|"date_only", direction: "asc"|"desc", cursor? }) -> DiscoveryPage<DiscoveryEventCandidate>`. One page reads at most 12 raw rows; caller enforces the three-page/two-item stream budget.
- `homeDiscovery.listClubs({ direction, cursor? }) -> DiscoveryPage<DiscoveryProfileSignal>`. At most 12 raw rows per page, public community identities only.
- `homeDiscovery.eventSignals({ eventIds: string[] }) -> { items: DiscoveryEventSignal[] }`, maximum four IDs, with unavailable IDs omitted.
- `homeDiscovery.profileSignals({ profileIds: string[] }) -> { items: DiscoveryProfileSignal[] }`, maximum 50 IDs, unavailable IDs omitted. Deduplicate and validate lengths at the boundary.

- [ ] **Step 1:** Write failing Convex tests named `samplesDistantBandsBeyondDenseNearTermEvents`, `continuesPastHiddenHostsWithinBudget`, `scopesCursorToBandZoneDirectionAndKind`, `includesClubsWithoutEvents`, `projectsOnlyCurrentPublicGenreAssignments`, `boundsRosterReadsAndReportsPartial`, and `rejectsOversizedSignalBatches`. Assert a day-120 record is retrieved despite 60 earlier events, unpublished/suppressed/private metadata never appears, a missing-end future event qualifies without an invented end, date-only today survives local-midnight/DST cases, disabled date-only behavior follows the existing flag, and truncated associations never claim a complete roster.
- [ ] **Step 2:** Run `node --conditions=import --import tsx --test tests/backend/home-discovery.test.ts`; confirm failures are missing endpoints/behavior rather than environment failures.
- [ ] **Step 3:** Implement the declared types/queries and scoped cursor helpers. Use `canReadProfile`, `getPublishedCommunity`, existing safe public image/media projections and `visibleProfileList(..., "genres", ..., "discovery")`. Extract a shared surface-aware public genre helper only if needed; preserve existing callers. Only scheduled, published, currently public events with supported canonical links qualify. No full media-kit/roster hydration per generic candidate; resolve only required public assets/signals. Cache repeated profile reads within a request.
- [ ] **Step 4:** Run the focused test plus `tests/backend/event-timeline.test.ts` and `tests/backend/search-discovery.test.ts`; expect zero failures. Run `pnpm check:backend:generated` and `pnpm typecheck:backend`. Record request/read bounds for maximum-size fixtures.
- [ ] **Step 5:** Commit the bounded query deliverable and its backend documentation as `feat: add public discovery recommendation candidates`.

## Task 2: Pure mixed recommendation selector

**Files:** Create `apps/web/src/lib/discovery/recommendations.ts`, `apps/web/src/lib/discovery/rotation.ts`, `tests/web/discovery-recommendations.test.ts`.

**Interfaces:** `selectDiscovery({ events, eventSignals, clubs, favoriteProfiles, favoriteProfileIds, rotationKey }) -> { events: DiscoveryEventCandidate[]; clubs: DiscoveryProfileSignal[] }`, with readonly array inputs and at most two outputs per group. `discoveryRotationKey({ seed, localDate }) -> string`; seed generation/storage stays outside the pure selector. Export `discoveryEventGenres(signal)` as attributed public performer genres for card presentation, never as event-authored genre metadata.

- [ ] **Step 1:** Write failing cases `blendsFamiliarAndUnfamiliar`, `usesExactPublicGenreIdentity`, `reachesPastNextWeekWithoutTimePenalty`, `prefersDifferentHosts`, `fillsSparseCategoriesWithoutDuplicates`, `coldStartHasStableVariety`, and `doesNotInferCommunityGenresFromLineups`. Assert a favorite DJ can earn the familiar slot, a new DJ sharing an exact public genre can earn discovery, matching display labels with different slugs do not match, a later genre match outranks a nearer nonmatch, and poster presence/shape does not change semantic scores. Pin deterministic expected IDs for a known rotation seed/date; changing seed/date must change an equal-score fixture's selected IDs.
- [ ] **Step 2:** Run `node --import tsx --test tests/web/discovery-recommendations.test.ts` and verify the expected missing-selector failure.
- [ ] **Step 3:** Implement the ranking/defaults above, deduplicating exact IDs/slugs before scoring. Favorite IDs alone cannot reveal a hidden name/genre; only current public signals can contribute that metadata. Partial roster evidence can establish a positive connection but cannot establish absence or reduce a score. Add no learned model, event counts or interaction history.
- [ ] **Step 4:** Rerun focused tests; expect zero failures. Verify inputs are not mutated and results stay bounded at two per entity type.
- [ ] **Step 5:** Commit as `feat: blend familiar and new discovery recommendations`.

## Task 3: Shared Home inspector and discovery lifecycle

**Files:** Create `apps/web/src/app/_components/home-browse-provider.tsx`, `apps/web/src/app/_components/discovery/use-home-discovery.ts`, `apps/web/src/lib/discovery/controller.ts`, `tests/web/discovery-controller.test.ts`. Modify `apps/web/src/app/_components/timeline/home-schedule.tsx` and its panel-selection type imports. Reuse `use-timeline-preferences.ts` unchanged unless a shared type import requires adjustment.

**Interfaces:** `HomeBrowseProvider` owns runtime timezone, `selection: TimelineSelection | null`, invoker and one `EventDetailPanel`. `useHomeBrowse()` returns `selection`, `timeZone`, `hour12`, `selectEvent(selection, invoker)`, `closeEvent()`, and `setDisplayTimeZone(zone)`. Keep the existing standalone HomeSchedule behavior through a local provider wrapper; its existing optional `onSelectionChange` callback still fires. `createDiscoveryController({ transport, concurrency: 3 })` returns `setContext({ now, timeZone, favoriteProfileIds, rotationKey })`, `getSnapshot`, `subscribe`, `retry`, `refresh`, and `dispose`. Its snapshot is a discriminated loading/available/error union, with available cards plus explicit candidate/signal coverage. Transport methods match Task 1's query signatures.

- [ ] **Step 1:** Write controller tests `samplesAllBandsBeforeFinalSelection`, `boundsContinuationsAndConcurrency`, `rejectsOldContextResponses`, `keepsFailureDistinctFromEmpty`, `resolvesAllFavoriteBatches`, and `revalidatesSuppressedCardsOnRefresh`. Assert three pages maximum per stream, at most three requests in flight, at most 32 deduplicated generic event candidates, all up-to-500 favorite IDs processed in 50-ID batches, and favorite community signals merged into the club pool. An old response cannot republish cards after timezone/favorites change or disposal.
- [ ] **Step 2:** Run `node --import tsx --test tests/web/discovery-controller.test.ts`; verify the intended missing-controller failures.
- [ ] **Step 3:** Implement bounded collection and the Task 2 selector. Subscribe to current candidate/signal query results so publication, hidden host and field-visibility edits invalidate cards. Keep subscription count bounded to current requests; dispose obsolete watchers. Omission from a successful eventSignals recheck removes that candidate, not just its genre data. Favorite signal responses replace prior signal sets, including removals. Refresh every five minutes and on visibility return with a fixed now bucket; apply actual-now eligibility locally every minute so an elapsed start cannot remain an upcoming card until the next sample refresh. Day/zone changes regenerate sampling context; favorite changes rerank and re-resolve public signals. Existing content clears on context invalidation/error; never retain stale public cards through a failed refresh. Stable rotation seed uses sessionStorage with an in-memory fallback. The hook starts collection near the viewport and exposes retry; no-JS keeps a real Browse link.
- [ ] **Step 4:** Extract only panel-selection/runtime ownership into the shared Home provider. Reuse the existing preference singleton and plan/favorite reducers. Schedule remains owner of pan/filter/history; synchronize its display timezone with the provider without resetting its viewed instant. Flush pending timeline navigation before relevant navigation/timezone actions. Inspector opening creates no new history entries, does not scroll the page and never pans the chart. Close restores connected invoker focus or the relevant section heading; invalidation uses the same close path.
- [ ] **Step 5:** Run controller tests plus `tests/web/discovery-recommendations.test.ts`, `pnpm typecheck:web` and the existing timeline regression suites identified by `rg --files tests/web | rg timeline`. Expect zero regressions. Browser-level cross-section replacement/focus evidence belongs to Task 5.
- [ ] **Step 6:** Commit as `refactor: share Home event inspection and discovery state`.

## Task 4: Poster-led event and club cards on Home

**Files:** Create `apps/web/src/app/_components/discovery/home-discovery.tsx`, `discovery-event-card.tsx`, `discovery-club-card.tsx` and `discovery.module.css` in that directory; create `apps/web/src/components/home-discovery.stories.tsx`. Modify `apps/web/src/app/_components/home-search-page.tsx` and `docs/planning/homepage-discovery-direction.md`.

**Interfaces:** `HomeDiscovery()` consumes the Task 3 hook/provider and existing preference store. `DiscoveryEventCard({ event, signal, preferences, onSelect, onSave })` and `DiscoveryClubCard({ club, preferences, onFavorite })` consume Task 1 entities and existing action types; derive prop types instead of duplicating public contracts. Story compositions supply static public view props without live backend requests or storage.

- [ ] **Step 1:** Add focused failing Playwright assertions in `apps/web/e2e/home-discovery.flow.spec.ts` for two-and-two composition, canonical event/club hrefs, separate save/favorite controls, favorite performer emphasis and genre provenance. A date weeks away must render normally. No next-event requirement or invented count appears on club cards. Missing public genres produce no fabricated labels.
- [ ] **Step 2:** Run that focused flow with local authorized fixtures on desktop; verify expected missing-card failures before implementing rendering.
- [ ] **Step 3:** Mount `HomeBrowseProvider` around Schedule and `HomeDiscovery` below it. Build poster-led cards using existing safe media primitives and shared tokens, matching the approved study's group balance. Show up to three linked public performer names, favorite performers first then authored order, and up to three attributed genre labels under the utility label `Lineup genres`. Clubs show only their own public genres, artwork/logo and name. Keep titles/date readable but visually subordinate to art and musical identity. Real canonical links enhance only ordinary activation to the shared panel. Club links use `/<slug>` directly. Show quick-add on hover/focus and a usable touch action; retain existing favorite/save capacity feedback.
- [ ] **Step 4:** Implement loading, available/partial, error/retry and verified-empty states. Exact utility labels are Discover, Events, Clubs, Browse, Loading, Unavailable, Retry, No events, No clubs and Lineup genres. Use existing approved action strings and explicit accessibility names. No other prose is included in plan approval. Partial zero-card groups show Browse without definitive empty claims. Keep actual sparse cards without filler. Add Storybook examples for mixed, cold-start, sparse, empty, partial, failed and missing-artwork states.
- [ ] **Step 5:** Run the focused flow, `pnpm lint:web`, `pnpm typecheck:web` and `pnpm build:storybook`; expect zero failures. Update the direction doc to distinguish current discovery recommendations from Schedule's planning job, with no stale seven-day or chronological-ranking instructions.
- [ ] **Step 6:** Commit as `feat: add visual recommendations to Home discovery`.

## Task 5: Real integration, visual review and delivery

**Files:** Create `apps/web/e2e/home-discovery-fixture.ts`, `apps/web/e2e/home-discovery.visual.spec.ts`, `tests/backend/home-discovery-fixture.test.ts`; finish Task 4's flow spec. Modify the existing loopback-only Home timeline fixture backend/routes in place where practical, and add intentional reviewed desktop/mobile images. Update `docs/testing/playwright-visual-preview.md`, `docs/planning/product-direction.md` and this plan's execution status.

**Interfaces:** Local fixture data supplies a favorite DJ event, unfamiliar genre match, near-term nonmatch, day-120 event, club without events, repeated hosts and private/suppressed variants. Reuse the existing fixed-date cross-worker lease helper and exact run-owned cleanup. Extend fixture payloads via a discriminated scenario rather than inventing a production-accessible seeding endpoint.

- [ ] **Step 1:** Add and run failing browser assertions for Schedule-to-discovery panel replacement, discovery-to-Schedule replacement, favorite/save synchronization, whole-event Included semantics, club profile navigation, modified-click/native links, keyboard/touch controls, focus after the invoking card disappears, Back with a pending pan, fractional-offset display and no-JS Browse. Fixture tests must prove local-only gating, exact cleanup and blocked lease after ambiguous creation/cleanup.
- [ ] **Step 2:** Implement only remaining integration fixes and fixture support. Keep a selected detail open while recommendation cards refresh; a truly unavailable event closes through the existing safe path. Do not alter screenshot tolerances, serialize the whole suite or weaken admission/visibility rules to fix fixtures.
- [ ] **Step 3:** Capture actual desktop/mobile screenshots for mixed recommendations, cold start, sparse, complete-empty, partial, failed and missing-artwork states. Inspect images directly with VLM review against the approved composition. Verify proportional logos, poster handling, long names, subtle favorite emphasis, controls, mobile panel overlap and focus rings. Correct UI issues and repeat only affected checks.
- [ ] **Step 4:** Run `pnpm test:web`, `pnpm test:backend`, `pnpm lint:web`, both typechecks, generated-code drift, Markdown lint and `pnpm build:web`. Use the documented build fallback only if the documented environment limitation reproduces, and report the exact limitation. Run `pnpm --filter web exec playwright test home-discovery.flow.spec.ts home-discovery.visual.spec.ts home-timeline.flow.spec.ts home-timeline-review.flow.spec.ts home-timeline-time-regressions.flow.spec.ts home-timeline.visual.spec.ts homepage-search.flow.spec.ts --project=desktop-chromium --project=mobile-chromium --workers=2`. New discovery cases must have no intentional skips; preserve existing unrelated baselines.
- [ ] **Step 5:** Record dense-fixture query counts/read bounds and time until usable discovery alongside responsive search/Schedule. Confirm early rendering and bounded watchers/request concurrency. If a cost issue requires new projection tables, services or a materially different ranking contract, report it before expanding scope. Finish source/docs drift review and commit as `test: verify mixed Home discovery across desktop and mobile`.
- [ ] **Step 6:** Request whole-branch review, address findings, and publish a draft PR with `ci:browsers` and `ci:visuals` before a normal UI CI run. Disposition/reply and resolve every addressed review thread before follow-up pushes. Iterate until selected checks pass, then report PR readiness with the URL and evidence. BASIC performs the merge.

## Execution setup and handoff

- [ ] Read AGENTS.md, the approved spec and this plan. Inspect current main and other active work before changing source. Do not replay the completed organizer, search or timeline implementation plans.
- [ ] Follow `superpowers:using-git-worktrees` and the managed-environment guidance before execution; preserve the existing clean branch/worktree. Activate `/workspace/vrdex-env.sh` in every shell and use the checked-in cloud startup/local lane.
- [ ] Run focused baseline timeline/search tests and record environment failures separately from code failures. Do not materialize hosted bindings to make local tests pass.

Recommended execution remains subagent-driven, consistent with BASIC's prior
request. Tasks 1 and 2 can be independently developed only after both workers
read Task 1's exact public types; Task 3 consumes both and Task 4 consumes Task 3.
Task 5 verifies the integrated result. Every task includes its own tests and
review before integration. Plan review precedes product implementation.
