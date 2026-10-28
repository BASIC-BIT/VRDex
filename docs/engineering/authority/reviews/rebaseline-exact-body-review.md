# Recoverable PROGRAM authority: independent exact-body review

2026-10-26. Independent SPEC and QUALITY review of Task 1, base `c9f6718cdf6e795eb0a54f36b615b7b6b7a68b22`, frozen subject commit `bd63fe256d751c8d116ea2b711783cf3cf1ac8a0`. This is the reviewer's actual disposition. It is not Root adoption, implementation approval, native semantic approval or external prelaunch A.

**SPEC: PASS for the bounded recovery model and substantive obligation inventory. QUALITY: CHANGES REQUESTED for the exact G2 decoder-stdio statement below. The present frozen subject set is not accepted for adoption until that correction receives scoped exact-body review.** No other blocking issue was found within this review's scope. Conditional PROGRAM/native132, paired qualification and capacity remain OPEN.

## Literal reviewed subject identities

All rows have kind `audit`. These are literal complete-original identities, independently checked against both committed blobs and working-tree bytes, not merely copied expectations from runtime constants.

| Contract key | Path | Audit ID | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| design | `docs/engineering/authority/program-source-design-rebaseline-v1.md` | `program-source-design-rebaseline-v1` | 17953 | `7463c898c2104ce5897830dafabb1e7b0ec88242f54bdfb45771ce6aa703c6c1` |
| guards | `docs/engineering/authority/program-source-guards-rebaseline-v1.md` | `program-source-guards-rebaseline-v1` | 21430 | `4e6ff3ca6a3e18a8652633331dad5058480e42a9569e67af6033acb67f6353d8` |
| pins | `docs/engineering/authority/program-native-pins-rebaseline-v1.md` | `program-native-pins-rebaseline-v1` | 15483 | `f5d04c68d66494a2aaa16056a06a15eea907f6254cafe4e567e97c2964e50417` |
| resultSizing | `tests/fixtures/program-result-sizing-r94-v1.txt` | `program-result-sizing-r94-v1` | 41830 | `0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c` |
| authorityRebaseline | `docs/engineering/authority/program-authority-rebaseline-v1.md` | `program-authority-rebaseline-v1` | 16626 | `42b3ad94be9a551b1f8a97e84ebff0ce65aaac4f6e367a323d1db2f442f014c5` |

The actual committed identity JSON has precisely these five ordered keys and `{key,path,kind,id,bytes,sha256}` rows. Each original is UTF-8, ends in LF, contains no CR, and has the stated filename-derived ID. The genuine R94 fixture has an empty diff from `db9abbcd59a30d206d85c0dcb2f407150e31dd9e`. The four new bodies total 71492 bytes; all five total 113322 bytes. These are physical body sizes, not runtime/ref/catalog fit measurements.

The retained genuine recovery assessment is 7450 bytes / `420c00dc94e09bc7d5685884904d40c2cfb1d4ae257973c850abd96778c0bc4e`; the retained design review is 9860 bytes / `599d628e2b144dada7ee1f8b256fdfbdc43195077e005eeb3759d8cc76ce108d`. Both committed copies equal their scratch originals byte-for-byte. They remain recovery/design dispositions, not earlier approvals of these exact new bodies.

## Blocking exact-body correction

1. **G2 must distinguish builder stdio from diagnostic execution stdio.** `docs/engineering/authority/program-source-guards-rebaseline-v1.md:21` says decode stdio is `ignore,ignore,pipe,pipe,pipe,pipe,pipe`. That is the seven-entry input to `diagnosticArguments`, not the final diagnostic binding compared by `verifyProgramRecipe` at `scripts/event-marker-program-guards.mjs:67` and `:68`. `programDecodeArguments` has no progress option. Therefore `scripts/event-marker-native-capture.mjs:29` adds `-progress pipe:7` and appends a pipe, making actual decode stdio `ignore,ignore,pipe,pipe,pipe,pipe,pipe,pipe`. The encoder already requests `-progress pipe:5` in `workers/restream/program-renderer.mjs:27`, so its stated six-entry stdio remains correct. Label the listed arrays as builder inputs and state the diagnostic decoder's added fd 7, or list both final bindings accurately. This matters because G2 is normative exact argv/stdio equality; a reviewer must not pin the seven-entry input as the complete observed decoder binding. No source change is requested.

