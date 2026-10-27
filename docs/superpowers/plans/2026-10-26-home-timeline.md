# Home timeline and night planning implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved continuously scrollable public schedule, event detail panel, browser-local favorites and My night to Home.

**Architecture:** Bounded Convex queries supply public interval projections and independently resolve saved references. Pure geometry and preference reducers feed a client schedule composed inside the existing Home page. Timeline and Agenda share records, actions and the same nonmodal event panel.

**Tech Stack:** Next.js 16, React 19, TypeScript, Convex, existing shared tokens and icons, Node test runner, Playwright. Node 24 and pinned pnpm 10.15.1; no new dependencies.

**Spec:** [Approved Home timeline design](../specs/2026-10-26-home-timeline-design.md), approved by BASIC on October 26, 2026.

## Execution status

Tasks 1–5 are implemented and task-reviewed on `codex/home-timeline`. Task 6
mounts the shared schedule on actual Home, preserves search and no-JS behavior,
flushes pending pan state before departure for correct Back restoration, and
adds real-fixture persistence, slot-identity and visual evidence. The branch
includes the clean merge of upstream main `3571211`; unrelated telemetry work
was not rewritten.

Local verification passed 909 web tests and 2,158 backend tests, with zero
failures or skips. The combined desktop/mobile timeline, Home-search and visual
run passed 110/110; affected public-event, lookup/search and Home baseline
comparisons passed 26/26. Both browser runs had zero skipped or flaky tests.
Web lint, both typechecks, generated-code drift and Markdown lint passed.
The default production build failed fetching Google Fonts through Turbopack's
TLS connection. The documented `pnpm build:web --webpack` fallback passed,
including TypeScript and 27/27 static pages; default Turbopack validation remains
environment-limited. No application fonts or TLS policy changed. New timeline
and affected Home images were directly inspected against the accepted study,
with unchanged screenshot tolerances.

Task 6 review, whole-branch review, publication and hosted CI remain pending.
No PR has been created and no push or merge is included in this execution.
The controller owns the review/publication sequence and `ci:browsers` plus
`ci:visuals` selection. The task checklists below retain the original plan.

## Global constraints

- Preserve compact public search, its GET submission, legacy root query redirects, `/lookup`, `/search?view=dj` and `/discovery`.
- No Today / Tomorrow / Upcoming tabs. One continuous axis; 100 CSS pixels per hour initially.
- Public row reuse requires 60 minutes of space. My night uses zero spacing and retains conflicting choices.
- Only authored time determines bar geometry. Missing ends are markers; date-only items retain their authored date.
- Fetch 48-hour windows, retain at most three windows. Requests span at most seven days and return at most 50 events per page.
- Saved-reference requests accept at most 50 references; browser limits are 200 plan references and 500 favorite profile IDs.
- Save references only, never public content snapshots, private grants or search text. Favorites and My night remain private to this browser.
- Use the approved spec's exact copy, shared charcoal tokens, purple My night treatment and contain-sized community logos.
- No autoplay, account synchronization, production seeding, external publishing integration, authoring behavior changes or new discovery cards.
- Local fixtures and anonymous local services only. Keep production broadcast admission fail-closed.

## Review focus

- Sparse eligible results behind hidden hosts must continue pagination instead of looking empty. Task 1 covers empty intermediate pages and Task 4 covers loading/More states.
- A saved slot removed and recreated under the same name must become unavailable. Tasks 1 and 3 pin stable-ID resolution and replacement behavior.
- Panning while a previous chunk or detail read completes must not replace the current viewport/selection. Tasks 4 and 5 cover out-of-order responses.
- Clock changes, DST and changing tabs must not shift the viewed instant or repack lanes unnecessarily. Tasks 2 and 4 cover elapsed-time geometry and refresh anchoring.
- Two tabs and blocked storage must preserve usable session actions without false persistence claims. Tasks 3 and 6 cover storage notifications, failure and reload.

## Execution setup and file boundaries

