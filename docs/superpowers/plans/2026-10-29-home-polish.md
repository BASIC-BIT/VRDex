# Home browsing polish implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Home polish as one combined PR with stable loading, clear interest/favorite controls, compact personal planning and a simpler timeline.

**Architecture:** Keep the existing public timeline, discovery selector, local preference store and shared inspector. Separate favorite updates from discovery's candidate-query lifetime, and fetch complete favorite-roster matches only for selected discovery cards. Shared controlled icon buttons provide consistent action semantics; the timeline remains the only schedule view.

**Tech Stack:** Existing Next.js, React, TypeScript, Convex, Node tests, Storybook and Playwright; Node 24 and pinned pnpm 10.15.1. No new dependencies or services.

**Spec:** [Home browsing polish](../specs/2026-10-29-home-polish-design.md). BASIC approved the visual/interaction direction on October 29, 2026. Review the implementation defaults in that spec before executing this plan.

## Global constraints

- One combined PR; do not reopen #397 or create separate spacing/control PRs. BASIC merges.
- Preserve preference schema version 1, 200 interest references, 500 favorite profile IDs, storage fallback and capacity feedback.
- Public lanes: minimum 376px, 94px pitch, 78px bars, one-hour packing gap. Personal lanes: 50px pitch, 44px bars, no heading band, no artificial gap.
- No arbitrary name cap or profile-derived event/set genre labels. Public profile genres may continue to affect recommendation ranking.
- Initial placeholders immediately reserve the responsive card footprint; spinner after 150ms, optional 140ms arrival fade, no minimum production loading delay.
- Preserve public revocation/error handling, canonical links, modifier clicks, selected late-page sets, native pagination and honest partial coverage.
- Preserve five-minute candidate refresh and minute-level local expiry. Three logical first-value reads is not a wire-concurrency claim.
- No new public prose beyond approved copy/utility labels without BASIC's review. No new tracking, persistence of public content or fake event times.
- Source the checked-in cloud startup skill before services. Use anonymous local fixtures; no hosted seeding or production writes.

## Review focus

- A favorite beyond the old eight-row roster prefix must appear without fetching every full roster or leaking a hidden profile; Task 3 owns the query/aggregation tests.
- A favorite change while a card or inspector has focus must preserve reading position and selection; a simultaneous revocation must still remove obsolete content; Task 4 owns these browser cases.
- An included set, capacity rejection or another tab's update must not animate unrelated controls or create a second save; Task 1 owns state/animation coverage.
- Date-only/open-end records and old Agenda URLs must remain usable after deleting Agenda, including across DST; Task 6 owns navigation/marker tests.
- Slow or failed initial data and long/broken artwork must not collapse the page or clip text; Task 7 owns measured desktop/mobile loading and visual cases.

## File responsibilities and order

1. Shared UI controls own appearance, accessible names, local interaction animation and removal hover; the existing preference reducer remains authoritative.
2. Timeline rendering owns compact personal lanes, set-cell actions and favorite identity marks.
3. Public discovery membership queries own complete, bounded matches; a separate browser controller owns their live aggregation for at most two selected cards.
4. Discovery lifecycle and presentation own stable updates, responsive cards, full-name club fallbacks, layout and placeholders.
5. The shared inspector owns full-roster display and canonical page navigation.
6. Timeline navigation/markers own removal of Agenda without dropping untimed records.
7. Integration owns real loading/performance evidence, docs, baselines and the single PR.

Execute tasks sequentially initially. Tasks 3 and 5 are independently reviewable,
but avoid concurrent edits to shared preference and Home integration files.
Use meaningful behavior tests; do not add tests that merely mirror CSS values
or implementation text. Use actual browser geometry for the visual dimensions.

## Task 1: Shared favorite and interest controls