Freeze and rehash the corrected guards original, update its literal identity row and obtain scoped review of the changed body/table before adoption. This review does not approve future unknown bytes. Unchanged subjects keep the dispositions below.

## Substantive source assessment

Read the task brief, approved implementation design, author report, entire review package including all four bodies and both genuine review copies, and the complete 41830-byte R94 original. Inspected actual source bodies/functions rather than inferring missing R85 prose.

- **G0 and dependency closure: PASS.** `openNativeBindingDependencies`/`readBounded`, `validateProgramDependencies`, the implementation catalog validators and `requiredAuthorityReferences`/`requireAuthorityMembership` support the finite graph, private capability, cross-binding, exact CODE/DATA roles and complete external premises. The documents accurately identify five-original membership as future implementation work; current code requires only the R94 fixed reference at G0/G12. Required later review/adoption/semantic originals must flow through existing proof/catalog/K and A, beyond file retention or optional attachment.
- **G1 and pins: PASS.** Checked `namedObject`, `parseElfIdentity`, `parseProgramMaps`, `snapshot`, `prepareInvocationObserver`, `verifyInvocationObservations`, the platform-view functions and native catalog expansion. The bodies preserve complete named-object identity, finite aliases/links/ELF facts, approved mount/kernel/environment assumptions, startup/terminal ownership, raw maps and absence confirmation. Conditional named-file observation does not become page identity or complete loading proof. Both strong false flags remain false. Native provider/build/source correspondence and actual-image semantic review remain required future evidence; they are not claimed established by JavaScript inspection.
- **G2–G3 and G9–G10: PASS in substance, with the G2 exact-body correction above.** Read the production encoder builder, decoder builder, diagnostic adapter, negotiation/graph checks, completion checks and native progress/statistics parsers. Exact recipes/default exclusions, initialized tuples, permitted graph, terminal ordering, warning restrictions and full EOF/drain premises remain conjunctive. The named native function/branch review remains required against actual pinned upstream originals.
- **G4–G8 and G11: PASS.** Read construction snapshot/regeneration/feed replay; complete transport inventory, PES/ADTS and picture-order paths; population reconciliation; demux/probe/timestamp replay; and `recordingBytes`/decoder flow. The bodies retain per-write rehash across frame boundaries, raw units, full coded population, seek/probe reset, parser ordering, timestamp branch operands, native statistics, priming/fill and stable stdout/file/descriptor lineage. Source/feed equality or output counts cannot substitute for native drain.
- **G12, clock and independent replay: PASS.** Read `inspectProgramClock`/`assertProgramClock`, complete `replayProgramRecording` and original intake, invocation store/reservation/accounting, front-door acquisition and collector flow. Replayed private handles, original consumption, independent detector/visual comparisons, exact result identity and logical-use multiplicity remain necessary. Numeric accounting is distinguished from retained storage, memory and actual read work.
- **External closure and preparation: PASS.** Read candidate/intent creation, materializer, common outer replay, image observation, Root readback joins, producer source selection and existing installer runtime handling. Existing K/A/I/image interfaces can carry the required substantive audits without a new provenance schema or lifecycle. Fixed bodies contain no future image/K/A hash; candidate-specific image audits stay external. Runtime/source changes require rebuild/reobservation. Root must inspect the complete substantive closure before real A, whose audit set matches K exactly.

This is focused policy/source correspondence review. It is not the later full implementation review, a proof that the baseline verifier has no bugs, or review of unavailable native/provider originals. For example, ELF rejection means the finite facts checked by this parser, not a general theorem about every possible ELF duplicate; after-child named-object checking uses recorded identities and links under the stated platform assumptions, not a second complete native-file hash.

## R94 precedence and historical-original dispositions

**Finite supersession: PASS.** The amendment addresses R94 lines 74–84 and the later retention/current-eligibility clauses at 88, 90–92, 178, 192 and 198. It preserves the three historical hashes exactly and does not assert historical fulfillment or equivalence. R94's result policy, accounting, substantive checks and historical status remain intact. Its old proposed/inactive status is not rewritten by this review; successor adoption must be a separate genuine act. The amendment's incidental references to R94 line 4 and line 14 locate blank lines adjacent to the intended paragraphs at 5 and 15; the quoted subject matter is unambiguous and does not broaden supersession.

