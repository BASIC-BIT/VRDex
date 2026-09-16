# Event lineup links and live playback implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a community event useful as an operator link sheet and a browser listening experience that follows its performers automatically.

**Architecture:** Extend existing event slots and visibility-safe public projections. Keep source selection and handoff decisions separate from the existing mpegts.js player. Browser playback follows one ordered sequence, with no media worker or shared broadcast state.

**Tech Stack:** Next.js, React, TypeScript, Convex, existing mpegts.js, Web Audio, Node test runner, Playwright. Keep the repository's Node 24 and pnpm versions.

**Spec:** [Approved design](../../planning/event-lineup-live-design-2026-09-14.md). Read it and the two linked research notes before execution.

## Global constraints

- Automatic advancement is enabled by default on the event page.
- Deliver the cohesive feature in one PR, with internal commits and validation checkpoints rather than separate feature PRs.
- Distinguish connected audio silence from disconnection.
- Support one ordered playback sequence per event in this slice.
- No new media worker, relay, provider credentials, or server audio processing is needed for browser playback.
- Do not broaden staff permissions or change MCP create-and-publish semantics here.
- Browser draft authoring remains available.
- Do not copy private fields into event data.
- Store only the selected normalized stream identity with the slot.
- One current and at most one prepared next connection; zero connections before Play.
- No clock-only cutoff, automatic skipping of unavailable slots, or final-slot wraparound.
- Reuse approved utility labels. BASIC reviews any substantive new public prose before shipping. No em dashes or double-hyphen substitutes in public copy.
- Complete desktop/mobile screenshot inspection before claiming UI completion.
- Merge and deployment remain separate from implementation/readiness authorization.

## Execution setup

- [ ] Read `superpowers:using-git-worktrees`, current `AGENTS.md`, and `AGENTS.local.md`. Create `codex/event-lineup-live` at `D:/bench/VRDex-wt/event-lineup-live` from refreshed main after checking branch/path availability. Do not switch or clean the protected main checkout.
- [ ] Copy only the approved design, this plan, and the two September 12 event research notes into that worktree. Compare their content before committing. Leave unrelated dirty files and local MCP configuration alone.
- [ ] Inspect current diff and relevant code against the research baseline. Reconcile any intervening event/player changes in the plan before coding. Install using the pinned package manager and lockfile.
- [ ] Record baseline focused tests. Commit the planning files on the feature branch. Keep experiment and implementation commits on this branch; do not open a documentation-only PR.

## File and interface map

Existing files to extend:

- `convex/_eventSlots.ts`, `_eventInputs.ts`, `schema.ts`, `events.ts`: source selection and viewing mode.
- `convex/_eventPublic.ts`: projected public links, playback identities, and resolved streams.
- `convex/_profilePublic.ts`, `_vrcdnLinks.ts`: reuse existing visibility and normalization functions.
- `packages/api-contracts/src/schemas.ts`, `index.ts`, `openapi.ts`: explicit slot/performer output types and write fields.
- `apps/web/src/app/events/event-editor-form.tsx`: mode and stream choice.
- `apps/web/src/app/_components/event-public-page.tsx`, `event-watch-surface.tsx`, `vrcdn-stream-player.tsx`: roster and live integration.
- `apps/web/src/lib/server/vrdex-mcp.ts`, `packages/vrdex-mcp/src/server.ts`: verify shared output, modifying only if needed.

New focused modules:

- `convex/_eventPlayback.ts`: resolve permitted selection from normalized public stream choices.
- `apps/web/src/lib/event-playback.ts`: pure join, eligibility, and handoff decisions.
- `apps/web/src/lib/event-audio-observation.ts`: analyser samples, monotonic evidence, invalidation.
- `apps/web/src/app/_components/event-lineup-player.tsx`: event subscription, current/next ownership, controls.
- `apps/web/src/app/_components/event-performer-links.tsx`: reusable link/copy rows.
- `tests/backend/event-playback-projection.test.ts`, `tests/web/event-playback.test.ts`, `tests/web/event-audio-observation.test.ts`: focused behavior tests.
- `apps/web/e2e/event-lineup.flow.spec.ts`, `event-lineup.snapshots.spec.ts`: fixture-driven behavior and visual checks.

Wire fields and pure interfaces to use across tasks:

