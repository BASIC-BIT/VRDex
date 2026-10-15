# Event editor identity and local-time checkpoint

BASIC approved the history indexing change, which is now applied. Tasks 1
through 6, whole-branch source review and the final scoped rereview are complete.
Both final findings, pending duration loss on TBA and equal-name linking intent,
are closed with no new findings. Final product source passed 56 covering browser
cases, 50 pure tests and 30 Linux editor snapshot comparisons. External PR, CI
and the 30-minute feedback gate remain pending.
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

The separate profile-editor disclosure request remains deferred. Final whole-branch review,
final CI and the PR feedback loop remain outstanding.

## Integration with current main

The feature branch now includes the public media details/history change from main.
The merge needed no conflict resolution and changed no feature code or tests.
Tasks 1 through 6 and the scoped Task 6 fix review are complete. Final whole-branch
review, PR, CI and the PR feedback loop remain pending. This is not merge-ready.

| Integrated check | Result |
| --- | --- |
| Web lint and types | Passed |
| Full web units | 731 passed, 0 skipped |
| Backend types and full tests | Passed; 1,490 passed, 0 skipped |
| API contracts | OpenAPI parity, types and 68 tests passed after local LF regeneration |
| MCP verification repeat | Types, 12 protocol tests, 261 script tests and local stdio smoke passed; one opt-in script case skipped |
| Production web build | Passed; existing middleware deprecation warning retained |
| Generated backend | Passed after coordinated stop; isolated one-shot health status was ok |
| Docs | Markdown lint and Docusaurus build passed |
| Nine combined editor flow files, desktop/mobile | 414 passed, 2 failed, 0 skipped, 0 flaky |
| Remaining lineup flow and asserted evidence cases, desktop/mobile | 53 passed, 1 failed, 0 skipped, 0 flaky |
| Three failing case names, both viewports, three unchanged traced repetitions | 18 passed, 0 failed, 0 skipped, 0 flaky |
| Public routes and public media details, desktop/mobile | 118 passed, 0 failed, 4 hosted-only skips, 0 flaky |
| Controller full Linux hard snapshots | 76 passed, 0 failed, 12 conditional auth skips, 0 flaky |

The combined run failed when community navigation returned `net::ERR_ABORTED`
and when staff slot removal found Generate disabled after filling Starts.
The latter snapshot showed only the footer after a navigation. The separate
mobile lineup case reached its second-save URL assertion while Review still
showed Saving. Each case passed three unchanged traced repetitions on both
viewports after the broad runs ended. Causes remain UNKNOWN. These covering
passes do not turn either broad run into a clean pass. No assertion, timeout,
threshold, product code or test code changed during integration.

The first API check compared generated LF output with CRLF checkout bytes.
Both exact committed blobs matched the generator; normalized original checkout
content matched too. Original bytes were backed up before local regeneration.
The API rerun passed without a normalized content change. The first MCP chain
passed its type and protocol checks, then one script subprocess-timeout case took
3,354 ms against its 3,000 ms bound. The unchanged focused case passed in 2,429 ms;
the final full-chain repeat passed that case in 2,804 ms. The original overrun's
cause remains UNKNOWN. The opt-in script skip requires `EVENT_PLAYBACK_PROOF=true`.
Hosted Streamable HTTP smoke was not selected, and the matrix check reads existing
evidence. Neither establishes new hosted-user or hosted-client proof.

The four public-route skips are the hosted-only anonymous API search and lookup
route/suggest cases on each viewport. The 12 snapshot skips remain the same six
Clerk-dependent routes per viewport. No golden changed. Hard thresholds and
explicit stage assertions stayed intact. The controller refreshed the Linux
source and ran its comparison; this worker did not run Docker tests.

