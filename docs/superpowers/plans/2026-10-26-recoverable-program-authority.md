# Recoverable PROGRAM Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user already selected this method and waived repeated approval questions; genuine peer dispositions and Root adoption remain evidence gates.

**Goal:** Replace unavailable fixed originals with recoverable, reviewed authority and enforce their complete membership throughout PROGRAM preparation and replay.

**Architecture:** Freeze four substantive originals, obtain exact-body review and real Root adoption, then activate one five-field contract. Reuse existing proof/catalog/K/A/I/image joins and pending-K materialization; retain review evidence outside runtime.

**Tech Stack:** Node 24 ESM, node:test/tsx, existing Python installer and native verification.

**Spec:** [Approved design](../specs/2026-10-26-recoverable-program-authority-design.md). Read it completely; every requirement applies. Baseline: `db9abbcd59a30d206d85c0dcb2f407150e31dd9e`, branch `codex/recoverable-stream-qualification`.

## Global Constraints

- Preserve genuine R94: `tests/fixtures/program-result-sizing-r94-v1.txt`, 41830 bytes, SHA-256 `0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c`. Compute new hashes only after Task 1 freezes actual bodies.
- Preserve runtime/bootstrap 196608; profile/manifest 65536; catalog ceilings 256; context 4096; legacy numeric 196608/262144; selected R83 1572864/1638400; reserve 65536; R94 result/other/combined 262144/196608/458752; A 196608; aggregate 16/32/64 MiB. Recompute actual bytes and repeated logical charges; failure remains failure.
- Preserve CI archive/parser 8/1 MiB, Docker-save/parser 2 GiB/1 MiB, shard decompression 256 KiB, all member/native/source/media bounds; Root payload 134152192 + terminal 65536, 257 objects, two complete reads, local high-water 384 MiB, free-before/during 512/128 MiB.
- Preserve deadlines: scene 20, ordinary 90, compressed 360, group 400+20, upload 160+20, process 600, RUNNING/PENDING 660/120 seconds; two media children, isolated ownership, TERM/KILL, two empty censuses, STOPPED/exit, inactive definition and absent ENI.
- Preserve all other baseline bounds, exact argv/defaults/media/clock/cleanup behavior, 79996 IDs, 83 groups, 294 invocations, native132 identities, 134 package entries and 139 builder source entries. Runtime manifest files count separately. No adapter implementation, new image schema, staging lifecycle, fallback contract or future-image dependency in runtime.

## Review Focus

1. `range:null`, empty/full-length ranges and changed kind/ID/length/hash must never replace a mandatory whole original (Task 2).
2. Self-consistent rehashed old/mixed K must fail launch/replay before costly body reads (Task 2).
3. Missing/changed final fixed body must produce zero runtime or K writes (Task 2).
4. Optional K attachments cannot replace required disposition/adoption/semantic operands; stale A and late body changes must fail (Tasks 2–3).
5. Membership deduplication must preserve repeated accounting; source/runtime edits invalidate observed-image correspondence (Tasks 2–3).

---

### Task 1: Freeze complete originals and obtain real dispositions/adoption

**Files:** Create under `docs/engineering/authority/`:

- `program-source-design-rebaseline-v1.md`
- `program-source-guards-rebaseline-v1.md`
- `program-native-pins-rebaseline-v1.md`
- `program-authority-rebaseline-v1.md`
- `program-authority-identities-v1.json`
- `reviews/recovery-assessment.md`, `reviews/rebaseline-design-review.md`, `reviews/rebaseline-exact-body-review.md`, `reviews/rebaseline-adoption.md`.

**Interfaces:** Produce frozen UTF-8/LF originals with audit IDs equal to their filenames without `.md`. Identity JSON is an ordered five-row array `{key,path,kind,id,bytes,sha256}`, keys `design,guards,pins,resultSizing,authorityRebaseline`; R94 uses its existing fixture path/ID. It is review metadata, never imported by runtime. Review/adoption originals receive separate complete refs after their bodies freeze.