```ts
// Event field, absent means the existing event-level behavior.
type WatchMode = 'event_stream' | 'performer_sequence';
// Slot authoring field. Omit = choose sole visible source; null in updates clears
// an explicit selection. Storage uses optional string, not null.
type SlotStreamInput = { selectedStreamId?: string | null };
type PlaybackStream = {
  streamId: string;
  pcUrl: string;
  questUrl: string;
};
type PlaybackSlot = {
  key: string;
  startAt: number;
  endAt?: number;
  stream?: PlaybackStream;
};
type PlaybackEvidence = {
  failureSince?: number;
  silenceSince?: number;
  observedAt: number;
  progressing: boolean;
  analysisActive: boolean;
};
type HandoffInput = {
  now: number;
  eligibleAt: number;
  following: boolean;
  paused: boolean;
  nextReady: boolean;
  evidence: PlaybackEvidence;
  silenceDurationMs: number;
};
// In event-playback.ts:
// joinSlot(slots: readonly PlaybackSlot[], now: number): PlaybackSlot | undefined
// handoffEligibleAt(current: PlaybackSlot, next: PlaybackSlot): number
// shouldHandoff(input: HandoffInput): boolean
```

Backend output adds `playbackKey` and optional `stream` to each public slot,
`outboundLinks` to its visible performer and other participant summaries, and
effective `watchMode` to public event detail. Reuse the existing public outbound-link
schema exactly, including copy-only link semantics. Do not invent a parallel link type.

Slot identity: current schedule saves replace slot rows. Expose the row id as
`playbackKey`. On a replacement, reconcile the active slot only if exactly one new
row matches performer identity, authored start, and selected stream. Preserve the
connection in that case. Otherwise release prewarm and re-evaluate current playback
without treating deletion as a silence/disconnection handoff. Never match by index.
This avoids changing the whole schedule-write model for playback.

## Task 1: Prove silence measurement and switching in the actual transport

**Files:** Create `scripts/event-playback-proof.mjs`, a development-only fixture under `apps/web/src/app/playwright/event-lineup-proof/`, and `docs/engineering/event-playback-proof.md`. Reuse existing Playwright fixture access restrictions. Test `apps/web/e2e/event-lineup-proof.spec.ts`.

**Consumes:** Existing `VrcdnStreamPlayer` and its MPEG-TS transport. **Produces:** recorded analyser compatibility, tested level/duration, supported-browser evidence, and bounded connection lifecycle findings.

- [ ] Add controlled local MPEG-TS sources. Use installed FFmpeg to produce a 440 Hz audible fixture and a silent fixture, with a loopback HTTP server providing the streaming transport. Keep generated media ignored. Example fixture generation:

```powershell
ffmpeg -f lavfi -i 'color=c=black:s=320x180:r=25' -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 8 -c:v libx264 -pix_fmt yuv420p -c:a aac -f mpegts .tmp/event-audible.ts
ffmpeg -f lavfi -i 'color=c=black:s=320x180:r=25' -f lavfi -i 'anullsrc=r=48000:cl=stereo' -t 8 -c:v libx264 -pix_fmt yuv420p -c:a aac -f mpegts .tmp/event-silent.ts
```

- [ ] Implement loopback fixture controls for audible, silent, disconnected, recovered, and next-unavailable. A finite fixture EOF is not a broadcaster-ended oracle. Bound and clean up every server/FFmpeg process started by the proof.
- [ ] Feed decoded audio through an analyser upstream of viewer gain. Do not double-route sound or use element mute as an audio-silence signal. Compare sound/volume/mute with the unmodified player.
- [ ] Measure RMS using `sqrt(sum(sample * sample) / sampleCount)` and dBFS using `20 * log10(max(rms, 1e-12))`. Try one-second evidence windows first and record quiet music versus synthetic silence separately. Do not ship an unmeasured magic threshold.
- [ ] Prove actual next-source progress and source switch, including volume, autoplay rejection, hidden/resumed context, and one-current/one-next maximum. Record Chromium/Firefox and Safari availability honestly.
- [ ] Write results with exact settings and reproduction commands. A working local transport fixture does not establish live provider behavior. Use an authorized live public test source for transport confirmation when available, never ingest credentials.
- [ ] If analysis is not reliable, report the evidence before proceeding with a changed scope. Otherwise record the tested silence level/duration in the proof note for Task 4. Commit the bounded proof and findings on the feature branch.