- [ ] Read `AGENTS.md`, the spec, `.agents/skills/vrdex-cloud-start/SKILL.md`, `docs/engineering/cloud-task-start.md` and `docs/engineering/local-development.md`.
- [ ] Verify PR #387's merge against current remote main. Prepare an isolated feature branch using the execution-environment guidance. Do not implement on the merged `codex/homepage-search` branch or discard other work.
- [ ] Activate the documented Node/pnpm environment. Read local lane readiness instructions before starting services. Record baseline failures; never introduce hosted credentials to repair a local fixture.
- [ ] Run focused baseline tests: `node --import tsx --test tests/web/event-lineup-timing.test.ts tests/web/event-lineup-display.test.ts tests/web/search-view-state.test.ts` and `node --conditions=import --import tsx --test tests/backend/search-discovery.test.ts`.

Backend files own public eligibility and bounded reads. New `apps/web/src/lib/timeline/`
modules own pure state/geometry. New `apps/web/src/app/_components/timeline/`
files own rendering and lifecycle. Do not expand the already large public event
page or `convex/events.ts` into schedule controllers.

Execution remains subagent-driven as previously requested. Task 1 and Task 2
can be developed independently after their shared contracts below are read.
Task 3 follows Task 1's identity contract. Tasks 4, 5 and 6 integrate sequentially.
Each task includes its own tests, documentation and reviewed commit.

## Task 1: Complete bounded public timeline reads

**Files:** Create `convex/eventTimeline.ts`, `convex/_eventTimeline.ts`,
`convex/_eventTimelineTypes.ts`, `tests/backend/event-timeline.test.ts`.
Modify `convex/schema.ts` and only the necessary shared projection helpers in
`convex/_eventPublic.ts`. Generate API declarations through repository tooling.

**Interfaces:**

- Export `TimelineRange = { startAt: number; endAt: number; timeZone: string }` and `PlanReference = { kind: "event"; eventId: string } | { kind: "set"; eventId: string; slotId: string }` from `_eventTimelineTypes.ts`.
- Export `TimelineSchedule = { kind: "timed"; startAt: number; endAt: number } | { kind: "open_end"; startAt: number } | { kind: "date_only"; eventDate: string }`.
- Export `TimelineSlot` with `id`, `eventId`, `displayLabel`, optional `performer: { id; slug; displayName }`, and `schedule` restricted to timed/open-end variants. IDs derive from Convex IDs internally; storage/RPC references are strings validated at the boundary.
- Export `TimelineEvent` with `id`, `slug`, canonical `href`, `title`, optional `host: { id; slug; displayName; imageUrl? }`, `schedule`, `slots: TimelineSlot[]`, `performers: Array<{ id; slug; displayName }>`, and `rosterCursor: string | null`. Performers include eligible linked untimed lineup/participant identities, deduplicated by ID. Identity fallback for manual community names stays a separate optional `communityName`.
- `eventTimeline.listPublic({ range: TimelineRange, cursor?: string, limit?: number })` returns `{ items: TimelineEvent[]; cursor: string | null; complete: boolean }`.
- `eventTimeline.listPublicRoster({ eventId: string, range: TimelineRange, cursor?: string })` returns `{ items: TimelineSlot[]; performers: TimelineEvent["performers"]; cursor: string | null; complete: boolean }` after rechecking event eligibility. Cursor phases cover confirmed slots, untimed lineup and eligible participants, at most 80 candidate rows per call.
- `eventTimeline.resolveSaved({ references: PlanReference[] })` returns one result per reference: `{ reference; kind: "available"; event: Omit<TimelineEvent, "slots" | "performers" | "rosterCursor">; status: "scheduled" | "cancelled"; slot?: TimelineSlot } | { reference; kind: "unavailable" }`. A set result requires its slot; express that distinction as a discriminated union in the implementation.

