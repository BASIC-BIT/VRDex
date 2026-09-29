# Contributor Upload and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let contributors donate collections through ordinary MCP, upload local images, inspect and review stored candidates through MCP or the website, and use separately granted publishing and capacity privileges.

**Architecture:** Extend the existing contribution and media lifecycle with shared authorized commands. Both clients use the same transitions and durable receipts; collection items reference media submissions rather than creating a second media lifecycle. Keep upload transport, contribution capacity, publication, review, ownership, and OAuth delegation separate.

**Tech Stack:** Existing Next.js, TypeScript, Convex, S3 multipart POST uploads, hosted MCP, Node test runner, convex-test, and browser visual tests. No new provider or reputation service.

**Spec:** [Trusted contributors and bulk contributions](../../planning/trusted-contributors-and-bulk-contributions.md). Read its linked upload and review investigations before changing those modules.

## Global Constraints

- Planning baseline: commit `74cf6b8a8e96cadf9622aba1cddaef9d0c35930b`. Reconcile source drift before execution. This document does not authorize implementation or production operations.
- Locked decision: separate trusted-publisher permission may publish the actor's clearly sourced additions to empty image/logo slots on public unclaimed profiles. Replacements, disputes, uncertain attribution or identity, and previously rejected/suppressed material require independent review.
- Empty includes legacy fallback images. A missing managed placement is not sufficient.
- Never turn a trusted publication into an independent review record. Preserve same-user refusal for independent review, including super-admins.
- Grants do not bypass ownership, private-profile boundaries, suppression, verified email, OAuth scope checks, or source publication restrictions.
- Initial contributor placements: person profile image and community primary logo. This is the plan's recommended v1 boundary; contributor galleries are outside this plan.
- Existing production thresholds remain unchanged until a separately authorized measured rollout. Numerical targets in the spec are sizing proposals.
- Maximum input image remains 12 MiB. Upload authorization lasts at most 10 minutes. Successful proposal retention and deletion rules remain explicit and legal-hold aware.
- Capacity-only downgrade permits an admitted unexpired reservation to finish within its original bounds. Revocation, lost ownership, or intake suspension can block finalization.
- Keep source credentials and private collection data out of public docs, logs, receipts, and client-visible errors.
- New public sentences require BASIC's exact-copy approval before shipping. Use existing approved labels where possible; visual verification is required for UI changes.

## Delivery boundaries

Locked delivery decision: use one PR with three internal phases and local commits per task. Phase 1 implements Tasks 1-2, a complete review path at current limits. Phase 2 implements Tasks 3-6, upload and collection workflows behind a disabled bulk-intake switch. Phase 3 implements Task 7, measured capacity and rollout controls. Keep all phases on the same implementation branch and in the same PR to avoid separate PR delivery cycles.

Tasks 1 through 6 are sequential because they share authority, receipt, and lifecycle contracts. Capacity accounting required to make uploads safe is part of Task 3, not deferred to Phase 3. Higher capacity waits for Task 7. This ordering establishes a working review checkpoint before building the collection workflow; phases are not separate releases.

## File and interface map

Paths below are repository-relative. `Create` paths are proposed files, not claims about current code.

