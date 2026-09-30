# Event Editor Redesign Implementation Plan

The multi-image scope below is superseded by the approved
[single-poster simplification](2026-09-30-event-intake-single-poster.md) on
2026-09-30. Other editor decisions remain in force. The original task details
are retained as implementation history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make event authoring a focused Source, Details, Lineup, Review flow, with text and multiple images in one discovery run, automatic poster artwork, and consistent editing for contributors and community staff.

**Architecture:** Extend the existing versioned contributor intake and private poster pipeline rather than adding another event store or agent. Share the editor navigation and field presentation across authoring paths, while contributor publication, contributor correction, and staff create/edit keep their existing backend commands and authority checks. Keep live output controls in the staff path.

**Tech Stack:** Next.js, React, TypeScript, Zod, Convex, existing AWS image storage, Responses API, MCP, Playwright.

**Spec:** [Visual reference](../../planning/event-editor-visual-reference-2026-09-29.md) and [approved changeset map](../../planning/event-editor-changeset-map-2026-09-29.md).

## Global Constraints

- One implementation changeset with testable internal commits. Do not create another planning PR.
- Source, Details, Lineup, and Review appear across the top, inside VRDex's existing header and footer layout. Correction may omit Source because its existing authority does not include new source uploads.
- The first image in the contributor's chosen order becomes artwork. A later explicit primary choice wins. Private source evidence and the processed public artwork remain separate.
- A contributor may enter details manually or submit text, up to five images, or both together in each discovery run. Discovery may be rerun after source changes; it proposes tentative values and never publishes.
- The Lineup step shows available performer profile pictures beside matched people and a clear fallback for unmatched names. Reuse the existing public avatar component and search result data.
- Preserve partial drafts, current publish preflight, idempotency, scoped self-edits, and separate staff authority. Do not redesign live playback or canonical event data.
- Public event schedule times remain viewer-local. Authoring controls may show the event timezone; no numeric Day offset control appears.
- Use existing UI primitives. New substantive public copy needs BASIC's approval of the exact wording before shipping, per `AGENTS.md`.

## Review Focus

- A source ID from another actor or draft must be rejected before extraction or artwork processing. Task 1 and Task 2 test this.
- Upload, retry, removal, and rapid image selection must never publish the wrong primary artwork or leave a stale draft version. Task 2 tests this.
- Changing text or the image list must invalidate suggestions and evidence, but keep accepted manual fields. Task 3 and Task 4 test this.
- A lineup set after midnight or during a DST gap or repeated hour must show an actual local date or a correction prompt, never an invented instant. Task 3 and Task 4 test this.
- Hidden staff-editor steps must preserve FormData and reveal an invalid field before publication. Task 5 tests this.

## File map and interfaces

| File | Responsibility |
| --- | --- |
| `packages/api-contracts/src/event-intake.ts` | Add `EVENT_INTAKE_MAX_POSTERS = 5`, ordered `posterSourceIds`, extract `posterAssetIds`, bounded source-specific evidence, and candidate dates. Retain singular fields as compatible inputs. |
| `convex/_eventIntake.ts`, `convex/eventIntakeSources.ts` | Normalize and version private draft sources; authorize every source; choose, clear, and publish only validated artwork. |
| `apps/web/src/lib/server/event-poster-storage.ts`, `apps/web/src/lib/server/event-intake-api.ts` | Finish verified upload with initial artwork preparation, idempotent retry, and the updated draft version. |
| `apps/web/src/lib/server/event-intake-agent.ts`, `apps/web/src/lib/event-intake-source.ts` | One bounded multimodal discovery run, source-attributed evidence, and date-to-dayOffset conversion. |
| `apps/web/src/app/events/event-editor-steps.tsx` | Shared top step navigation and responsive editor/preview layout; no authority or persistence logic. |
| `apps/web/src/app/events/event-intake-form.tsx`, `event-intake-source.tsx`, `event-editor-preview.tsx` | Contributor draft, multi-image Source, local-date lineup, tentative review, Review/publish. |
| `apps/web/src/app/events/event-editor-form.tsx`, `event-contribution-controls.tsx` | Reuse stepped presentation while preserving staff canonical commands and contributor correction scope. |
| Existing contract, backend, web, MCP, and Playwright tests | Pin compatibility, security, artwork, source attribution, time, and full-page flows. |

### Task 1: Extend the shared intake shape and actor-bound source list

