# Timeline cleanup transport repair implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover from one connection reset before timeline cleanup commits, while continuing to block later fixtures whenever cleanup remains uncertain.

**Architecture:** Set Playwright's existing `maxRetries: 1` option on the timeline fixture's cleanup DELETE only. Keep the same run ID, ownership checks, exact deletion counts and cross-process lease. Exercise the actual fixture against a disposable loopback HTTP server, following the existing failed-create regression pattern.

**Tech stack:** TypeScript, Node test runner, Playwright 1.60.0, existing local Next/Convex fixture tooling. No new dependency.

**Spec:** The [repair contract](#repair-contract) and acceptance criteria in this document.

## Review brief

The connection-verification fix is deployed. Azn's public VRChat link now shows "Verified VRChat account" and "25 Oct 2026". The remaining failure is in screenshot-test teardown: a cleanup DELETE sometimes receives `ECONNRESET`, then its retained lease correctly blocks later timeline fixtures.

**Current recommendation:** Allow one transport retry through Playwright, with every existing cleanup check intact. The code change should be one option on one request, plus tests and documentation. This affects test infrastructure only.

The tradeoff is deliberate: a reset before deletion can recover, but a lost response after deletion still blocks if the retry returns zero counts. Accepting zero could conceal a late fixture creation. Recovering that ambiguous case would require a separate design for durable run-owned cleanup receipts.

**Locked decision:** BASIC approved this bounded repair and its continued failure on ambiguous cleanup on 28 October 2026. Implementation and follow-up PR publication are authorized. Merge remains separate.

## Repair contract

- Retry only the cleanup DELETE after `ECONNRESET`, at most once. There are at most two DELETE attempts for the same run.
- Keep fixture creation POST and state-change PATCH retry behavior unchanged.
- Retain loopback-only routing, helper authentication, backend run ownership checks and exact cleanup counts.
- Release the lease only after a successful HTTP response, valid JSON and exact expected counts.
- Keep the blocked lease for exhausted resets, HTTP errors, malformed responses, count mismatches and ambiguous creation. Never delete a failed lease automatically.
- Default and prefetch scenarios expect `{ events: 8, profiles: 2, slots: 8 }`. Detail expects `{ events: 8, profiles: 3, slots: 87, lineupEntries: 2 }`.
- Do not alter screenshot thresholds, baselines, application behavior, provider adapters or CI selection to make the check pass.

## Confirmed evidence and limits

Two PR #391 runs failed at the same cleanup request with `apiRequestContext.delete: read ECONNRESET`. The first failure was the dense desktop timeline scenario. Subsequent mobile failures reported the retained `cleanup-failed` lease. Other runs passed the screenshot lane.

The installed Playwright types and implementation confirm that `maxRetries` defaults to zero, retries only `ECONNRESET`, and does not retry HTTP errors. A value of one adds one retry after its existing 250 ms backoff.

The exact reason the original socket closed, and whether deletion committed before that reset, remain unknown. This plan addresses the observed transport failure conservatively. If CI instead returns zero after a retry, preserve that failure and investigate the ambiguous response. Do not loosen the count assertion or increase retries.

## Global constraints

- Start implementation from current `origin/main` in an isolated worktree, using a `codex/` branch. The old PR #391 branch is merged.
- Use the existing fixture and lease interfaces. Add no production cleanup API or general retry wrapper.
- Fault injection is restricted to a disposable loopback server with synthetic IDs and a unique test-owned lease.
- Stop owned child processes and remove only the temporary files and leases created by that test after assertions finish.
- No production writes, deployment or new proof attempt is needed for this repair.

## Review focus

| Condition | Required result |
| --- | --- |
| Reset before the first DELETE commits | One retry returns exact counts; fixture passes and releases its lease. |
| Both DELETE attempts reset | Fixture fails after two attempts and retains a blocked lease. |
| First DELETE commits but its response is lost | Retry returns zero; exact-count validation fails and the lease remains blocked. |
| HTTP 503 or malformed/count-mismatched HTTP 200 | No transport retry; fixture fails and retains its lease. |
| Creation disconnects and commits after cleanup reads zero | Existing failed-create regression still fails closed; creation is never retried. |
| Detail scenario has additional rows | Exact detail counts remain required after recovery. |

## Task 1: Add bounded transport recovery and prove the cleanup boundary

**Files:**

- Modify: `apps/web/e2e/home-timeline-fixture.ts`, the cleanup DELETE options near line 98.
- Create: `tests/web/timeline-fixture-cleanup-retry.test.ts`.
- Reuse unchanged: `tests/web/timeline-fixture-create-failure.test.ts` and `tests/web/timeline-fixture-lease.test.ts`.
- Modify: `docs/testing/playwright-visual-preview.md`, "Home timeline evidence".

**Interfaces:** Consume the exported `test` fixture and `withTimelineFixtureLease<T>(backendUrl, run, options)` exactly as the existing failed-create test does. No new application interface or exported helper is needed.

- [ ] **Step 1: Write the failing recovery tests.** Follow `timeline-fixture-create-failure.test.ts`: run a temporary Playwright spec importing the real fixture, point it at a disposable Node HTTP server, and use a unique backend origin and lease. Return realistic synthetic create arrays. Capture POST/DELETE counts, request run IDs, child exit code and output. Do not substitute a mock cleanup function for the fixture.

  Table-drive the review-focus cases, including both default and detail counts. The essential assertions are:

  ```ts
  // Reset before commit, then exact cleanup:
  assert.equal(exitCode, 0);
  assert.equal(postAttempts, 1);
  assert.equal(deleteAttempts, 2);
  assert.ok(deleteRunIds.every(id => id === createdRunId));
  // A subsequent withTimelineFixtureLease call must enter successfully.

  // Persistent reset, lost acknowledgement, HTTP error or invalid result:
  assert.equal(exitCode, 1);
  // Persistent reset and lost acknowledgement: exactly two DELETEs.
  // HTTP error and invalid result: exactly one DELETE.
  await assert.rejects(
    withTimelineFixtureLease(backend, async () => {
      assert.fail("blocked lease admitted another fixture");
    }, { timeoutMs: 100 }),
    /Timeline fixture cleanup failed/,
  );
  ```

  In the lost-acknowledgement case, atomically clear the synthetic records before destroying the first DELETE response. Return zero counts on retry. In the pre-commit case, destroy that response before changing the synthetic records. Include malformed JSON and a valid JSON count mismatch as separate parameter rows.

- [ ] **Step 2: Run the red test.**

  Run `node --import tsx --test tests/web/timeline-fixture-cleanup-retry.test.ts`.

  Expected: reset-before-commit cases fail because the fixture makes only one DELETE attempt. Negative cases must expose their intended failure boundary. Save the exact failing assertion and output.

- [ ] **Step 3: Add `maxRetries: 1` to the cleanup DELETE options.** Keep its URL, headers and `{ runId }` body unchanged. Preserve the existing HTTP, JSON and exact-count checks and `blockAfterCleanupFailure()` path. Add no retry loop or new error classifier.

- [ ] **Step 4: Run the boundary tests.**

  Run `node --import tsx --test tests/web/timeline-fixture-cleanup-retry.test.ts tests/web/timeline-fixture-create-failure.test.ts tests/web/timeline-fixture-lease.test.ts tests/web/timeline-fixture-boundary.test.ts`.

  Expected: every test passes. Successful recovery releases its lease; each negative case proves the next fixture remains blocked. The existing late-create test must still observe the late records and reject the next fixture.

- [ ] **Step 5: Document the exact behavior.** Add one short paragraph to "Home timeline evidence": one cleanup-only reset retry, unchanged count validation, and continued blocking when the response is ambiguous. Do not describe socket closure as a confirmed Next bug or claim that all cleanup failures recover.

- [ ] **Step 6: Run real local browser verification.**

  Run `pnpm --filter web exec playwright test home-timeline.visual.spec.ts --project=desktop-chromium --project=mobile-chromium --workers=2 --repeat-each=2` against the existing isolated local runtime.

  Expected: all selected timeline comparisons pass without baseline updates, cleanup errors or retained leases. Preserve the reports. This confirms integration; the disposable-server tests prove reset recovery deterministically.

- [ ] **Step 7: Run lint and whitespace checks, then commit.**

  Run `pnpm lint:web`, `pnpm lint:md` and `git diff --check`. Review the generated-file diff after local Convex runs and retain no unrelated template churn. Commit the fixture option, its regression file and documentation as one scoped change.

## Publication and acceptance

- [ ] Review the complete diff, including every negative cleanup case. Publish a follow-up PR with `ci:browsers` and `ci:visuals` selected.
- [ ] Require terminal acceptable checks for the exact pushed head, including the full image-diff lane. A skipped lane is not acceptance.
- [ ] If the cleanup failure repeats, inspect its first error and counts before changing code or retrying the workflow. Preserve the blocked lease. A zero-count replay requires the deferred receipt design, not relaxed assertions.
- [ ] After the latest commit is at least 30 minutes old, refresh checks, ordinary comments, inline threads, formal reviews, mutable AI summaries and mergeability. Address valid feedback and refresh again before reporting merge-ready. Every new commit restarts that window.
- [ ] Merge remains a separate action. This test-only change needs no product deployment or production verification mutation.

## Evidence appendix

- Checked on 28 October 2026 around 12:30 PM America/Indianapolis. The live app and Vercel reported production commit `b499f7ef8122f81d6ef55bc64a9705060964df96`. GitHub comparison confirmed it contains PR #391's merge `fb1e5f02853b42167e5f95d9df34bde43942cad6`.
- [Azn's live profile](https://vrdex.net/aznmandown): public API contains one verified VRChat connection dated 25 October 2026. Browser text and screenshot show "Verified VRChat account" and "25 Oct 2026". Profile trust remains `claimed_unverified`. This does not inspect Azn's private account session or replay his proof.
- [First cleanup failure run](https://github.com/BASIC-BIT/VRDex/actions/runs/40628359392), image job `122623472695`: cleanup DELETE reset followed by blocked leases.
- [Recurring cleanup failure run](https://github.com/BASIC-BIT/VRDex/actions/runs/40639134105), image job `122655405902`, head `8f7f6e86b84ca53a7fdf8b662c027690442c04f9`: same first error and lease cascade. Other checks, including signed-in verification and 221 broad flow cases, passed.
- Current `main` was checked read-only at `b499f7ef8122f81d6ef55bc64a9705060964df96`; its cleanup DELETE still has no retry option.
- SDK references: `playwright-core@1.60.0/types/types.d.ts` documents `maxRetries`; bundled `lib/coreBundle.js`, `_sendRequestWithRetries`, implements the reset-only retry and backoff.