The following are explicit reviewer dispositions of every listed missing-obligation case, subject to Root's later actual adoption decision:

| Missing or unverified operand | Disposition |
| --- | --- |
| Three R85 design/guards/pins bodies | **Accept current replacement, preserve historical gap.** Historically unavailable; equivalence not established. The new complete obligations, genuine successor disposition/adoption and implementation review replace their current authority role. A hash cannot reconstruct their prose. |
| R94 input design, 31338 bytes / `f20c5e61c778d52f82419b9a67da7aae6eed908a3d5a38c2ebe89bffd65d963d` | **Accept recorded historical gap.** Reviewed genuine R94 supplies its consolidated result policy for current use. Do not claim possession or fresh evidence from the missing input design. |
| R94 input independent review, 18837 bytes / `48febfacbe8e0f4e50abf14f14511d1a8ca375c87c38fae51009005b4dc8c390` | **Accept replacement of current review prerequisite only.** This genuine review supplies present dispositions, not the missing reviewer's historical action. |
| Original R85 design review, final R94 exact-body peer, Root R94 disposition and historical implementation/semantic reviews | **Accept explicit historical retention gap and successor current-eligibility chain.** No historical act is certified. Genuine successor adoption and fresh implementation/semantic originals remain mandatory through K/A before admission. |
| R76 S1/S2/S3 normative originals | **Accept current concrete obligations; no inferred historical equivalence.** Preserve Root-only complete audit/source possession, full storage/read accounting and actual image observations through existing joins. No new audit exemption or provenance protocol follows. |
| R81 construction original | **Accept current explicit construction/feed obligations.** Source-ledger functions and the new guards retain full regeneration, exhaustion and per-write correspondence. Historical review remains unproved. |
| R83 numeric and R90 numeric/scope originals | **Accept current explicit policy and scope obligations.** Preserve legacy/selected ceilings, private acquisition, exact workload selection and ordinary native132 result limits. No new allowance or inferred historical adoption follows. |
| R87 semantic eligibility and R91/R93 DATA/eligibility originals and reviews | **Accept successor current review requirement, not historical eligibility claims.** Full source possession, explicit CODE/DATA separation, ordinarily charged DATA and repeated uses, full code union per invocation and real semantic source review remain mandatory. These documents alone do not approve any implementation body's semantic eligibility. |
| Optional historical R93 differential source | **Not established.** A skipped differential stays skipped. Current literal historical values and unchanged present source cannot establish historical behavior-preservation testing. No native132 or capacity result follows. |
| Historical result witness/layout, checkpoint log, request/construction and source observations | **Historical evidence only.** They introduce no new fixed-body prerequisite here because this review makes no new empirical claim from them. Recover exact bodies before relying on them for such a claim; current fit needs same-run measurements. |
| Actual candidate image/provider/source/build/native originals and semantic reviews | **Still required and pending.** They are not superseded or waived. Obtain complete real originals, substantively review exact candidate correspondence, retain the required closure and obtain genuine exact prelaunch A. |

No additional mandatory historical-original dependency was identified in the inspected current enforcing paths beyond this inventory. This is a disposition of the known current treatment, not proof of the unknowable contents of missing originals. Any later discovered additional normative-original requirement must be enumerated and independently dispositioned; it cannot be silently canceled. Complete current admission closure remains unfulfilled until the required future originals and decisions exist.

## Bounds, scope and verification limits

The bodies retain 196608 acquisition/runtime/source limits, 65536 profile/manifest, 4096 context, 256 catalogs, legacy 196608/262144 and selected 1572864/1638400 numeric policies, 65536 reserve, result/other/combined 262144/196608/458752 and unchanged A at 196608. They preserve 16/32/64-MiB aggregates, CI 8-MiB archive and parser limits, Docker-save 2-GiB stream/1-MiB parser/member bounds, shard and media caps, Root 134152192+65536 bytes/257 objects, two full reads, 384-MiB high-water and 512/128-MiB free-space gates. No fresh per-child allowance, DATA discount, forgotten logical use or generic S substitute is admitted.

