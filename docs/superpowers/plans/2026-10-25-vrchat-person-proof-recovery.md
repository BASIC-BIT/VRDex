# VRChat Person-Proof Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore person verification through a validated public-profile bio read, and prove recovery without converting missing evidence into a negative verdict.

**Architecture:** Keep `VrchatClient.findProofCode` and the existing collector protocol. Switch only person proofs to `/profile/{id}`, validate the returned identity and bio, and reuse the worker's provider-failure path. Keep pending attempts recoverable through ordinary polling and settlement.

**Tech Stack:** Node.js 24, JavaScript ESM, `node:test`, TypeScript backend fixtures, `convex-test`, pnpm 10.15.1, existing Markdown tooling. No new dependency.

**Spec:** [Approved recovery design](../specs/2026-10-25-vrchat-person-proof-recovery-design.md). BASIC approved the design on October 25, 2026. This request authorizes writing the plan, not executing it.

## Review brief

This is one code deliverable followed by a separately authorized live acceptance step. Claimants keep the existing journey and copy. Unexpired attempts can recover automatically; canceled or expired attempts require the normal new code. Missing or malformed provider data keeps the attempt pending with `provider_unavailable`, while a readable bio without the code produces `not_found`.

The approved scope excludes recurring checks and a new outage UI. The remaining acceptance risk is whether the collector's own account can read the public profile. A successful adapter test or healthy worker heartbeat cannot resolve that uncertainty.

**Current recommendation:** implement natively in this existing worktree, then have one fresh reviewer inspect the complete branch. The code and its fixtures form one small, tightly coupled change, so separate implementers would add coordination without useful independence. Preserve a separate rollout approval because merge can trigger production deployment.

## Global constraints

- One request per person check to `GET /profile/{targetExternalId}`. No `/users` fallback or second status request.
- Require a non-null, non-array object, matching `id`, and string `bio`. Missing, null, wrong-type, or mismatched evidence throws `VrchatProviderError` with category `schema_drift`.
- Person proofs inspect `bio` only. Group proofs retain their endpoint and field selection. Keep short-code boundaries and legacy-code matching unchanged.
- Reuse `provider_unavailable`; add no schema migration, outcome enum, backend authorization change, retry loop, or operator repair mutation.
- Preserve collector binding, key checks, request reservations, cooldown, expiry, kill switches, authentication shutdown, and rate-limit backoff.
- Keep bios, codes, cookies, and provider payloads outside logs and saved receipts. Synthetic test values are permitted in fixtures.
- No public-copy or UI change, recurring canary, alerting project, provider credential work, or unrelated VRChat-consumer changes.
- Hold merge, deployment, live profile edits, and production ownership changes for separate approval. Successful main-branch Baseline Checks can trigger collector release automatically.

## Review focus

These cases need explicit assertions in Task 1, beyond a happy-path endpoint test:

1. An empty string bio is a readable negative, whereas an absent, null, numeric, array, or object bio is unavailable.
2. A matching code in another identity's response must not grant control; missing or wrong-type identity is also unavailable.
3. A code in `statusDescription` cannot rescue missing bio or match an empty bio. No hidden second request or `/users` fallback is allowed.
4. A schema error may contain sensitive text internally; the worker must record only its bounded category and must not send `proof_result` for that attempt.
5. A provider outage must preserve the attempt's code and expiry, and a later due poll must be able to resolve that same attempt without weakening collector or ownership checks.

## File map

| File | Responsibility |
| --- | --- |
| `workers/group-telemetry/vrchat-client.mjs` | Person endpoint and response validation |
| `workers/group-telemetry/proof-matching.mjs` | Person evidence-field selection only |
| `workers/group-telemetry/proof-matching.test.mjs` | Updated endpoint fixture, field selection, and preserved format/group assertions |
| `workers/group-telemetry/vrchat-client.test.mjs` | Response-contract and transport-error cases |
| New `workers/group-telemetry/worker-proof-checks.test.mjs` | Actual worker-handler outcome routing using the existing VM-test pattern |
| `tests/backend/short-claim-codes.test.ts` | Correct person response identity and path in all four short/legacy user/group settlement cases |
| `tests/backend/collector-proof-checks.test.ts` | Unavailable-to-success recovery for one pending attempt |
| `docs/deployment/claim-verification-enablement.md`, `docs/deployment/group-telemetry-collector.md` | Current provider contract, retry behavior, and bounded acceptance procedure |

Read-only references include `workers/group-telemetry/worker.mjs`, `workers/group-telemetry/runtime.mjs`, `workers/group-telemetry/worker-collect.test.mjs`, `convex/communityTelemetry.ts`, and `.github/workflows/group-telemetry-release.yml`. No production worker or Convex refactor is planned.

## Task 1: Correct the provider boundary and prove normal recovery

**Files:** Modify the existing files in the file map; create only the named worker test.

**Interfaces:**