**Files:** Create `apps/web/src/components/ui/favorite-button.tsx`, `apps/web/src/components/ui/interest-button.tsx`, `apps/web/src/components/ui/preference-controls.module.css`, `apps/web/src/components/home-preference-controls.stories.tsx`, `apps/web/e2e/home-preference-controls.storybook.spec.ts`. Consume existing `apps/web/src/lib/timeline/plan-actions.ts` and `preferences.ts`; preserve their contracts.

**Interfaces:** Export `FavoriteButton({ label, pressed, onToggle, size?, className? })` and `InterestButton({ label, state, onToggle, size?, className? })`. `label: string`, `pressed: boolean`, `state: ReturnType<typeof planSaveState>`, `onToggle: () => void`, `size?: "default" | "compact"`. Both are controlled native buttons; default size has at least a 40px touch target, compact desktop set actions at least 24px. An included interest is disabled. No transport/storage inside the buttons.

- [ ] **Step 1:** Add real Storybook/browser cases named `favoritesAndInterestAreIndependent`, `includedSetDoesNotToggle`, `checkBecomesRemoveOnHoverAndKeyboardFocus`, `onlyDirectSelectionAnimates`, and `externalOrRejectedUpdatesDoNotPop`, under the existing `@storybook-visual` selection tag. Assert pressed/disabled state, tooltip/accessibility context, actual animationstart events, focus order and no SVG replacement when an unrelated prop changes. Pin reduced-motion behavior with browser media emulation. Test registration/assertions remain unconditional; screenshot captures respect the existing capture flag.

  Representative assertions for the independent controlled-story buttons:

  ```ts
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect(interest).toHaveAttribute("aria-pressed", "false");
  ```

- [ ] **Step 2:** Run `pnpm --filter web exec playwright test --config=playwright.storybook.config.mjs home-preference-controls.storybook.spec.ts --project=storybook-desktop --workers=1`; confirm the tests fail for missing controls/behavior.
- [ ] **Step 3:** Implement the two shared components and controlled stories. Scope selection animation to a successful transition caused by that instance's own activation. Already-selected mounts and synchronized copies do not pop. Check/X paths share one stable SVG; removal hover uses translucent purple. Use reduced-motion handling and explicit context-specific accessible names. Reuse existing design tokens where available.
- [ ] **Step 4:** Run the same browser cases and `pnpm --filter web exec eslint src/components/ui/favorite-button.tsx src/components/ui/interest-button.tsx src/components/home-preference-controls.stories.tsx`. Run existing preference/plan-action unit cases; retain limit/no-op behavior.
- [ ] **Step 5:** Commit the independently usable controls and evidence as `feat: unify favorite and interested controls`.

## Task 2: Compact My night and direct DJ actions

**Files:** Modify `apps/web/src/app/_components/timeline/timeline-night.tsx`, `timeline-event-bar.tsx`, `timeline-chart.tsx`, `timeline.module.css`, `home-schedule.tsx`, `apps/web/src/lib/timeline/packing.ts` only if its existing packing needs adaptation, `tests/web/timeline-packing.test.ts`, `apps/web/e2e/home-timeline.flow.spec.ts`, `apps/web/e2e/home-timeline-review.flow.spec.ts`.

**Interfaces:** Extend `TimelineNight` to consume existing `TimelineActions` favorite IDs/actions in addition to selection/interest actions. Reuse `SavedResolution`, `TimelineEvent`, `TimelineSlot`, `planSaveState` and `packPlan`. Join whole-event DJ tracks from current loaded public records/coverage; individual saved sets already resolve their exact slot. Never convert `resolveSaved` into an unbounded roster query.

- [ ] **Step 1:** Add browser cases `overlappingInterestsUseCompactDistinctLanes`, `savedSetKeepsEventAndDjIdentity`, `favoriteClubAndDjMarksRemainDistinct`, `hoverDjActionsAreSeparateSiblingButtons`, and `wholeEventIncludesSetControls`. Assert two overlapping items occupy two 50px lanes, bars are 44px, public rows retain 94px/78px geometry, first title aligns with My night, and no projection exists when empty. Test a selected set beyond the loaded roster prefix and honest partial whole-event tracks.

  For two overlapping fixture references, measure the actual first/second bars:

  ```ts
  expect(first.height).toBe(44);
  expect(second.y - first.y).toBe(50);
  expect(publicBar.height).toBe(78);
  ```

