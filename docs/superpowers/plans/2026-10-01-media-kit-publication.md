# Media-kit publication implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. BASIC selected an implementer and independent reviewer for each round, in one PR.

**Goal:** Publish contributions into the media kit without a declaration checklist, with separate authorized profile-picture actions through the website and MCP.

**Architecture:** Reuse existing assets, gallery placements, uploads, review queues, receipts, and cleanup. Both approval paths publish additive gallery assets. Separate commands handle primary placement and bounded management of a contributor's own published assets.

**Tech Stack:** Next.js, TypeScript, Convex, existing S3 upload/storage paths, Zod contracts, Node test runner, convex-test, Playwright, Storybook. No new dependencies.

**Spec:** [Approved design](../specs/2026-09-30-media-kit-publication-design.md), committed as `60c7b0c` and approved by BASIC before this plan.

## Global constraints

- Deliver one PR with three internal phases: backend/contracts, website/MCP, migration/hosted verification.
- Use an implementer and an independent reviewer for each implementation round.
- Remove the checklist and Confirm evidence; do not auto-populate equivalent assertions.
- Direct trusted publication is own-contribution only, for public, published, unclaimed profiles.
- Keep contributor, publisher, reviewer, owner, and admin authority distinct; retain independent-review self-review refusal.
- Existing pictures do not block kit publication. Visible legacy/automatic artwork still occupies a picture slot.
- Preserve existing visibility, historical receipts, cleanup/legal holds, and one published charge per asset.
- Use durable actor-scoped idempotency keys; uncertain responses require same-key replay.
- Node `>=24 <25`, pnpm `10.15.1`; use repository scripts and generated Convex types.
- Claimed-profile proposals/notifications, logo bundles, and asset categorization are separate follow-ups.
- New substantive public prose requires BASIC's approval of its exact wording before shipping.
- No production migration or deployment during planning. Later production actions need their applicable authorization.
- Do not call a PR merge-ready until its latest pushed commit is at least 30 minutes old and all feedback/check surfaces have been refreshed for that exact head.

## Review focus

1. Existing managed, legacy, automatic, or private pictures remain untouched by additive publication (Task 1).
2. Another actor selecting the same asset invalidates a publisher's earlier undo authority (Task 2).
3. Lost responses, shared keys across command kinds, revoked grants, and newly claimed targets do not duplicate operations or expand authority (Tasks 1-4).
4. Metadata correction cannot erase the required credit/provenance, rewrite historical evidence, or expose private owner media (Task 3).
5. Old pending proposals and consumed uploads remain usable without duplicate blobs/charges; private or changed primary assets are never swept into a public migration (Task 6).

## Preparation and file map

Planning inspected `origin/main` at `a9f6263dd5d2c6c71fecad7d7f325e331c7baa31`. The planning checkout remains on an older implementation base. Start execution in a fresh isolated worktree from current main using the worktree skill; carry the approved spec and this plan as documentation commits. Re-read applicable AGENTS.md and inspect changes since this reference before editing. Do not rebase the shared planning checkout or extend the old merged PR.

Modify existing seams:

| Files | Responsibility |
| --- | --- |
| `convex/schema.ts`, `_trustedPublication.ts`, `_mediaReview.ts`, `profileMediaSubmissions.ts` | Proposal intent, additive approval, authority, snapshots, wrappers |
| `convex/_profileAssets.ts`, `profileAssets.ts` | Reusable placement/metadata mutations and owner-command provenance |
| `packages/api-contracts/src/{media-review,media-upload}.ts`, `src/index.ts` | Exact public command/detail contracts and exports |
| `convex/contributionUploads.ts`, `apps/web/src/lib/server/{mcp-media-upload,profile-media-mcp-import}.ts` | Local minted upload and URL-import placement normalization |
| `apps/web/src/lib/server/{mcp-media-review,vrdex-mcp}.ts` | MCP dispatch, delegation scopes, previews and receipts |
| Contribution editor, account contribution/review panels, public media-kit rendering | Website flow and shared action UI |
| `tests/backend`, `tests/web`, `packages/api-contracts/tests`, `apps/web/e2e` | Existing test runners and fixtures |
| MCP catalog/smoke scripts and `docs/engineering/media-review-commands.md` | Client catalog, hosted evidence, operating contract |