**Files:** Modify `packages/api-contracts/src/event-intake.ts`, `convex/_eventIntake.ts`, `convex/eventIntakeSources.ts`, `apps/web/src/lib/server/event-intake-session.ts`, `apps/web/src/lib/server/event-intake-api.ts`; test `packages/api-contracts/tests/event-intake.test.ts`, `tests/backend/event-intake.test.ts`, `tests/backend/event-intake-sources.test.ts`, `tests/web/event-intake-api.test.ts`, `tests/web/event-intake-session.test.ts`, `packages/vrdex-mcp/tests/event-intake.test.ts`; update `docs/developers/public-api.md` and `docs/developers/vrdex-mcp-event-writes.md`.

**Interfaces:** `EventIntakeFieldsSchema.posterSourceIds?: string[] | null` and `ExtractEventIntakeSchema.posterAssetIds?: string[]` are ordered and capped at five unique IDs. The existing singular `posterSourceId` and `posterAssetId` remain accepted for older REST/MCP clients. Reject contradictory singular and plural values in the same request. `authorizeExtraction` takes the normalized ID list and validates actor, draft, ready state, and expiry for every item before reserving the existing quota. Draft save may retain pending IDs belonging to that actor/draft so an upload can complete after the ordered list is saved. Candidate evidence gains a nullable `posterIndex` (zero-based index in `posterAssetIds`), and event/lineup candidate times gain nullable `startDate` and `endDate` ISO dates. Draft evidence is private and bounded to 40 entries.

- [ ] Write contract tests asserting five unique ordered IDs parse, six or duplicate IDs fail, singular input still parses, mixed contradictory input fails, and evidence above 40 entries fails.
- [ ] Run `pnpm --filter @vrdex/api-contracts test`; expect the new assertions to fail.
- [ ] Add the schema fields and server-side legacy normalization in the listed files. Keep MCP tool names and upload transport.
- [ ] Write backend/API tests asserting pending same-draft IDs save, foreign/expired/unready IDs fail before extraction, and a singular client still succeeds.
- [ ] Run `node --conditions=import --import tsx --test tests/backend/event-intake.test.ts tests/backend/event-intake-sources.test.ts` and `node --import tsx --test tests/web/event-intake-api.test.ts tests/web/event-intake-session.test.ts`; expect the new assertions to fail.
- [ ] Implement actor/draft source validation and transport adapters. Rerun the tests above plus `pnpm --filter @basicbit/vrdex-mcp test`; expect pass.
- [ ] Update REST/MCP docs, then run `pnpm generate:api-openapi` and `pnpm check:api-openapi`; expect generated contract consistency. Commit the contract slice.

### Task 2: Make uploaded artwork automatic and deterministic

**Files:** Modify `convex/eventIntakeSources.ts`, `convex/_eventIntake.ts`, `apps/web/src/lib/server/event-poster-storage.ts`, `apps/web/src/lib/server/event-intake-api.ts`, `packages/api-contracts/src/event-intake.ts`; test `tests/backend/event-intake-sources.test.ts`, `tests/web/event-intake-agent.test.ts`, `tests/web/event-intake-api.test.ts`; update `docs/backend/event-intake-sources.md` and `docs/backend/event-intake.md`.

**Interfaces:** `poster_upload_complete` returns `{ posterAssetId, artworkAssetId?: string, version: number }`. The browser saves chosen source order, then uploads selected files sequentially. When the first ID in `posterSourceIds` is ready and no explicit choice exists, completion prepares its existing WebP derivative through `selectPosterArtwork`/`completeArtwork`. If a later image finishes first through another client, it waits; it must not steal primary status. A legacy single-image completion without an ordered list selects that image. `artwork_select` still switches the primary source and accepts `posterAssetId: null` to clear it when all images are removed; removing the primary with other images remaining selects the next ready image in order. A repeated completion retries an unfinished derivative instead of returning early. The selected artwork source must still be in the draft's ordered list at publication when an ordered list exists. A failed derivative remains visible as an actionable upload error, never as silently publishable art.

- [ ] Write source/storage tests asserting first-image selection, later-image-finishes-first waiting, legacy single-image selection, stable upload of another image, explicit reselection, next-image choice after removal, and clearing when empty. Assert cross-draft, stale-version, concurrent completion, failed-write/retry, and private-source/public-derivative behavior.
- [ ] Run `node --conditions=import --import tsx --test tests/backend/event-intake-sources.test.ts` and `node --import tsx --test tests/web/event-intake-agent.test.ts tests/web/event-intake-api.test.ts`; expect new assertions to fail.
- [ ] Reuse current validation, immutable source copy, derivative conversion, and recovery functions. Add the minimum versioned, idempotent Convex selection/clear transition and return completion's draft version.
- [ ] Rerun the focused tests; expect pass. Update source-retention and artwork docs, then commit the artwork slice.

