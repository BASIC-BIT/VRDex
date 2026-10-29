# Recoverable PROGRAM authority source verification

2026-10-26. This record reports checks actually run by the Task 3 source-verification worker. It is a source verification original, not an independent peer semantic review, external prelaunch A, actual-image/native result or capacity admission. Root retains those decisions and operations.

## Exact source subject

Checked out `codex/recoverable-stream-qualification` at `4e4ed7af635af8d72b2cee273d9de29ce381f080`, including implementation commit `f8996d1eea480ee19a95fac0024f7b83b13d80b2` and retained genuine Task 1/2 dispositions. The sole Task 3 test edit asserts `invocations.length === 294` in the existing qualification authority test. Documentation and that assertion await independent review and normal commit by Root. This record claims no review of its own future committed bytes.

Read the approved [design](../../../superpowers/specs/2026-10-26-recoverable-program-authority-design.md), [plan](../../../superpowers/plans/2026-10-26-recoverable-program-authority.md), repository instructions and Task 3 execution brief. Independently inspected the complete `git diff db9abbcd -- scripts workers .github`, retained as the 141-line local `task-3-source-review.diff`. Only five planned authority modules differ: contract, guards, authority closure, native controller and bundle materializer. They add adopted DATA identities, whole-reference membership and validated fixed-body materialization, plus earlier catalog validation before expensive body reads. No media/clock algorithm, argv/default, policy, reader cap, workload, ownership, cancellation or cleanup behavior changes. No `workers` or `.github` file differs.

Repeated the exhaustive caller search specified by the plan: 88 matching lines across 18 files, retained in `task-3-callers.txt`. Task 2's per-caller disposition inventory remains applicable. CI/ECS preparation still reaches candidate/intent checks; independent PROGRAM/native132 replay still reaches the common verifier. Required whole originals and later substantive review operands remain separate obligations. Passing simulated fixtures cannot supply genuine reviews or actual A.

## Measured invariants and limits

- Qualification has 79,996 required IDs, 83 groups, 294 invocations and 3,072 quarter-amplitude IDs. ID authority remains `c55078312b8e2b6d24c84f7caa82cd487b1a440da20c301ed0e69ab5f44a9f16`; expected contracts remain `2af9fce4e907623fa75a6f4191d102d10745d47573884e4d5553e28675993873`.
- Packaging has 134 paths, CI/private-builder producer closure 139, existing Root producer closure 136. Both producer path literals are byte-identical to `db9abbcd`. Manifest-listed runtime files remain a separate inventory.
- Native inventory remains 42 Python and 90 Node identities. Names JSON is byte-identical to baseline, 11,672 bytes, SHA-256 `817d513c56abe31d028df04d01e0da21f1232b10f472ca42749aa0dfa1b27ac0`. Inventory verification is not actual ordinary132 execution.
- The package manifest is byte-identical, 6,156 bytes, SHA-256 `bb2acb5c5ebe7b931f9d78c81eff9d214a5049bf14a02f804780587ad60ee839`. Evidence policy is byte-identical, 3,749 bytes, SHA-256 `cc2f23894c264aed98c1bf4948ed6cdd813ebee9788a0c352b4fc4f51db7cd02`.
- All five complete authority bodies independently match the literal identity table and tracked blobs at `4e4ed7a`. R94 remains 41,830 bytes, SHA-256 `0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c`. The table, four frozen bodies and existing review/adoption originals were not edited.

Local `task-3-cardinality.json` and `task-3-identities-callers.json` retain measured results. Task 2's retained source-simulation costs remain whole DATA module 1,595 bytes, contract JSON 398, table JSON 830, five fixed originals 113,624 storage bytes and 227,248 bytes for two full reads. Logical fixed uses remain design 2, guards 13, pins 2, sizing 2 and rebaseline 2. Its 37,362-byte simulated bootstrap and 33,188-byte K do not establish genuine current runtime/image fit. Root must measure genuine review/image closure, reservation, storage and reads before A.

Unchanged limits remain runtime/bootstrap 196608 bytes; profile/manifest 65536 each; runtime/native/closure catalogs 256; context 4096; legacy normal/final numeric 196608/262144; selected R83 1572864/1638400; failure reserve 65536; selected R94 result/other/combined 262144/196608/458752; A 196608; invocation aggregates 16/32/64 MiB. No repeated-use charge or DATA classification is discounted.