- [ ] Author the four complete bodies against current source. Design covers the complete dependency graph, trust boundary, conditional assurance, workload, accounting and retained bounds. Guards gives G0–G12 premises, original operands, actual enforcing functions, rejection conditions and source basis; inspect acquisition, guards, observer, conservation, clock, qualification replay and collector implementations. Pins covers critical/platform partitions, ELF/aliases/links/maps/kernel/environment, provider/source/build and observed complete bodies. Include every substantive obligation enumerated in the spec; never defer to missing R85 prose.
- [ ] Enumerate the amendment's finite supersession of R94 lines 74–84 and later unavailable-original/current-eligibility retention clauses. Copy all three historical hashes from `/workspace/scratch/fixed-r85-recovery-assessment.md`; state “historically unavailable; equivalence not established.” Preserve all other R94 policy/status language. Enumerate any additional missing normative original for peer disposition.
- [ ] Freeze bodies; generate the five literal identity rows from actual bytes. Verify with `sha256sum docs/engineering/authority/program-*-v1.md tests/fixtures/program-result-sizing-r94-v1.txt` and `wc -c` on the same paths. Verify R94 against the exact values above and `git diff db9abbcd -- tests/fixtures/program-result-sizing-r94-v1.txt` is empty. No code activation yet.
- [ ] Retain the recovery assessment and final design review from `/workspace/scratch/`; commit originals/table with `git add docs/engineering/authority && git commit -m "docs: freeze recoverable PROGRAM authority originals"`.
- [ ] Independent reviewer reads every exact body plus source and literal table, recording genuine SPEC/QUALITY dispositions in the designated review file. Root performs and records genuine adoption under existing authorization. Hash/retain both separately and commit with `git add docs/engineering/authority/reviews && git commit -m "docs: retain PROGRAM authority review and adoption"`. Changed subjects require fresh hashes/review. No manufactured disposition or user-authorization-as-A.

**Handoff:** Frozen commit, literal five-row table, reviewer dispositions and Root adoption. Task 2 cannot activate until these exist.

### Task 2: Enforce whole-reference membership and migrate every caller

**Files:** Modify `scripts/event-marker-{program-contract,program-guards,authority-closure,native-controller,native-bundle}.mjs`; `tests/fixtures/marker-positive-program.mjs`; `tests/scripts/event-marker-{data-separation,program-result-sizing,native-controller,positive-program-fix1}.test.mjs`. Create `tests/scripts/event-marker-program-authority.test.mjs`. Keep genuine R94 untouched.

**Interfaces:** Keep existing production signatures. Contract exports `PROGRAM_SOURCE_CONTRACT` with exactly Task 1's five hash values and `PROGRAM_AUTHORITY_REFS: readonly {key,kind:'audit',id,bytes,sha256}[]`, ordered like the table; freeze entries and table. In authority-closure add `isFullAuthorityReference(actual,expected): boolean` (exact kind/ID/bytes/hash, no own `range`) and `requireMandatoryAuthorityMembership(audits): void` (valid unique audit catalog, all five refs). Guards shares the comparator; `requireAuthorityMembership(deps,audits)` invokes the checker while preserving all existing operands and reference multiplicity. Materializer retains `materializeNativeBundle(bundle,{readSource,write}={})`; extend its existing result with `authorityOriginals: {ref,bytes:Uint8Array}[]` for Root's bounded resolver, separate from runtime files.