| Responsibility | Existing files to modify | Files to create |
| --- | --- | --- |
| Review commands, authority, receipts | `convex/profileMediaSubmissions.ts`, `convex/schema.ts` | `convex/_mediaReview.ts`, `packages/api-contracts/src/media-review.ts` |
| OAuth review/publication delegation | `packages/api-contracts/src/auth.ts`, `packages/api-contracts/src/oauth.ts`, `convex/_oauth.ts`, `convex/oauthApps.ts` | None |
| MCP adapters and stored preview | `apps/web/src/lib/server/vrdex-mcp.ts` | `apps/web/src/lib/server/mcp-media-review.ts` |
| Browser review | `apps/web/src/app/account/media-review/media-review-panel.tsx`, `apps/web/src/app/account/media-contributions/media-contributions-panel.tsx` | None |
| Upload bridge and reservations | `convex/profileAssets.ts`, `convex/_profileAssets.ts`, `convex/profileMediaSubmissions.ts`, `apps/web/src/lib/server/profile-asset-storage.ts`, `apps/web/src/lib/server/profile-media-mcp-import.ts` | `convex/contributionUploads.ts`, `convex/_contributionCapacity.ts`, `apps/web/src/lib/server/mcp-media-upload.ts` |
| Collection manifests and staged profile/link commands | `convex/_seedImports.ts`, `convex/_seedImportValidators.ts`, `convex/profiles.ts`, `convex/_profileLinks.ts`, `convex/_profileUpdates.ts` | `convex/contributionBatches.ts`, `packages/api-contracts/src/contribution-batches.ts` |
| Publisher and reviewer grants | `convex/_accountFeatureModel.ts`, `convex/_accountFeatures.ts`, `convex/accountFeatureGrants.ts` | `convex/_trustedPublication.ts` |
| Cleanup and policy reporting | `convex/crons.ts`, `convex/profileMediaSubmissions.ts` | `convex/contributionCleanup.ts`, `docs/testing/contributor-collection-checkpoint.md` |

Keep existing media route handlers as thin adapters. Both legacy routes under `apps/web/src/app/api/v0/profile-assets/upload-intents/[intentId]/` must reject MCP-purpose intents in their token-only completion paths. Preserve existing owner uploads.

Shared wire contracts use string IDs; backend adapters validate and convert to generated Convex IDs. The following new definitions belong in the contract files above. Runtime schemas must reject unknown decision fields and bound all strings and arrays.

```ts
export type OperationState = "committed" | "refused" | "in_progress";
export type CommandReceipt = {
  operationId: string;
  operationState: OperationState;
  resourceId?: string;
  code?: string;
};
export type ReviewDecision = {
  submissionId: string;
  expectedReviewVersion: string;
  decision: "approve" | "reject";
  privateReason: string;
  publicReason?: string;
  idempotencyKey: string;
};
export type ReviewPageRequest = {
  cursor: string | null;
  limit: number; // 1..40
  batchId?: string;
};
export type LocalUploadRequest = {
  mode: "owner" | "contributor";
  profileId: string;
  expectedUpdatedAt: number;
  placement: "profile_image" | "primary_logo";
  contentType: string;
  byteLength: number;
  sha256: string;
  credit: string;
  sourceUrl?: string;
  batchId?: string;
  itemKey?: string;
  idempotencyKey: string;
};
export type LocalUploadTarget = {
  intentId: string;
  expiresAt: number;
  transfer: {
    method: "POST";
    url: string;
    fields: Record<string, string>;
    fileField: "file";
  };
};
```

The proposed command exports are `profileMediaSubmissions.decideForMcpActor(ReviewDecision)`, `contributionUploads.begin(LocalUploadRequest)`, and `contributionUploads.complete({intentId, idempotencyKey})`. Authenticated actor context is supplied by the trusted server boundary, never accepted as a client-selected identity. Completion returns `CommandReceipt`. The exact preview/detail runtime schemas also include a stored rendition reference and opaque review version; they never expose bucket keys or super-admin identity fields to ordinary reviewers.

## Task 1: Shared review authority and replay-safe decisions

**Produces:** Authorized queue/detail projections, review version, and one shared decision transition used by browser and MCP. Existing browser endpoint behavior remains compatible.

- [ ] Extend `tests/backend/profile-media-submissions.test.ts` with competing decisions, stale target/placement, same-user refusal, expired proposals, and replay after a lost response. Add `tests/backend/media-review-authority.test.ts` for owner versus super-admin projections and revoked authority. Run `pnpm test:backend` and confirm the added cases fail for the missing behavior.
- [ ] Extract authority and decision helpers into `convex/_mediaReview.ts`. Preserve current checks in `decide`; do not authorize by OAuth scope alone. Queue excludes expired proposals and uses an indexed cursor. Detail includes current placement and candidate provenance so clients can compare them.
- [ ] Add a review revision and immutable decision receipts in `convex/schema.ts`. Bind the opaque version to the stored candidate, target revision, placement snapshot, and rebase revision. A transaction rechecks all of them before applying a decision. Persist terminal refusals; do not mint a new key automatically after refusal.
- [ ] Execute the decision and successful receipt atomically. Receipt lookup must validate the current actor and visibility before returning protected details. The same key with changed input returns a conflict. A second reviewer cannot approve a terminal submission; advisory `startReview` does not grant exclusive authority.
- [ ] Add review scopes `assets:review:read` and `assets:review:write` to the existing scope catalog, validation, and consent plumbing. Read needs `mcp:read`; decisions need `mcp:write`. Resource authority is still separately checked.
- [ ] Run `pnpm test:backend`, `pnpm test:api-contracts`, and `pnpm typecheck:backend`. Commit the shared commands and their tests as `feat: share authorized media review commands`.