### Task 3: Accept text and multiple images in one discovery run

**Files:** Modify `apps/web/src/lib/server/event-intake-agent.ts`, `apps/web/src/lib/event-intake-source.ts`, `packages/api-contracts/src/event-intake.ts`; test `tests/web/event-intake-agent.test.ts`, `tests/web/event-intake-source.test.ts`; update `docs/backend/event-intake-sources.md`.

**Interfaces:** `extractEventIntake({ draftId, sourceText?, posterAssetIds? }, deps)` preserves the existing bounded loop and read-only people, community, and time tools. It sends one `input_text` block and one `input_image` block per selected image in order, with a total prepared-data-URL ceiling of 20 MB. The model returns `posterIndex` for poster evidence; reject indexes outside the authorized list. `candidatePatch(candidate)` persists tentative values, questions, and bounded evidence while preserving accepted fields. Convert explicit candidate dates to existing `EventIntakeLocalTime.dayOffset` only when the event date and offset are valid; unresolved midnight or DST cases remain questions.

- [ ] Write agent tests asserting text plus two posters appear in one request in order, each read is authorized, out-of-range evidence indexes fail, and a sixth image or aggregate-size overflow never calls the provider.
- [ ] Write mapping tests asserting a dated after-midnight set becomes `dayOffset: 1`, an undated set never gains an offset, DST uncertainty stays a question, evidence persists, and accepted manual fields remain unchanged.
- [ ] Run `node --import tsx --test tests/web/event-intake-agent.test.ts tests/web/event-intake-source.test.ts`; expect new assertions to fail.
- [ ] Extend the existing agent and candidate mapper, preserving the disabled/failure fallback and read-only tools.
- [ ] Rerun both test files; expect pass. Update discovery docs and commit this slice.

### Task 4: Build the contributor's stepped editor

**Files:** Create `apps/web/src/app/events/event-editor-steps.tsx`, `apps/web/src/app/events/event-editor-preview.tsx`; modify `apps/web/src/app/events/event-intake-form.tsx`, `apps/web/src/app/events/event-intake-source.tsx`, `apps/web/src/app/playwright/event-intake/revision-preview.tsx`; test `apps/web/e2e/event-intake-source.flow.spec.ts` and focused contributor visual snapshots; update `docs/planning/event-routing-and-authoring.md` when the behavior lands.

**Interfaces:** `EventEditorSteps` receives the available step IDs, active step, and `onSelect`; it renders the top navigation and a responsive preview slot without persistence logic. `EventIntakeFieldsForm` owns one controlled draft across Source, Details, Lineup, Review. `IntakeTime` renders a native local date plus time and maps it to the existing `dayOffset` wire field; it retains the repeated-hour occurrence choice. Source handles ordered multi-file input, previews each authorized source, offers a primary-image choice, and submits text and selected images together. Lineup reuses `ProfileAvatarImage` for matched search results and a name fallback otherwise. Review routes back to missing fields, shows applicable similar events, preserves Save draft, and publishes to the event page using the current action.

- [ ] Update the connected Playwright fixture for ordered sources, completion version, automatic artwork, evidence readback, and multiple previews.
- [ ] Write flow assertions for manual entry, text-plus-two-image discovery, primary switch/removal, resumed draft, source-change invalidation, dated lineup with avatar/fallback, and direct publish navigation.
- [ ] Run `pnpm --filter web exec playwright test e2e/event-intake-source.flow.spec.ts`; expect the new assertions to fail.
- [ ] Implement the shared step shell and controlled contributor fields with current UI primitives. Keep draft values across step navigation; use `EventTimezonePicker` and native date/time inputs.
- [ ] Rerun the focused flow test and `pnpm --filter web typecheck`; expect pass.
- [ ] Capture desktop and mobile screenshots, review them visually against the reference, fix observed issues, and commit the contributor UI slice.

### Task 5: Apply the stepped layout to owner/staff create and edit