CI auxiliary archive/parser remain 8/1 MiB, Docker-save/parser 2 GiB/1 MiB and shard decompression 256 KiB. Root retrieval remains 134152192 payload plus 65536 terminal, 257 objects, two full reads, 384 MiB local high-water and 512/128 MiB free-before/during. All other member/source/native/media bounds remain unchanged.

Deadlines remain scene 20 seconds, ordinary 90, compressed 360, group 400+20, uploads 160+20, process 600, RUNNING/PENDING 660/120. At most two media children run. Isolated ownership, bounded TERM/KILL, two empty censuses, actual STOPPED/exit, INACTIVE definition and absent ENI remain required.

## Actual commands and results

Commands source `/workspace/vrdex-env.sh`, using Node `v24.19.0` and pnpm `10.15.1`. Meaningful Node/test commands ran with `require_escalated` because the established sandbox pipe corruption makes child-process tests unreliable otherwise. This worker performed no hook bypass, hosted write, actual AWS/Docker operation or actual media/native acquisition. Image tests use fake AWS/Docker boundaries.

| Command | Actual result | Full local log |
| --- | --- | --- |
| `node --import tsx --test tests/scripts/event-marker-*.test.mjs tests/scripts/restream-image.test.mjs` | Exit 0; 475 tests, 470 pass, 0 fail, 5 historical R93 skips | `task-3-marker-family.log` |
| `node --test .github/scripts/restream-native*.test.mjs` | Exit 0; 24 tests, all pass, 0 skips | `task-3-native-ci-driver.log` |
| `python3 tests/scripts/event-marker-root-retrieval.test.py` | Exit 0; 4 tests, all pass | `task-3-python-retrieval.log` |
| `pnpm verify:vrdex-mcp` | Exit 1; typecheck succeeds, MCP 12/12 pass; nested scripts 973 tests, 947 pass, 20 fail, 6 skips | `task-3-host-verify-vrdex-mcp.log` |
| `pnpm test:scripts`, explicitly after the preceding command completed | Exit 1; 973 tests, 947 pass, 20 fail, 6 skips | `task-3-host-test-scripts.log` |
| `pnpm exec markdownlint-cli2 docs/engineering/source-marker-qualification.md docs/engineering/authority/reviews/rebaseline-verification.md` | Exit 0; repository configuration scans 258 Markdown files, zero errors | `task-3-markdownlint.log` |
| `git diff --check` | Exit 0; no whitespace errors | `task-3-diff-check.log` |

Full logs are under `.superpowers/sdd/recoverable-program-authority/`. The passing marker family retains full-result/other-outer/combined bounds, boundary-adjacent caps, declared-small/returned-oversized negatives, late-original edits/stale A and repeated-use accounting. The R1 operand test reaches its intended conflict/range failures after a valid unchanged-dependencies control. No assertion was weakened to hide fixture failure.

The MCP chain stopped at its nested scripts failure. Later `pnpm smoke:mcp-compat` and `pnpm check:mcp-client-matrix` stages were not reached; they remain unrun. Complete host-chain success remains OPEN.

## Every failure and skip

All 20 failures in each completed host run are known baseline dispatcher fixtures. Each retained stack reports `Error: Unproved broadcast configuration` from the empty production capacity map through the allocation fixture. Dispatcher/allocation/map files have no source delta from `db9abbcd`. These remain original Task 6 OPEN failures. No allocation was fabricated or failure waived. The separate scripts run reproduced the same 20 failure names, 20 exact errors and six skip names as the nested run. No new Task 2 regression was found in completed source checks.