Create only these focused implementation units:

- `convex/_mediaContributionCommands.ts`: published-contribution snapshots and shared authorized placement/management commands. Existing browser and MCP wrappers call these functions.
- `tests/backend/media-contribution-commands.test.ts`: Task 2/3 authorization, concurrency, and receipt tests using `_mediaReviewFixture.ts`.
- `convex/mediaKitPublicationMigration.ts` and its backend test: bounded conversion and exact-resource correction, defaulting to dry-run.
- `apps/web/src/app/account/media-contributions/published-contribution-card.tsx`: actions for a published item, distinct from the pending publisher card.

No new storage abstraction, review service, permission framework, or notification subsystem.

## Phase 1: Backend and contracts

### Task 1: Additive intake and publication without declarations

**Files:** Modify the proposal/schema/contracts and upload/import seams above; tests in `tests/backend/trusted-publication.test.ts`, `profile-media-submissions.test.ts`, `media-review-authority.test.ts`, and `packages/api-contracts/tests/media-review.test.ts`.

**Interfaces:**

- Keep `MediaPublication = { submissionId, expectedReviewVersion, idempotencyKey }` and `publicationCommand(ctx, input: MediaPublication, actor: ReviewActor): Promise<CommandReceipt>`.
- Add optional stored `requestKind: "kit_asset" | "identity_placement"` and `candidateAssetId: Id<"profileAssets">`; new image intake writes `kit_asset` and `requestedPlacement: "gallery"`.
- Add optional `profileAssets.sourceSubmissionId: Id<"profileMediaSubmissions">` as immutable contribution provenance. Set it when publishing an uploaded proposal.
- Owner upload placement behavior stays unchanged. Contributor legacy primary-placement inputs normalize to gallery instead of implicitly selecting identity placement.
- `reviewSnapshot(ctx, submission, profile)` keeps its existing return type but uses intent-specific relevant state. Kit snapshots exclude unrelated profile timestamps and existing identity artwork. Placement snapshots include that artwork and selection provenance.

- [ ] **Write regression tests** using the existing upload fixture, without calling its declaration helper:

  ```ts
  assert.equal(receipt.operationState, "committed");
  assert.deepEqual(newAssetPlacements.map(p => p.placement), ["gallery"]);
  assert.equal(currentPrimaryAssetId, previousPrimaryAssetId);
  assert.equal(evidenceRows.length, 0);
  ```

  Cover managed/private/legacy/automatic pictures, nonempty kit, independent approval, and no invented reviewer. A biography-only edit must preserve the inspected publication version; changed target identity, candidate metadata, privacy, claim, or restrictions must invalidate it. Retain capacity, verification, source/credit, suppression/rejection/dispute, and revoked-grant refusal tests. Same-key replay returns the original receipt and one asset/charge.
- [ ] **Run to confirm the new tests fail:** `node --conditions=import --import tsx --test tests/backend/trusted-publication.test.ts tests/backend/profile-media-submissions.test.ts tests/backend/media-review-authority.test.ts`. Expected: assertion failures against the old declaration/primary-slot behavior.
- [ ] **Implement the shared change:** remove assertion/empty-picture gates from kit eligibility, publish both approval paths through `consumeProfileAssetUploads` with gallery only, preserve credit/provenance, and use `sanitizeProfileAssetLabel(submission.label) ?? "Image"` for the required gallery title. Patch all intake callers, including local minted uploads and URL imports. A meaningful target change requires fresh inspection, never replacement of the stored bytes. Split kit freshness from primary freshness rather than disabling version checks globally.
- [ ] **Retire declarations:** keep old records untouched. Legacy declaration calls may replay their historical receipts; a fresh legacy declaration returns a terminal `declaration_retired` refusal without adding evidence. New publication does not call that handler.
- [ ] **Verify:** rerun the targeted tests, then `pnpm test:api-contracts`, `pnpm typecheck:api-contracts`, `pnpm typecheck:backend`. Regenerate Convex types through the normal local backend workflow if schema/API changes require it; do not edit generated files by hand.
- [ ] **Review and commit:** independent reviewer checks all intake/decision callers and the authority changes; fix findings, rerun affected checks, commit `feat: publish media contributions into the kit`.

