# Event editor wizard refinement implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (the previously requested method) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the agreed three-step editor, optional import modal and compact
Details controls in one focused PR.

**Architecture:** Refine the existing shared editor and keep contributor intake,
scoped corrections and staff commands separate. Reuse `EventIntakeSource` and
its current action, with a mounted native dialog around it. Keep the existing
wire fields and timezone resolver behind the combined date/time controls.

**Tech Stack:** Existing Next.js, React 19, TypeScript, Convex, UI primitives,
lucide-react, native date/time controls and Playwright. No added dependency.

**Spec:** [Agreed layout and scope](../../planning/event-editor-wizard-refinement-2026-10-11.md).

## Global constraints

- One implementation PR, with internal commits. No separate planning PR.
- Details, Lineup, Review are the only wizard stages. Import is an optional
  top-right page action, outside the stage progression.
- Reuse one poster plus optional text in one existing extraction run. No new
  agent, model, upload contract, artwork toggle or multiple images.
- Preserve current authority, revision handling, partial intake drafts,
  duplicate checks, explicit timezone authoring and viewer-local previews.
- Native picker styling varies by browser. Reuse the real timezone picker,
  real community search, avatars, errors and UI tokens, not prototype stubs.
- End remains optional. Do not invent a one-hour end; preserve stored values
  and legitimate legacy lineup-derived ends.
- Keep all existing staff/source fields reachable. Do not redesign live event
  playback, world discovery, the profile editor or legacy staff permissions.
- Preserve source replay exclusions. New substantive product copy requires
  BASIC's exact review under `AGENTS.md`; utility labels are listed in the spec.

## Source audit and execution boundary

Current GitHub `main` was checked through the connector at
`2b17577145add28e4d969317060eec7b3dccfe31`, which includes merged PR #356.
The shared checkout is on `codex/issue-297-profile-media-mcp` with unrelated
changes. Its Git refresh and direct network access were blocked, so local
`origin/main` was not used as the implementation baseline.

At execution, create or reuse a suitable isolated managed worktree from current
`main`, branch `codex/event-editor-wizard-refinement`. Recheck head and the file
map, then copy only this plan, spec and its two archived assets from the shared
checkout. Do not switch, clean or commit the shared checkout. Planning has not
changed application code or opened a PR.

The source audit found three relevant differences from the mock:

- `CommunityInput` uses a datalist and writes typed queries into `communitySlug`.
- `EventIntakeFieldsForm` currently starts at Source and clears all timed fields
  on Time TBA. `EventIntakeSource` owns upload recovery state that must survive
  dialog close/reopen.
- Staff `EventEditorForm` has artwork/link inputs, not an `IntakeSourceAction`.
  Its start is already `datetime-local`, and `resolveAuthoredEventEndAt`
  currently invents a 60-minute end when no stored or lineup end exists.

Locked approved scope: import remains on contributor draft authoring. Staff
edits of published events and scoped contributor corrections do not gain an
import action in this PR. Adding either path needs a separate proposal/apply
design under its existing authority.

## Review focus

- Close/reopen during upload or extraction must preserve source, retry state,
  revision and accepted fields. Task 1 covers this.
- Typing an unmatched community query must not alter a stored selection or
  hide it after a failed lookup. Task 2 covers this.
- A DST gap or repeated hour, including an overnight end, must reveal the
  relevant visible control from Review without inventing an instant. Task 3
  covers this.
- Switching Time TBA must retain reversible local edits without sending timed
  fields in date-only commands or reviving deleted lineup rows. Task 3 covers this.
