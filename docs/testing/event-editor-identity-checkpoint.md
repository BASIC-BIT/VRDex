# Event editor identity and local-time checkpoint

Task 6 is in progress. The focused checks pass. Complete history fallback indexing awaits direct
approval. Combined testing found integration bugs that are fixed; final browser
comparison and Linux visuals are still running. This is local evidence, not deployment
or hosted signed-in verification.

## Current evidence

- Windows isolated Next dev on 3186 and Convex on 3290, from the task worktree.
- Web typecheck and lint passed after integration fixes. Full web units passed
  726 of 726, with no skipped cases. Backend types and 1,472 tests passed.
- Web build, isolated backend generated check and docs verification passed.
  The next final build will include the opaque picker-surface correction.
- The first combined desktop/mobile run passed 397 of 414 cases. Its failures
  and covering reruns remain in `apps/web/test-results/task6-combined.json`
  and `task6-covering.json`. The covering functional cases passed; new removal
  evidence exposed a focus bug, fixed before the eight-case capture run passed.
- The named recent-search reopen case passed on desktop and mobile in
  `apps/web/test-results/task6-recent-search.json`.
- Focused persistence tests passed 5 of 5.
- Local authenticated correction, intake and lineup backend tests passed 91 of 91.
- Focused desktop unsaved and lineup tests passed 46 of 46 with the blocked
  `history fallback` case explicitly excluded. Native refresh, close and document
  cancellation, real Navigation API Back, repeated cancel and accept, upload and
  extraction pending buffers, save races, retained publication, stale save,
  removal, presentation-only state and unchanged saves executed.
- Clean publication and forbidden retained-publication cases passed 5 of 5 in
  [completion results](../../apps/web/test-results/task6-completion.json).
- `apps/web/test-results/task6-reports/independent/index.html`
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

Desktop/mobile light/dark captures are in
`apps/web/test-results/task6-evidence-ready`. Inspection found readable Details,
Lineup, removal, Review and repeated-clock controls, but the open identity picker
showed underlying labels through its translucent background. The picker now uses
the existing opaque elevated token. Recapture and Linux comparison remain open.
No screenshot baseline has been updated in Task 6.

The separate profile-editor disclosure request remains deferred.
