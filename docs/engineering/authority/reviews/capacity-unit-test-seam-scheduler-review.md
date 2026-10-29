# Task 1 independent spec and quality review

SPEC verdict: PASS for the frozen Task 1 implementation.

QUALITY verdict: PASS. No actionable findings.

This is an independent review of the uncommitted 13-file subject against Task 1's brief, its verbatim Global Constraints, and the complete canonical design at `docs/superpowers/specs/2026-10-26-capacity-unit-test-seam-design.md`. I read `AGENTS.md`, the implementation report, the review package, the hash manifest, all changed hunks, and the relevant scheduler, capacity, allocation-validator and direct bridge-call context. BASE and HEAD both equal `383288f4ac16fd847eb6e34facbe82d85d955ac2`.

## Findings

SPEC findings: none.

QUALITY findings: none.

## Reviewed behavior

- The production capacity module has exactly the requested `CapacityInput`, `CapacityResolver`, readonly entries, resolver result, explicit inner input and production/default parameter JSDoc annotations. A comparison after removing comments and whitespace confirms its runtime text is identical to BASE. `MEASURED_ALLOCATIONS` remains empty, and no test data or capacity authority enters production through imports, RPC arguments, environment values or database rows.
- `createScheduleEventMediaWorker(resolveAllocation: typeof resolveWorkerAllocation)` returns the complete inferred `mutation` registration. A mechanical comparison confirms that the only scheduler changes are the factory wrapper, the two resolver dependencies, and the default binding. The existing authentication, event and output authority, time, open/claimed session, immutable settings and frozen destination logic are intact. Initial allocation uses `resolveAllocation`; both new and scheduled existing sessions pass through `validateMeasuredSnapshot(validateAllocationSnapshot(...), resolveAllocation)` before scheduling writes. The default registration remains `createScheduleEventMediaWorker(resolveWorkerAllocation)`.
- The ordinary factory remains in `events.ts`. There is one source-level default schedule registration. The factory has no public resolver argument and no explicit broad result annotation. No new casts, `any`, packages, module mocks, mutable resolver setters, generic fixture framework or authority overrides were introduced. This source conclusion does not establish the analyzed deployed function set.
- The test resolver covers every key of the six-entry `VIDEO_PROFILES` map crossed with both boolean simulcast states. Each entry is literally `{ cpuUnits: 4096, memoryMiB: 8192, evidenceId: "fixture-capacity-v1" }`. `allocatedSession` uses this resolver, with its options explicitly typed. Synthetic evidence is confined to tests.
- The one named loader lazily imports the real events module, spreads its exports, and replaces only `scheduleEventMediaWorker` with a factory result bound to the fixture resolver. It neither mutates the namespace nor shares mutable resolver state. Seven listed backend fixture maps use that exact loader and retain their other entries and calls to the real schedule API.
- Fresh production rejection captures complete session/program/command/audit rows before and after. Persisted rejection uses a test-module-only alias alongside the original production registration in one database, creates the admitted session through the real fixture-bound scheduler, verifies the literal allocation, then checks production rejection and deep equality of all four row collections. This exercises the existing-session path rather than seeding around admission.
- The isolation test creates independent production and synthetic instances, admits synthetic scheduling first, restores each fixture's account binding for its invocation, and then requires production rejection with unchanged scheduling state. Account binding remains output authorization, never capacity authority.
- The validator-preservation test independently corrupts a syntactically valid allocation evidence ID and the stored destination profile. It requires the specific real errors `Unproved allocation snapshot` and `Mismatched destination profile`, respectively, and full scheduling-state equality after each rejection. The evidence case reaches measured validation; the profile case reaches structural snapshot validation.
- Existing negative assertions and fixture setup are preserved in the migrated backend files. The settings expectation alone changes from production resolver output to the explicit fixture resolver. The two output-test and one media-worker-test `taskDefinitionFor` calls deliberately pass that same fixture resolver through the existing third parameter, matching their synthetic snapshots. Their secret-binding and destination assertions remain intact; the real structural and measured validators still execute in `taskDefinitionFor`.
- The narrow direct-seeded control fixture and generated API are unchanged. The changed-file set contains no actual-admission migration contract, historical fixture, receipt, schema, production bridge, packaging or CI changes. The positive whole-flow production-admission gate remains blocked on measurements and red under its unchanged contract.

## Verification evidence and limits

I inspected the recorded logs and exit files, including the meaningful RED failure caused by the missing factory/loader. Recorded results are 1 pass and 3 expected failures before implementation; 32 of 32 focused tests passing; backend typecheck and its normal guard passing; and 4 of 4 admission tests passing after the final test-only named-loader change. The final rerun is explained by that concrete test-file change. All nine evidence files match the manifest by SHA-256, byte count and mode.