**Files:** Modify `apps/web/src/app/events/event-editor-form.tsx`, `apps/web/src/app/events/event-editor-page.tsx`, `apps/web/src/app/playwright/event-lineup/client.tsx`; use `event-editor-steps.tsx`; test `apps/web/e2e/event-editor.snapshots.spec.ts` and existing editor/lineup flow tests; update `docs/backend/event-schema.md` where editor behavior is described.

**Interfaces:** Staff Source uses existing media, link, and poster URL controls; contributor intake handles private multi-image uploads. Details contains title, timing, timezone, venue, and description; Lineup contains scheduled and untimed performers with the shared avatar treatment; Review contains publication controls and applicable advanced staff operations. Keep `createCommunityEvent`/`updateCommunityEvent`, `events:write`, VRCDN output controls, stream assignment, and staff-only operations unchanged. Because `onSubmit` reads `FormData`, inactive panels must stay mounted. Use form `noValidate` plus a publish-time validity check that switches to the first invalid step and focuses its field. Save draft remains possible with the current canonical rules; successful publish keeps its existing redirect.

- [ ] Extend `event-editor.snapshots.spec.ts`, `event-lineup.flow.spec.ts`, and `event-lineup-validation.spec.ts` with create/edit navigation, value retention, invalid-field return, timed/untimed lineup avatars, publication redirect, and staff-only control assertions.
- [ ] Run `pnpm --filter web exec playwright test e2e/event-editor.snapshots.spec.ts e2e/event-lineup.flow.spec.ts e2e/event-lineup-validation.spec.ts`; expect the new assertions to fail.
- [ ] Move existing sections into step panels while retaining mounted FormData fields, canonical payloads, and permissions. Put advanced operations in a collapsed staff area and reveal invalid fields before publish.
- [ ] Rerun focused Playwright tests and `pnpm --filter web typecheck`; expect pass.
- [ ] Capture desktop and mobile screenshots, check that staff controls remain reachable, fix observed issues, and commit the staff UI slice.

### Task 6: Finish contributor corrections, docs, and cross-path verification

**Files:** Modify `apps/web/src/app/events/event-contribution-controls.tsx` and `event-intake-form.tsx` as needed; test `apps/web/e2e/event-contribution.flow.spec.ts`, `apps/web/e2e/event-editor.snapshots.spec.ts`, existing correction tests; update `docs/backend/event-intake.md`, `docs/backend/event-intake-sources.md`, `docs/developers/public-api.md`, `docs/developers/vrdex-mcp-event-writes.md`, and the implementation status in the visual reference.

**Interfaces:** Correction uses Details, Lineup, and Review from the same presentation but cannot change community, source evidence, artwork, live controls, or staff fields. Its `updateOwnContributedEvent` and optimistic `expectedUpdatedAt` check remain. A successful correction returns to the event page; report/retract/takeover controls retain their separate permissions.

- [ ] Add correction flow assertions in `event-contribution.flow.spec.ts` for allowed edits, hidden restricted fields, stale rejection, and return to the event.
- [ ] Run `pnpm --filter web exec playwright test e2e/event-contribution.flow.spec.ts`; expect the new assertions to fail.
- [ ] Reuse the stepped field presentation, retaining the correction patch filter and permission checks.
- [ ] Rerun the correction and contributor flow tests; expect pass.
- [ ] Update the listed docs and visual-reference status to describe shipped behavior accurately.
- [ ] Run `pnpm test:api-contracts`, `pnpm test:backend`, `pnpm test:web`, `pnpm check:api-openapi`, `pnpm lint:web`, `pnpm --filter web typecheck`, `pnpm lint:markdown`, and focused Playwright flows/snapshots. Use screenshot/VLM review for desktop and mobile Source, Details, Lineup, Review, staff edit, and correction.
- [ ] Show BASIC every exact new substantive public-facing sentence for copy approval before shipping. Commit final verification and docs in the same implementation changeset after approval.

## Self-review

- **Coverage:** The six tasks cover the visual reference, combined discovery, automatic artwork, dates across midnight, all approved authoring paths, permissions, docs, and visual proof.
- **Boundary:** The contributor pipeline remains contributor-sourced; owner/staff actions remain canonical. Live playback and event public-page layout stay outside this changeset.
- **Dependency order:** Contract and source authorization precede artwork and discovery; those precede the connected UI and its fixtures. Staff and correction presentation reuse the finished step shell.
- **Open implementation choice:** Use the smallest shared step shell and field components that make the forms consistent. Do not force unlike backend payloads into one abstraction.
