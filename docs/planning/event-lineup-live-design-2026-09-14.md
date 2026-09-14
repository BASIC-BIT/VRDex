# Event lineup links and live playback

Status: design approved by BASIC in this task on September 14, 2026. One PR.
Product code and browser experiments have not started. This document supersedes conflicting
recommendations in the September 12 research notes, but not their evidence.

## Outcome and approved direction

Locked decisions:

- Connect community events, scheduled performers, and their reusable profile links.
- Automatic advancement is enabled by default on the event page. Starting playback
  should feel like joining the live event, as close to attending in-world as practical.
- Distinguish connected audio silence from disconnection.
- Minimize PR count. Deliver the cohesive feature in one PR, with internal commits
  and validation checkpoints rather than separate feature PRs.

Observed workflow: BASIC regularly uses MCP profile reads to retrieve people's
links and now needs the same convenience for an entire event roster.

The behavior below was approved for implementation planning. Silence calibration
still requires experimental evidence; approval does not establish a working threshold.

## Scope

Include community-scoped event authoring integration, selected performer streams,
an event-level list of public performer links, matching API/MCP event reads, and a
browser player that follows scheduled performers. Reuse existing event creation,
publication, discovery, profiles, and the MPEG-TS VRCDN player.

Support one ordered playback sequence per event in this slice. Simultaneous stages,
combined DJ/VJ composition, shared operator-controlled switching, and a continuous
restream output are outside this design. Existing event-level watch links continue
to work through an explicit choice between the event stream and performer sequence.
Recommend preserving the existing event stream mode for configured events and
offering performer sequence mode when the organizer enables lineup viewing.

No subscription or paid-tier requirement is inferred. No new media worker, relay,
provider credentials, or server audio processing is needed for browser playback.

## Data and operator flow

1. An authorized organizer creates or edits an event within its community.
2. Each scheduled appearance links to a person profile or retains a freeform label.
3. Project the person's currently visible public outbound links into the event
   response. Reuse profile visibility rules and deduplicate profile reads, while
   retaining every scheduled appearance. Do not copy private fields into event data.
4. Derive supported stream choices from those links. With exactly one distinct
   VRCDN stream, select it automatically. PC/Quest variants of the same stream
   count as one choice. With several streams, the organizer selects one per slot.
5. Store only the selected normalized stream identity with the slot, not a duplicated
   profile link list or a secret URL. Revalidate it against currently visible profile
   links on every public projection. An explicit choice that disappears becomes
   unavailable; do not silently substitute another stream.
6. A freeform performer or one without a stream still appears in the schedule and
   does not block publication. It cannot be automatically played.
7. The event page presents time, performer, public links, and PC/Quest copy actions
   together. Only the selected player opens a stream connection. Do not instantiate
   a live preview for every performer row.

Proposed implementation locations:

- `convex/schema.ts`, `_eventSlots.ts`, `_eventInputs.ts`, and `events.ts`: selected
  source and viewing-mode validation, persistence, and editor round trip.
- `convex/_eventPublic.ts` and `_profilePublic.ts`: visibility-safe link projection.
- `packages/api-contracts/src/schemas.ts` and `openapi.ts`: event read/write contracts.
- `apps/web/src/app/events/event-editor-form.tsx`: per-slot source selection and mode.
- `apps/web/src/app/_components/event-public-page.tsx`: roster link presentation.
- `apps/web/src/app/_components/event-watch-surface.tsx`: mode and player integration.
- New `apps/web/src/lib/event-playback.ts`: pure schedule and handoff decisions.
- Existing `vrcdn-stream-player.tsx`: playback observations and source changes,
  retaining its current transport and controls.

These are responsibility boundaries, not permission to refactor unrelated modules.

## Joining and following

Starting playback selects the scheduled current slot, not the first slot of the
event. Before the event, wait for its first slot. In a schedule gap, do not start a
future performer early merely because their stream is available. If a selected
source is unavailable, show recovery/manual controls and retry with a bound.

The clock identifies candidates; actual playback retains its selected slot identity.
Passing a slot boundary never cuts off healthy playback. A new viewer can therefore
hear a different source from an existing viewer during an overrun. This is an
explicit limitation of independent browser state, not synchronized event control.

Current recommendation: manually selecting a performer pauses automatic following.
A return-to-live action selects the scheduled current slot and resumes following.
Pause never triggers a transition. Resuming in follow mode re-evaluates the schedule;
muting and volume changes never count as source silence.

## Automatic handoff policy

For adjacent slots, prepare the next source no earlier than two minutes before the
boundary. For gaps or overlaps, use the later of current end minus two minutes and
next start minus two minutes. If current end is absent, use next start as its
effective boundary for handoff only; do not change authored schedule data.

Current recommendation: allow at most one next-source connection inside this
window, after the viewer starts playback. Require actual media progress before
committing a switch. Release obsolete connections on schedule/source changes,
manual selection, mode change, cancellation, or leaving the page.

Two independent candidate triggers:

- Disconnection/stopped playback: require at least one second of continuous failure
  evidence. Attempt recovery of the current source; cancel the candidate if it
  recovers before commitment. EOF and local buffering are not authoritative proof
  of broadcaster completion.
- Connected silence: require progressing decoded audio below a measured threshold
  for a continuous interval. Start the experiment with BASIC's proposed one second;
  choose the actual level and duration from evidence. This trigger is included in
  the intended PR scope, subject to a successful browser experiment.