- [ ] Write failing `program-authority` tests named `tracked originals match frozen five-field authority`, `every mandatory reference requires whole identity`, `old and mixed contracts fail all front doors`, `required reviews cannot be optional attachments`, and `membership retains repeated logical uses`. Independently read actual Git-tracked paths, hash bodies and compare literal Task 1 identities, contract and table; assert deep immutability. Parameterize each original's removal/mutation at G0/G12/K/resolver/A; require guards at every G1–G11. Cover wrong fields, all range variants, generic S, duplicate/conflicting refs, absent/edited bodies and missing/extra/old/mixed contracts. Use real fixed bodies with explicitly simulated effects/A. Review-closure cases put substantive refs in existing proof sourceRefs/appropriate sourceAuditRef operands, then remove K refs, originals or A membership. Removing required proof operands while retaining optional K attachments must break the previously reviewed runtime/candidate identity; Root separately checks substantive completeness before adopting replacement runtime bytes. Do not invent a parser for review roles.

  Pin assertions using actual Task 1 rows and existing acquired `deps`:

  ```js
  assert.equal(body.length, row.bytes);
  assert.equal(sha(body), row.sha256);
  assert.equal(PROGRAM_SOURCE_CONTRACT[row.key], row.sha256);
  assert(Object.isFrozen(PROGRAM_AUTHORITY_REFS));
  assert(PROGRAM_AUTHORITY_REFS.every(Object.isFrozen));
  assert.equal(isFullAuthorityReference({...ref, range:null}, ref), false);
  assert.throws(() => requireMandatoryAuthorityMembership([ref, ref]));
  assert.equal(requiredAuthorityReferences(deps).filter(r => r.id === repeatedId).length, occurrences);
  ```

- [ ] Run `node --import tsx --test tests/scripts/event-marker-program-authority.test.mjs`; expect failures against old contract/missing exports and membership behavior.
- [ ] Implement DATA exports from Task 1's actual identities; no DATA reader/import/generator. Replace R94-only G0/G12 check with shared full-reference comparisons and G1–G11 guards membership. Apply mandatory checker in candidate creation, intent creation and outer replay before source/audit reads; retain exact contract checks, complete reopen/hash and A's exact audit-set equality. Preserve producer path literals in authority-closure: the private builder parses their current shape.
- [ ] Resolve the four checked-in Markdown paths and R94 fixture through materializer `readSource`, outside sourceFiles whitelist. Validate every fixed body before any write; return validated originals for resolver population, retain pending state. Add `fixed originals validate before any output` in native-controller tests with write/read spies for each absent/mismatched body and duplicate catalog; assert zero writes and no unnecessary body reads. Do not package authority/review bodies.
- [ ] Migrate fixture proof/K/resolver to all five genuine bodies. Load checked-in paths for materializer spies as well as ID-keyed resolver originals. Add clearly simulated required review/adoption/semantic operands; never relabel simulated A. Update literal-contract tests while retaining R93's historical three-operand expected object as history, independently asserting adopted successor values. Preserve result-limit/error negatives.
- [ ] Exhaustively search tracked/hidden source using `rg -n --hidden -g '!node_modules/**' -g '!.git/**' 'makeNativeCandidate|makeNativeIntent|prepareCiCreate|prepareEcsNativeLaunch|createCiNativeProducer|verifyNativeOuterJoins|materializeNativeBundle|requireAuthorityMembership|PROGRAM_SOURCE_CONTRACT|native-candidate-v1' scripts tests .github`. Record disposition of every match. Direct candidate callers: native-bundle, positive fixture, native-controller test helper. Launch consumers: native-controller, native-ecs-controller/CLI, native-ci-controller, `.github/scripts/restream-native.mjs`. Replay consumers: native132-replay, marker-qualification/program-replay, result-sizing and positive-program-fix2 tests. Update fixtures/assertions at every affected site; unchanged wrappers need explicit reviewed disposition. Historical R94 text is not a caller.
- [ ] Extend native-controller CI/ECS preparation and existing `PP27-10` replay tests for malformed rehashed K; extend result-sizing outer-replay tests for late originals/stale A. Run `node --import tsx --test tests/scripts/event-marker-{program-authority,native-controller,program-result-sizing,data-separation,positive-program-fix1,positive-program-fix2}.test.mjs`; require all pass with no weakened cap/accounting assertions. Record actual contract/ref/bootstrap/Root charges. Independently review Task 2, then stage only the listed implementation/test files and reviewed caller migrations with `git add -- <reviewed-file-inventory>` and run `git commit -m "fix: require recoverable PROGRAM authority throughout preparation and replay"`.