- [ ] **Step 2:** Run those focused cases against the current app and record expected failures. Existing packing tests must establish that personal choices can be adjacent with zero gap while public events retain one hour.
- [ ] **Step 3:** Render compact headers and authored DJ tracks on one shared axis. Include a gold mark grouped with a favorite club logo and gold marks by favorite DJ names; update in place. Use Task 1 controls for event/set interest and club favorites. Add sibling open-set/star/interest buttons to public set cells, shown on hover/focus within; highlight the entire cell and keep the action group transparent. Touch continues through the panel. Preserve overlap feedback, partial coverage, removal access for unavailable items and focus after removing a compact bar.
- [ ] **Step 4:** Run the focused cases and existing packing/plan-action suites. Visually inspect whole-event and mixed-event/set plans, long names, the check/X state, hover across all three cell targets, touch and reduced motion. Record no unrelated check-animation events while favoriting a club/DJ.
- [ ] **Step 5:** Commit as `feat: compact personal timeline and add direct DJ actions`.

## Task 3: Complete favorite matches for selected discovery cards

**Files:** Modify `convex/schema.ts`, `convex/homeDiscovery.ts`, `convex/_homeDiscoveryTypes.ts`, `convex/_homeDiscovery.ts` only for shared public eligibility/projection reuse, and generated API declarations through the normal tool. Create `apps/web/src/lib/discovery/favorite-lineup.ts`, `apps/web/src/app/_components/discovery/use-favorite-lineup.ts`, `tests/web/discovery-favorite-lineup.test.ts`. Extend `tests/backend/home-discovery.test.ts` and `docs/backend/search-discovery.md`.

**Interfaces:** Add `homeDiscovery.favoriteLineup({ eventIds: string[], favoriteProfileIds: string[] }) -> { items: Array<{ eventId: string; performers: Array<Pick<DiscoveryProfileSignal, "id" | "slug" | "displayName">> }> }`. Validate raw limits of two event IDs and 25 favorite IDs per request, deduplicate internally, and omit unavailable events/profiles. No cursor or association-prefix truncation. Add indexes `eventSlots.by_eventId_personProfileId_reviewState`, `eventLineupEntries.by_eventId_personProfileId`, and `eventParticipants.by_eventId_personProfileId_confirmationState` using those exact field sequences.

An association exists through a confirmed public slot, authored lineup entry or
confirmed participant represented in the public detail roster. Match the actual
public roster's role semantics; do not invent a DJ-only role filter that hides
other displayed favorite people. Date-only events skip slots as the current
public detail query does. Gate event and person visibility through existing
public helpers, and deduplicate people across all three sources.

Export `createFavoriteLineupController({ transport })`, where transport exposes
`favoriteLineup(args): DiscoveryQuery<FavoriteLineupResult>`. Provide
`setContext({ eventIds, favoriteProfileIds })`, `getSnapshot`, `subscribe`,
`retry`, `dispose`. Snapshot is loading, error, or available with complete matches
for current IDs. Batch at 25 favorites and at most three logical first-value
reads. Only the selected two cards use this path; no favorite IDs means no reads.
The hook adapts Convex live queries; it does not own recommendation selection.

- [ ] **Step 1:** Add backend cases `findsFavoriteBeyondOldPrefix`, `deduplicatesRosterSources`, `omitsPrivatePeopleAndEvents`, `dateOnlyMatchesPublicRosterSemantics`, and `rejectsOversizedFavoriteMembershipBatches`. Put a match after 80 nonfavorite associations and assert it is still returned. Add controller cases `aggregatesAllTwentyBatchesForFiveHundredFavorites`, `doesNotPublishAnArbitraryPartialSubset`, `ignoresObsoleteResponses`, `removesRevokedMatches`, and `skipsEmptyFavorites`. Assert no more than two selected IDs, 25 IDs/call, three first-value reads, and every matching identity after all batches finish.

  For one selected event with a single eligible late favorite, then a separate
  500-favorite controller fixture:

  ```ts
  assert.deepEqual(result.items[0]?.performers.map(person => person.id), [lateFavoriteId]);
  assert.equal(calls.length, 20);
  assert.ok(calls.every(call => call.favoriteProfileIds.length <= 25));
  ```