## Task 2: Persist stream choices and project one safe roster through API/MCP

**Files:** Backend and API-contract files in the map; `tests/backend/event-playback-projection.test.ts`, existing `event-foundation.test.ts`, `hosted-mcp-event-writes.test.ts`; `packages/api-contracts/tests/event-playback.test.ts`; `packages/vrdex-mcp/tests/api-client.test.ts` and `stdio.test.ts`.

**Consumes:** Current profile projections and canonical VRCDN normalization. **Produces:** `watchMode`, public roster links, `playbackKey`, `stream`, and editor choices using the shared types above.

- [ ] Add failing pure resolution tests. Define `resolveEventStream(choices: readonly PlaybackStream[], selectedStreamId?: string): PlaybackStream | undefined` in `_eventPlayback.ts`, accepting only already-normalized public choices.

```ts
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolveEventStream } from '../../convex/_eventPlayback';
it('never substitutes for a removed explicit selection', () => {
  const a = { streamId: 'alpha', pcUrl: 'rtspt://stream.vrcdn.live/live/alpha', questUrl: 'https://stream.vrcdn.live/live/alpha.live.ts' };
  assert.equal(resolveEventStream([a], 'removed'), undefined);
  assert.equal(resolveEventStream([a])?.streamId, 'alpha');
  assert.equal(resolveEventStream([a, { ...a, streamId: 'beta' }]), undefined);
});
```

- [ ] Run `node --conditions=import --import tsx --test tests/backend/event-playback-projection.test.ts`, confirm the intended failure, then implement explicit-match-or-sole-choice resolution. Normalize and deduplicate PC/Quest equivalents before this function.
- [ ] Extend slot and event validators/storage. Use existing stream-id parsing, length bounds, community authority, and audit machinery. Require selected stream membership on authoring. Preserve omitted fields on partial updates; explicit clearing removes the stored selection.
- [ ] Trace every event constructor, slot replacement, editor loader, API/MCP input, and public projector. Preserve selections when an update omits schedule data; editor schedule replacement round-trips choices. Defaults preserve event-stream behavior.
- [ ] Add integration cases for hidden links/profile, duplicate performer slots, freeform labels, multiple choices, removed selections, and source change after load. Assert outbound links equal the public profile projection, not raw profile storage.
- [ ] Add explicit Zod schemas for the new slot/performer fields instead of leaving them as `unknown`. Preserve existing slot metadata and source fields. Test schema parse of the actual public query output and propagation through hosted and stdio MCP.
- [ ] Verify owner event writes retain current authorization and create/publish behavior. Assert missing scope, unauthorized community, and inappropriate staff access stay denied. No new roster tool or permission capability.
- [ ] Run focused tests, `pnpm test:api-contracts`, `pnpm test:vrdex-mcp`, and backend/contracts typechecks. Generate OpenAPI with `pnpm --filter @vrdex/api-contracts generate:openapi`, then `pnpm check:api-openapi`. Commit with matching `docs/backend/event-schema.md` and MCP contract docs.

## Task 3: Build the editor choices and event link sheet

**Files:** `event-editor-form.tsx`, `event-public-page.tsx`, new `event-performer-links.tsx`; existing `apps/web/src/app/playwright/event-editor/` fixtures, new event-lineup fixture; `apps/web/e2e/event-lineup.flow.spec.ts` and `event-lineup.snapshots.spec.ts`.

**Consumes:** Task 2 public roster and editor source choices. **Produces:** authorized source/mode authoring and a usable public link sheet, with no per-row streaming.

- [ ] Add a fixture with two scheduled appearances by one person, a person with two streams, a freeform row, and a hidden-link case. Write browser assertions before changing UI. Accessible labels below are utility-label candidates, not approved substantive copy:

```ts
test('event roster exposes copy actions without opening streams', async ({ page }) => {
  const streams: string[] = [];
  page.on('request', r => { if (r.url().includes('.live.ts')) streams.push(r.url()); });
  await page.goto('/playwright/event-lineup');
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy PC stream' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Private fixture link' })).toHaveCount(0);
  expect(streams).toEqual([]);
});
```

