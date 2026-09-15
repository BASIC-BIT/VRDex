# Shared media review commands

The browser and trusted MCP server boundary call the same review authority and
publication transition in `convex/_mediaReview.ts`. Public browser functions
resolve the active session. MCP actor functions are internal Convex functions;
the hosted server must derive `actorUserId` from the authenticated delegated user.
Neither OAuth scope nor an actor ID supplied by a client grants resource access.

Review authority also requires a current verified email. Browser calls use the
authoritative identity claim. Internal MCP review calls accept server-only
`emailVerified` and `emailVerificationAttestedAt`, produced by the existing
hosted `verifyContributorEmail(principal.userId)` check and a fresh server
timestamp. The shared attestation helper allows at most two minutes of age and
30 seconds of backward clock skew. Missing, negative, stale, or future
attestations refuse reads and receipt replay even with an active owner/admin
role. These fields are never part of the client-facing decision schema.
Own withdrawal does not require review verification.

## Authority and projections

Current profile owners and active super-admins retain their resource authority.
A limited reviewer needs both an active `media_reviewer` account feature grant
and an active, unexpired assignment to the submission's collection. Assignment-only
authority applies to published, public, unclaimed profiles. A later claim or
privacy change removes that access, including historical receipt replay.
Global queues require super-admin authority; owners select an owned profile. Independent approval and rejection refuse the
submitter, including super-admin submitters. `startReview` is advisory.

Queue reads use status/expiry indexes with cursor pagination of 1 to 40 rows.
Submitted and under-review queues exclude expired rows before pagination.
Detail provides an opaque review version, current managed placement and credit,
legacy avatar URL, candidate provenance, and a stored-candidate reference.
Owner and assigned-reviewer projections omit moderator identity evidence and
private review reasons.
Preview storage resolvers share the detail authority predicate and return only
validated linked uploaded/consumed renditions that remain available for reading.
Client responses must not expose their internal storage keys.

Local-upload proposals carry `sourceKind: "local"` and may replace the source URL
with a bounded private source description. Review consumers omit the source link
when no URL exists. Legacy URL intake still requires a URL. The
[local upload verification guide](../testing/local-media-upload.md) documents
transport, reservations, cleanup configuration, and the separate S3 proof gate.

## Decisions and retries

`decideWithReceipt` and internal `decideForMcpActor` accept submission ID,
expected review version, approve/reject, private reason, optional public reason,
and an idempotency key. Rejection requires a public reason. Strict runtime
contracts reject unknown fields and bound input strings.

The version hashes candidate/provenance, stored upload identity, current target,
current placement and asset, and the submission's optional `reviewRevision`.
Missing revisions mean zero for existing rows. Advisory start-review updates do
not invalidate it. Approval checks the original target and placement snapshots; a
fresh detail read does not silently rebase the proposal. Rejection remains
available against a refreshed version when that original placement has changed.

Successful publication and its immutable receipt commit in one transaction.
Expected terminal refusals also persist receipts. Projected active-public-asset
capacity is checked before writes, accounting for singleton assets that retire
only when no other active placement remains. `capacity_exceeded` remains refused
when capacity later becomes available. The upload consumer retains its final
transactional capacity assertion. Reusing a key with identical
canonical input returns the original receipt; changed input returns
`idempotency_conflict`. Clients retain the key after a lost response or refusal
and must not generate replacement keys automatically. Authorization is checked
again before any receipt lookup. Unexpected transaction errors roll back and
may be retried with the same key.

Legacy `decide` retains its argument/result shape and calls the shared transition.
The receipt path is the required interface for new browser/MCP clients.

## Delegation and rollout

Review reads use `assets:review:read` plus `mcp:read`; decisions use
`assets:review:write` plus `mcp:write`. The hosted adapter checks this pair before
calling the internal function. Existing contribution scopes gain no review
power. Own withdrawal is an internal actor command with a submitter ownership
check and does not require review authority.

This source change neither changes intake limits nor grants accounts new
features. The separate contribution and media-kit switches still apply.
MCP tools and the browser use these shared commands. Deployments, account grants,
and publication operations remain separate.

## Assigned collections and explicit rebase

`profileMediaSubmissions.setBatchReviewer` is a verified-browser super-admin
mutation. It creates, updates, or revokes an exact batch/user assignment and
refuses assignment of the donor to their own batch. It does not grant the
separate account feature. Assignment-based access is also gated by
`VRDEX_CONTRIBUTION_BATCHES_ENABLED`, whose hosted default remains disabled.

Submission membership comes from `contributionItemAttempts.by_submissionId`
and its immutable `contributionItemRevisions.batchId`, rather than a second
media lifecycle in collection items. Collection item readers also recheck the
current target authority and exclude unrelated profile/link source records.
Reconciliation reads remain strictly actor-owned. Every cursor is scoped to
its authenticated actor, exact resource, and filters. Reactive split pages wrap
both outgoing continuation and split cursors and validate both incoming start
and end cursors. Optional and null cursor boundaries retain their meaning.

`assignedReviewBatches` traverses `by_reviewer_active` in bounded pages. A review
queue with `batchId` traverses immutable revisions through `by_batch_key_revision`,
then resolves each attempt and live submission status. Nonmatching rows can
produce an empty page with a continuation. Consumers must keep traversing until
`isDone`, rather than treating an empty page as exhaustion. No status is copied
into a mutable collection item.

Browser `rebase` and internal `rebaseForMcpActor` share `rebaseReviewCommand`.
The MCP name is `vrdex_media_review_rebase`, requiring review-write delegation.
Rebase records the prior target identity/version and placement asset, the current
target and placement context, the inspected version, actor, and incremented
revision in `mediaReviewRebases`. It updates the proposal baseline without
approving. The next decision must use the new version. Donors have no rebase
privilege; rejection remains possible without rebase against a fresh version.

## Selected decisions and preview bounds

`vrdex_media_review_decide_selected` and the website share
`decideSelectedReviews`. Its strict input is `{ decisions: ReviewDecision[] }`,
with 1 to 20 explicit objects, each carrying its own viewed version, reasons,
and idempotency key. It snapshots the input before awaiting and invokes each
single-item command in its own transaction, returning ordered receipts. An
appended queue item cannot enter the selection. There is no filter approval.
A failed command does not roll back earlier successes or stop later commands.
A thrown transport error is `in_progress` with `decision_unavailable`, since the
mutation may have committed before response loss. Retrying preserves the exact
key and input and retrieves the authoritative backend receipt.
The browser retains failed selections and shows their individual outcomes;
reselection after inspecting current context creates a deliberate new command.

MCP preview bytes come only from the stored candidate whose SHA-256 matches the
inspected version. The renderer keeps the 12 MiB input, 16,777,216 pixel, 2,048
maximum edge, and 4 MiB PNG output bounds. High-entropy images are resized through
bounded halvings until the raster output fits. Native SVG and donor source-URL
bytes are never returned. Image delivery records no claim of human examination.

Local Storybook fixtures exercise URL-free provenance up to 1,000 characters,
current/candidate comparison, selection/refusal retention, and explicit rebase
on desktop and mobile. This is component interaction evidence, not a hosted
authenticated end-to-end or provider-storage test.