- [ ] **Step 2:** Run `node --conditions=import --import tsx --test tests/backend/home-discovery.test.ts` and `node --import tsx --test tests/web/discovery-favorite-lineup.test.ts`; verify intended failures. Inspect real test counters, not only subprocess exit status.
- [ ] **Step 3:** Implement indexed existence lookups, at most three association lookups per event/person pair, plus public visibility checks. Use `.first()` on exact indexed association keys, not `.take(8)`, full roster scans or new denormalized fields. Aggregate current live batches before publishing a complete summary; clear untrusted matches on changed membership/privacy results. Preserve candidate-query budgets and metadata-minimizing projections.
- [ ] **Step 4:** Run focused tests, backend types and `pnpm check:backend:generated`. Verify the new indexes and endpoint on the native local backend, including privacy changes and all 500 favorites. Record targeted membership request/read bounds separately from candidate sampling.
- [ ] **Step 5:** Commit as `feat: resolve complete favorite lineup matches for discovery`.

## Task 4: Stable discovery lifecycle, cards, Home spacing and initial placeholders

**Files:** Modify `apps/web/src/lib/discovery/controller.ts`, `apps/web/src/app/_components/discovery/use-home-discovery.ts`, `home-discovery.tsx`, `discovery-event-card.tsx`, `discovery-club-card.tsx`, `discovery.module.css`, `apps/web/src/app/_components/home-search-page.tsx`, `apps/web/src/app/_components/home-browse.module.css`, `apps/web/src/components/home-discovery.stories.tsx`, `tests/web/discovery-controller.test.ts`, `tests/web/home-discovery-presentation.test.ts`, `apps/web/e2e/home-discovery.flow.spec.ts`. Remove `discoveryEventGenres` only if it has no remaining callers, preserving private genre-affinity helpers in `apps/web/src/lib/discovery/recommendations.ts`.

**Interfaces:** Add `setFavorites(favoriteProfileIds: readonly string[])` to the existing discovery controller. Remove favorite IDs from `DiscoveryContext`, leaving `{ now, timeZone, rotationKey }`, and update hook/tests to call the two setters separately. Retain normalized current favorites inside the controller. Its candidate lifetime follows client, timezone, local date and rotation context, not the favorites-array identity. Favorite changes reuse watched candidate/event-signal pools and update favorite-profile reads; a new full candidate collection is unnecessary. Add `eligibleEventIds: readonly string[]` and `eligibleClubIds: readonly string[]` to available snapshots for presentation to distinguish ordinary reranks from revoked entities, updating stories/fixtures too. Event cards consume Task 3's complete matching people, separately from bounded ranking signals.

- [ ] **Step 1:** Extend controller/browser tests with `favoriteChangeKeepsCandidatesAndCards`, `rapidFavoritesIgnoreStaleReplies`, `expiryStillRefillsWithoutNewReads`, `revocationClearsRetainedContent`, `focusedCardSurvivesOrdinaryRerank`, and `inspectorOutlivesRecommendationMembership`. Assert candidate-query registrations do not restart on a favorite toggle, no loading collapse, and the same public detail remains selected/focused. Presentation tests assert all matching favorite names, no arbitrary nonfavorite names, no profile-genre set claims, full-name fallback and canonical links.

  Measure a normal-length fixture card before the club favorite interaction;
  compare after the new favorite query has actually completed:

  ```ts
  expect(await card.boundingBox()).toEqual(beforeBounds);
  expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll);
  assert.equal(candidateRegistrationsAfter, candidateRegistrationsBefore);
  ```