- Saving a staff edit must preserve associations, private output controls and
  known end values; a new event without sets must not gain a fake end. Task 4
  covers this.

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/app/events/event-editor-steps.tsx` | Three-stage connected navigation and optional heading/action slots. |
| `apps/web/src/app/events/event-intake-dialog.tsx` (new) | Small event-scoped native dialog with focus/cancel lifecycle. |
| `apps/web/src/app/events/event-intake-form.tsx` | Draft header action, modal state, directory selection and combined authoring controls. |
| `apps/web/src/app/events/event-intake-source.tsx` | Existing source processing, modal title/status presentation, preserved recovery state. |
| `apps/web/src/app/events/new/page.tsx` | Move the existing heading into the client editor heading slot. |
| `apps/web/src/app/events/event-editor-page.tsx`, `event-editor-form.tsx` | Staff heading, three steps, reachable legacy source fields and optional end serialization. |
| `apps/web/src/lib/calendar/event-intake-date-time.ts` (new) | Small pure mapping between native wall-date/time strings and existing intake fields. |
| `apps/web/src/app/events/event-editor-preview.tsx` | Reuse the relocated calendar-date helper and preserve viewer-local preview output. |
| `apps/web/src/lib/calendar/event-end-time.ts` | Stored, explicit or derived end handling without an artificial default. |
| Existing Playwright fixtures/specs and two focused web test files | Real flow, DST, source recovery, end handling and screenshots. |
| `docs/planning/event-routing-and-authoring.md`, `docs/engineering/event-contribution-browser.md`, `docs/testing/event-intake-checkpoint.md` | Current authoring flow and evidence. |

### Task 1: Three stages and optional import dialog

**Files:** Modify these under `apps/web/src/app/events/`:
`event-editor-steps.tsx`, `event-intake-form.tsx`, `event-intake-source.tsx`,
`new/page.tsx`, `event-editor-page.tsx`, `event-editor-form.tsx`;
create `event-intake-dialog.tsx` in that directory. Update
`apps/web/src/app/playwright/event-intake/revision-preview.tsx` and
`apps/web/src/app/playwright/event-intake/preview.tsx`; test
`apps/web/e2e/event-intake-source.flow.spec.ts` and
`apps/web/e2e/event-contribution.flow.spec.ts`.

**Interfaces:** `EventEditorStep` becomes `"Details" | "Lineup" | "Review"`.
`EventEditorSteps` retains its existing props and adds optional
`heading?: ReactNode` and `actions?: ReactNode`, rendered above navigation.
`EventIntakeFieldsForm` and `EventEditorForm` accept a heading slot passed by
their page/fixture. `EventIntakeDialog({ open, onClose, children })` owns only
native dialog presentation; the form continues to own fields and source state.
`IntakeSourceAction` and its payloads remain unchanged.

- [x] Refresh every caller with `rg -n 'EventEditorStep|EventEditorSteps|IntakeTime|resolveAuthoredEventEndAt' apps packages tests`. Update existing source tests to start at Details and open the import action. Add assertions for exactly three stages, direct access, Enter submission, partial Save draft and restricted corrections.
- [x] Add a flow that opens import from Lineup, edits text, closes with Escape and reopens with text intact and focus returned to the import button. Add close/reopen while an upload completes, failed completion/retry, stale response and extraction failure assertions. Existing poster/source revision assertions must still pass.
- [x] Run `pnpm --filter web exec playwright test e2e/event-intake-source.flow.spec.ts e2e/event-contribution.flow.spec.ts`; expect the new journey assertions to fail before implementation.
- [x] Render the heading/action row above the stepper. Use lucide icons, subtle connecting lines, current-position styling and at least 44px touch targets. Update Back/Continue ordering and current-position count; do not mark visited stages as validated.
- [x] Preserve Add event headings in signed-out/loading states when moving the page heading into the editor. Update fixture-owned headings to avoid duplicates.
- [x] Mount one dialog and one `EventIntakeSource` throughout the editing session. Use native `showModal`/close/cancel, labelled heading and a close button. Do not nest forms or key source state by open status. Close does not cancel processing or discard a poster. While processing, retain the existing busy guard; source errors must be visible inside the open dialog. Successful extraction closes, selects Details and focuses suggestions or the first editable Details control.
- [x] Remove Source from the staff stage list and move its existing fields into a Details disclosure. Keep its form inputs mounted so FormData and invalid-field revelation still work. Keep import absent when no source action exists, including corrections and staff published-event edits under the recommended scope.
- [x] Rerun the focused flows, then commit this coherent navigation slice.

### Task 2: Community selection and concise Details fields

**Files:** Modify `apps/web/src/app/events/event-intake-form.tsx`,
`event-intake-source.tsx`, `event-editor-form.tsx`, and the existing
`app/playwright/event-intake/revision-preview.tsx` fixture. Test
`apps/web/e2e/event-contribution.flow.spec.ts`.

**Interfaces:** Keep `CommunityInput({ value, disabled, onChange })` and
`onChange(slug: string)` internal to the intake form. The search query is UI
state, distinct from the selected slug. Reuse `api.search.searchUniversal`
with `entityType: "profile"`, `profileType: "community"`, `limit: 8`.
Keep the persisted `communitySlug` and `venueLabel` names.

- [ ] Add a fixture search result set and flow assertions: name/slug search selects a community; typing an unmatched query leaves the current slug untouched; Change then Escape retains selection; Clear saves an incomplete draft; correction has no community control. Initial `?community=` and resumed slugs survive loading or missing search results.
- [ ] Run `pnpm --filter web exec playwright test e2e/event-contribution.flow.spec.ts`; expect the new picker assertions to fail.
- [ ] Replace the datalist behavior with an accessible search/listbox and selected entity row. Support Arrow keys, Enter, Escape and explicit Clear. Display returned names and available avatars using current components; retain a slug fallback for existing values while loading. Never construct a new community from a search query.
- [ ] Rename Venue to Where (optional), including suggestion/review labels, while keeping `venueLabel` storage. Preserve `worldSlug`, source URL, description and doors controls in existing disclosures. Update affected fixture selectors and correction assertions rather than removing their coverage.
- [ ] Rerun the focused flow, then commit the Details selection slice.

### Task 3: Combined date/time controls and reversible Time TBA

**Files:** Modify `apps/web/src/app/events/event-intake-form.tsx` and
`apps/web/src/app/events/event-editor-preview.tsx`; create
`apps/web/src/lib/calendar/event-intake-date-time.ts` and
`tests/web/event-intake-date-time.test.ts`. Update
`apps/web/e2e/event-contribution.flow.spec.ts` and
`apps/web/e2e/event-intake-source.flow.spec.ts`.

**Interfaces:** Move the pure `eventLocalDate` into the new calendar helper and
update preview/form imports. Keep this module independent of React/app files.

```ts
eventLocalDate(date?: string | null, value?: EventIntakeLocalTime | null): string
formatIntakeDateTimeInput({ eventDate, local }: { eventDate?: string | null; local?: EventIntakeLocalTime | null }): string
parseIntakeDateTimeInput({ value, eventDate, eventStart }: { value: string; eventDate?: string | null; eventStart: boolean }): { eventDate: string | null; local: EventIntakeLocalTime | null }
```

The formatter returns a complete wall-date/time or an empty string. The parser
maps complete native values to the existing base date, clock and `dayOffset`
fields. Reject
invalid complete values using existing calendar/schema validation. Empty input
clears local time while retaining the base date. Date-only editing uses the
separate native date input under Time TBA, not a fabricated midnight value.

`IntakeTime` keeps its existing label/value/date/timezone/eventStart props and
changes only its callback to `onChange(change: { eventDate: string | null;
local: EventIntakeLocalTime | null }): void`. Update all five call sites for
start/end/doors and lineup start/end. The start caller updates base date and
start atomically; secondary callers update only their local value. When the
base date changes, retain explicit calendar dates of entered secondary times
and recompute offsets. Enforce -1 through 7 bounds without silently changing
entered dates. Retain invalid raw edits visibly and block submission with
focused validation until corrected, rather than reverting or saving stale data.

- [ ] Write `event-intake-date-time.test.ts` assertions for an empty value; start `2026-10-10T23:00`; end `2026-10-11T02:00` mapping to `dayOffset: 1`; date-only handling; invalid calendar dates and -1/7 bounds. Reuse existing schema/date validation. Date arithmetic may use UTC for calendar days only, never to interpret an event wall time.
- [ ] Run `node --import tsx --test tests/web/event-intake-date-time.test.ts tests/web/calendar-timezone.test.ts`; expect new mapping tests to fail.
- [ ] Render native combined inputs using the shared Input primitive. Show Starts and optional Ends together on desktop, stacked if they cannot fit on mobile. Expand an existing end on resume; new drafts show Add end time. Keep the real timezone picker and repeated-hour selectors. Updating a wall time/date or timezone clears stale occurrence choices.
- [ ] Keep date-only Starts editable under Time TBA. Retain reversible timed values in editor-only state, while serializing the existing null/untimed shape for date-only saves and publication. Restore times only for surviving lineup client keys, never deleted rows or hidden timed values from a loaded date-only draft. Remembered values are not a new persisted contract.
- [ ] Preserve an existing draft date if the combined control is incomplete. Add assertions for extraction returning a date without a time and for moving Starts outside a secondary time's allowed date range; no date loss, normalized midnight or stale successful save.
- [ ] Update missing-date/time selectors to focus the combined input. From Review, open the required stage/disclosure and focus the invalid input or occurrence selector. Do not leave focus behind a closed end disclosure or inside an inert import dialog.
- [ ] Update existing flows to assert partial draft saves, date-only save/reload, reversible toggles, overnight end ordering, America/New_York gap on `2027-03-14 02:30`, and repeated hour on `2026-11-01`. Keep both repeated-hour ordering cases already covered. Add browser timezone different from selected event timezone and unchanged later-occurrence edit assertions.
- [ ] Rerun the unit command and both fixture flows. Confirm payloads still use `eventDate`, local times, occurrences and offsets, not new timestamps/contracts. Commit this time-control slice.

### Task 4: Staff end behavior, visual proof and one PR

**Files:** Modify `apps/web/src/app/events/event-editor-form.tsx`,
`apps/web/src/lib/calendar/event-end-time.ts`,
`tests/web/event-end-time.test.ts`, `apps/web/e2e/event-editor.snapshots.spec.ts`
and affected fixture/snapshot selectors. Update the three docs in the file map.

**Interfaces:** Extend the existing end helper with
`authoredEndAt?: number | null` and return `number | undefined`. A number is an
explicit end; null clears an authored/stored end and may retain a legitimate
known lineup-derived end; undefined preserves existing stored-end shifting
when the schedule is unchanged, then falls back only to a known lineup end.
No final 60-minute fallback. Staff create omits an unknown end; update sends
null to clear it under the existing `updateCommunityEvent` contract.

- [ ] Replace the helper's existing 60-minute-default test with an undefined-end assertion. Add explicit end, explicit clear, known lineup end and stored-end preservation tests. Run `node --import tsx --test tests/web/event-end-time.test.ts`; expect failures before the change.
- [ ] Add the optional combined Ends control to staff Details, with explicit/untouched state and DST occurrence handling. Preserve an unchanged stored instant, including a later repeated-hour occurrence. Validate entered end after start. Keep existing lineup, doors, output, cancellation and association commands. Reuse current staff field-revelation behavior and null-clearing payloads.
- [ ] Keep staff create's existing start-time requirement and current date-only edit restrictions. Contributor partial/date-only authoring remains on its existing commands.
- [ ] Rerun focused helper tests plus `tests/web/calendar-timezone.test.ts` and `tests/web/event-intake-source.test.ts`. Run the existing contributor/source fixture flows and staff lineup/validation flows; their payload, permission and hidden-field checks must remain.
- [ ] Update `event-editor.snapshots.spec.ts` from four stages to three and add import-open/error captures in fixture-backed tests. Capture create, resumed draft, correction and staff edit on desktop/mobile in light and dark themes. Include selected community, optional end, DST error and repeated-time prompt. Inspect images with VLM review; no horizontal overflow, clipping or lost controls.
- [ ] Regenerate affected screenshot baselines in the existing Linux Chromium route. Remove only obsolete Source-stage baseline files. Run `pnpm --filter web exec playwright test e2e/event-editor.snapshots.spec.ts --grep @snapshot`; expect accepted three-stage comparisons, with import evidence alongside them.
- [ ] Run `pnpm lint:web`, `pnpm typecheck:web`, `pnpm test:web`, `pnpm lint:markdown` and `pnpm build:docs` in the isolated worktree. Required hosted CI still applies; do not claim fixture tests prove real model accuracy, S3 delivery or production authentication.
- [ ] Update authoring docs and checkpoint with exact behavior, copy disposition and visual evidence. Self-review against the spec, commit and push only this changeset, open one PR and attach it to this chat. Follow the repo review/recycle rules and the 30-minute latest-head completion gate before calling it merge-ready.

## Out of scope and handoff

World picker, profile-editor cleanup, new models/agents, MCP contract changes,
published-event import under staff authority and a custom calendar library are
outside the recommended PR. The native calendar appearance and the draft-only
import boundary are the material tradeoffs for BASIC's review.

Use the previously requested subagent-driven implementation after this plan is
reviewed. No agents were dispatched for planning. No application tests were
run because this changeset currently contains planning/reference files only.
