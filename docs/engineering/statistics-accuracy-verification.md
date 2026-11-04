# Statistics accuracy implementation verification

Implementation of the [approved design](../superpowers/specs/2026-11-02-statistics-accuracy-design.md) and [plan](../superpowers/plans/2026-11-02-statistics-accuracy.md), November 2, 2026. Delivery: [PR #417](https://github.com/BASIC-BIT/VRDex/pull/417).

## Independent review

A fresh reviewer inspected the implementation branch against the design and reproduced four important defects before acceptance. Each was reproduced in a failing regression, corrected, and rerun successfully:

| Finding | Correction and evidence |
| --- | --- |
| An invalid-only event timestamp did not break persisted recap continuity. | Reset the carried endpoint. Preview and persisted results agree for observed/unknown/observed timestamps, including page boundaries. |
| A recap returning no output could be marked corrected. | Reject date-only targets and require a matching integration, event, bucket, version, and recent computation before correction. |
| A replacement job could be ignored by repair status. | Track the current job by event identity and validate its integration and bounds. A replacement remains pending. |
| Background work inherited the interactive coverage-window cap. | Use indexed outage-barrier existence probes per eligible pair instead of materializing every window. Test more than 1,000 windows with and without an outage. |

The failure-path regression also verifies that scheduled continuation errors are retained on the job, shown as failed in repair status, and restartable by an explicit retry. The reviewer independently inspected the desktop screenshot and confirmed an outage gap without a synthetic zero. The follow-up fixes were verified by tests; a second independent approval was not claimed.

Review regressions live in `tests/backend/community-telemetry-repair.test.ts`; all seven tests pass. The branch was subsequently integrated with current main. Its sole conflict was the old five-minute boundary-read literal, resolved to the approved shared six-minute constant.

## Local checks

| Check | Result |
| --- | --- |
| Focused backend statistics, queries, summaries, recaps and repair | 70 passed |
| Web suite | 1,095 passed |
| Collector suite | 257 passed |
| Operator CLI argument/manifest tests | 2 passed |
| Desktop/mobile Storybook outage-chart assertions | 2 passed; screenshots inspected |
| Backend and web TypeScript | Passed |
| Web lint | Passed |
| Isolated local Convex compilation, schema/index validation and health | Passed |
| Windows-compatible backend suite | 3,091 passed, 5 failed; Linux-only Twitch test file excluded |

The five backend failures are in unchanged tests for the VRCDN hold-program encoder, renderer transition anchors, two broadcast-worker admission failures, and the public artwork route. The artwork subprocess fails because its Windows absolute import is not a file URL. These failures prevent claiming an entirely green local backend suite; they were not changed as part of the statistics repair.

Hosted CI is separate evidence. Browser and visual labels select it for this PR. No merge-readiness claim follows from this document.

Hosted review later reproduced a future-dated observation overriding a current count and an ordinary recap job stopping after a page failure. Current dashboard reads now end at the request time and require a fresh selected observation. Recap continuations retry after one, two and four minutes, retain exhausted failures, and restart failed calculations. Regressions verify future-only data is stale, exact-now counts remain visible, retries are bounded, and ordinary jobs recover without a repair inventory. Related telemetry/staff suites passed 56 tests; backend types and Markdown lint passed. The remaining backend guide references were aligned to the six-minute rule.

## Implementation adjustments

- Native PowerShell maintained the execution ledger after the Bash bookkeeping helper failed to create its Windows path under the sandbox. This changes no product behavior.
- Unrelated default README/config and line-ending rewrites from local Convex initialization were restored. The intentional generated API entry was retained; local compilation passed.
- Background coverage uses the existing state/time indexes rather than a persisted coverage cursor. Each candidate interval adds up to four indexed barrier probes. This avoids the window-count failure while preserving the same outage rule; the production canary must still assess cost at real history volume.

## Remaining release work

Production deployment, production dry-run inventories, historical apply, and runtime acceptance of corrected production totals have not occurred. They retain their separate approvals. The canary starts with BITRATE and Faceless and must compare raw observations, corrected persisted buckets and the signed-in UI before expansion.

Raw observations, publication settings and presentation epochs remain unchanged. Recalculation can recover boundary time and correct coverage arithmetic, but it cannot recover guests omitted by the pre-414 collector. During an approved rebuild, old and corrected buckets coexist until their targets finish; queued or failed work is not reported as corrected.