- [ ] **Step 2:** Reproduce the current favorite-induced collapse in the real browser and record card bounds, document scroll and query registrations. Run new focused tests for the expected failures.
- [ ] **Step 3:** Separate hook/controller lifetimes and pending favorite generations. Reuse public candidate watches for favorite changes, retaining usable cards while new favorite inputs resolve. Commit ready ranks atomically. Defer replacement of a focused eligible card until blur; never defer a privacy-driven removal. Keep ordinary timer refresh, native live invalidation and minute-level local expiry semantics. Use Task 3 for favorite summaries and Task 1 for controls.
- [ ] **Step 4:** Implement approved card hierarchy, Full lineup/Browse arrows, responsive full-name artwork fallback and wider mobile card scrollers. Use existing media safety and contain sizing; leave missing event posters unchanged. Reserve event metadata with a 128px minimum and club metadata with 72px/80px minima without clipping. Consolidate Home spacing/search row, with 24px desktop and 22px narrow search padding. Keep GET search and page navigation unchanged.
- [ ] **Step 5:** Add stable first-load card shells, static decorative skeletons, section `aria-busy`, one spinner after 150ms and immediate ready content with a reduced-motion-aware 140ms fade. Ordinary refresh does not show initial skeletons. Add Storybook states for cold, warm-refresh, sparse, empty, failed and long content; preserve real revocation/error state behavior.
- [ ] **Step 6:** Run controller/presentation tests and relevant discovery browser cases. Inspect real desktop/mobile renders, actual dimensions/scroll during favorites and cold/slow transitions, broken images, long/punctuation-heavy club names and an error that follows a loaded snapshot. Run affected ESLint and web types, then commit as `feat: stabilize Home discovery and refine browsing layout`.

## Task 5: Compact shared event inspector

**Files:** Modify `apps/web/src/app/_components/timeline/event-detail-panel.tsx`, `event-detail-content.tsx`, `event-detail.module.css`, `apps/web/src/app/_components/viewer-local-event-times.tsx`, `tests/web/timeline-detail.test.ts`, `apps/web/e2e/home-timeline.flow.spec.ts`, `apps/web/e2e/home-timeline-time-regressions.flow.spec.ts`.

**Interfaces:** Keep existing selection, public event/roster and preference contracts. Use Task 1 controlled buttons. Add an optional `showTimeZone?: boolean` to the relevant viewer-local time components, defaulting to existing output for other callers; the inspector omits repeated zone text and has one panel-level zone/hour-format indicator. Canonical page hrefs use the existing `publicEventPath`/public event identity contract.

- [ ] **Step 1:** Add browser cases `panelUsesCompactPerformerControls`, `fullEventLinksPreserveNativeActivation`, `panelKeepsLatePageSetAndFocus`, and `panelTimesCrossDstWithoutRepeatedOffsets`. Assert generic DJ labels omitted, meaningful non-DJ roles retained, unlinked authored names present, event/set interest scope correct, one timezone indicator, and correct local times across the Halloween DST boundary. Preserve original viewer-local formatting elsewhere.

  In the fixture with generic DJ roles and a known canonical event URL:

  ```ts
  await expect(panel.getByText("DJ", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "Open full event page" })).toHaveAttribute("href", canonicalHref);
  ```

- [ ] **Step 2:** Run the focused cases and document expected current failures.
- [ ] **Step 3:** Link the title and add the full-page icon beside Close; remove the redundant Open event button and old Expand/Collapse mode. Keep the nonmodal side/bottom panel, compact performer rows and safe internal scrolling. Reserve poster bounds through loading/decode and retain poster access on mobile. Keep pagination, More/Retry, canonical links and selected late-page rows. Close/Escape restores focus; public unavailability closes safely.
- [ ] **Step 4:** Run detail, time and focused browser tests; inspect desktop and mobile with long titles, later roster pages, storage limits and an open panel while favorites/ranks change. Commit as `feat: simplify the shared event inspector`.