- Consume `VrchatClient.findProofCode(targetType, targetExternalId, proofCode): Promise<boolean>`, `VrchatProviderError`, `RequestBudget`, and `boundedProviderCategory` from their existing modules.
- Preserve the provider method's signature and boolean return. Only a fully validated person response may reach matching.
- Produce `proofSurfaceFields("vrchat_user") === ["bio"]`; preserve `proofSurfaceFields("vrchat_group") === ["description", "name"]`.
- Reuse `internal.communityTelemetry.claimPendingProofChecks`, `recordProofCheckOutcome`, and `recordProofCheckResult` with their existing validators. Unavailable is a check outcome, not a terminal attempt state.

- [ ] **Step 1: Confirm the execution baseline.** Check branch/status and current upstream before editing. Keep this attached worktree and preserve the approved design. If main changed in the affected files, reconcile the plan against that diff before implementation. With Node 24 and the package-manager version declared in `package.json`, install only the frozen lockfile dependencies if absent: `pnpm install --frozen-lockfile`. Run `pnpm test:group-telemetry` and `node --conditions=import --import tsx --test tests/backend/short-claim-codes.test.ts tests/backend/collector-proof-checks.test.ts`. Record baseline failures separately. These tests require no provider account or hosted backend.

- [ ] **Step 2: Write the failing provider-contract tests.** Extend the current provider-client test and its existing `client(body, status)` helper, rather than inventing a production adapter. Add tests named `person proof reads the requested public profile exactly once`, `person proof rejects unreadable or foreign profile evidence`, and `person proof uses only a readable bio`. Assertions include:

```js
assert.equal(await client(JSON.stringify({ id: "usr_fixture", bio: "" }))
  .findProofCode("vrchat_user", "usr_fixture", "VRDEX19825"), false);
await assert.rejects(client(JSON.stringify({ id: "usr_fixture", statusDescription: "VRDEX19825" }))
  .findProofCode("vrchat_user", "usr_fixture", "VRDEX19825"), { category: "schema_drift" });
await assert.rejects(client(JSON.stringify({ id: "usr_other", bio: "VRDEX19825" }))
  .findProofCode("vrchat_user", "usr_fixture", "VRDEX19825"), { category: "schema_drift" });
```

Parameterize the same rejection assertion over missing/null/number/array/object bio; missing/null/numeric `id`; and null/array/scalar envelopes. With a matching identity, test a matching bio, a different-code bio, and empty bio plus a code-bearing status. In the path-capturing fixture, include `id` for person responses, expect `/api/1/profile/usr_fixture`, and assert exactly one request per call. Keep group and short/legacy matcher assertions. Add person-path 401, 429 with `Retry-After`, 5xx, malformed JSON, and transport timeout cases using the current client options; assert existing categories and bounded error messages rather than logging response bodies.

- [ ] **Step 3: Write worker and recovery coverage before changing production code.** Create the named worker test using the source-extraction/`runInNewContext` pattern from `worker-collect.test.mjs`. Normalize CRLF, extract from `async function checkProofs()` to the following top-level `collector_started` log, and assert both boundaries were found. Inject the real `VrchatClient` with fixture HTTP transport, real `RequestBudget` and `boundedProviderCategory`, one synthetic pending attempt, fixed time, and a fake control plane supporting `proof_claim`, `proof_budget`, `proof_outcome`, and `proof_result`. Capture calls and logs; make unexpected operations fail the test. Test `missing bio produces unavailable without a negative verdict` with these assertions:

```js
assert.equal(calls.filter(([op]) => op === "proof_result").length, 0);
assert.equal(calls.find(([op]) => op === "proof_outcome")[1].outcome, "provider_unavailable");
assert.ok(logs.some(e => e.event === "collector_proof_check" && e.category === "schema_drift"));
assert.doesNotMatch(JSON.stringify(logs), /private-bio-sentinel|fixture-cookie|VRDEX19825/);
```

Use the real client with a missing-bio response for the first test. Add a thrown `VrchatProviderError` containing the synthetic sensitive sentinel to prove the handler does not echo its message. Include a readable empty-bio case that sends `proof_result` with `found: false`, distinguishing it from unavailable.

In `collector-proof-checks.test.ts`, reuse `seedCollector`, `seedAttempt`, and `convexTest` to add `provider unavailable preserves a pending attempt that a later check resolves`. Claim the attempt, save its code/expiry, record `provider_unavailable` with the served collector and correct key hash, and assert `recorded: true`, pending state, unchanged code/expiry, and `lastCheckOutcome === "provider_unavailable"`. Advance to a due poll at `now + 6 * 60_000`, claim the same attempt, then record `found: true` and assert normal verified settlement. This is a preservation test of existing backend behavior; it need not fail on the baseline. Do not change backend code to force a red test.

- [ ] **Step 4: Run the red phase.** Run `node --test workers/group-telemetry/proof-matching.test.mjs workers/group-telemetry/vrchat-client.test.mjs workers/group-telemetry/worker-proof-checks.test.mjs`. Confirm failures point to the old users path, missing validation, or status matching. The integrated worker test must demonstrate the original false-negative behavior before the fix. Harness, import, and timeout mistakes are not valid red evidence.