**Handoff:** Passing commands, finite caller disposition inventory, measured costs, exact changed-source commit; review originals remain required substantive closure inputs, not inferred from the five refs.

### Task 3: Regression, durable review closure and actual-image continuation

**Files:** Modify `docs/engineering/source-marker-qualification.md`; extend `tests/scripts/event-marker-qualification-authority.test.mjs`; create `docs/engineering/authority/reviews/rebaseline-implementation-review.md` and `reviews/rebaseline-verification.md`. Actual candidate image/provider originals use existing durable external retention and catalog refs.

**Interfaces:** Consume Task 2 unchanged APIs. Root builds reviewed dependencies with actual complete disposition/adoption/implementation/semantic refs in existing proof/catalog/K closure and exact A audit set. Candidate-specific image/source/native reviews stay external to packaged runtime; no new provenance schema.

- [ ] Document recovery paths, historical versus adopted authority, real review gates and OPEN conditional/capacity status. Add assertion `invocations.length === 294` to the existing authority test (79996 IDs/83 groups already asserted). Record 134 package paths, 139 builder paths/native132 identities and unchanged policy/argv/source diff; inspect `git diff db9abbcd -- scripts workers .github`. Require unchanged packaging manifest and builder path literals, all non-authority semantics/bounds unchanged.
- [ ] Run `node --import tsx --test tests/scripts/event-marker-*.test.mjs tests/scripts/restream-image.test.mjs`, `node --test .github/scripts/restream-native*.test.mjs`, `python3 tests/scripts/event-marker-root-retrieval.test.py`, and `git diff --check`. Require passing results; retain boundary-adjacent/full-result/oversized-return/multiplicity negatives. Baseline result-sizing/data-separation already passed (logs `/workspace/scratch/authority-baseline`); this run verifies changed source.
- [ ] Run the required repository host chain in order: `pnpm verify:vrdex-mcp`, then `pnpm test:scripts`. Retain each command's exit status and record every failure by test/check name in `reviews/rebaseline-verification.md`. Known production-map fixture failures remain original Task 6 OPEN; never report them passing, waive them, or fabricate allocations to satisfy them. Continue independent source/image checks while reporting their results separately; an unresolved host failure prevents claiming the complete host chain passed.
- [ ] Independently review exact source and semantic closure; freeze/hash Git-retained review originals after their subjects. Commit docs/test with `git add docs/engineering tests/scripts/event-marker-qualification-authority.test.mjs && git commit -m "docs: retain authority implementation verification and recovery procedure"`. Root checks required refs/originals, substantive adoption and all costs before any A.
- [ ] Root follows existing materializer/installer and separately reviewed private build preparation for changed revision/runtime injection. Rebuild/reobserve actual image, rerun ordinary 42 Python +90 Node, compare all 134 packaged files, 139 builder sources, wheel contents and manifest-listed runtime bytes. Existing ordinary gate command is `node .github/scripts/restream-native.mjs` against the freshly built CI tag; private execution uses its retained reviewed packet. Rebuild/reobserve if source/runtime changes. Retain actual image/config/layers, native ELF/object/alias inventory, provider/source/Node/FFmpeg correspondence and semantic review through existing full catalog/K/A/I/image joins; no optional-audit shortcut.
- [ ] Freeze final complete K, obtain genuine external prelaunch A for exact candidate/environment, then I/C/Q/observed L and independent replay. Refresh spend/reservations: remaining $20 ceiling, $1 ancillary reserve; $1.53346 is estimate only. Perform only A's bounded conditional step, then canary-000 with all four frozen paired captures and native terminal/cleanup/two-read originals; bulk requires complete canary acceptance. No retries/promotion/expanded workload. Stop on evidence/deadline/cleanup/budget failure and leave affected IDs OPEN. Report actual gates separately from source-test success.