## Task 6: Timeline-only navigation and complete untimed-event access

**Files:** Modify `apps/web/src/lib/timeline/navigation.ts`, `apps/web/src/app/_components/timeline/home-schedule.tsx`, `timeline-toolbar.tsx`, `timeline-chart.tsx`, `timeline-night.tsx`, `timeline.module.css`, `tests/web/timeline-navigation.test.ts`, `tests/web/timeline-geometry.test.ts`, `apps/web/e2e/home-timeline.flow.spec.ts`, `apps/web/e2e/home-timeline-time-regressions.flow.spec.ts`. Create `apps/web/src/app/_components/timeline/timeline-date-markers.tsx` and `apps/web/src/lib/timeline/schedule-label.ts`. Delete `apps/web/src/app/_components/timeline/timeline-agenda.tsx` after moving its remaining formatting callers.

**Interfaces:** Remove `view` from `TimelineNavigation`; retain anchor, timezone and favorites. `readTimelineNavigation` ignores legacy `scheduleView`, and `timelineNavigationHref` always deletes it while preserving unrelated params. Move `scheduleLabel(schedule, timeZone)` to the named utility. `TimelineDateMarkers({ records, range, origin, ...actions })` consumes existing typed schedules/actions; date-only records map to their local calendar day, not a fabricated hourly event. Open-end records retain their known-start marker.

- [ ] **Step 1:** Update navigation tests to assert old Agenda links restore the same date/zone/favorites in timeline and serialize without `scheduleView`. Add cases `dateOnlyRecordsRemainDiscoverableWithoutAgenda`, `openEndDoesNotInventDuration`, `savedUntimedReferencesRemainRemovable`, and `quietRangeNavigatesToKnownLaterEvent`. Cover DST, feature-flagged date-only support, no known later target and preservation of unrelated URL parameters. Assert no view-switch controls or Agenda UI remain.

  ```ts
  assert.deepEqual(readTimelineNavigation(new URLSearchParams("at=1793509200000&tz=America%2FNew_York&scheduleView=agenda&favorites=1")), {
    anchor: 1793509200000, timeZone: "America/New_York", favoritesOnly: true,
  });
  assert.equal(new URL(href, "https://example.test").searchParams.has("scheduleView"), false);
  ```

- [ ] **Step 2:** Run focused navigation/geometry/browser tests and verify the intended failures.
- [ ] **Step 3:** Remove view state/branches, toggle, Agenda markup, dead styles and Agenda-specific tests. Extract shared formatting before deleting its old module. Render date-only markers conditionally in the timeline with Time TBA, retaining inspector/interest access. Do not drop records currently surfaced by the chart's Agenda fallback. Retain clear controls for unavailable saved references without recreating an alternate Agenda.
- [ ] **Step 4:** Set four-row minimum geometry and reserve the real toolbar/axes/chart shell during Home startup. Show Next event only when the current public loaded buffer contains a later target; use its authored time/day and preserve filter context. Keep date controls and Now when no target is known. Do not add an unbounded future seek. Recheck mouse/touch/keyboard panning and date synchronization.
- [ ] **Step 5:** Run focused tests, native browser flows, web types and affected lint. Use `rg 'TimelineAgenda|scheduleView|navigation\.view' apps/web/src tests/web apps/web/e2e` to inspect every remaining hit; only deliberate compatibility tests may refer to legacy view query text. Commit as `feat: make Home schedule timeline-only`.

## Task 7: Combined verification, performance evidence and delivery

**Files:** Update `apps/web/e2e/home-timeline.visual.spec.ts`, `home-discovery.visual.spec.ts`, `home-discovery-states.storybook.spec.ts`, `home-timeline-fixture.ts`, `home-discovery-fixture.ts` only as necessary, their affected reviewed screenshot baselines, `docs/testing/playwright-visual-preview.md`, `docs/backend/search-discovery.md`, `docs/planning/homepage-discovery-direction.md`, and both earlier timeline/discovery design docs where superseded behavior needs an explicit link to this spec.