### Task 2: Explicit primary selection, undo, and reviewed replacement

**Files:** Create `_mediaContributionCommands.ts` and `media-contribution-commands.test.ts`; modify schema, `_profileAssets.ts`, `profileAssets.ts`, `_mediaReview.ts`, `profileMediaSubmissions.ts`, and the media-review contract.

**Interfaces:**

- Export `PublishedContributionDetail`: string `submissionId`, `assetId`, `profileId`, `profileSlug`, `contributionVersion`; `metadata: { label: string; altText?: string; credit: string; creditUrl?: string; sourceUrl?: string; sourceDescription?: string }`; and `canSelectPrimary`, `canClearPrimary`, `canEditMetadata`, `canRemove` booleans. These are computed capabilities, not assertions supplied by a user.
- Export `ContributionCommandBase = { submissionId: string; expectedContributionVersion: string; idempotencyKey: string }`.
- Export `ContributionPlacementCommand = ContributionCommandBase & { action: "select_primary" | "clear_primary" }` with strict schemas and existing bounded ID/version/key limits.
- Implement `publishedContributionDetail(ctx: QueryCtx | MutationCtx, submissionId: string, actor: ReviewActor): Promise<PublishedContributionDetail>` and `contributionPlacementCommand(ctx: MutationCtx, input: ContributionPlacementCommand, actor: ReviewActor): Promise<CommandReceipt>` in the new module.
- Browser/MCP wrappers: `contributionDetail`, `contributionDetailForMcpActor`, `placeContribution`, `placeContributionForMcpActor` in `profileMediaSubmissions.ts`. Use the existing verified actor and MCP attestation patterns.
- `proposeContributionPlacement(ctx: MutationCtx, input: ContributionCommandBase, actor: ReviewActor): Promise<CommandReceipt>` creates an `identity_placement` proposal referencing the existing asset; expose `proposePlacement` and `proposePlacementForMcpActor`. Its receipt resource ID is the new review submission.
- Add optional placement `selectionActorUserId` and `selectionOperationId`. Every owner/admin/reviewer/publisher identity-selection path writes fresh provenance, including same-asset selection. Legacy missing provenance never grants contributor undo.

- [ ] **Write tests** for a publisher's own public kit asset in an unclaimed profile:

  ```ts
  assert.equal(selected.operationState, "committed");
  assert.deepEqual(activePlacements.sort(), ["gallery", "profile_image"]);
  assert.equal(cleared.operationState, "committed");
  assert.deepEqual(afterClearPlacements, ["gallery"]);
  assert.equal(asset.state, "active");
  ```

  Cover community primary logo, existing visible fallbacks, another contributor's asset, revoked publisher, newly claimed/private target, and stale version. Another authorized actor selecting the same asset must invalidate undo. Reviewed replacement must keep gallery membership of both assets, require a distinct reviewer, and create no new upload/blob/published charge. Repeated placement commands replay one receipt; reuse of the key with another command refuses.
- [ ] **Run and observe failure:** `node --conditions=import --import tsx --test tests/backend/media-contribution-commands.test.ts`.
- [ ] **Implement:** resolve immutable source submission and active public asset; check current verified actor, authority and restriction state in the transaction. Selection fills an actually empty identity slot only. Clearing requires the exact unchanged self-selection and current publisher authority. Retain gallery when modifying the primary slot. Owner/admin selection uses its existing authority, but stamps new provenance.
- [ ] **Extend review:** an `identity_placement` request uses the existing queue/decision receipts, stored public asset preview, source/credit and narrow placement snapshot. Apply existing bounded proposal counts/rate limits without reserving new uploaded bytes. Approval changes placement only. Rejection/withdrawal records the placement-request disposition, without retiring the kit asset, creating a digest-wide content rejection, or scheduling its bytes for proposal-blob cleanup. Explicit moderator suppression remains a separate existing action.
- [ ] **Verify:** targeted command tests, `media-review-authority.test.ts`, `profile-assets-management.test.ts`, API-contract tests and backend typecheck. Extend preview tests to prove an existing-asset proposal reads the authorized stored object, not its source URL.
- [ ] **Review and commit:** reviewer checks same-asset reselection, all owner/legacy selection callers, and retention/capacity interactions; commit `feat: separate profile picture selection from publication`.

