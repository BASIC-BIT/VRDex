# PR #388 CI triage

PR: [#388](https://github.com/BASIC-BIT/VRDex/pull/388)
Run: [40398508442](https://github.com/BASIC-BIT/VRDex/actions/runs/40398508442)
HEAD: 4e4ed7af635af8d72b2cee273d9de29ce381f080
Baseline comparison: db9abbc (local existing commit; no fetch or checkout).

19 jobs: 5 success, 4 failure, 10 skipped. This run is not merge-ready.

## Failures

1. **Typecheck Backend**: the actual `Run backend typecheck` step PASSED (`tsc --noEmit --project convex/tsconfig.json`). The later `Run backend unit tests` failed: 2015 tests, 1843 passed, 172 failed, 0 skipped. Every failure summary reports `Error: Unproved broadcast configuration`. First: `tests/backend/event-api-ownership.test.ts:2:17205`, “cancels scheduled media work and requests a stop for active media”; stack starts `workers/restream/broadcast-capacity.mjs:17:23` -> `convex/events.ts:3814:63`. Temporal runtime/inference tests did not execute after this failure.
2. **Verify API and MCP**: `Run MCP package verification` failed in the script suite: 973 tests, 947 passed, 20 failed, 6 skipped. All 20 failure summaries report the same `Unproved broadcast configuration`. First: `tests/scripts/event-media-bridge-lifecycle.test.mjs:85:1`, “RunTask propagates the ownership tags from its registered task definition”; stack reaches the resolver through `tests/scripts/_event-allocation-fixture.mjs:15:17`. 19 failed tests are in event-media-bridge-lifecycle; 1 in event-media-lambda-bridge. This matches the supplied host script failure counts.
3. **Verify Backend Local**: preflight, backend bootstrap, and generated-file checks PASSED. Convex functions were ready and health was `ok`. Safe artifact now confirms the later rehearsal failed at `protocol-lifecycle`: `events:scheduleEventMediaWorker` rejected with `unproved-broadcast-configuration`. The driver completed historical migration evidence (162 migration calls) before this failure. Its 14 earlier backfill RPC errors are expected rejection scenarios; they are not the terminating cause. Driver cleanup passed and deleted 47 fixture records. Phase/recovery receipts prove fixture cleanup, empty manifest, both temporary binding removals, and private-file removal. Recovery status passed; work/backend closures passed with no remaining processes or listeners. Phase native exit was 1, with no timeout or overflow. Artifact verified at 12359 bytes, SHA256 `239c8a39b9140df75f53b2652a12fe50d1ca0d08ee809da5169c5bea02607cd7`, safely extracted to migration-evidence/.
4. **PR Verification Report**: aggregation failed with exact error `verify-api-mcp must succeed; received failure.` This is a downstream enforcement failure, not a fourth source defect.

## Capacity root and attribution evidence

`workers/restream/broadcast-capacity.mjs` defines `MEASURED_ALLOCATIONS = Object.freeze({})`; its resolver throws `Unproved broadcast configuration` for an absent preset/simulcast entry. The backend caller and script allocation fixture use this production resolver. All 172 + 20 recorded failures have that error; there is no other summarized exception class.

Read-only Git object comparison proves 19 relevant files are byte-identical between db9abbc and HEAD: the capacity/profile modules, convex/events.ts, allocation fixture, all 11 failing test files, migration runner, CI workflow, package.json and lockfile. Full blob IDs are in baseline-comparison.json. These capacity failures are therefore rooted in pre-existing baseline code/fixture wiring, with no diff to these failure paths from the five authority modules. None of the summarized failure stacks names one of those five modules. This supports baseline-rooted capacity failure attribution; it does not claim an observed green/red baseline rerun, because no baseline suite was executed. Migration artifact independently confirms the same production resolver rejection in its first protocol-start attempt. Its raw exception is intentionally discarded, but the bounded RPC reason identifies the exact schedule rejection.

## Passed and skipped checks

Lint Web, Typecheck Web, Verify Docs, Select Visual Evidence and Restream Local Checks jobs succeeded. Restream Local Checks skipped its install/typecheck/test/image/local-validation steps according to its change selector, so that success is not evidence those checks ran.

Build Web was skipped because its required backend/API dependencies failed. The Storybook and Playwright optional jobs were skipped by their selection/dependency conditions; no browser, image diff or preview pass can be claimed. Deploy Convex Production was skipped because this is a pull_request event (its workflow requires a push to main), also downstream of Build Web. Ten total skipped jobs are enumerated in jobs.json.

## Before merge

- Keep production capacity admission closed until measured allocations exist; decide how the local migration protocol rehearsal obtains an explicit synthetic admitted-session fixture without pretending that production capacity has been measured. Historical migration coverage and cleanup already passed.
- Address the pre-existing empty capacity map / test fixture authority conflict through the intended measured-allocation and test seam process. Do not blindly populate production capacity entries to silence failures.
- Rerun backend unit tests, MCP verification, and local migration; then allow Build Web and consolidated report to execute successfully. Temporal tests still need to run.
- Treat optional browser/visual jobs as unexecuted; select them if the merge scope requires their evidence.

Raw sources retained: run.json, jobs.json, artifacts.json, run-logs.zip, extracted logs/. Failed individual job download placeholders may be empty; authoritative logs are in the successfully downloaded run archive. Artifact download initially failed through gh but a parent-provided connector fallback succeeded; migration-evidence.zip and extracted JSON receipts are authoritative. No source/index/branch edits, suites, external comments, reactions, or messages were performed.
