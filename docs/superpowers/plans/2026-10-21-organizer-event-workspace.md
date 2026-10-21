# Organizer event workspace implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> for Native execution or superpowers:subagent-driven-development if BASIC
> selects that method. Implement the checklist task by task after plan review.

**Goal:** Make My events a complete, reliable place to find saved work and
continue the existing event authoring journey.

**Architecture:** Add an authenticated, bounded inventory projection over
existing managed events, own contributions and creator-private intake drafts.
Reuse indexed pagination, current authority and the existing editor routes and
save/publication commands. No inventory table or replacement editor state.

**Tech Stack:** Existing Next.js, React 19, TypeScript, Convex, shared UI tokens
and primitives, convex-test and Playwright. No new dependency.

**Spec:** [Approved organizer design](../specs/2026-10-21-organizer-event-workspace-design.md).

## Global constraints

- Initial slice is inventory, filtering, continuation and navigation. Compact
  lineup styling is a later review within the existing scheduling contract.
- Preserve Details, Lineup, Review, explicit saves, revision checks, pending-save
  edits, unsaved-change protection and canonical post-publication navigation.
- Canonical staff drafts and intake drafts are different records with different
  authority and routes. Contributor inventory never grants staff editing.
- Keep intake drafts creator-private, unexpired and without a publication
  receipt. Reads do not renew the rolling 30-day retention period.
- Use current staff/contributor authorizers for every query and continuation.
  Cursors and supplied community IDs are not authorization.
- Keep Retracted contributions in All with their eligible existing actions.
  Retraction does not turn a contribution into a resumable draft.
- Use viewer-local date presentation. Do not invent event ends, resolve an
  ambiguous source clock silently or convert date-only values into instants.
- Reuse approved utility labels and existing error patterns. Any new substantive
  public prose needs BASIC's exact review under `AGENTS.md` before shipping.
- Discord post copying retains current staff-editor eligibility. No external
  publishing integration, VRC.tl target, homepage rewrite or production logo
  change belongs to this slice.

## Execution boundary

Planning was audited against product source at `0d7246b`. The current branch
contains subsequent design documents and assets only. Before execution,
inspect the current branch, status and instructions and use an isolated
managed worktree if concurrent changes would overlap. Do not reset shared work.

Before starting local services, follow `.agents/skills/vrdex-cloud-start/SKILL.md`
and `docs/engineering/cloud-task-start.md`. The published activation path
`/workspace/vrdex-env.sh` was absent during planning; recover the documented
local setup before browser verification. Do not substitute a hosted deployment
for an unavailable local fixture environment.

## Review focus

| Input class | Required behavior | Verification |
| --- | --- | --- |
| Normal | Find both draft kinds, continue, save, reopen, publish and revise | Tasks 1 and 3, real backend commands plus browser journeys |
| Boundary | More than 100 events, tied timestamps, date-only/unknown ends, overnight/DST | Task 1 traversal/date cases; Task 3 local-time regression |
| Invalid or adversarial | Foreign IDs/cursors, revoked authority, other creators' evidence | Task 1 authenticated isolation and scope cases |
| Empty | Undated draft, no matches, an empty intermediate scan page | Tasks 1 and 2; only exhausted successful sources mean no results |
| Failure or concurrent change | Failed source, expired draft, save conflict, auth/filter change | Tasks 1–3; explicit error/retry and existing revision guards |

## File map

| File | Responsibility |
| --- | --- |
| `convex/eventInventory.ts` (new) | Authenticated paginated inventory query |
| `convex/_eventInventory.ts` (new) | Tagged projections, authorized continuation, matching and date classification |
| `convex/events.ts` | Reuse current management authorizers; detect owner-source truncation |
| `convex/_reviewCursor.ts` | Reuse scoped cursor/pagination helpers; change only if required by the final cursor envelope |
| `tests/backend/event-inventory.test.ts` (new) | Real source paging, authority, retention and projection cases |
| `apps/web/src/app/account/events/managed-events-panel.tsx` | Connected inventory, filters and existing organizer actions |
| `apps/web/src/app/account/events/event-inventory-list.tsx` (new) | Shared inventory presentation, row actions, loading/empty/error states |
| `apps/web/src/components/ui/nav-utilities.tsx` | Authenticated My events entry without changing nav search |
| `apps/web/src/app/events/event-editor-page.tsx`, `new/page.tsx` | My events return navigation using existing authoring/dirty guards |
| `apps/web/src/app/playwright/event-inventory/page.tsx`, `preview.tsx` (new) | Gated deterministic fixture using the production inventory presentation |
| `apps/web/e2e/event-inventory.flow.spec.ts` (new) | Filter, pagination, navigation, responsive and visual evidence |
| `tests/backend/helpers/event-inventory-browser-bridge.ts` (new) | Browser-to-real-Convex command/projection checkpoint |
| Existing authoring flows and routing/checkpoint docs | Preserve established save, correction, export and navigation behavior |

### Task 1: Authorized, complete inventory projection

**Files:** The backend files and new backend test in the file map; regenerate
`convex/_generated/api.d.ts` through the supported local Convex toolchain.