### Task 3: Own published-item corrections and removal

**Files:** Extend `_mediaContributionCommands.ts`, schema and wrappers; tests in `media-contribution-commands.test.ts` and the media-review contract tests.

**Interfaces:**

- Export `ContributionMetadataPatch` with optional `label`, `altText`, `credit`, `creditUrl`, `sourceUrl`, `sourceDescription` fields, using existing sanitizers/limits. Clearing optional values uses `null`; required credit and at least one provenance field cannot be cleared.
- Export strict `ContributionManageCommand`: command base plus either `{ action: "update_metadata", metadata: ContributionMetadataPatch }` or `{ action: "remove" }`.
- Implement `contributionManageCommand(ctx: MutationCtx, input: ContributionManageCommand, actor: ReviewActor): Promise<CommandReceipt>`; expose browser `manageContribution` and attested `manageContributionForMcpActor` wrappers.
- Add optional asset `sourceDescription` for corrected local provenance. Preserve the original submission/evidence; the published-detail projection reads current asset metadata.

- [ ] **Write tests:** own kit-only corrections commit and change `contributionVersion`; empty credit/provenance and wrong-submitter edits refuse. Removal excludes the item from the public kit through existing logical deletion/retention. Active primary placement, another actor's selection, newly claimed target, suppression, and private owner media block contributor management. Own approved history remains readable without leaking current private asset bytes/metadata. Ordinary contributors can manage their own independently approved kit-only items without a publisher grant.
- [ ] **Confirm failure** with the Task 2 command-test invocation.
- [ ] **Implement bounded management:** allow only the listed metadata fields, never bytes, target, visibility, or arbitrary placement changes. Recheck profile/asset/provenance and verification; retain audit before/after metadata and command receipt. Use existing retirement/cleanup machinery and legal-hold behavior. Update capability/version projections after every mutation.
- [ ] **Verify:** command tests, existing asset-management tests, contract tests and backend typecheck; prove same-key retry cannot produce repeated correction/removal or mutate a different item.
- [ ] **Review and commit:** reviewer checks post-review metadata permissions, private projections and cleanup references; commit `feat: manage own published media contributions`.

## Phase 2: Website and MCP parity

### Task 4: MCP contracts, dispatch and catalog

**Files:** Modify `apps/web/src/lib/server/mcp-media-review.ts`, `vrdex-mcp.ts`, API-contract exports, `tests/web/mcp-media-review.test.ts`, `vrdex-mcp.test.ts`, `scripts/smoke-vrdex-mcp-compat.ts`, `scripts/smoke-mcp-inspector-client.ts`, and their `tests/scripts` smoke tests.

**Interfaces:**

- Keep `vrdex_media_submission_publish` with its existing input shape, now kit-only.
- Add `vrdex_media_contribution_get` (submission ID, `mcp:read` + `assets:contribute`), `vrdex_media_contribution_manage` (Task 3 input, `mcp:write` + `assets:contribute`), `vrdex_media_contribution_place` (Task 2 placement input, `mcp:write` + `assets:publish`), and `vrdex_media_contribution_propose_placement` (command base, `mcp:write` + `assets:contribute`).
- Use the backend functions from Tasks 2/3. Existing owner `vrdex_profile_media_manage` remains owner-scoped; do not widen `assets:write` or route contributor management through owner wrappers.
- Declaration is absent from advertised tools; compatibility dispatch retains terminal historical behavior from Task 1.

