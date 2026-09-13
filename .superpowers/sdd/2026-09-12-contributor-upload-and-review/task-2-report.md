# Task 2 report: complete MCP and website review

Status: implemented and locally verified. Shared staging proof remains unexecuted.

Implementation commit: `917af2c10d48543babc97e9529b0bfb7cbce37ad`.

## Changes

- Added hosted MCP tools `vrdex_media_review_list`, `vrdex_media_review_get`,
  `vrdex_media_review_preview`, `vrdex_media_review_decide`, and
  `vrdex_media_submission_withdraw`.
- Review reads require `mcp:read assets:review:read`; decisions require
  `mcp:write assets:review:write`; own withdrawal requires
  `mcp:write assets:contribute`. Request classification computes the union for
  mixed batches before dispatch, and the one-write-per-batch rule includes both
  new writes.
- Each protected review invocation uses the trusted OAuth actor and calls the
  existing hosted `verifyContributorEmail(principal.userId)`. The server stamps
  `Date.now()` and never accepts verification or actor identity from tool input.
- Preview requires the inspected `reviewVersion`, obtains the server-only
  candidate descriptor through Task 1 authority, reads only that stored object,
  validates its MIME, declared length and SHA-256 against the authorized detail,
  then rechecks the version before emitting pixels. Sharp decodes within a
  16,777,216-pixel limit, fits within 2048 by 2048, strips active markup by
  encoding PNG, and refuses output above 4 MiB. Stored input remains capped at
  12 MiB. Tool content never includes the source URL, storage key, raw SVG, or
  moderator-only identity outside the authorized projection.
- The browser review panel now uses `reviewDetail` plus
  `decideWithReceipt`, displays the current and candidate images side by side,
  keeps private and public rejection reasons separate, and makes stale
  review/placement refusals visible. Existing suppression remains available.
- The current-image projection matches public profile rendering: a managed
  placement wins, then the legacy avatar field, then the selected automatic
  VRChat/community fallback. The automatic fallback is included in
  `reviewVersion`, so changed fallback artwork invalidates an inspected review.
- The contribution panel retains existing own-withdrawal behavior; MCP now
  exposes the same own-withdrawal transition without reviewer privilege or
  verified-email attestation.
- Extended the existing opt-in two-Clerk-user lifecycle fixture instead of
  duplicating it at `media-review.spec.ts`, per the controller's plan-path
  adjustment. The fixture proves browser donor denial, MCP self-review refusal,
  authorized native preview, different-owner MCP approval, identical receipt
  replay, browser status parity, one public asset, and existing exact cleanup.
- Added a Storybook comparison fixture and desktop/mobile visual capture. Both
  screenshots were inspected: the wide layout presents an aligned two-column
  comparison, and the narrow layout stacks full-width images with readable
  conflict text.
- Updated hosted OAuth/read-tool/lifecycle docs, MCP tool event catalogs, scope
  discovery expectations, and regenerated OpenAPI JSON/YAML after Task 1 scope
  additions.

## Reviewed interfaces consumed

- Browser: `profileMediaSubmissions.reviewDetail`,
  `profileMediaSubmissions.decideWithReceipt`, existing indexed
  `listForReview`, `withdraw`, and `suppressApprovedAsset`.
- MCP internal: `listForReviewForMcpActor`, `reviewDetailForMcpActor`,
  `candidateForMcpActor`, `decideForMcpActor`, and `withdrawForMcpActor`.
- Every protected MCP review call supplies server-derived `actorUserId`,
  `emailVerified`, and `emailVerificationAttestedAt`. Withdrawal supplies only
  server-derived actor identity.

## TDD and verification

- RED: `mcp-media-review.test.ts` initially failed because the server adapter
  module did not exist. Added coverage for per-call attestation, native image
  output, stale version refusal before storage access, hash mismatch refusal,
  durable decision replay, and withdrawal without review attestation.
- RED: new MCP discovery/classification tests initially failed because the five
  tools and the scope-union helper did not exist.
- RED: browser view-model tests initially failed because receipt conflict and
  current-placement selection helpers did not exist.
- Focused handler tests: 6/6 passed.
- Focused browser view tests: 3/3 passed.
- Focused automatic-fallback authority and comparison tests: 10/10 passed.
- Focused media authority/submission suites after the fallback fix: 35/35 passed.
- `pnpm test:api-contracts`: 38/38 passed after extending the shared snapshot.
- Focused scope/discovery and updated OAuth catalog tests: 30/30 passed.
- Initial broad web run found six stale OAuth/tool-discovery expectations after
  adding the Task 1 scopes. Their focused rerun passed 30/30. A later broad run
  found one remaining write-tool list expectation; its focused rerun passed.
- Final `pnpm test:web`: 463/463 passed.
- Storybook build: passed after rerunning outside the restricted sandbox, which
  initially denied access to Storybook's dependency cache.
- Storybook visual: 2/2 passed (`storybook-desktop`, `storybook-mobile`).
- `pnpm test:backend`: 800/800 passed.
- `pnpm typecheck:web`, `pnpm typecheck:backend`, and `pnpm lint:web`: passed.
- Markdown lint: 153 files, zero errors. `git diff --check`: passed.
- OpenAPI generation and `pnpm check:api-openapi`: passed.
- The opt-in lifecycle test loaded under the ordinary Playwright configuration
  and reported one skipped test because
  `VRDEX_E2E_MEDIA_LIFECYCLE=true` was deliberately absent.

## Visual evidence

- `apps/web/playwright-artifacts/storybook/storybook-desktop-media-review-comparison.png`
- `apps/web/playwright-artifacts/storybook/storybook-mobile-media-review-comparison.png`

These artifacts are local Playwright output and are not committed.

## Evidence boundary and limitations

- No deployment, shared staging flag/config mutation, OAuth grant, production
  action, push, merge, or live review decision was performed.
- The authenticated two-user browser/MCP proof is implemented but was not run
  against staging. It requires an exact candidate deployment plus temporary
  shared staging configuration, which remains a separately approved operation.
  The skipped local invocation is not claimed as auth/client proof.
- Intake limits and publication thresholds are unchanged.

## Exact proposed public copy

New utility labels: `Current`, `Candidate`, `No image`, `Unavailable`, and
`Public rejection reason`.

New browser status/error strings:

- `Review detail is unavailable.`
- `Review changed. Inspect the current images before deciding again.`
- `Decision is still in progress.`
- `The target profile is no longer available for this review.`
- `Decision refused.`
- `Decision refused: {machine code}.`

New MCP titles and descriptions:

- `List Media Reviews`: `List media submissions available to the signed-in reviewer.`
- `Get Media Review`: `Inspect one media submission and its current placement.`
- `Preview Media Review`: `Render the stored candidate for an inspected review version.`
- `Decide Media Review`: `Approve or reject one inspected media submission.`
- `Withdraw Media Submission`: `Withdraw one open media submission made by the signed-in user.`

These exact strings are proposed for BASIC's public-copy review. They have not
been deployed or shipped.