**Interfaces:** Expose one `eventInventory.listPage({ view, query, timeZone,
asOf, paginationOpts })` query returning `PaginationResult<InventoryRow>`.
Traverse one indexed source per execution in this deterministic sequence:
creator-private intake drafts, managed communities sorted by ID, own
contributions. Discover only communities the actor can currently manage,
including nonpublic communities where already permitted. This is source/index
ordering, not a globally chronological union.

Rows are tagged `managed_event`, `own_contribution` or `intake_draft`. Include
only the safe title/community/schedule/state/thumbnail data the list needs,
stable record identity and an authorized continuation discriminant:
`staff_editor`, `intake_editor`, `public_event` with existing correction
eligibility, or `unavailable`. Intake rows include real expiry and version.
Do not return raw source text, provenance, evidence or private poster payloads.

Page criteria are view (`all`, `upcoming`, `drafts`, `past`), normalized query,
viewer timezone and fixed classification `asOf`, plus native pagination options.
Derive actor identity from the active browser session. Bind a versioned cursor
to actor, source-membership fingerprint and normalized criteria. Its position
is either within a source with a native cursor or after a source with its
terminal native cursor. As a start, after advances sources; as an end, after
retains the completed source's terminal cursor. Wrap split cursors within the
same source, reject invalid cross-source ranges and mark global `isDone` only
after the final source. Authority/source changes invalidate old cursors with
an `InvalidCursor` error recognized by the installed native hook. Always use
server time for intake expiry rather than trusting the classification anchor.
Validate timezone/anchor/query bounds using existing validators at the boundary.

- [ ] Register the new module in the existing convex-test setup. Seed owner,
  staff, ordinary contributor and unrelated-user identities using existing
  ownership/correction/intake helpers. Add failing traversal and isolation
  assertions before writing queries.
- [ ] Run `node --conditions=import --import tsx --test tests/backend/event-inventory.test.ts`.
  Confirm failures identify the missing inventory behavior, not fixture setup.
- [ ] Discover managed communities through existing live authorizers. Change
  the owner's silent `.take(100)` to detect overflow and report an incomplete
  authority inventory explicitly; preserve existing staff/role bounds. Never
  return a truncated discovery result as complete.
- [ ] Page existing indexed sources with bounded reads and one native
  `.paginate()` per query execution. Use the current sortAt rollout policy for
  managed events, contributor index for own events and actor index for intake.
  Filter candidate pages before emitting authorized rows. Retain native
  continuation and split/end cursor semantics even when zero rows match.
  Test reactive replay/splitting across source boundaries, including exhausted
  sources, so an end cursor never becomes the next source's null start.
- [ ] Prefer the managed representation of an event the actor also contributed
  using live management eligibility. Exclude receipt-backed intake drafts.
  Preserve staff takeover, cancellation, retraction and existing correction
  eligibility without widening editable fields or export access.
- [ ] Match title/community names case-insensitively, including empty query and
  current community renames. Keep undated drafts in All/Drafts; cancelled and
  retracted records remain in All. For dated noncancelled work, compare timed
  runtime using current `_eventRuntime` policy and date-only calendar values
  against the viewer-local date. Incomplete/unresolved clocks stay explicit;
  do not fabricate a successful timed projection to enter Upcoming/Past.
- [ ] Cover full traversal beyond 100 managed events, a match after the first
  page, empty intermediate output, equal timestamps and no duplicate IDs.
  Cover cursor reuse across actor/source/filter, revoked owner/staff access,
  foreign community IDs, invalid timezone/anchor inputs, managed/contributed
  duplicates, cancelled/retracted
  records, private/missing artwork and unavailable public routes.
- [ ] Cover two creators' private drafts, expired and published-receipt drafts,
  rolling expiry unchanged by reads, incomplete/date-only drafts, unknown ends,
  overnight and both DST transitions. Assert bounded scans and a clear failure
  when authority discovery cannot be complete.
- [ ] Rerun the inventory test plus `tests/backend/event-api-ownership.test.ts`,
  `tests/backend/event-corrections.test.ts` and `tests/backend/event-intake.test.ts`
  with the same runner. Run `pnpm typecheck:backend`. Commit this backend slice.

### Task 2: My events inventory and continuation navigation

**Files:** UI/fixture files in the file map, plus existing UI primitives only
when necessary. Keep all event form commands and serializers unchanged.

**Interfaces:** Derive row/criteria types from the generated Convex API with
`FunctionReturnType`/`FunctionArgs`; do not maintain a second hand-written wire
schema. The connected panel owns authentication, criteria and pagination. The
list receives rows, current view/query, loading/error/completeness state and
callbacks; fixtures use this same presentation rather than a screenshot clone.

Use native `usePaginatedQuery` for the single backend source traversal. Reset
its arguments/session subtree when viewer, view, normalized query or timezone
changes. Keep `asOf` fixed through one traversal; refresh it on Retry and
focus/local-day changes. Request 20 candidate rows per page. After empty output,
automatically advance at most three pages per criteria generation, then offer
Load more while candidates remain. Never scan indefinitely in an Effect.