Use the existing convex-test fixture in `profile-media-submissions.test.ts`. The central concurrency assertion after two authenticated decisions is:

```ts
assert.equal(results.filter((r) => r.operationState === "committed").length, 1);
assert.equal(results.filter((r) => r.code === "already_decided").length, 1);
assert.equal(publicAssets.length, 1);
assert.deepEqual(replayedReceipt, originalReceipt);
```

Here `results` are the two command receipts; `publicAssets` is the fixture query for assets created from that submission. Test state, not just returned strings.

## Task 2: Complete MCP and website review

**Consumes:** Task 1 authority and decision contracts. **Produces:** `vrdex_media_review_list`, `vrdex_media_review_get`, `vrdex_media_review_preview`, `vrdex_media_review_decide`, and `vrdex_media_submission_withdraw`.

- [ ] Add `tests/web/mcp-media-review.test.ts` with missing-scope failures, unauthorized detail/preview, native MCP image content, and durable decision replay. Extend `tests/web/vrdex-mcp.test.ts` to test tool discovery with each scope combination. Run `pnpm test:web` and confirm failures before registration.
- [ ] Implement `mcp-media-review.ts` and register its tools from `vrdex-mcp.ts`. Preview reads the validated stored rendition through the existing storage authorization rules. Return bounded native image content with structured context; do not fetch the original source URL. Withdrawal is the donor's own command and does not require reviewer privileges.
- [ ] Update the review panel with current-versus-candidate images, provenance, visible stale-state conflict, and decision results. Keep private reviewer reasons separate from public rejection reasons. Use the existing contribution panel for own withdrawal and status.
- [ ] Add an authenticated browser test at `apps/web/e2e/media-review.spec.ts` using two fixture identities. Prove both browser and MCP refuse the donor's independent approval and produce the same public asset after an authorized decision. Capture desktop and narrow-screen review screenshots and inspect both.
- [ ] Update `docs/developers/hosted-mcp-oauth-writes.md`, `docs/developers/vrdex-mcp-read-tools.md`, and `docs/testing/mcp-media-staging-lifecycle.md`. Record any proposed public sentences for BASIC's review.
- [ ] Run `pnpm test:web`, `pnpm test:backend`, `pnpm typecheck:web`, `pnpm lint:web`, and the new browser test through the existing `pnpm test:e2e` configuration. Commit as `feat: review contributed media through MCP and website`.

**Phase 1 acceptance:** A reviewer can list, inspect actual stored pixels, approve/reject, and read back results through MCP. Browser parity is demonstrated. Intake caps have not increased.

## Task 3: Mint local upload targets with bounded reservations

