# Event editor identity and local-time checkpoint

Task 6 is in progress. The independent focused checks pass. Complete history
fallback indexing awaits direct approval, and final combined and visual checks
have not run on this implementation yet. This is local evidence, not deployment
or hosted signed-in verification.

## Current evidence

- Windows isolated Next dev on 3186 and Convex on 3290, from the task worktree.
- Web typecheck and lint passed after retained staff association readback.
- Focused persistence tests passed 5 of 5.
- Local authenticated correction, intake and lineup backend tests passed 91 of 91.
- Focused desktop unsaved and lineup tests passed 46 of 46 with the blocked
  `history fallback` case explicitly excluded. Native refresh, close and document
  cancellation, real Navigation API Back, repeated cancel and accept, upload and
  extraction pending buffers, save races, retained publication, stale save,
  removal, presentation-only state and unchanged saves executed.
- Clean publication and forbidden retained-publication cases passed 5 of 5 in
  [completion results](../../apps/web/test-results/task6-completion.json).
- [Focused browser report](../../apps/web/test-results/task6-reports/independent/index.html)
  and [JSON results](../../apps/web/test-results/task6-independent.json).

The safe interim fallback allows untagged destinations through. The proposed
[indexing change](./event-editor-history-indexing-proposal.md) is unapplied.
Earlier fallback success used an unsafe unknown-direction assumption and is not
current acceptance evidence.

## Evidence provenance

An early Task 6 Playwright run omitted an explicit output directory and removed
ignored prior Task 3 and Task 5 screenshots and the Task 5 `task5-r1` JSON. Their
SDD reports and review records survive, but those missing images cannot support
this checkpoint. Final captures must use new existing paths. Every later run
uses a unique `test-results` output and a separate HTML report directory.

Final desktop/mobile light/dark screenshots and current-head Linux comparison
will be added after inspection. No screenshot baseline has been updated in Task 6.

The separate profile-editor disclosure request remains deferred.