Put the connected pager behind an error boundary with Retry resetting the
traversal. A source failure fails the inventory pipeline visibly; do not skip
it or manufacture completeness. Clear previous rows on failed authorization or
session changes. Do not promise independent-source retries or keep a shadow
copy of query results that could retain stale permissions.

- [ ] Add failing fixture journeys for All/Upcoming/Drafts/Past, title/community
  search, keyboard selection, both Continue routes, expired/unavailable actions,
  duplicate identities and retracted contributions. Include an empty matching
  page with continuation, query changed while loading and one failed source.
- [ ] Run `pnpm --filter web exec playwright test e2e/event-inventory.flow.spec.ts --project=desktop-chromium --project=mobile-chromium`.
  Confirm the new behavior assertions fail before implementation.
- [ ] Render My events with Add event, existing Event reports access and existing
  community-specific authoring entry. Use shared controls and plain state
  labels. Show community, local schedule, eligible artwork/fallback and actual
  intake expiry; never label intake source artwork public merely for this list.
- [ ] Implement the four filters and labelled Find an event input. Keep rows
  readable as a mobile list, with keyboard-accessible actions and visible focus.
  Use the stated source/index ordering, not a first-page-only chronological
  sort presented as a globally sorted result set.
- [ ] Keep a visible continuation control while more candidates remain. Loading
  or failure cannot display definitive No events. A failed traversal shows an
  explicit error and working Retry instead of an empty inventory. Reuse existing
  approved wording; submit any necessary new sentence for copy review.
- [ ] Route canonical staff work to its current editor and intake drafts to
  `/events/new?draft=...`. Contributions keep their public/correction path and
  current eligibility. Do not offer Continue or Discord export based solely on
  contribution ownership. Do not claim unsaved-buffer/last-step restoration.
- [ ] Add authenticated My events navigation beside the account control and
  authoring return links. Preserve signed-out/loading account states, nav
  search keyboard/focus behavior, narrow-screen layout, unsaved-change guards
  and successful publication's canonical-page destination.
- [ ] Rerun the focused browser journey and affected nav/authoring flows. Verify
  filters and pagination also work with empty query and no management authority.
  Commit the inventory/navigation slice.

### Task 3: Working organizer checkpoint and visual review

**Files:** New browser bridge and inventory flow; existing
`apps/web/e2e/event-editor-lineup-save.flow.spec.ts`,
`event-editor-unsaved.flow.spec.ts`, `event-review-actions.flow.spec.ts`,
`tests/web/event-editor-persistence.test.ts`; update
`docs/planning/event-routing-and-authoring.md`,
`docs/engineering/event-contribution-browser.md` and
`docs/testing/event-intake-checkpoint.md`.

- [ ] Extend the existing bridge pattern in
  `tests/backend/helpers/event-lineup-browser-bridge.ts`: seed actual managed
  and intake drafts, read the inventory, feed browser-authored commands through
  real Convex mutations, reopen and verify the resulting saved projections.
  Add a failing checkpoint before changing fixture wiring. Do not replace
  authority checks with fixture booleans.
- [ ] Exercise both draft continuations, performer/set-time edit, explicit save,
  reopen, Review publication and the canonical event destination. Then edit a
  published lineup with Save changes and confirm it remains published and its
  current authorized Discord text reflects the saved lineup. Confirm cancelled,
  unpublished and unauthorized contribution cases cannot gain export access.
- [ ] Retain meaningful existing coverage for save conflicts, edits made during
  pending saves, staff takeover/correction, unsaved navigation and local-time
  round trips. Add tests only for new inventory/navigation regressions; avoid
  duplicating unchanged scheduling implementation tests.
- [ ] Capture the real inventory and continuation views at desktop/mobile sizes
  in light/dark themes, including populated, empty, failure and loading
  states. Inspect screenshots with VLM review for hierarchy, wrapping, contrast,
  missing artwork, focus and horizontal overflow. Fix issues before acceptance.
- [ ] Run targeted backend tests from Task 1 and the inventory/affected authoring
  browser flows. Run `pnpm lint:web`, `pnpm typecheck:web`, `pnpm test:web`,
  `pnpm typecheck:backend`, `pnpm check:backend:generated`,
  `pnpm lint:markdown` and `pnpm build:docs`. Broaden checks for actual failures
  or changed contracts, rather than repeating passed checks without new cause.
- [ ] Update the docs with shipped inventory sources, routes, expiry, ordering,
  continuation and error behavior. Link actual screenshots and distinguish
  deterministic UI fixtures, real backend command proof and any live browser
  authentication evidence. Do not claim fixtures prove external delivery.
- [ ] Self-review against the approved spec and this checklist. Commit the final
  checkpoint; open one focused PR under normal repository delivery rules with
  `ci:browsers` and `ci:visuals`, useful validation evidence and any exact-copy
  approval. Report the PR URL and real remaining limitations.

## Handoff

This document is a plan, not implementation or verification evidence. The
separate outlined wordmark study is ready for visual review; selecting a logo
color is independent of this inventory slice. Review this plan and choose
Native execution (recommended for these coupled tasks) or Subagent-driven
execution before changing application code.