- [ ] Write backend tests using the repository's real `convex-test` schema/module setup. Test half-open interval boundaries, a prior-day ongoing event, unknown-end start membership, authored dates across viewer timezones, cancelled/private records, hidden linked people/worlds, all confirmed slots and safe manual labels. Test 51+ candidates, hidden-host-only pages, cursor/range mismatch, invalid IDs, wrong-event slots, same-name replacement slots and a saved event outside the chart range.
- [ ] Pin query coverage in named tests `continuesPastHiddenHosts`, `includesEarlierOngoingEvents`, `doesNotCarryUnknownEndsForward`, `resolvesSavedOutsideRange` and `continuesAfterEightySlots`. Collect every page through the real public API and assert unique stable IDs equal the eligible fixture IDs exactly. Assert no hidden profile ID, slug, URL or asset appears in serialized results. For date-only membership use local dates touched by `[startAt, endAt)`, excluding the upper-bound date when it starts exactly at midnight.
- [ ] Run `node --conditions=import --import tsx --test tests/backend/event-timeline.test.ts`; confirm failures are missing functionality.
- [ ] Implement the three queries. Validate finite ordered bounds, maximum seven elapsed days, valid IANA zone, page limits and maximum 50 saved references. Invalid IDs in saved references produce generic unavailable, matching private/missing records. Reject malformed range/cursor requests at the boundary.
- [ ] Implement resumable scan phases: scheduled starts within the requested range; earlier starts whose authored end exceeds range start; date-only events on viewer-visible calendar dates. Reuse existing scheduled/public start/end indexes and add `by_publicationState_eventStatus_eventDate` for authored date-only records. A phase cursor records range/zone, phase and database pagination cursor. Filter before including results; keep advancing after empty eligible pages. Never cap an historical scan and claim completion. Start default page size at eight; clamp requested size to 1–50 and scan at most that many candidate events per call.
- [ ] Reuse/extract public host and performer eligibility helpers rather than calling the heavyweight full-event projection per bar. Only confirmed slots are eligible. Return the first bounded 80-row roster candidate page and a continuation when more exist; the client must drain all roster phases before treating that event's lineup/favorite matches as complete. Never silently inherit `_eventPublic.ts`'s existing 80-row truncation for legacy records. Missing-end slots appear when their start is inside the range; timed slots use interval overlap. Add a favorite-matching test where the only eligible linked performer has an untimed lineup entry on a later roster page.
- [ ] Resolve saved items independently of range and slot-page caches. Recheck event publicity, host eligibility, slot membership and performer publicity. Permit current public cancellation status only in saved results. Do not disclose the reason a reference is unavailable. Keep at most 50 records per resolver call and avoid loading every unrelated lineup row.
- [ ] Rerun focused tests and `pnpm typecheck:backend`; generate and check Convex API declarations with `pnpm check:backend:generated` after local schema deployment as required by the cloud guide. Confirm no unrelated generated drift.
- [ ] Commit `feat: add bounded public timeline and saved-reference queries`.

## Task 2: Time geometry, stable packing and navigation state

**Files:** Create `apps/web/src/lib/timeline/geometry.ts`, `packing.ts`,
`navigation.ts`; tests `tests/web/timeline-geometry.test.ts`,
`timeline-packing.test.ts`, `timeline-navigation.test.ts`.

**Interfaces:** Consume Task 1's types using type-only imports. Export
`timeToX({ instant, origin, pixelsPerHour }): number`,
`localDayBands({ startAt, endAt, timeZone }): Array<{ startAt; endAt; label }>`;
`packEvents({ events, previous? }): Array<{ eventId; lane }>`;
`packPlan({ items }): Array<{ key; lane; overlapping }>` where items contain
stable key and resolved timed schedule. `readTimelineNavigation(searchParams)`
returns `{ anchor: number | null; timeZone: string | null; view: "timeline" | "agenda"; favoritesOnly: boolean }`;
`timelineNavigationHref({ pathname, searchParams, state }): string` preserves
unrelated parameters and uses `at`, `tz`, `scheduleView`, `favorites` keys.

- [ ] Write tests asserting exactly 3,600,000ms permits public lane reuse, one millisecond less does not, equal starts use stable IDs, append preserves prior lanes, and My night allows adjacent sets and marks every genuine overlap. Test invalid/reversed authored intervals never becoming solid bars.

  Use exact numeric assertions such as
  `assert.equal(timeToX({ instant: 3_600_000, origin: 0, pixelsPerHour: 100 }), 100)`.
  The lane fixture `A=[0,3600000]`, `B=[7199999,10800000]`,
  `C=[7200000,10800000]` must assign A to lane 0, B to lane 1 and C to lane 0.