Windows browser checks used the existing webpack web port 3186 and isolated
Convex ports 3290/3291. After the merge, the watcher compiled the added media index
and reported ready at 22:37:23 UTC. Both HTTP probes returned 200 before browser
checks. The controller stopped only its owned services for the production build
and generated check. The one-shot backend reported ready, returned health status
ok and exited; ports 3186/3290 had no listeners before controller restart.
The replacement backend reported ready at 22:53:13 UTC, and webpack web returned
ready after 4.4 seconds. Existing CLI deprecation, beta and update notices remain.
Backend authority tests use authenticated `convex-test` identities. Browser
fixtures substitute local transport. These remain local integration evidence,
separate from deployed HTTP or hosted signed-in acceptance.

## Execution decisions retained from the controller ledger

These eight rulings preserve the approved implementation refinements in their
original order. They do not add product scope. The direct human approval below
supersedes the earlier requirement to restore history wrappers on editor unmount.

1. **Preserve world associations.** Task 2 could change the existing nullable
   `worldSlug` command to distinguish omission from explicit clearing and retain
   untouched protected/private links. The risk was deleting a valid association or
   retaining one unexpectedly. Backend and browser readback coverage was required.
2. **Identify the represented world.** Authenticated editor readback could include
   `editableWorldAssociation` with its association ID and public world slug.
   Replacement/clear preserves every unrepresented link, including other public
   worlds, deduplicates a retained selection and refreshes its mapping after save.
   Public projections omit this metadata and private slugs. Fresh opens still use
   the first projected public world, without a persisted primary-world field.
   The risk was deleting the wrong link or misrepresenting a multiworld event.
3. **Use canonical lineup commands for deliberate browser edits.** New events and
   edited lineups could use the existing canonical command, while unrelated saves
   omit lineup and external legacy commands remain compatible. Stable authenticated
   association mapping preserves legacy identity, provenance and confirmation.
   Scoped snapshot IDs retain unrepresented protected/private links; represented
   explicit removals still delete. The risk was association, billing, provenance
   or confirmation loss. Repeated-save and protected-association tests were required.
4. **Resolve missing source zones explicitly.** An Unresolved time control could
   author missing canonical zone context. The normal zone selector stays display
   only; known source zones remain intact. No account preference write, discarded
   evidence or extra cascade was permitted. The risk was resolving a clock in the
   wrong zone. Tests require unchanged payloads before deliberate source resolution.
5. **Retain invalid clock buffers before hiding time.** Pending invalid clocks
   block Time TBA and display-zone changes, retain timing/backups and focus the
   input. A visible Cancel action complements Escape. The cost is one extra action
   before choosing TBA after invalid input. Both recoveries and exact TBA restoration
   require coverage.
6. **Use public cancelable traversal.** Task 6 could use the Navigation API plus a
   public history fallback after framework listener order defeated a later editor
   listener. No private framework keys or navigation trap was permitted.
   Noncancelable browser traversal can escape. The risk was lost edits or broken
   history. Real Back/Forward, repeated cancel/accept and absent-API tests were required.
7. **Capture before hydration.** The standard instrumentation-client bootstrap
   could install one inert page-lifetime popstate dispatcher, idempotently.
   Editor delegates, dirty closures and editor-specific listeners still detach.
   This ruling initially also required wrapper restoration on editor unmount;
   ruling 8 and direct human approval supersede that part. The risk was app-wide
   navigation regression or stale blocking. Normal-page and unmount coverage was required.
8. **Index public history for the page lifetime.** Public `pushState`/`replaceState`
   wrappers and position tracking could remain in the same bootstrap. They preserve
   caller/framework state, never interpret private keys or rewrite unrelated older
   entries, and never guess an unknown traversal direction. Editor state still
   cleans up. The risk was app-wide history regression. Two automatic-review
   rejections held this change until BASIC directly approved the exact two-file
   proposal and granted bounded standing authorization. That approval is recorded
   in the [history indexing decision](./event-editor-history-indexing-proposal.md).
   Repeated Back/Forward, multi-step and unknown-entry coverage proves the current
   contract; browser-controlled escape remains a limit.

## Integration evidence reference

