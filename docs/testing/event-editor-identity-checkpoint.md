# Event editor identity and local-time checkpoint

BASIC approved the history indexing change, which is now applied. Its current
covering checks are recorded below. Controller review remains open.
The earlier broad browser run passed 418 of 422 cases. Its covering rerun passed
18 of 18; that does not turn the broad run into a clean pass.

## Behavior and remaining limit

Both editors confirm slot removal and protect authored changes, including pending
clock, duration and name-override input. Successful requests record only their
submitted baseline. Newer local edits survive source/save completion. Publication
followed by Stay retains event identity and uses the authorized edit command with
its current revision and field restrictions.

Native unload confirmation, shell links, explicit exits and cancelable Navigation
API traversal are covered. Public history indexing now starts before hydration
and remains for the page lifetime. Editor delegates and dirty handlers still
clean up on unmount. The [approved indexing decision](./event-editor-history-indexing-proposal.md)
records the direct approval and its bounded standing scope. Unknown entries
pass through without guessed replay. They can trigger framework document
navigation and native unload confirmation. Noncancelable browser traversal
remains a compatibility limit.

## Verification

| Layer | Executed result |
| --- | --- |
| Web lint and types | Passed again after history indexing |
| Web units | 726 passed, 0 skipped |
| Backend types and full tests | Passed; 1,472 tests, 0 skipped |
| Web build | Passed again after history indexing |
| Generated backend check | Passed against the coordinated isolated local backend |
| Docs | Passed after approval, behavior and checkpoint updates |
| Focused persistence | 5 passed, repeated after history indexing |
| History fallback and native-refresh covering run | 16 passed, 0 skipped, desktop and mobile |
| Pre-review history/editor/lineup covering pair | 112 passed, 0 failed, 0 skipped, desktop and mobile |
| Review-fix guard/lineup covering pair | 120 passed, 0 failed, 0 skipped, desktop and mobile |
| Focused authority/association tests | 91 passed using `convex-test` authenticated identities |
| Final combined desktop/mobile browser run | 418 passed, 4 failed, 0 skipped |
| Covering repeat run | 18 passed, 0 skipped; three case names, two viewports, three repeats |
| Recent-search reopen carry | 2 passed, desktop and mobile |
| Linux asserted visual captures | 34 passed, 0 skipped |
| Linux editor hard-golden comparison | 30 passed, 0 skipped |
| Full non-Storybook snapshot comparison | 76 passed, 0 failed, 12 conditional auth skips |

The earlier broad run excluded the then-held `history fallback` cases. Two failures were
obsolete Lineup-focus expectations after a rejected Starts edit. Their corrected
tests require Details, focus, the exact rejected raw input, invalid state and
unchanged canonical readback after Escape. The other two failures were an initial
identity search with no options and a revision fixture stuck at Loading. Both
passed three repetitions per viewport without changed assertions. Cause: UNKNOWN.

After indexing was approved, the first new covering pair passed 101 cases and
failed three. Two unknown-entry tests read state during the expected document
reload; waiting for the destination fixed that test synchronization. One desktop
staff native-refresh case lost its edited title after dismissal. Its cause is
UNKNOWN. The unchanged case passed in the focused 16/16 run and the final 112/112
covering pair. Neither result erases the earlier failure.

Scoped review found two unsaved-work defects. Accepted traversal left approval
active when the same editor stayed mounted, and compact duration controls dropped
blank invalid input on blur or Enter. Both are fixed. Approval now covers one
attempt, with separate native-unload and traversal handling. The capture callback
receives the prior public position, so same-component pushes cannot leave a stale
traversal distance. Blank and whitespace duration input stays dirty until Escape
or a valid commit; detailed controls retain their explicit clear operation.

The new regression cases reproduce both findings before the fix. The final
120-case covering pair also checks accepted clicks canceled by another handler,
immediate native reload protection and accepted native document exits with one
confirmation. Earlier failures and their causes remain in the Task 6 report.
The existing middleware deprecation warning is deferred, and no unrelated backend
or visual suite was repeated for these fixes.

The fallback cases remove the Navigation API before bootstrap. Both editors
retain URL, values and caller/framework state through repeated Back, Forward and
two-step cancellation. Separate cases accept each direction once, then navigate
cleanly after editor unmount. An entry created before bootstrap escapes through
native unload with exactly the requested history.go call and no guessed replay.