**Interfaces:** Use existing anonymous native backend, fixture lease/cleanup support, real public APIs and current screenshot-selection flags. No production seed, fixture safety relaxation, screenshot tolerance increase or fake network-data source.

- [ ] **Step 1:** Add integration cases `slowHomeKeepsItsFootprint`, `failedInitialLoadSettlesWithRetry`, `warmFavoriteUpdateKeepsInspectorAndReadingPosition`, `allFavoriteNamesSurviveLargeRoster`, and `coldSearchRemainsUsable`. Use real fixture data and delayed real transport response completion for slow cases, not fabricated payloads. Compare document coordinates and section geometry before/after loading; explicitly test metadata wrap, empty/error results and both mobile/desktop. Do not claim every arbitrary long title has zero layout movement.

  For the ordinary metadata fixture, compare document coordinates including
  `scrollY`, rather than viewport coordinates after a screenshot scrolls:

  ```ts
  expect(Math.abs(after.footerDocumentY - before.footerDocumentY)).toBeLessThanOrEqual(1);
  expect(after.documentWidth).toBeLessThanOrEqual(after.viewportWidth);
  ```

- [ ] **Step 2:** Run the integrated flows against the native backend, then capture a fresh local before/after comparison using the same fixture, viewport and browser conditions. Record cold/warm section readiness, first/decoded artwork, actual layout shifts and favorite-triggered candidate/membership registrations. Include a dense fixture and a bounded slow-network observation; report unfinished loads as unfinished. Distinguish logical scheduler bounds from live wire work. No synthetic delay from the prototype enters the app.
- [ ] **Step 3:** Run `pnpm typecheck:web`, `pnpm typecheck:backend`, `pnpm lint:web`, `pnpm lint:markdown`, `pnpm test:web`, `pnpm test:backend`, and `pnpm check:backend:generated`. Inspect actual counters. If this harness suppresses real Node file execution, run files in separate real Node processes with `--test-isolation=none`, keeping `--conditions=import` for backend only, and retain that exact evidence. Run `pnpm build:web` and `pnpm build:storybook`; disclose a local tool/network limitation rather than calling a different command the default build.
- [ ] **Step 4:** Run `pnpm --filter web exec playwright test home-timeline.flow.spec.ts home-timeline-review.flow.spec.ts home-timeline-time-regressions.flow.spec.ts home-discovery.flow.spec.ts --project=desktop-chromium --project=mobile-chromium --workers=2`. Run the timeline/discovery visual suites and Storybook component/state checks using their existing config/project names. Review changed screenshots visually before accepting baselines; capture loading, selected set, compact overlaps and fallback artwork. Preserve genuine failures and exact scoped reruns.
- [ ] **Step 5:** Self-check spec coverage, then request independent whole-branch review through the selected execution workflow. Fix verified findings with appropriate checks. Update docs and a short evidence summary, including any performance or incomplete-coverage limits. Commit the reviewed integration evidence.
- [ ] **Step 6:** Open one draft PR around the complete change. Add `ci:browsers` and `ci:visuals` before marking ready. Triage/reply/resolve outstanding review threads before follow-up pushes. Iterate required and selected CI failures without repeated blind retries. Publish reviewed screenshots/evidence in the PR and leave the merge to BASIC. Do not describe readiness without the PR URL and current check evidence.

## Self-review and handoff

Coverage: controls/animations/interest semantics in Task 1; compact projection
and direct actions in Task 2; complete public favorite matches in Task 3; stable
cards, artwork fallbacks and loading/spacing in Task 4; inspector/times in Task
5; Agenda removal, markers and initial schedule shell in Task 6; real page-wide
performance, visual review and combined delivery in Task 7.

Implementation defaults needing review are called out in the spec: when ready
recommendations replace focused cards; ongoing/future projection semantics;
date-level untimed markers; and Next event limited to a known loaded target.
The approved prototype does not establish production behavior for those data
boundaries. No product implementation has begun on this branch.