- [ ] Add geometry/navigation tests for midnight crossings, Indianapolis local time, New York's November 1, 2026 repeated hour, its March 8 shortened day, a 100px hour, invalid query parameters and preservation of unrelated query keys. The repeated hour must map to two distinct positions.
- [ ] Run `node --import tsx --test tests/web/timeline-geometry.test.ts tests/web/timeline-packing.test.ts tests/web/timeline-navigation.test.ts`; confirm expected RED.
- [ ] Implement pure functions. Public packing sorts start/ID and takes the first available lane with the fixed hour gap. Timed plan packing uses zero gap. Represent markers and untimed items separately. Derive day boundaries in IANA time, not by adding 24 hours to a local midnight. Existing event-time helpers are the formatting source; add no date library.
- [ ] Rerun the same tests and commit `feat: model timeline geometry and stable event packing`.

## Task 3: Browser-local planning and favorite state

**Files:** Create `apps/web/src/lib/timeline/preferences.ts`, `preference-storage.ts`,
`apps/web/src/app/_components/timeline/use-timeline-preferences.ts`;
tests `tests/web/timeline-preferences.test.ts`, `timeline-storage.test.ts`.

**Interfaces:** Consume `PlanReference`. Export
`TimelinePreferences = { version: 1; plan: PlanReference[]; favoriteProfileIds: string[] }`;
`reducePreferences(state, action): { state; outcome: "changed" | "unchanged" | "limit" }`,
with explicit add/remove plan and favorite actions;
`parsePreferences(value: unknown): TimelinePreferences`;
`createPreferenceStore({ storage, eventTarget })` with `getSnapshot()`,
`getServerSnapshot()`, `subscribe(listener)`, `dispatch(action)` and `dispose()`.
The hook exposes those actions and `persistence: "saved" | "session"`.

- [ ] Write reducer tests for stable event/slot IDs, whole-event replacement, included sets, removing a whole event, idempotent adds, preserving overlapping choices, 200 plan / 500 favorite limits and removal while at limits. Test that reference payloads contain no display content.

  In `wholeEventReplacesItsSets`, add two distinct sets from event A, then A
  itself, and assert `state.plan` equals `[{ kind: "event", eventId: "A" }]`.
  In `fullPlanRejectsOnlyAdditions`, prefill exactly 200 distinct references,
  assert the next addition returns `outcome === "limit"` with identical state,
  then assert removing one returns a 199-item plan.
- [ ] Write storage tests for invalid JSON, unsupported versions, invalid shapes, duplicate IDs, SSR with no browser APIs, quota/read exceptions and two independent stores receiving a cross-tab storage event. An accepted external snapshot replaces the snapshot; do not imply conflict-free concurrent multi-tab merging.
- [ ] Run `node --import tsx --test tests/web/timeline-preferences.test.ts tests/web/timeline-storage.test.ts`; confirm RED.
- [ ] Implement the reducer and versioned `vrdex.timeline.preferences.v1` storage. Validate/destructure known fields only. Reject new additions at limits rather than evicting saved choices. On storage failure keep the in-memory change, set session persistence and expose Not saved. Do not adopt the prototype's sample-name favorites or its storage keys.
- [ ] Implement the hook with `useSyncExternalStore`, stable snapshots, one owned storage listener and cleanup. Avoid browser reads during SSR and rendering. Batch Task 1 saved resolution into groups of at most 50 when the controller requests it; the store itself performs no network calls.
- [ ] Rerun focused tests, `pnpm typecheck:web`, and commit `feat: persist private browser night plans and favorites`.

## Task 4: Continuous schedule and shared Agenda

**Files:** Create `apps/web/src/app/_components/timeline/home-schedule.tsx`,
`use-timeline-data.ts`, `timeline-toolbar.tsx`, `timeline-chart.tsx`,
`timeline-event-bar.tsx`, `timeline-agenda.tsx`, `timeline-night.tsx`;
pure cache/controller helpers in `apps/web/src/lib/timeline/window-cache.ts`;
tests `tests/web/timeline-window-cache.test.ts`,
`apps/web/e2e/home-timeline.flow.spec.ts`.

**Interfaces:** `HomeSchedule()` owns the shared preference store, navigation,
loaded data and selection. `TimelineSelection = { eventId: string; slug: string; slotId?: string }`;
child views receive records, loading state, selection and explicit callbacks.
`useTimelineData({ range, favoritesOnly, favoriteProfileIds })` returns a
discriminated loading/partial/ready/error state with retained records, per-event
slot coverage, `retry()`, `loadMore()` and saved-reference results. Use existing
Convex client/provider conventions; guard the missing-backend state rather than
throwing the entire Home page. Export selection from `home-schedule.tsx` for Task 5.