- [ ] Implement performer link rows using current link rendering and `CopyValueRow`. Keep profile links and viewer-local times. Do not replace copy-only VRCDN references with fabricated browser pages.
- [ ] Add event-stream versus performer-sequence choice within watch authoring. Show per-slot source choice only when relevant. One normalized choice is automatic; ambiguous choices require selection for that row to be playable, not for the event to be published.
- [ ] Save and reload a fixture-backed editor to prove explicit choice and mode persistence. Clearing a choice and changing performer must not retain another person's stream.
- [ ] Run `pnpm --filter web exec playwright test event-lineup.flow.spec.ts --project=desktop-chromium`. Add desktop/mobile screenshots via existing visual helpers, inspect the images, and correct spacing, copy, link wrapping, and keyboard access.
- [ ] Commit the editor/link-sheet checkpoint with `docs/planning/event-routing-and-authoring.md` updates. Keep it in the same PR; it is not the finished feature.

## Task 4: Implement deterministic join and handoff policy

**Files:** New `event-playback.ts`, `event-audio-observation.ts`, and their Node tests.

**Consumes:** `PlaybackSlot`, `PlaybackEvidence`, calibrated silence duration from Task 1. **Produces:** the three pure functions in the interface map and an observation accumulator with explicit invalidation.

- [ ] Write failing time-policy tests with no real timers:

```ts
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { handoffEligibleAt, shouldHandoff } from '../../apps/web/src/lib/event-playback';
it('does not advance before eligibility or during viewer pause', () => {
  const current = { key: 'a', startAt: 0, endAt: 600_000 };
  const next = { key: 'b', startAt: 600_000 };
  assert.equal(handoffEligibleAt(current, next), 480_000);
  const input = { now: 479_999, eligibleAt: 480_000, following: true,
    paused: false, nextReady: true, silenceDurationMs: 1000,
    evidence: { failureSince: 478_000, observedAt: 479_999,
      progressing: false, analysisActive: false } };
  assert.equal(shouldHandoff(input), false);
  assert.equal(shouldHandoff({ ...input, now: 480_000,
    evidence: { ...input.evidence, observedAt: 480_000 } }), true);
  assert.equal(shouldHandoff({ ...input, now: 480_000, paused: true }), false);
});
```

- [ ] Run `node --import tsx --test tests/web/event-playback.test.ts` and confirm the intended failure. Implement eligibility as `Math.max((current.endAt ?? next.startAt) - 120_000, next.startAt - 120_000)`.
- [ ] Implement join selection using authored time intervals. No slot before start, after event entry closes, or inside a gap. If simultaneous candidates are ambiguous, return no automatic selection. Infer a missing end from the next start only for selection.
- [ ] Implement handoff as eligibility AND following AND not paused AND next ready AND fresh qualifying evidence. Failure requires 1000 ms. Silence additionally requires progressing media and active analysis, with duration from the proof. Never branch solely on the clock or `ended` event.
- [ ] Define `observeAudio(previous, sample)` and `clearPlaybackEvidence(now)` in the observation module. Samples carry timestamp, measured dBFS, media progress, pause state, and analysis state. Emit evidence from observed data, not DOM volume. Reset on audible recovery, pause, suspension, backwards timestamps, or discontinuous sample gaps. Use a named 500 ms freshness ceiling for the planned 100 ms foreground sampling interval; verify scheduling behavior in browsers.
- [ ] Cover 999/1000 ms failure, 119-second eligibility, gap/overlap, no next source, recovery, muted audible input, suspended analysis, stale evidence, missing ends, manual mode, and last slot. Run both new Node test files and commit the pure policy separately from UI integration.

## Task 5: Integrate automatic following with the player lifecycle

**Files:** `event-lineup-player.tsx`, `vrcdn-stream-player.tsx`, `event-watch-surface.tsx`, `event-public-page.tsx`, event-lineup fixtures and browser tests.

**Consumes:** Task 2 reactive public event and Task 4 policy. **Produces:** default-follow audible playback with bounded current/next ownership and manual return-to-live behavior.