- [ ] **Step 5: Make the bounded production change and migrate fixtures.** In `VrchatClient.findProofCode`, select `/profile` for person targets, retain `/groups` for groups, and validate person envelope, exact identity, and string bio before matching. Reuse the generic `Proof target response is malformed.` error and `schema_drift` category. Additional identity/bio guards are person-specific. Change the existing person-field helper to `["bio"]`. Preserve matching algorithms, request transport, budgets, and worker protocol. In `short-claim-codes.test.ts`, give person fixture responses `id: f.args.targetExternalId` and change their expected route from `users` to `profile`; retain the four existing settlement cases and their ownership/link assertions.

- [ ] **Step 6: Update the operator docs in the same deliverable.** Document public-profile reads, readable-empty versus unavailable evidence, retry of the same unexpired attempt, unchanged browser pending copy, and one request per check. State that heartbeat/readiness and adapter tests do not establish successful bio access. Carry the separately authorized controlled-proof procedure from Task 2 into the collector runbook. Do not add real user identifiers or proof material.

- [ ] **Step 7: Run green checks and inspect the scope.** Repeat the focused worker command, then run `pnpm test:group-telemetry`, the two-file backend command from Step 1, and `pnpm lint:markdown`. Expected: all tests pass, no skipped new regression cases, no Markdown errors. Check `git diff --check` and inspect the complete diff for unexpected source, lockfile, environment, UI, or schema changes. No browser or visual selection is needed for the approved no-UI scope; existing required CI still applies. Do not count synthetic tests as live acceptance.

- [ ] **Step 8: Commit and prepare review.** Commit the code, tests, and operator docs together as `fix: read and validate VRChat person proof bios`. Preserve the design/plan commits. Push the implementation branch and open a draft PR when execution is authorized; describe the fixed trigger, the unavailable-versus-negative distinction, and the pending live collector proof. Prefix posted agent-authored prose with `[AGENT]`. Use the selected execution method's independent review and address valid feedback. If asked to reach merge readiness, observe the repo's 30-minute current-head review window and refresh every feedback surface afterward. Hold merge because it can release the collector automatically.

## Task 2: Approved collector rollout and one controlled proof

**Files:** No further product code is planned. Record bounded acceptance evidence in the existing collector operator reference, or link a private receipt when it contains target or approval details.

**Interfaces:** Consume the reviewed exact release from Task 1 and the existing release/readiness workflow. Produce a receipt distinguishing release convergence, a real collector `found` verdict, backend settlement, and the reactive claim-page result.

- [ ] **Step 1: Resolve the live acceptance target and obtain the necessary approvals.** Identify environment, controlled immutable VRChat identity, fixture profile, claimant, expected ownership/trust result, and cleanup owner. Reuse an existing dedicated fixture if possible. Obtain approval for fixture creation or bio edits if needed and for any live claim settlement. An ordinary user's profile is not a substitute. Plan approval alone does not execute these actions.
- [ ] **Step 2: Obtain exact-release rollout approval.** Present the reviewed PR/head and current CI evidence. Call out automatic release after main Baseline Checks before seeking merge approval. Do not merge, dispatch a release, alter provider settings, or rotate credentials under the planning request.
- [ ] **Step 3: After authorization, use the existing release procedure and verify convergence.** Confirm the worker heartbeat and proof poll report the approved release. Keep the captured previous immutable image available for normal rollback. Do not report the person-proof fix accepted from these readiness signals alone.
- [ ] **Step 4: Complete one normal controlled attempt.** Create or reuse a still-valid pending attempt, have the authorized owner save its current code in the controlled bio, and let the collector claim and check it through ordinary cadence. Confirm a new real dispatch and `found` check, normal settlement, expected trust outcome, and the claim page's reactive completion. A fixture verdict, preexisting proof, operator-account API read, or manual ownership grant cannot substitute.
- [ ] **Step 5: Save the receipt and finish cleanup.** Retain exact release, timestamps, bounded outcomes, and approval reference; keep code, bio, session, and private target details out of public artifacts. Have the owner remove the code after success and perform only approved fixture cleanup. If collector access or settlement fails, record the bounded failure and leave acceptance open. Any rollback uses the existing release procedure; returning to the old reader may recover fleet operation while restoring the person-proof defect.

## Plan validation and evidence appendix

- Self-review must trace each Review focus item to Task 1's assertions and all release/consent requirements to Task 2. No scope or product decision remains open beyond execution method and the later exact live target/rollout approvals.
- Baseline source: `f6b0b95ef8e51e941951533034b8a8216151fd3e`. Design commit: `b14842262bad10e6fc4d92e2ed5bbf86e4a61900`. Refresh affected upstream source at execution, without resetting someone else's work.
- Current workspace: `C:/Users/steve/.codex/worktrees/vrchat-person-proof-design/VRDex`, branch `codex/vrchat-person-proof-design`.
- Current backend fixtures cover `not_found` bookkeeping but contain no explicit `provider_unavailable` recovery assertion. Current worker test files contain no `checkProofs` outcome harness; the new file is intentional.
- The approved [design's evidence appendix](../specs/2026-10-25-vrchat-person-proof-recovery-design.md#evidence-appendix) owns the provider-history and deployed-source links. This plan adds no new live-provider claim.