I did not rerun application tests or typecheck on the same code. Read-only checks performed during this review reconstructed all 13 review-package subjects from BASE and compared them with the actual worktree, verified all manifest identities, confirmed capacity runtime equivalence, confirmed the exact scheduler transformation, passed `git diff --check`, and confirmed no diff for `convex/_generated` or `tests/backend/event-broadcast-control.test.ts`.

The affected/full backend and scripts suites, unchanged control-fixture execution, MCP and Temporal verification, Task 2 bridge evidence, and supported local runtime/API analyzed-function checks remain OPEN. In particular, unchanged generated files and source inspection do not prove that the factory is absent from analyzed function names. This Task 1 review establishes neither integration nor merge readiness, and claims no positive whole-flow production admission.

## Checked identities

The working source set is exactly 11 tracked modifications plus the two declared new backend files. Every listed source matched SHA-256, bytes and mode from the frozen manifest during this review.

| Source | SHA-256 |
| --- | --- |
| `workers/restream/broadcast-capacity.mjs` | `672c4d16fecf0d512555b252b2d054d501157c1739339667b3bf9f40a80ec280` |
| `convex/events.ts` | `4983ae19282be9479909b06eebb75cd06f0dee738b01d08136581a5d351fb023` |
| `tests/scripts/_event-allocation-fixture.mjs` | `a8731c36c02fdd3ed95fddfeb0ce90f2787df58ea0a97b9a1e59d75999268c58` |
| `tests/backend/_eventCapacityFixture.ts` | `7588f6ad62c5ab8a7b6f4a0ccc01e9c49f9f0252cb5ed06a5710365489a52720` |
| `tests/backend/event-broadcast-capacity-admission.test.ts` | `76c2a30c08c002892300d7d5764eeb83199ff4a60c464bd8b9136669264c99a8` |
| `tests/backend/event-api-ownership.test.ts` | `e5695d19af82e82566230833e5d8b64ffae09a78443e5f21b3d3f1b41ee2f7eb` |
| `tests/backend/event-broadcast-worker.test.ts` | `d85170ec11979f7fd55dcfc0ed6e45767a9735d02d6eaa1f8b0444197f384bd3` |
| `tests/backend/event-media-worker.test.ts` | `9fab0d937855d5b1d9d1df2d07d985312e397a1dbc8012e0459551f14aff9475` |
| `tests/backend/event-broadcast-settings.test.ts` | `21e9f7dee6a553c50496282cbcaa3b89b745de6f297f1e2430e52fcbf1dd1105` |
| `tests/backend/event-broadcast-output.test.ts` | `fd269904922f19434f900a49aa31784d4888a4deaf70a67ec2af14b2fed90ffa` |
| `tests/backend/event-broadcast-sources.test.ts` | `51ffab337e3428e56bdddcb6c99c1cc0693029e35b5f46ee47f1d7cbc7ae4708` |
| `tests/backend/event-corrections.test.ts` | `1a9292c85cd2a121dc2ede740590062cba0469d35571d17ffb857dd734a0aa03` |
| `tests/backend/event-output-authorization.test.ts` | `bf7b5e1e505a1edda4da89b8261c922a0b7ea6632fb1b2d5b177327dbfbc2edd` |

| Review input | SHA-256 |
| --- | --- |
| `AGENTS.md` | `52312bbad25f39e032e42183e9413ff8929e05bbb2931f2bdb8d8166976fc64f` |
| `docs/superpowers/specs/2026-10-26-capacity-unit-test-seam-design.md` | `63ada4161c75716f0c23cd5ef0389b71244a3d608530574a9b010bd496946f56` |
| `.superpowers/sdd/capacity-unit-test-seam/task-1-brief.md` | `e78a673d569e2be4c55ea63fb23c1e84bae54fa20e1a88aca43aa69daf579370` |
| `.superpowers/sdd/capacity-unit-test-seam/task-1-report.md` | `3b1782b27eb51a6440251f241619200a8e6e05ffd46f4ae01c6abec46d355f3e` |
| `.superpowers/sdd/capacity-unit-test-seam/task-1-review-package.diff` | `62680e83fe862a495a8cbafe9ad85ea4b6c13a6fe054b25382e627f65f9e2e9a` |
| `.superpowers/sdd/capacity-unit-test-seam/task-1-worktree-hashes.json` | `09ec302c50dd961879139a47f902f21bd720da6b71868ed37d565a75aea1414d` |

The nine evidence identities are the exact entries in the verified manifest above, including the implementation report. Only this review document was written by this reviewer. No source changes, commits, network requests, services or provider operations were performed.