The full snapshot lane skipped six routes on each viewport because Clerk credentials
are unavailable: submit, sign-in, account-signed-out, event-new-signed-out,
developer-tokens-signed-out and developer-oauth-apps-signed-out. These were not
executed or accepted as hosted auth evidence.

The 91 authority tests execute backend functions in `convex-test` with authenticated
identities. They do not establish deployed HTTP or hosted signed-in browser proof.
Browser fixtures exercise the real components with local substituted transport;
Linux and Windows runtimes provide local rendering and integration evidence.
There is no production deployment or hosted-user acceptance claim.

## Visual evidence

Worker and controller inspection covered desktop/mobile and light/dark Details,
Lineup, Review, community/world results, optional times, unresolved/repeated clocks,
removal, import errors and scheduling conflicts. Translucent identity menus showed
underlying labels; the existing opaque elevated token fixed that defect. The old
transparent captures are rejected.

Portable inspected examples:

- [Details with optional times](./assets/event-editor-identity/identity-details-mobile-dark.png)
- [Community results](./assets/event-editor-identity/community-picker-mobile-dark.png)
- [World results](./assets/event-editor-identity/world-picker-mobile-light.png)
- [Removal confirmation](./assets/event-editor-identity/remove-slot-mobile-dark.png)
- [Review with identity artwork](./assets/event-editor-identity/identity-review-desktop-light.png)
- [Unresolved repeated clock](./assets/event-editor-identity/unresolved-clock-mobile-dark.png)
- [Staff mobile Lineup](../../apps/web/e2e/__screenshots__/mobile-chromium/staff-edit-dark-lineup.png)
- [Staff desktop Review](../../apps/web/e2e/__screenshots__/desktop-chromium/staff-create-light-review.png)

Linux captures used commit `906d4bc8bbd03f3df6b017e4087fb61836a8acd1`.
The later snapshot test change requires the intended panel before capture.
Successive hard comparisons rejected four newly generated Lineup/Review baselines
that had captured Details. Only those four wrong-stage images were replaced with
inspected actuals of their intended stages. Hard screenshot thresholds are unchanged.

## Evidence provenance

Local artifacts live under `apps/web/test-results/`:

- `task6-combined.json`: first combined run, 397 passed and 17 failed.
- `task6-covering.json`: integration-fix coverage, including the newly exposed
  removal-dialog focus failure; `task6-evidence-ready.json` records its fixed run.
- `task6-final-functional.json`: earlier broad 418/4 result.
- `task6-history-covering.json`: 101 passes and three failures described above.
- `task6-history-focused.json`: 16 passing fallback/native cases, with traces.
- `task6-history-final.json`: 112 passing editor/lineup cases after indexing.
- `task6-review1-red.json`: six reproduced review failures before fixes.
- `task6-review1-focused.json`, `task6-review1-corrected.json` and
  `task6-review1-attempt.json`: intermediate failures and corrected implementation
  boundaries, explained in the Task 6 report.
- `task6-review1-green.json`: 120 passing guard/lineup cases after review fixes.
- `task6-final-covering.json`: 18/18 covering result with traces.
- `task6-linux-captures-final/` and matching JSON: 34 asserted visual cases.
- `task6-linux-golden-compare/` and matching JSON: rejected wrong-stage comparison.
- `task6-linux-editor-accepted.json`: 30 passing hard editor comparisons.
- `task6-linux-all-snapshots-final.json`: 76 passes and 12 conditional auth skips.
- HTML reports are separate folders under `task6-reports/`, except the traced
  covering report, preserved at
  `.tmp-gh-artifacts/event-editor-identity-local/reports/final-covering/index.html`
  relative to the repository root. Its generated JavaScript otherwise enters the
  web lint tree. New history reports also use that ignored root reports folder.
  Exact lint passed after moving the original report; no rules changed.
  Logs are named `task6-*.log`. These ignored artifacts are local evidence, not
  portable CI links.

An early Task 6 run omitted an explicit output directory and removed ignored prior
Task 3/5 screenshots and the Task 5 `task5-r1` JSON. Their SDD reports and review
records survive, but the missing images cannot support this checkpoint. Every
later run uses unique output and separate report directories. The images linked
above are new tracked artifacts and survive SDD scratch cleanup.

The separate profile-editor disclosure request remains deferred. Controller review,
final CI and the PR feedback loop remain outstanding.
