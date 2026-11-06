# Automatic event viewer and inferred set ends

Make public community events watchable from their existing lineup without staff configuration. Use one derived schedule for lineup displays and the browser player. Authored times stay unchanged.

## Agreed behavior

- A missing set end uses the immediate next unambiguous start. The final set uses the event end when known. Otherwise it stays open-ended. Explicit ends win; missing or ambiguous rows remain barriers.
- Timed events with a playable public DJ stream offer the existing viewer automatically. A configured event stream keeps precedence. Playback still begins with the viewer pressing Play, and persists while navigating.
- Enable the requested client-side silence trial: 15 continuous seconds below -60 dBFS, within five minutes before or after the derived set end, with a prepared next stream. This changes only the local client, with manual selection and Return to live retained.
- Pause, hidden documents, stale observations and unavailable next streams prevent automatic handoff. Viewer volume and mute do not alter measured levels.
- No broadcasting worker, relay enablement, source-data backfill, guessed stream identity or music calibration project is included.

```mermaid
flowchart LR
  Page[Public event page or direct event link] --> Play[Press Play]
  Play --> Player[Persistent local viewer]
  Player --> Next[Next stream ready near set end]
  Next --> Quiet[15 seconds below threshold]
  Quiet --> Advance[Local client advances]
  Player --> Manual[Select performer or Return to live]
```

## Implementation and checks

1. Add and test a pure shared end-inference helper. Apply it to public lineup/slot projections and browser schedule consumers without persisting derived values.
2. Test automatic viewer eligibility, existing explicit event-stream precedence, cancellation/date-only behavior, and local-only adapter selection. Update the existing watch settings to reflect automatic lineup behavior.
3. Add deterministic threshold/window/handoff tests before enabling the existing client analysis path. Keep failure recovery and stale-evidence guards.
4. Run focused tests, types/lint, appropriate backend tests and browser/visual verification. Inspect screenshots, then open one reviewable PR.

The numerical silence defaults are implementation choices for the requested trial, not a claim of calibration against real DJ sets. Real-music usefulness remains a live trial question.

## Source verification, November 6

Implementation preserves authored timing in both host and editor reads, including
repeated saves after clearing an end. The timed playback projection carries an
untimed-row barrier so filtering the public lineup cannot reconnect across it.
The editor offers Automatic or Event stream. These are utility labels; no new
public explanatory prose is introduced.

The full web suite passed 1,154 tests, plus web/backend typechecking, web lint
and Markdown lint. The integrated timing, authoring and playback regressions
passed 101 tests.
API-contract tests passed 85 tests. Desktop and mobile browser checks passed
for automatic, explicit-sequence and event-stream playback surviving consumer
unmount, plus the Automatic/Event stream selector. An independent review found
no blocking source or screenshot issues.

The full backend run reported four failures in unchanged broadcast tests and did
not reach a terminal summary before it was stopped. Isolated runs reproduced the
encoder pipe, renderer anchoring and fake-AWS dispatch failures. This is not a
green backend result. The opt-in FFmpeg loopback proof was updated but not run.
Real DJ silence usefulness and deployed behavior remain unverified. Merge and
deployment are outside this source-only completion.