**Consumes:** Existing validation/storage pipeline and Task 1 receipts. **Produces:** `vrdex_media_upload_begin` and `vrdex_media_upload_complete`, with the contracts above. Integrates [issue #340](https://github.com/BASIC-BIT/VRDex/issues/340).

- [ ] Add `tests/backend/contribution-uploads.test.ts` and extend `tests/web/profile-asset-upload-route.test.ts` and `tests/web/profile-asset-storage.test.ts`. Cover digest/size/type mismatch, legacy-token bypass, expiry, replayed transfer, revoked actor, capacity downgrade, and two simultaneous completions. Run backend and web suites to establish the failures.
- [ ] Add an explicit issuer/purpose discriminator to upload intents. Existing records default only to their legacy behavior. MCP-issued intents never return a legacy upload token and cannot be completed through either legacy token-only route.
- [ ] Implement transactional actor/target/byte/concurrency reservations in `_contributionCapacity.ts`. Reserve declared source bytes plus the configured maximum derivative allowance; reconcile to actual retained bytes on seal. Retained rejected/withdrawn files and legal holds remain charged until confirmed deletion. A failed attempt releases processing concurrency without forgetting stored bytes.
- [ ] `begin` checks authority, source metadata, target snapshot, digest format, effective capacity, and idempotency before issuing the short-lived S3 multipart form. Return the exact fields and `file` part name. Only the random quarantine key is exposed through the required form fields, never source/download/display keys. S3 receives no VRDex OAuth token or cookies.
- [ ] `complete` rechecks delegated authority and reservation, reads and validates the candidate once, then writes validated bytes and derivatives to immutable server-selected keys. Commit exactly once with a receipt. Concurrent or later overwrites of quarantine cannot change committed bytes. Owner mode follows existing permitted asset finalization; contributor mode always creates a private proposal, even for publishers.
- [ ] Add scheduled orphan cleanup through `contributionCleanup.ts` and `convex/crons.ts`: schedule deletion after transfer expiry, retry failures, and reconcile abandoned/late writes. Storage work runs in an action; mutations lease bounded deletion work and confirm deletion. Keep legal-hold checks transactional with leases. Do not release byte charges merely because a timestamp expired.
- [ ] Run backend/web tests and both typechecks. Prove an actual multipart transfer against a dedicated test bucket, including an overwrite before/after sealing. Record that the form is reusable until expiry, while finalization is single-commit. Commit as `feat: add delegated local media upload bridge`.

## Task 4: Durable collection manifests and staged profile/link items

**Consumes:** Upload intents and media submissions. **Produces:** `vrdex_contribution_batch_create`, `vrdex_contribution_batch_append`, `vrdex_contribution_batch_get`, `vrdex_contribution_batch_items`, and `vrdex_contribution_item_submit`.

- [ ] Add `tests/backend/contribution-batches.test.ts`. Cover 1,001-row pagination, append limit 50, cross-client retries, changed payload under the same item key, source privacy, preserved links, suppressed identities, and interruption after partial submission. Run `pnpm test:backend` before implementation.
- [ ] Add batch, item, immutable attempt, and bounded revision records. Unique logical identity is actor + batch + item key, independent of OAuth client. Validate that replaying clients still have current authority. An item references its media submission or resulting profile command receipt; never copy media status into an independently mutable lifecycle.
- [ ] Define `ContributionItemInput` in `contribution-batches.ts` as a discriminated union: `profile_create`, `profile_links`, or `media`. Each requires `itemKey` and source evidence; existing-target items require `profileId` and `expectedUpdatedAt`. A profile-create item records explicit identity resolution before publication. Ambiguous matches return `needs_review`, never auto-select by name.
- [ ] Stage profile/link proposals before submission. Extract bounded validation/publication helpers from `_seedImports.ts` and `_seedImportValidators.ts`; call them through a contributor-authorized adapter. Do not expose internal seed import or bulk-publish methods. Enforce source-publication permissions anew for each submitted revision, including append after an earlier selection.
- [ ] Apply profile/link items through the existing community write rules and durable item receipt. Merge normalized link destinations with current links, preserve their provenance, enforce the existing maximum, and reject stale snapshots rather than replacing the entire list with the donor's subset. Private-only seed evidence cannot become a public profile field.
- [ ] Add indexed cursor queries scoped to actor or assigned reviewer; cap active rows and retained revisions as defined by effective policy. Terminal items still count in nonarchived manifests. Archiving does not erase receipts, held evidence, or unresolved review context.
- [ ] Extend MCP registration, tests, and `docs/planning/seed-import-model.md`. Run backend, web, and contract tests plus typechecks. Commit as `feat: add resumable contributor collections`.

## Task 5: Assigned reviewers, explicit rebase, and selected decisions

**Consumes:** Tasks 1, 2, and 4. **Produces:** Limited reviewer access by batch, `vrdex_media_review_rebase`, and bounded selected-item decisions.

- [ ] Extend authority tests with a reviewer grant lacking assignment, assignment without grant, revoked assignment, another batch's cursor, self-submission, and forbidden admin identity fields. Add rebase tests for intervening ownership and placement changes. Run backend/web tests and establish failures.
- [ ] Add a limited media-reviewer feature grant and separately managed batch assignments. Only an authorized admin can assign reviewers. Require active grant plus assignment on queue, detail, preview, evidence, rebase, and decision. Owners and super-admins retain their existing resource authority.
- [ ] Implement rebase as a reviewer-only command that records prior and current target/placement snapshots and increments review revision. It does not approve. A donor may request review or withdraw/resubmit but cannot refresh away a review conflict. Recheck authority if a claim occurred.
- [ ] Accept at most 20 explicit decision objects with separate viewed versions, reasons, and idempotency keys. Process each transaction independently and return ordered per-item receipts. Reject an empty selection or a filter-only approval request. A newly appended item cannot enter a previously selected decision set.
- [ ] Add website selection and rebase controls using the same commands. Show per-item outcomes and retain failed selections for deliberate retry. Render stale current-versus-candidate context before a new decision; image delivery is not proof that a human examined it.
- [ ] Run backend/web/contract tests and browser visual checks. Commit as `feat: add assigned collection review and explicit rebase`.

## Task 6: Separate trusted publication and correction records

**Consumes:** Stored media proposals, current target state, grants, and receipts. **Produces:** `vrdex_media_submission_publish` and the equivalent website action, gated by `assets:publish` plus `mcp:write` for MCP.

- [ ] Add `tests/backend/trusted-publication.test.ts`: eligible own image and community logo succeed; replacement, legacy fallback, claimed target, missing credit, uncertain identity/attribution, dispute, rejection/suppression history, revoked grant, and concurrent slot fill fail. Run the backend suite before implementation.
- [ ] Add `trusted_publisher` independently from `trusted_contributor` and the limited reviewer grant. Do not grant either implicitly through super-admin, OAuth app tier, or another contributor feature. Add the publication scope to all scope validation and consent surfaces.
- [ ] Implement `_trustedPublication.ts` using a fresh transactional target/placement read. The publish command accepts `submissionId`, `expectedReviewVersion`, and `idempotencyKey`; reject changed candidate or target versions. Require a recorded source reference or local-file provenance, credit, and explicit identity/attribution confirmation. Unresolved evidence goes to review. Check both managed placement and rendered legacy fallback. Route blocked publication to an actionable review conflict rather than weakening eligibility.
- [ ] Persist publication method `trusted_publisher` or `independent_review`, actor, source evidence revision, and decision receipt. Treat older approved records as legacy approvals with unknown method unless existing evidence proves otherwise; never invent independent reviewers during migration.
- [ ] Preserve restriction history indexed by target and content digest, plus explicit identity/dispute records. Fresh item keys or a different upload URL cannot evade a known rejection/suppression. Link resubmissions to prior evidence. Byte-different unknown variants still require an honest eligibility declaration; this plan does not claim perceptual duplicate detection.
- [ ] Add explicit publication to both clients, including own-item detail and stored-image preview for publisher-only actors without reviewer grants. Restrict that projection to the actor's own submissions and omit private reviewer reasons. Completion of upload must not invoke publication. Keep an independent-review option. Retain existing admin suppression and legal-hold powers separately; add correction linkage and a query of publisher publications for periodic sampling.
- [ ] Run backend/web/contract tests and visual checks. Commit as `feat: support bounded trusted publication`.

The core publication invariant can be tested directly against the proposed eligibility helper's boolean result:

```ts
assert.equal(eligible({ ...validOwnAddition, legacyImageUrl: "https://example.test/old.png" }), false);
assert.equal(eligible({ ...validOwnAddition, priorSuppression: true }), false);
assert.equal(eligible({ ...validOwnAddition, independentReviewerGrant: true, publisherGrant: false }), false);
assert.equal(eligible(validOwnAddition), true);
```

Define `eligible` in `_trustedPublication.ts` with a typed input containing the four fields shown plus current public/unclaimed state, own-submission identity, source/credit confirmation, current placement, and unresolved disputes. The transaction must load those facts server-side; the pure helper's result is not authority supplied by a client.

**Phase 2 acceptance:** In dedicated staging, process a synthetic collection of 30 profile/link items and 20 actual media proposals. Include URL and local uploads, an interruption, review conflicts, rejection, independent approval, and eligible trusted publication through both clients. Prove actual stored-image rendering in Codex and Claude Code. Record any unavailable client evidence as unverified. Production caps remain unchanged.

## Task 7: Measured capacity, operations, and release evidence

**Consumes:** Transactional reservations, collection storage, cleanup, and full review workflow. **Produces:** Effective-capacity discovery, separately grantable higher capacity, backlog/cost evidence, and controlled rollout configuration.

- [ ] Add `tests/backend/contribution-capacity.test.ts` for concurrent actors/targets, rolling limits, retained bytes, legal holds, downgrade, revocation, and interrupted cleanup. Add `tests/scripts/contributor-policy.test.ts` proving test overrides cannot run against production. Establish failures before adding policies.
- [ ] Add `trusted_contributor` as capacity only. Return effective limits, usage, remaining reservations, retry time, and terminal-versus-in-progress operation state through `vrdex_contribution_capacity`. Preserve the current normal production policy by default. Higher proposal numbers come from the spec's policy table, not duplicated constants in clients.
- [ ] Define a disabled bulk-intake switch and explicit policy selection in checked-in configuration and self-hosting docs. Use a dedicated test deployment identity allowlist for the synthetic override; fail closed for unknown or production identities. Intake pause must preserve status/review/withdrawal and receipts.
- [ ] Add bounded operational queries for oldest pending age, reviewer throughput, bytes including derivatives/held objects, orphan cleanup lag, failure costs, and database reads. Load-test the proposed 1,000-open ceiling and aggregate multi-user demand, not only the 50-item demonstration. Record measured results in `docs/testing/contributor-collection-checkpoint.md`.
- [ ] Use additive schema changes. Deploy readers that tolerate absent new fields before enabling writers. Backfill receipt/history/accounting indexes in bounded batches and reconcile against stored objects; do not enable higher limits until accounting matches. Rollback disables new intake while preserving old/new pending records and scheduled cleanup.
- [ ] Update lifecycle tests, MCP client compatibility, rollout checklist, account-grant operations, and cleanup runbooks. Document configuration owner, scope, recreation, and rollback. Record proposed initial grant recipients and reviewer staffing as operational decisions requiring owner authorization; do not apply grants from a migration.
- [ ] Run `pnpm verify:api-contracts`, `pnpm verify:vrdex-mcp`, `pnpm verify:web`, `pnpm typecheck:backend`, `pnpm test:backend`, `pnpm check:backend:generated`, and `pnpm verify:docs`. Run the targeted authenticated browser and two-client staging proofs. Commit as `feat: add measured contributor capacity controls`.

## Completion and execution handoff

- [ ] Reconcile each task's changed behavior with the canonical design and update developer/public/operations documentation in the same PR.
- [ ] Before calling the combined PR merge-ready, follow the repository's latest-pushed-head 30-minute window and refresh checks, comments, inline threads, formal reviews, mutable summaries, and mergeability. Include the PR URL in readiness reports.
- [ ] Keep merge, deployment, higher production thresholds, and actual grant changes as distinct operations. The plan is complete when the implementation tasks and evidence gates are clear, not when those later operations have occurred.

Locked execution workflow: use Superpowers subagent-driven development with one conductor, a fresh implementer subagent per task, task review for spec compliance and code quality, and scoped fixes/re-review before proceeding. Use the three phase acceptance checkpoints for integration verification, then perform one broad whole-branch review and the combined PR readiness cycle. Keep a shared execution ledger and provide bounded context to each worker; do not run concurrent writers on the shared modules. Start with Task 1 after implementation is requested. Recipient qualification, staffing, exact public copy, and measured deployment values need owner decisions before rollout, but do not block building the bounded mechanisms or their synthetic tests.