Deadlines, isolated ownership, TERM/KILL, two empty censuses, STOPPED/exit, inactive definition and absent ENI remain required. Preserve 79996 IDs, 83 groups, 294 invocations, native132 identities, 134 packaged sources and 139 builder sources. Independent Git comparison found no changes under `scripts`, `workers`, `tests` or `.github` from `db9abbcd` to the reviewed commit; the change contains exactly the seven declared documentation/identity files. The actual package manifest has 134 entries; the inspected private builder requires the existing 139-source union and treats manifest-listed runtime inputs separately. No enumeration suite or native operation was run, and no new empirical workload result is claimed.

Performed read-only source inspection, independent committed-byte hash/length/encoding checks, retained-copy comparisons and Git scope comparisons. No tests, network, AWS, builds, native/media operations, commits, source edits or subagents. Only this authorized review artifact was written. Full runtime/ref/Root fit, changed-source tests and semantic review, actual image/native provenance, genuine adoption and A remain later gates. Root may format/hash/retain this review; any subject-body changes require the scoped fresh review stated above.

## Final fix 1 disposition

2026-10-26. Scoped independent re-review of corrected subject commit `e7e155f213ef604e992cbaab01e92d4c802d3ef0` against the initial reviewed commit `bd63fe256d751c8d116ea2b711783cf3cf1ac8a0`. Read the exact fix diff and appended author report, independently verified committed bytes, and reread only the enforcing recipe/diagnostic/encoder sections needed for the sole finding.

**Finding 1: ADDRESSED. Final SPEC: PASS. Final QUALITY: PASS for the corrected five-original authority set. No blocking issue or new breakage was found in the fix diff.** This supersedes the initial QUALITY CHANGES REQUESTED disposition for current corrected subjects; the initial record and identities above remain historical evidence of what was reviewed then.

The corrected G2 row explicitly identifies the six-/seven-entry arrays as builder inputs. It states that the encoder already requests `-progress pipe:5` and retains six diagnostic stdio entries, while the decoder has no progress option and `diagnosticArguments` adds `-progress pipe:7` plus the eighth pipe. This matches `verifyProgramRecipe`/`programDecodeArguments`, the adapter's existing-progress and no-progress branches, and the production encoder builder. No source or algorithm change is needed or included.

The final literal guards reference is:

```json
{
  "key": "guards",
  "path": "docs/engineering/authority/program-source-guards-rebaseline-v1.md",
  "kind": "audit",
  "id": "program-source-guards-rebaseline-v1",
  "bytes": 21732,
  "sha256": "54130902985c22ddef115437afe033d4347e66901c17a211295b0e529ad7ef12"
}
```

The other four literal subject identities in the initial table remain unchanged and are part of this final PASS: design 17953 / `7463c898c2104ce5897830dafabb1e7b0ec88242f54bdfb45771ce6aa703c6c1`; pins 15483 / `f5d04c68d66494a2aaa16056a06a15eea907f6254cafe4e567e97c2964e50417`; resultSizing 41830 / `0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c`; authorityRebaseline 16626 / `42b3ad94be9a551b1f8a97e84ebff0ce65aaac4f6e367a323d1db2f442f014c5`. Their kinds, IDs and paths remain exactly as listed above. All five committed bodies independently match the corrected committed identity table and working-tree bytes, with valid UTF-8/LF. The four unchanged rows and bodies compare byte-for-byte to the initial reviewed commit. The corrected five-body total is 113624 bytes, not a runtime or Root fit claim.

The supplied fix diff equals the actual committed diff and changes only G2 wording and the guards identity length/hash. All other initial substantive assessments, explicit historical-original dispositions, retained bounds and limitations carry forward. The historical source/review gaps are not declared fulfilled, and missing-body equivalence remains unestablished.

This final disposition makes the corrected exact subjects eligible for Root's separate genuine adoption decision. It does not itself adopt them, activate code, approve implementation/native semantics, or supply A. Mandatory later implementation/semantic and actual-image/provider/source/native originals, existing K/A/I closure, measured fit, physical cleanup and real prelaunch approval remain required. Conditional PROGRAM/native132 and capacity remain OPEN. No suites, network, AWS, builds, native operations, commits, source edits or agents were used for this fix review; only this review record was appended. Any further subject-body change requires fresh scoped exact-body review.