- [ ] Write controller tests for out-of-order window responses, generation invalidation, 48-hour prefetch, three-window eviction, failed-window retry, empty intermediate pages, incomplete slot pages and a favorite match found only on a later page. Empty is possible only after complete coverage.
- [ ] Add local `@flow @fixture` browser cases against real published fixtures for continuous midnight panning, Now/date navigation, forward/back history, simultaneous usable search, Agenda equivalence, pointer drag versus click, keyboard actions, touch operation and focus retention after refresh. Use fake time only for the clock, never fake the timeline's public query.
- [ ] Run focused Node tests and the new Playwright cases, confirming the missing feature causes RED. Before Home integration use the existing gated Playwright route pattern at `apps/web/src/app/playwright/home-timeline/page.tsx` with a small `preview.tsx` that mounts the real component. It must remain disabled in production like neighboring fixtures.
- [ ] Implement the controller. Start one hour before now, fetch 48-hour chunks and prefetch within six hours of an edge. Deduplicate stable identities and drain slot continuation. Load at most ten candidate pages automatically per viewport generation, then show More while retaining an explicit partial state. More continues from the last cursor. Abort/discard obsolete reads, especially on filter/date changes; do not collapse partial into empty. Resolve saved references separately in batches and pan Next saved directly to a resolved instant.
- [ ] Implement chart/Agenda and toolbar using shared tokens and existing icon primitives. Render unknown-time and authored-date groups explicitly. Chart bars use exact geometry, contain logos and distinct selection/save/favorite states. Hover/focus plus buttons stop parent activation; touch actions remain in Agenda/details. My night has no lane when globally empty, compact Next saved navigation when outside the viewport, tight packing and non-color conflict indicators.
- [ ] Implement navigation with coarse 300ms debounced URL replacement for panning and history pushes for explicit date/view/filter changes. Cancel pending replacement before popstate. Preserve viewed instant on prepends/material edits, preserve assignments on ordinary clock/favorite updates, refresh on focus and at 60-second cache expiry. Do not label the Now line as streaming status.
- [ ] Reuse the browser's timezone/hour format, render a reserved loading frame until resolved, and use named globe/clock metadata. Keep bars and all controls keyboard reachable; Agenda supplies actions for sub-touch-width sets. Honor reduced motion and stop all owned listeners/timers on unmount.
- [ ] Rerun scoped tests and both viewport projects. Record actual counts and any failures. Commit `feat: add continuous public schedule and night lanes`.

## Task 5: Nonmodal poster and event detail panel

**Files:** Create `apps/web/src/app/_components/timeline/event-detail-panel.tsx`,
`event-detail-content.tsx`, `use-event-detail.ts`; test lifecycle logic in
`tests/web/timeline-detail.test.ts` and extend `home-timeline.flow.spec.ts`.
Extract shared rendering from `event-public-page.tsx` only where actually
reusable, preserving that page's behavior and playback owner.

**Interfaces:** `EventDetailPanel({ selection: TimelineSelection | null, onClose, preferences, onPreferenceAction })`;
`useEventDetail({ slug: string | null })` returns loading/available/unavailable/error
variants derived from `api.events.getPublicBySlug`, never a parallel event type.
Selection of a set scrolls its stable-key lineup row into view without adding it.

- [ ] Write lifecycle tests for A-selected/B-selected/A-finishes, revoke after successful detail, transient failure versus unavailable, same event with another selected slot, and closing during a pending read.
- [ ] Write desktop/mobile browser cases proving the intact poster, internal panel scrolling, continued chart panning, replacement on another selection, accessible Close/Escape/focus return, mobile expand/collapse, canonical Open event navigation and no autoplay. Assert add/remove/favorite actions remain independent of detail selection and that hidden performer metadata is absent.
- [ ] Run focused tests to RED, then implement a named nonmodal region. Do not reuse a modal primitive's backdrop or focus trap. Desktop floats lower right; mobile initially uses at most half the dynamic viewport and can expand. Keep chart dimensions/scroll unchanged. Use existing approved event times, safe images, public links and canonical path helpers.
- [ ] Add explicit Retry for failed reads. On revoked/missing event remove cached detail metadata and clear selection. When an invoking control vanished, return focus to the Schedule heading rather than an unrelated event. Do not reset the timeline because its panel closed.
- [ ] Source favorite profile IDs from Task 1's eligible host/performer roster projections, not slugs or display names from full event detail. Resolve the selected event's roster even when opened from a saved item outside cached chart windows. Untimed linked people use that visibility-checked projection; manual names alone have no favorite action. Do not expose private IDs to fill this gap or change public detail permissions.
- [ ] Rerun focused Node and browser cases plus existing affected public-event tests. Commit `feat: browse event posters and details without leaving the timeline`.

