# Fixed R85 original recovery assessment

Read-only local investigation on 2026-10-26 against clean `/workspace/VRDex` HEAD `db9abbcd59a30d206d85c0dcb2f407150e31dd9e`. No source edits, network, AWS, builds, tests, approvals or authority substitutions occurred. This assessment does not qualify conditional native132 or PROGRAM.

None of the three exact original bodies was recovered. Their byte lengths and original artifact paths remain unavailable in the inspected material.

| Contract field | Required original SHA-256 | Recovered path / bytes |
| --- | --- | --- |
| design | `aa6d1308c3ed17a2440004d06ef85a5d47aa47d09034b11fe8ddc01087f13c93` | unavailable |
| guards | `a9cdeede2f5be1c9daf79cc9842b60e079e1bc2dff8501b3cc9cf75f4f9073f7` | unavailable |
| pins | `8cd6382c44b4c70bde56a20387d8268b8133023c79bd8c5afd90027dbd00e75a` | unavailable |

The current contract is `scripts/event-marker-program-contract.mjs:1`. `git log --all -S <design hash>` identifies only commit `879d38bc93f96a9bffad09af7e70f870c1af2e6f`, the October 26 squash for PR #383. Its diff introduces the whole contract file with all four current values. The materializer and positive fixture also first appear in that commit. Available history has no separate R85/R93/R94 implementation commits or earlier authority body revisions.

The repository is not shallow. Its available refs are local `work` and `origin/main`. `git fsck --full --no-reflogs --unreachable` returned no output. A local object investigation enumerated 11,140 reachable objects and skipped all 2,143 HEAD blob IDs, avoiding the prior assessor's current-file scan. SHA-256 hashing of the remaining 4,438 historical-only blobs, 231,675,141 bytes, found zero matches to the three authorities. Historical object names contain no R85/native-pins/program-design audit artifact paths. The three authorities therefore have no whole-body copy among the available historical-only Git blobs. This result does not speak for unavailable remote PR refs, other clones or the lost environment.

I also checked all members of the available recovery ZIPs. `root-recovery-post-tiny-20261026.zip` has 299 members, and each of `root-recovery-bundle-b284aeae.zip` and `root-recovery-bundle-b284aeae-downloaded.zip` has 235 members. No member hashes to a required original. Their member names contain no R85, pins, audit, program-design or program-guards candidate.

The checked-in text offers authority references, not embedded recoverable originals. The full hashes occur in the contract, two tests and the R94 fixture. The R94 fixture describes an R85 design paragraph 77 and a G12 row, but supplies only quotations and hashes. It does not give the missing originals' lengths, file names, complete contents or a reversible encoding. The likely storage class is Root's private authority/source store: `tests/fixtures/program-result-sizing-r94-v1.txt:84` explicitly requires the final design, original design review, amendment, dispositions and subsequent reviews to remain complete resolvable originals there. An exact historical file path cannot be inferred from that statement.

`scripts/event-marker-native-bundle.mjs:12` explicitly calls itself a materializer of supplied reviewed inputs and says it does not read the private audit registry. It decodes supplied runtime base64, validates supplied refs and current source bytes, and emits a pending K. It contains no authority prose generator or data from which these bodies follow. Its determinism cannot recreate an omitted input.

`tests/fixtures/marker-positive-program.mjs:23` uses the one-byte body `S` under `SIMULATED-APPROVAL-ONLY` for audit premises, and line 32 reads the genuine R94 fixture. Lines 33 and 38 use those simulated refs in proof/K. This exercises the machinery with simulated premises; it never constructs the fixed design/guards/pins bodies. Passing it cannot establish possession of them. Current code checks exact contract equality and reference membership, while the reviewed closure supplies the substantive base-original obligations. Do not exploit that separation to omit them.

The complete R94 original is available and was independently checked during this investigation:

| Path | Bytes | SHA-256 |
| --- | --- | --- |
| `tests/fixtures/program-result-sizing-r94-v1.txt` | 41,830 | `0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c` |

Its lines 74-84 expressly preserve the three R85 hashes and full R85/native-pins originals. Merely replacing the three constants would conflict with the still-pinned R94 body.

The practical next step is a concrete, separately reviewed authority-rebaseline proposal. It must name the unavailable originals honestly and provide complete new design, G0-G12 obligations and actual-image native provenance/pins originals. Review must assess those new bodies against current code and all retained requirements. Equivalence to unavailable R85 prose cannot be asserted from its hashes. Freeze exact bytes, lengths and IDs, retain peer dispositions, and obtain an actual adoption decision for the new effective contract. This assessment supplies no such decision.

That proposal needs a superseding amendment addressing R94's explicit retention clauses. Preserve the existing R94 body as a historical original. Decide explicitly how the new amendment identity and base identities become the single exact effective contract, including required full-original proof/catalog/K refs and the matching real A audit set. Every consumer must reject stale or mixed contracts. Full-body audit joins should be explicit for each new base identity, so test fixtures cannot substitute a generic audit for them. Keep the acyclic order of reviewed authority originals, source/implementation audit, candidate K, external A, intent/context/launch and observed execution. Never synthesize an approval or reinterpret ordinary132 as conditional qualification.

The rebaseline must retain all current bounds and selections. These include 196,608-byte runtime originals, 65,536-byte profile/manifest, 256 manifest/catalog entries, selected R94 PROGRAM result 262,144 plus other originals 196,608 and combined reservation 458,752; legacy numeric 196,608 normal/262,144 final and selected R83 numeric 1,572,864 normal/1,638,400 final, each with the existing 65,536 failure reserve. Preserve aggregate accounting, every repeated logical charge and no resets per child. Preserve CI auxiliary archives at 8 MiB with the 1-MiB parser limit, Root retrieval's 128-MiB total and 257 objects, two complete reads, 384-MiB local high-water, all existing deadlines/cancellation/cleanup, exact command selection, native argv/source/clock/conservation obligations, all 79,996 IDs, 83 groups, 294 invocations and native132 identities.

A contract/source change changes packaged source and candidate identity. Build and compare the resulting actual image again, rerun ordinary132 and applicable source checks, then prepare reviewed runtime dependencies and seek a real prelaunch A for that exact candidate. The root agent reports a fresh image build, ordinary132 pass and current 134-source/1,854-wheel-file comparison for the unchanged baseline; those results do not recover the missing bodies and are not verification performed by this assessment. Conditional qualification remains unavailable under the unchanged authority until genuine originals are recovered, or a real reviewed superseding contract is adopted and exercised.