The feature pre-merge head was `effaefeb7d89f76336d8aeadfba318f1c013d156`.
Refreshed main was `ebd4ef1a77b1b76d7a309d83e24d2e94bfcaafd3`, with merge
base `21e48169d4f0cd54e55bbe48b1662ff128c8fe7f`. Exact integrated source was
`9b79f286b7f1104d2aa041e26f99bf84231c5b03`. The normal merge had no conflicts
or deleted paths. Later evidence-only documentation does not change that source.

Current local result files under `apps/web/test-results/` are
`integration-combined.json`, `integration-lineup-evidence.json`,
`integration-failure-covering.json`, `integration-public.json` and controller-owned
`integration-linux-snapshots.json`, with matching logs. Unique browser output
folders use those same run names. HTML reports are under the ignored root
`.tmp-gh-artifacts/event-editor-identity-local/reports/` with the same names,
except the controller's Linux report remains with its runtime artifacts.
`integration-checks/` holds exact static, API/MCP, build, generated and docs logs.
The plan-owned `integration-report.md` retains exact commands, timestamps and
failure dispositions. Original generated/OpenAPI bytes and equality manifests
remain in plan-owned scratch. None of the generated line-ending noise is committed.

## Final whole-branch fix wave

The whole-branch review found pending duration loss during Time TBA conversion
and equal-name manual linking that created an unintended billing override.
The focused fixes block TBA before any pending duration can unmount, reveal
Lineup and the control's disclosure, and focus its retained raw input. A valid
commit or Escape permits conversion and exact restoration of surviving timing.
Display-zone conversion keeps its existing pending-clock guard. Optional clear
and explicit row removal keep their existing behavior.

A manual name equal to the selected profile name now starts with default billing.
A differing name remains an override. Already-explicit overrides retain their
intent even when the text equals a profile name.

The corrected browser RED matrix failed all six desktop cases at the expected
TBA assertion before production edits. The final bounded run passed 56 cases,
with zero skips, failures or flakies, across desktop and mobile. This includes
12 new regressions: intake compact duration and staff compact/detailed duration,
each with Escape and valid-commit recovery from a successfully saved clean
baseline. They assert raw pending input, focus, dirty state, row identity and
persisted canonical timing through the TBA round trip. Existing source-buffer,
optional-clear, removed-row, precise-duration and local-time cases also passed.
Pure identity/time/persistence/lineup tests passed 50 of 50. Web lint, web types
and documentation lint/build passed.

The first GREEN attempt passed 11 of 12. One mobile staff fixture never rendered
the editor and timed out before its initial Ends edit. Its unchanged target
passed after route warmup, and the full bounded final run also passed it. The
initial cause remains UNKNOWN. Type generation completed before the final browser
run. No timeout or assertion was relaxed. Earlier broad browser and script
UNKNOWN failures above remain unchanged.

Browser JSON and output folders are `final-fix-tba-red3`,
`final-fix-tba-green1`, `final-fix-tba-target` and `final-fix-covering` under
`apps/web/test-results/`. HTML uses matching names under the ignored root
`.tmp-gh-artifacts/event-editor-identity-local/reports/`. Plan-owned
`final-fix-report.md` records setup corrections, exact commands, logs and final
commit. Screenshot inspection confirmed the focused raw duration and visible
Lineup disclosure on mobile staff and desktop intake. No visual baseline changed.

This wave starts at `32bb10c44b2ebaee0cb1d6ca5728d43122a02ac8` and changes web
source, focused tests and behavior/checkpoint docs only. All seven generated and
OpenAPI status entries retain empty normalized diffs and remain excluded.
The earlier integrated-source Linux proof is at
`9b79f286b7f1104d2aa041e26f99bf84231c5b03`.

### Final source review and Linux receipt

Final product source is `1e7a325a6e8373182d909cde13622499b8ac5619`.
The fresh scoped rereview closed I1 and M1 with zero new findings. Its source
verdict is separate from external PR readiness. The 56 covering browser cases
and 50 pure tests above apply to this product source.