- [ ] **Write transport tests:** no declare call is needed before publish; each new tool dispatches the exact input to the correct attested wrapper and validates `CommandReceipt`/detail output. Missing operation scope prevents backend execution. `assets:contribute` alone cannot select/clear primary even when the account has a publisher grant. Contributor projections omit private reviewer information and private owner assets.
- [ ] **Run to failure:** `node --import tsx --test tests/web/mcp-media-review.test.ts tests/web/vrdex-mcp.test.ts`.
- [ ] **Implement registration/mapping:** extend the existing handlers and write-audit machinery. Add scope hints consistent with the existing OAuth recovery path. Provide useful action descriptions that distinguish kit publication, primary placement, and reviewed replacement; treat substantive descriptions as reviewable copy before shipping.
- [ ] **Update independent catalog expectations:** add new tools/schemas and remove declaration from advertisement in the web catalog fixture and compatibility/Inspector smoke scripts. Preserve independent expected assertions rather than generating them from the implementation under test.
- [ ] **Verify:** targeted web tests, `pnpm verify:api-contracts`, `pnpm verify:vrdex-mcp`, `pnpm typecheck:web`; local compatibility smoke shows the intended catalog but is not hosted mutation proof.
- [ ] **Review and commit:** reviewer inspects scopes, actor binding, retries, privacy and compatibility behavior; commit `feat: expose media kit contribution actions through MCP`.

### Task 5: Website publication and published-item actions

**Files:** Modify `apps/web/src/app/_components/profile-media-contribution-editor.tsx`, account `media-contributions/{publication-card,media-contributions-panel}.tsx`, account `media-review/media-review-panel.tsx` and `media-review/media-review-view.ts`, and `apps/web/src/app/_components/profile-public-page.tsx` for verified gallery title/download behavior. Create `published-contribution-card.tsx`. Update `apps/web/src/components/trusted-publication.stories.tsx`, `media-review-comparison.stories.tsx`, `apps/web/e2e/media-contribution.flow.spec.ts`, `media-kit.visual.spec.ts`, and `tests/web/{media-command-result,media-review-view,profile-media-kit}.test.ts`.

**Interfaces:** Pending card consumes `ReviewDetail` and calls Publish once. Published card consumes `PublishedContributionDetail`, calls the Task 2/3 wrappers and exposes only current capabilities. Reviewed replacement sends the Task 2 proposal command. Use existing result/refusal/retry components and retain the exact pending payload/key after an uncertain response.

- [ ] **Write flow assertions:** the trusted publisher card has zero declaration checkboxes and no Confirm evidence action. Publish makes the kit item visible without changing the hero/avatar. Published item allows eligible picture selection, undo, metadata editing and removal. A protected selection has no contributor removal action. Ordinary review approval publishes into the kit; explicit replacement compares current picture with the published candidate.
- [ ] **Confirm failure** using the existing disposable authenticated media fixture environment. In PowerShell set `$env:VRDEX_E2E_MEDIA_LIFECYCLE='true'`, then run `pnpm --filter web exec playwright test e2e/media-contribution.flow.spec.ts`. Extend its fixture grants/OAuth scopes for publisher and distinct reviewer scenarios. Require executed assertions rather than a skipped suite; absent fixture credentials are a blocker, not proof. Storybook fixtures provide deterministic pending/published/refused/unknown-outcome cases.
- [ ] **Implement the journey:** submit gallery intent; simplify pending card to preview, destination, attribution, readable source and one primary Publish action. Keep independent review secondary. Render published actions separately and derive visibility from backend capabilities. Show source description as text when no URL exists; URL links use validated existing URLs and readable labels rather than raw signed attachment strings. Preserve authentication return paths and direct contribution links.
- [ ] **Implement correction UI:** edit current asset metadata, distinguish clearing primary from removing the kit item, and send protected replacements to review without another upload. Retain candidate bytes and draft metadata on conflicts/errors; refresh capabilities before a new decision.
- [ ] **Verify:** `pnpm typecheck:web`, targeted media result/view/kit tests, local contribution flow, desktop/mobile Storybook and public-kit screenshots. Use a VLM to review spacing, button hierarchy, long sources, disabled/protected states, keyboard accessibility, and no implied avatar placement. Show any substantive new public wording verbatim to BASIC before shipping.
- [ ] **Review and commit:** reviewer checks UI/backend parity and pending-key recovery; commit `feat: simplify media kit publication and picture actions`.

## Phase 3: Conversion and hosted verification

### Task 6: Bounded migration, Karly correction and end-to-end proof