- [ ] Extend the proof tests to the product component before integration. Assert initial `following=true`, zero connections before Play, and one audible source even while the next source is prepared.
- [ ] Keep existing profile-player callers working with the current player API. Add optional observation/source-control hooks rather than coupling profile playback to event state. Reuse the proved analyser and preserve sound, volume, fullscreen, and error controls.
- [ ] Make `EventLineupPlayer` own current and next players and their cleanup. Only the current source is routed audibly. Require decoded progress on the next connection before switching. Catch every `play()` rejection and keep a visible action to resume.
- [ ] Subscribe once to the public event query while mounted. Handle null/unpublished/cancelled results by releasing streams. On slot replacement use the exact unique-match reconciliation rule above; invalidate stale async next-source completion with a request generation or abort signal.
- [ ] Evaluate policy from monotonic playback observations with wall time used only for schedule eligibility. On tab/context resume clear evidence before sampling again. Bound retries to backoff intervals of 1, 2, 4, then 10 seconds while eligible and visible; reset on source change and stop on teardown. Preserve current audio while next retries fail.
- [ ] Separate entering the watch window from continuing an active session. Keep an already-playing final source after posted end. Never reopen a new after-end session or loop back to the first performer automatically.
- [ ] Wire manual selection to pause following, return-to-live to rejoin scheduled playback, and pause to stop transition decisions. Do not prewarm before Play or more than two streams total.
- [ ] Run fixture browser cases for every design-table row, including silent connected media and musical breaks. Verify event-stream mode and profile stream playback regressions. Inspect desktop/mobile live/recovery screenshots and commit integration plus player documentation.

## Task 6: Complete one-PR verification and review

**Files:** Existing tests/docs touched by Tasks 1-5; proof evidence note; this checklist.

**Consumes:** Complete feature, not an isolated checkpoint. **Produces:** one reviewable PR with exact-head evidence and disclosed remaining deployment checks.

- [ ] Run the relevant suites and typechecks once the complete change is present:

```powershell
pnpm test:backend
pnpm test:web
pnpm test:api-contracts
pnpm test:vrdex-mcp
pnpm typecheck:backend
pnpm typecheck:api-contracts
pnpm typecheck:vrdex-mcp
pnpm typecheck:web
pnpm lint:web
pnpm check:api-openapi
pnpm --filter web exec playwright test event-lineup.flow.spec.ts --project=desktop-chromium --project=mobile-chromium
```

- [x] Run the new snapshot tests with the configured desktop/mobile projects, inspect images, and record screenshot paths. Run markdown checks for changed documents and `git diff --check`. Re-run only when changes/failures justify it.
- [ ] Demonstrate the same controlled event through community editor, discovery, event page, public API, and hosted/stdio MCP. Development fixtures must exercise real serialization/authorization code. A production mutation requires a separately approved exact event/target; mark live-write verification pending if none is authorized.
- [x] Recheck client event-tool visibility without overwriting local MCP edits. Report missing scope/config as an operational prerequisite, not a product-code failure. Existing production auth smoke remains deferred under `AGENTS.local.md` unless that prerequisite has been completed independently.
- [x] Audit docs for behavior drift: event schema, authoring, MCP event writes/reads, and browser proof. Show BASIC any substantive proposed public prose that needs approval before shipping.
- [ ] Open/update one PR. Describe the concrete operator and viewer outcomes and include useful manual/browser evidence. No separate proof or docs PR. Triage outstanding review comments before each follow-up push, reply with disposition, and resolve handled threads.
- [ ] After the latest pushed commit is at least 30 minutes old, refresh exact-head required/informational checks, comments, inline threads, formal reviews, and mutable AI summaries. Address valid feedback, then refresh again. Report merge-ready only with acceptable terminal checks, clean mergeability, and no blocking feedback. Include the PR URL. Do not merge or deploy without authorization.

## Plan self-review

- Scope coverage: roster, authoring, API/MCP, privacy, default following, source selection, silence/disconnection, overtime, invalidation, visual checks, and one-PR review are assigned above.
- Task 1 owns measured thresholds; Task 4 consumes its recorded result. No threshold is presented as already validated.
- Public field names and policy interfaces are defined once and used consistently. Runtime slot ids may change, so reconciliation is explicit.
- Completed verification items link to the September 16 [local evidence ledger](../../engineering/event-lineup-verification.md). Unchecked delivery items remain pending; the original task breakdown is retained as history.