The controller refreshed Linux to that exact source, confirmed the backend ready
at 23:14:47 UTC and received HTTP 200 from the web runtime. The affected
`event-editor.snapshots.spec.ts` hard comparison passed 30 cases with zero
failures, skips or flakies and no baseline updates. It started at
2026-10-15T23:15:03.324Z and took 41.821 seconds. Actual JSON and log are
`apps/web/test-results/final-linux-editor-snapshots.json` and
`apps/web/test-results/final-linux-editor-snapshots.log`.

The controller also inspected the two pending-TBA images and confirmed focused
`45.5`, revealed Lineup, retained committed ranges and contained layouts. Earlier
UNKNOWN failures, hosted-auth limits and deferred profile-editor cleanup remain
unchanged. External PR, CI, mergeability and the 30-minute feedback gate remain
pending. No merge-ready, hosted-user or production acceptance is claimed.

## PR 374 external feedback correction

The review of head `7bcda74d5c0a4248a1c395ad09eb64b976f87d35` found that
existing timed events without a stored timezone could not save. The staff editor
now preserves their known absolute instants and missing source zone through
opening, display conversion and unrelated saves. Starts, end, doors and preview
use the editing zone for presentation. Deliberate clock edits establish missing
source context in that selected zone and reproject untouched controls. Only a
Starts edit runs the lineup cascade.

Seven new browser cases cover unrelated saves, clean display conversion, exact
TBA restoration and deliberate Starts, Ends and Doors edits. The optional-clock
cases include a Los Angeles display on the previous calendar day. All 14 cases
passed across desktop and mobile with exact subminute timestamps and retained
association IDs. Existing date-only Starts authoring and unresolved contributor
clock cases also passed. The initial RED run failed four of five desktop cases
before the production fix. Starts already passed.

The four-file covering run passed 116 cases and failed six. The failures were
three older validation tests on both viewports. A bounded comparison against
unchanged head reproduced all three on desktop. They assumed the browser used
the source zone and selected an ambiguous Details disclosure. Their correction
pins the intended DST zone, targets the timing disclosure and retains pending
raw input, rejection, focus and Escape restoration checks. All six corrected
viewport cases passed. The earlier 116/6 run remains a recorded failed run.

CI run `38822867515` also exposed outdated public editor selectors, a scheduling
snapshot captured during community hydration and two contribution locators.
Public editor coverage now uses the approved community summary, Where chooser,
doors disclosure and Performer control while retaining generation bounds,
reset cancellation, Review, publish and Advanced assertions. It passed both
viewports. Contribution coverage waits for the selected community presentation
and scopes validation status to its exact message. Both cases passed on both
viewports. Scheduling snapshots wait for the known community title in Details
and preview. Their four Windows assertion cases passed with pixel comparisons
disabled. No golden or threshold changed. The controller still owns the new
Linux hard comparison and external PR readiness checks.

The pure editor time, identity, persistence and lineup-adapter tests passed
34 of 34. Web types, web lint, Markdown lint and the Docusaurus build passed. Screenshots of the corrected missing-zone view were inspected on both
viewports. These browser fixtures use the actual editor with local substituted
transport. Backend source permits omitted timezones for known timestamps;
legacy `slotLinks` still requires a zone when submitted. The unrelated browser
save omits lineup changes. No backend or publication rule changed, and this
correction adds no hosted-user or production evidence.

Local browser JSON and output folders use `pr374-timezone-red`,
`pr374-timezone-green1`, `pr374-timezone-covering`,
`pr374-validation-baseline`, `pr374-ci-test-fixes`, `pr374-public-visual`,
`pr374-contribution`, `pr374-contribution-green`,
`pr374-scheduling-assertions`, `pr374-scheduling-assertions-final` and
`pr374-scheduling-assertions-green` under `apps/web/test-results/`.
The ignored delivery directory
`.tmp-gh-artifacts/event-editor-identity-local/` holds exact commands, logs,
intermediate assertion corrections and `pr374-timezone-fix-report.md`.
HTML reports use its `reports/` subdirectory. Earlier UNKNOWN failures and
hosted-auth limits remain unchanged. The seven generated/OpenAPI entries still
have empty normalized diffs and are excluded from this correction.