**Files:** Create `convex/mediaKitPublicationMigration.ts`, `tests/backend/media-kit-publication-migration.test.ts`; modify `tests/backend/hosted-mcp-profile-media-contributions.test.ts`, `apps/web/e2e/media-contribution.flow.spec.ts` for actual hosted lifecycle proof, `docs/engineering/media-review-commands.md`, and `docs/testing/mcp-media-staging-lifecycle.md`.

**Interfaces:** Export an operator-only internal mutation `convertBatch({ dryRun: boolean, cursor: string | null, limit: number })` returning `{ scanned, changed, skipped, conflicts, continueCursor, isDone }`, with limit `1..40`. Dry-run is the default in its operator wrapper. It converts pending uploaded proposals to `kit_asset`/gallery and increments review revision without changing uploaded bytes or historical receipts. It also backfills immutable source-submission provenance only from unique matching approved records.

For the explicit correction, export internal `correctPrimaryToKit({ dryRun: boolean, submissionId, expectedAssetId, expectedPlacementId, expectedPlacementUpdatedAt })`. Require exact current public asset/profile linkage and unchanged eligible primary placement; return a report/refusal, never select another image. Karly's current approved submission is `x1747ftcbeq1k475kz4hqdn77d8fcz0r`; resolve current IDs in dry-run, do not hardcode guessed asset IDs. Keep production correction separate from generic conversion.

- [ ] **Write tests:** repeated conversion changes nothing twice; stored candidate/digest and source stay intact; old review versions refuse; a refreshed pending proposal publishes without re-upload. Already consumed/public assets keep one published charge. Nonunique legacy provenance is skipped, not guessed. Private, claimed, changed or protected primary records refuse the exact correction, while the permitted correction leaves an active public gallery asset and no authored primary placement.
- [ ] **Run to failure:** `node --conditions=import --import tsx --test tests/backend/media-kit-publication-migration.test.ts`.
- [ ] **Implement bounded conversion/reporting:** preserve deliberately selected and ambiguous existing pictures, historical assertion/reviewer identities and privacy. Add `profileMediaSubmissions.by_approvedAssetId` for a bounded two-record uniqueness check before backfilling an asset's source submission. Add gallery only to already public contribution assets requiring retention protection. Do not publish private owner media or invent legacy selection provenance. Reconcile legacy uploaded intents at finalization so an upload admitted before conversion can finish into the new kit flow.
- [ ] **Run regression gates:** targeted media suites, contracts, MCP and web verification, markdown checks, and `pnpm check:backend:generated`. Update operating docs to distinguish kit approval from placement approval, retirement from byte deletion, and old-client behavior.
- [ ] **Prove staging through actual authenticated MCP:** upload to the minted endpoint, complete, inspect, publish without declare, get approved state, view/download kit, select/undo primary, correct/remove kit-only item, submit a replacement and have a distinct authorized reviewer decide it. Include existing-picture publication, an unrelated profile edit, a stale selection, a protected same-asset reselection, revoked authority and same-key lost-response recovery. Use existing disposable staging identities/resources and runtime; keep raw tokens/upload targets out of public evidence.
- [ ] **Prove website:** exercise the same staging publisher/reviewer capabilities through browser UI; capture public kit and unchanged/selected/restored picture screenshots on desktop/mobile. Check the deployed feature gate and public field visibility. A receipt alone is insufficient if the asset does not render or download.
- [ ] **Independent review and one PR:** fix findings, commit the migration/proof/docs round, run whole-branch review and required checks. Publish the PR when authorized. Each change round uses a fresh implementer and independent reviewer; handle/reply to/resolve valid review threads before pushing. After the latest commit's 30-minute window, refresh exact-head checks, PR comments, threads, reviews, mutable AI summaries and mergeability. Do not merge automatically.
- [ ] **Deployment handoff:** provide the bounded migration dry-run report, Karly exact-resource correction preview, backend/web ordering and hosted evidence. With production authorization, apply reviewed conversion/correction and verify production kit/download/placement state. Planning or implementation approval alone is not authorization for those live actions.

## Completion and handoff

All acceptance items in the approved spec map to Tasks 1-6. Claimed-profile owner-notification proposals remain documented follow-up work, without scaffolding in this PR. Stop after this plan is reviewed; then execute with the already selected subagent implement/review method.
