# Task 2 independent SPEC and QUALITY review

Reviewer: `/root/review_capacity_bridge_seam`, independent of the implementer. Reviewed on 2026-10-26. No subagents.

SPEC verdict: PASS.

QUALITY verdict: PASS.

Findings: none. No required corrections or unresolved Task 2 concern found in the frozen four-file subject.

## Reviewed identities

Base and observed HEAD: `dc249a52a9463d7f38be2db8a2935bba202a20c8`. The subject is four uncommitted files against that base. I verified every file and evidence entry against the handoff manifest, including byte count, SHA-256 and mode. All matched. All four filesystem modes are `0o600`; the Git diff retains `100644`.

| Path | SHA-256 |
| --- | --- |
| `scripts/event-media-ecs-bridge.mjs` | `3b1d3bf0eab43479f0100a984711cb2d100695cd93826e9e18863529e677efd7` |
| `tests/scripts/event-broadcast-capacity.test.mjs` | `50f99ffd727df33556c5fc13fd831aec33b4e948f1d6b7d718bc449a279a30c6` |
| `tests/scripts/event-media-bridge-lifecycle.test.mjs` | `ffb9237df0ad83fb742dd3f5bf88c7efe943cc3d0acb1c7cfbe8d67c7849594d` |
| `tests/scripts/event-media-lambda-bridge.test.mjs` | `7c5c4bcbe620b4d601190e53165971bbdc666a74dc99cce6a1d6c06f6601ee51` |

The packaged diff, after its commit/stat preamble, exactly matches `git diff --unified=10` for the four paths. Package SHA-256: `f0f1eae8c92cb716b4f6ea73491d8bc08194316a12141722b708c04b926411dd`. Manifest SHA-256: `d8ec2cffebc1503b010c9cf21461d4765f1b674a85f1431c33b05d6f0c59eade`. Implementation report SHA-256: `408483c630f73f612462066c1586da4b983d21bf3f2808afdcbda6873d543abc`.

Read `AGENTS.md`, the complete Task 2 brief and canonical design, report, package and manifest. Brief SHA-256: `d275411ec2a8fa62d6aa56985fc89a173fcf946b7a504ee6ac975eca8818e006`. Canonical design SHA-256: `63ada4161c75716f0c23cd5ef0389b71244a3d608530574a9b010bd496946f56`.

## SPEC evidence

- `runBridge` forwards its resolver to `claimAndProcess`, which forwards it to `startCommand`, then `registerTaskDefinition`, then `taskDefinitionFor`. Both public entrypoints default to `resolveWorkerAllocation`; the executable CLI still calls `runBridge(client, config)` at line 684. The imported `CapacityResolver` annotates the new direct-claim dependency and private forwarding parameters. The loop option retains inference from the typed production resolver and keeps existing clock, signal and wait inference.
- The production diff only adds this dependency propagation. Admission remains before task-definition validation. `taskDefinitionFor` still calls `validateAllocationSnapshot` followed by `validateMeasuredSnapshot` with the supplied resolver at lines 245-246. Launch fences, task ownership, error handling, release, cleanup and RunTask behavior are unchanged. No parser, config, environment, RPC argument, runtime authority or Lambda production code changed. The production measured map remains empty.
- The new default rejection case at lifecycle line 87 invokes the real `claimAndProcess` without a resolver override. Its valid synthetic session reaches granted admission, then rejects before AWS. The complete asserted mutation sequence contains claim, admission and exact-identity `releaseUnlaunchedDispatch` only. This excludes both the launch marker and fallback task-status mutation. The test retains the assigned dispatch ID and asserts the exact existing `event_media_ecs_dispatch_failed` event for the rejected session using the test-scoped Node console mock.
- Positive lifecycle scheduling uses the narrow Task 1 events loader; positive direct bridge calls and loops receive the fixture resolver explicitly. The default rejection case receives none. The registration test independently asserts task CPU `"4096"`, memory `"8192"`, container CPU `4096` and memory `8192`, and preserves the RunTask ownership-tag assertion.
- Capacity tests use the shared synthetic fixture and retain all four literal resource assertions for six presets and both simulcast states. They independently reject all 12 production combinations. Strict malformed resolver input, allocation shape, evidence, destination-profile, task metadata and resource assertions remain. The shared fixture still uses exactly `{cpuUnits:4096,memoryMiB:8192,evidenceId:"fixture-capacity-v1"}` for every combination.
- Lambda injects a wrapper through `createLambdaHandler` dependencies, spreading existing options into real `runBridge` and adding the fixture resolver. AWS runtime, config and environment receive no resolver authority. Four literal registration assertions precede full serialized-definition equality. RegisterTaskDefinition/RunTask ordering, admission-before-marker, marker-before-RunTask, dispatch registration, client token, absent overrides and environment assertions remain.
- The migration driver, fixtures, unit contract, historical semantics and receipt behavior are outside the diff. I inspected the unchanged unit contract, which still requires protocol-lifecycle failure, no real-admission evidence and successful cleanup while the production map is empty. No synthetic admitted migration fixture was added.

## QUALITY evidence and verification limits

The change stays within the four authorized paths and uses the existing narrow fixtures. No new package, cast, `any`, module mocking, setter or generic fixture machinery appears.

The accepted-marker test now bounds its own awaited wait callback to fewer than five waits. A failed progress assertion rejects the actual bridge promise and passes through the existing listener-cleanup `finally`; it creates no raced or abandoned loop. Its exact AWS operation order and final cleanup assertion remain. Adding `region: 'us-east-1'` completes only the lifecycle fixture. Real `startCommand` already supplies `computeRuntime.region` and `computeRuntimeValidator` already requires `v.string()`. Neither production behavior nor validators changed.

I inspected the recorded logs and matched their hashes rather than rerunning unchanged tests. Completed RED records exit 1 with 40 tests, 36 pass and four positive-path failures; the new default rejection case passes. The first acceptance records 123/124 with the accepted-marker fixture failure. Final acceptance records exit 0 with 124/124, including all 12 production rejections, default bridge rejection, Lambda launch and unchanged migration contract. `git diff --check` passed during this review. No concrete new concern justified a test rerun.

Root separately reports Task 1 actual anonymous local function analysis passed with 572 functions, exactly one public schedule mutation, factory absent, exact environment restoration, two empty port censuses and zero generated diff. I did not repeat or independently attest that analysis. Full suites and remaining verification belong to Root's later verification stage. This review does not establish merge readiness or positive whole-flow admission. Production measurements remain required and the original migration CI gate remains red.

No source edits, test executions, services, network, provider/AWS actions or commits were performed. Only this review artifact was written. The first two read-only orientation shells preceded discovery of the brief's environment-pinning requirement; all later shells sourced `/workspace/vrdex-env.sh`.