1. `RunTask propagates the ownership tags from its registered task definition`
2. `deadline drain stops a late worker and releases capacity only after exact STOPPED and cleanup acknowledgement`
3. `drain cannot report success with unknown-arn`
4. `drain cannot report success with missing-task`
5. `drain cannot report success with cleanup-provider`
6. `drain cannot report success with cleanup-ack`
7. `drain cannot report success with control`
8. `drain observes a worker that stops after five seconds and acknowledges cleanup before a thirty-second forced shutdown`
9. `ambiguous reservations retain a positive bounded drain retry cadence`
10. `SIGTERM during an in-flight ordinary refresh stops the task before any poll sleep`
11. `SIGINT during an in-flight ordinary refresh stops the task before any poll sleep`
12. `deadline during an in-flight ordinary refresh stops the task before any poll sleep`
13. `deadline-at-sleep during an in-flight ordinary refresh stops the task before any poll sleep`
14. `SIGTERM wakes idle sleep and drains without aborting cleanup control calls`
15. `SIGINT wakes idle sleep and drains without aborting cleanup control calls`
16. `crossing deadline during claim prevents RunTask`
17. `crossing deadline during admission prevents RunTask`
18. `crossing deadline during registration prevents RunTask`
19. `accepted launch marker finishes task registration then immediately drains if the deadline arrives in flight`
20. `Lambda dispatch carries the same measured resources and launch fence through the SDK`

The first five skips are historical R93 differentials gated on absent `R93_BASELINE`. The sixth is the unchanged opt-in playback integration test gated on `EVENT_PLAYBACK_PROOF=true`; it is outside the focused marker command and is skipped in host scripts. None counts as a pass.

1. `R93 retained-source complete encoder/output/local argv, defaults, getters and factory errors`
2. `R93 retained-source capacity fixture and native noise complete argv with independent fake probe/capture`
3. `R93 retained-source six hold frames compare every byte, isolated backing stores and per-instance reuse`
4. `R93 retained-source input factory omitted/undefined/null and supplied quality late reads`
5. `R93 retained-source full PCM families/defaults/boundaries and unchanged 636-frame canary`
6. `proof servers own isolated media and cleanup while another server streams`

## Remaining actual gates

Actual preparation remains OPEN. The baseline correspondence inventory covers `/app` and `/opt/twitch`; it lacks complete critical-native, loader/alias, running `/proc` view and source/build/provider-provenance observations. The private builder still pins revision `db9abbcd` and its 139-source tree with no runtime-input channel; changed-source preparation and a bounded, separately counted manifest-listed runtime channel require separate review. Focused source inspection confirms `validateExecutionCommand` admits only the single-PROGRAM collector or CI native132, selected R83 binds one owned invocation, and the group collector uses a different command and four frozen canary invocations. Single-PROGRAM K/I/context and R83/R94 selection cannot authorize that four-capture canary. Its command/context/replay boundary needs a later bounded design; canary remains OPEN without implicit widening of commands, selection, caps or scope. This is a preparation blocker, not an implementation change or new framework. The read-only preparation assessment is `/workspace/scratch/actual-runtime-preparation-path.md`; inspected current policy, collector, group and authority source agrees with its boundary finding.

Conditional PROGRAM/native132, genuine runtime/native population fit, actual current image/config/layers and provider/source/native/Node/FFmpeg/wheel/runtime correspondence, rebuilt ordinary 42-Python/90-Node execution, candidate-specific semantic review, full final K and genuine external prelaunch A remain OPEN. Existing baseline-image evidence cannot qualify changed source. Runtime/source changes require rebuild/reobservation and a new complete K before A.

Root must supply genuine complete exact-body, adoption, implementation and semantic originals as required proof/catalog/K operands, reopen/hash full originals and match A's exact audit set. Retention, optional attachment, a local helper receipt or this source report alone cannot meet those gates. No new independent peer semantic-review disposition is claimed here.

Four frozen paired canary captures, native terminal/cleanup/two-read originals, bulk qualification, capacity and production map remain OPEN. Root refreshes spend/reservations under the remaining $20 ceiling and $1 ancillary reserve; $1.53346 remains only an estimate. Only exact A's bounded conditional step is eligible. `canary-000` remains blocked by its separate preparation boundary above; bulk requires complete existing canary acceptance. No retry, promotion or expanded workload is authorized. Evidence/deadline/cleanup/budget failure keeps affected IDs OPEN.

The complete new test subject is 1068 bytes, SHA-256 `7811579f242ad6a49395eee96852968b96c3ce398592d41079751a9336e85b15`. Its committed identity will be recorded externally after normal-hook verification.