Both require eligibility, a playable next source, and automatic following enabled.
Do not count pause, mute, zero volume, suspended analysis, or stale background-tab
observations as source silence. Reset observations when playback/context resumes.
Use elapsed timestamps rather than timer tick counts. One second is a minimum
confirmation interval, not a promise of one-second audible switching.

| Situation | Proposed behavior |
| --- | --- |
| Dropout before the two-minute window | Recover current source; never advance |
| Dropout recovers before commitment | Clear failure evidence and keep current |
| Current source remains audible past its slot | Keep playing; do not cut by clock |
| Next source is offline or missing | Retry current/next with bounds; do not skip ahead |
| Next slot is freeform or intentionally empty | Stop automatic traversal there; retain manual control |
| Ambiguous simultaneous slots | Require organizer to remove ambiguity for automatic playback |
| Final performer runs past event end | Keep the existing listening session alive |
| Final performer stops | End/recovery controls; no wraparound to the first performer |
| Viewer arrives after posted event end | Keep normal ended-event entry behavior; no new endless live session |
| Event cancelled, unpublished, or selected link hidden | Stop/release on receiving the updated projection |
| Browser rejects playback | Show usable play control; preserve chosen source and follow preference |

Use the application's reactive event data where available. If the public page is
currently a static fetch, add an event-scoped reactive read while mounted so edits
and visibility changes invalidate selected sources. Do not create one subscription
per performer. Reconcile by slot identity and selected stream, never array index.

## MCP boundary

Expose the same public roster links and selected safe stream through existing event
reads, in both hosted and stdio MCP where their shared contracts apply. Keep event
lookup plus profile lookup usable; no additional roster-specific tool is required.

Verify existing event creation/update with community ownership and required scopes.
Do not broaden staff permissions or change MCP create-and-publish semantics here.
Browser draft authoring remains available. A live write test needs an explicitly
approved event and destination; preview/local fixtures cover development meanwhile.

The workspace allowlist omits event tools in the September 12 snapshot. Recheck at
execution, preserve existing local edits, and handle client configuration separately
from checked-in product code. Tool visibility does not prove OAuth write authority.

## Internal checkpoint before full implementation

In the feature worktree, use controlled MPEG-TS fixtures with audible audio, a
musical break, connected silence, disconnect/reconnect, and an unavailable next
source. Prove the existing mpegts.js pipeline yields meaningful analyser samples.
Compare against the existing player without analysis for sound and control regressions.

Record browser, fixture, threshold, duration, false transitions, connection count,
and source-change delay. Test viewer mute/pause, transport EOF, background/resume,
and rejected play promises. Check Chromium and Firefox plus Safari where this
transport is supported; unavailable browser evidence stays explicitly unverified.

If connected-silence detection is unreliable, return the evidence and a revised
recommendation to BASIC. Do not silently remove it from the one-PR completion scope.
The experiment is an internal checkpoint, not a separate PR or a release claim.

## Delivery and acceptance

One feature branch and one PR. Suggested independently testable commits:

1. Browser experiment and findings, then confirmed handoff parameters.
2. Event stream selection and public roster API/MCP contracts with visibility tests.
3. Event editor and link sheet with desktop/mobile visual verification.
4. Default-follow player, recovery, silence/disconnection policies, and overtime behavior.
5. End-to-end evidence, documentation, and review fixes.

Required checks include:

- Repeated performers, freeform rows, absent links, multiple streams, hidden profiles,
  removed selections, stale writes, and owner/staff permission distinctions.
- Deterministic clock tests for every transition-table row, including 119-second
  eligibility, gaps, recovery resetting evidence, and no automatic skipping.
- Browser fixtures verify audible continuity, source switching, pause/mute, no
  connection before play, bounded connections, and cleanup after unmount/cancellation.
- The same event roster is visible through the website, public API, and MCP contracts.
- Editor round trip preserves selected sources. One controlled published fixture
  supports discovery, public page, and performer-link readback verification.
- Screenshot evidence and visual review for desktop/mobile roster, source choice,
  live player, and recovery controls. Visual design is not complete yet.
- Lint, typecheck, relevant backend/web/API/MCP suites, then required CI checks.
- Update event-schema, event-authoring, MCP, and player docs alongside behavior.
- Review exact new public prose with BASIC before shipping; utility labels can reuse
  approved patterns. Do not add explanatory filler or mention internal failure mechanics.
- Follow the repo's 30-minute exact-head PR review window and final feedback refresh.
  Merge and deployment remain separate from implementation/readiness authorization.

No server media egress is introduced; next-source prewarming adds up to one browser
viewer connection. Keep provider-capacity and autoplay limitations in engineering
docs, not promotional claims. Existing self-hosted deployments use the same browser
path and need no new secret or managed worker for this feature.

## Execution

BASIC approved the behavior table, connected-silence experiment, organizer stream
selection, bounded MCP scope, and one-PR delivery. Follow the
[implementation plan](../superpowers/plans/2026-09-14-event-lineup-live.md).
Do not describe this approved design as tested playback. Threshold changes must
be backed by experiment results; a failed experiment requires a scope decision,
not silent removal of connected-silence handling.

## Evidence

- [Gap assessment](event-operator-gap-assessment-2026-09-12.md)
- [Browser/provider research](event-client-handoff-research-2026-09-12.md)
- [Existing event routing](event-routing-and-authoring.md)

Prior live checks are dated September 12; no new live-state claim is made here.