## Task 6: Home integration, real fixtures and visual verification

**Files:** Modify `apps/web/src/app/_components/home-search-page.tsx` to mount
`HomeSchedule` after search. Create `apps/web/e2e/home-timeline-fixture.ts`,
`apps/web/e2e/home-timeline.visual.spec.ts`; extend
`home-timeline.flow.spec.ts`. Reuse gated local e2e event authoring/cleanup
helpers, extending their existing boundary only if necessary.
Update `docs/planning/homepage-discovery-direction.md`, the prior whole-home
spec's supersession note, `docs/testing/playwright-visual-preview.md` and this
plan's execution status with actual evidence.

**Interfaces:** No new public routes except existing production Home. Local
fixture helper owns unique event/profile IDs and deletes only those records.
Do not make tests depend on `seed:local`, old staging deployments or manual data.

- [ ] Add Home browser assertions first: unchanged compact search and five-option keyboard limit, legacy `/?q=` redirect, usable GET search without JS, no timeline signup requirement and unchanged `/discovery`. Add real-fixture coverage for cancellation/privacy after saving, deleted/recreated slots, 81+ historical slots, stored references outside cached dates and two-tab favorites.
- [ ] Add blocked-storage browser coverage proving usable save actions plus Not saved. Verify persistence after reload in the normal case, zero My night rows initially, saved full-event replacement, overlapping sets, favorite DJ and club filtering, and removable unavailable references without old cached metadata.
- [ ] Run focused cases to RED, integrate Home and finish fixture setup through existing authorized local paths. Mark every local fixture-dependent scenario `@fixture`; verify hosted CI selection excludes them while still selecting genuine hosted flows. Helpers must refuse nonloopback targets and clean all owned records on failure.
- [ ] Capture deterministic desktop/mobile screenshots for ordinary browsing, selected details, purple overlapping My night, empty schedule, failed read, missing logo and long names. Inspect actual images directly, compare with the accepted study, and correct geometry/overflow/focus rather than accepting unreviewed golden changes. Use existing snapshot harness and unchanged thresholds. Record fixture and clock boundaries in testing docs.
- [ ] Run `pnpm lint:web`, `pnpm typecheck:web`, `pnpm test:web`, `pnpm typecheck:backend`, `pnpm test:backend`, `pnpm check:backend:generated`, `pnpm lint:markdown` and `pnpm build:web`. Record any environment-limited command honestly; use the documented build fallback only with its limitation reported.
- [ ] Run `pnpm --filter web exec playwright test e2e/home-timeline.flow.spec.ts e2e/home-timeline.visual.spec.ts e2e/homepage-search.flow.spec.ts` with both configured viewport projects, then affected existing public-event/lookup checks. Prove zero unexpected skips; fixture setup must not touch production admission policy.
- [ ] Commit `feat: bring schedule and private night planning to Home` with docs and inspected visual evidence. Complete task reviews and a whole-branch review, resolving findings before publication. For the PR, set `ci:browsers` and `ci:visuals` before the normal run; triage every review before each follow-up push. Publish and iterate to required green checks using the established repository workflow. Merging remains the user's action unless separately requested.

## Plan self-review

All spec sections map to tasks: public interval/privacy/saved resolution to 1;
time, spacing and history contracts to 2; device-local state to 3; browsing,
Agenda, favorites and My night to 4; poster/details to 5; actual Home, no-JS,
copy, real fixtures and screenshots to 6. The five review-focus cases each have
explicit owning tests. Shared types originate in Task 1; later tasks derive
from them. Slot continuation is explicit because existing public previews cap
associations and cannot establish completeness. No account-sync or discovery
redesign project is folded into this slice.

Implementation status and remaining review/publication gates are recorded above.
