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
Own withdrawal does not require review verification. Hosted adapters also carry
server-owned token/client/resource identity. Every internal protected read and
command checks the current token, linked application/client, resource and scope
pair before resource access or receipt replay. Revocation between selected
commands stops later commands even within the same HTTP request. Legacy trusted
internal callers may omit OAuth identity; client-facing tools cannot supply it.

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

MCP preview accepts optional `target: "candidate" | "current"` (candidate by
default). Candidate and managed-current previews read the download rendition
whose SHA-256 is stored, including legacy records with a single rendition. The
current image follows the effective public image/logo slot, including alternate
managed placement, legacy fallback and enabled automatic artwork. Its authorized
storage descriptor binds the inspected version before acquisition, and detail
is reauthorized after acquisition. Legacy/automatic current artwork uses only
the server-selected URL/provider snapshot through bounded safe-fetch/cache
helpers. It never uses contributor provenance or a client-provided URL. Blocked
redirects and unavailable images return a safe unavailable result. Remote
URL/provider identity does not prove immutable bytes if upstream changes at the
same URL. The renderer keeps the 12 MiB input, 16,777,216 pixel, 2,048
maximum edge, and 4 MiB PNG output bounds. High-entropy images are resized through
bounded halvings until the raster output fits. Native SVG and donor source-URL
bytes are never returned. Image delivery records no claim of human examination.

Local Storybook fixtures exercise URL-free provenance up to 1,000 characters,
current/candidate comparison, selection/refusal retention, and explicit rebase
on desktop and mobile. This is component interaction evidence, not a hosted
authenticated end-to-end or provider-storage test.

## Bounded trusted publication

`trusted_publisher` is a separately issued, revocable account feature. Neither
super-admin, reviewer, application tier nor contribution capacity implies it.
The browser uses `publisherDetail`, `declarePublicationEvidence`, and `publish`.
MCP uses `vrdex_media_submission_get`, `vrdex_media_submission_preview`,
`vrdex_media_submission_declare`, and `vrdex_media_submission_publish`.
Reads require `mcp:read` and `assets:publish`; declarations and publication require
`mcp:write` and `assets:publish`. These scopes are requestable, never defaults.
Every backend operation requires fresh verified email and the explicit grant.
Publisher projections are own-only and require a current public, published,
unclaimed target. They omit private reviewer reasons and moderator identities.
They do not confer independent reviewer authority.

Publication takes exactly `{submissionId, expectedReviewVersion, idempotencyKey}`.
Before publication, including for older pending proposals, the explicit declaration
command takes those same fields plus four booleans: `identityConfirmed`,
`attributionConfirmed`, `publicationPermitted`, and `noKnownRestrictions`.
Declarations are immutable records bound to the candidate digest, target, placement,
source reference or local provenance, and attribution. Recording one changes the
review version. Inspect again before publishing. Absent, false or stale declarations
require independent review. Nonempty credit or source text never implies consent
or identity confirmation. Upload completion only submits; it never publishes.
Choosing Independent review on the contributions page leaves the existing proposal
in its independent-review queue and closes the publication controls locally.

The publication mutation reads the current target, both image/logo placements,
legacy image visibility, actual automatic artwork, declarations and restrictions
in one transaction. Review versions bind authored placements and cached source
identity/artwork records, including changes without an observed-time bump. Visible
VRChat icons, group logos and Discord artwork fill a slot. Disabled or hidden
fallbacks follow public rendering semantics. Existing authored placements remain
protected even when hidden. A target version or candidate change refuses the
inspected command. Conflicts preserve the independent-review path.

Restriction history is indexed independently of mutable source URLs and collection
item keys. Identity/dispute records restrict the target; rejection and suppression
restrict the exact content digest across targets. Legacy rejected submissions and
suppressed assets are checked by indexed digest as well. An unrelated digest is
not refused solely because the target once had a rejection. Matching new history
is linked through `priorRestrictionId`. Byte-different variants are not identified
perceptually; the explicit no-known-restrictions declaration remains required.
Admin `recordPublicationDispute` records identity/dispute restrictions. Existing
suppression records a correction linked to the published operation; legal-hold and
cleanup authority are unchanged. These records do not contain private reasons.

New approvals persist `publicationMethod`, `publicationActorUserId`,
`publicationEvidenceRevision`, and `publicationOperationId` on the submission.
Trusted publication does not populate reviewer fields. Independent decisions keep
the same-user refusal, including for admins. Legacy direct approval calls also
record an operation receipt; preexisting approvals stay method-unknown and appear
as Legacy approval. No migration invents independent reviewers. Super-admin
`publisherPublications` provides a bounded sampling query, indexed by method and
publisher, with actor/publisher-scoped cursor, splitCursor and endCursor handling.
Its projection contains submission/profile/asset references and the operation and
evidence revision, without private reasons.

Both publisher previews reuse the stored-candidate digest/version checks and safe
PNG rasterizer. The browser route is
`/api/account/media-contributions/submissions/:id/file?version=:reviewVersion`.
It derives authority from the browser session on each read and returns no-store
PNG only. Candidate preview never fetches donor source URLs. Local Storybook tests use controlled
commands and synthetic images; they do not establish hosted authentication,
stored S3 transfer or installed Codex/Claude transport evidence.

## Capacity and rollout

`trusted_contributor` grants capacity only. It does not grant review, publication,
ownership or OAuth scopes. Contributor capacity, own requests/status, temporary
batch allowances, shared accounting, payload expiry and rollout evidence are
documented in the [collection checkpoint](../testing/contributor-collection-checkpoint.md).
Intake pause preserves existing review, withdrawal and receipt reads.

## Own lifecycle and recovery

The implemented journey below is local code behavior; hosted enablement and
authenticated provider/client evidence remain separate rollout gates. Existing
direct proposal links and account entry points converge on the same commands.

```mermaid
flowchart TD
  MCP[MCP client] --> OAuth[OAuth sign in and scoped consent]
  OAuth --> Intake[Collection or direct local / URL upload]
  Intake --> Own[Own contribution list and exact lookup]
  Site[Website account or direct proposal link] --> SignIn[Sign in]
  SignIn --> Account[/account/media-contributions]
  Account --> Own
  Own --> Withdraw[Versioned withdrawal]
  Own --> Publisher[Separate publisher grant: inspect and declare]
  Publisher --> Publish[Explicit publish]
  OAuth --> Assigned[Discover assigned collections]
  Assigned --> Review[Authorized review queue]
  SignIn --> ReviewPage[/account/media-review]
  ReviewPage --> Review
  Review --> Compare[Current and stored candidate comparison]
  Compare --> Decision[Versioned decision or explicit rebase]
  Decision --> Receipt[Durable receipt]
  Withdraw --> Receipt
  Publish --> Receipt
  Receipt --> Own
  Decision --> Unknown[Response lost: retain exact command]
  Publish --> Unknown
  Withdraw --> Unknown
  Unknown --> Retry[Retry same key and input]
  Retry --> Receipt
```

`vrdex_list_my_media_submissions` accepts optional cursor, limit (1-40), status
and batch ID, retaining the `submissions` field for existing callers and adding
`continueCursor`/`isDone`. `vrdex_get_my_media_submission` provides exact own
lookup, with expiry, review version and linked collection/revision/receipt when
present. Both need `assets:contribute` plus `mcp:read`, without publisher or
reviewer grants. Projections omit private review notes and only expose approved
asset IDs when current public field visibility permits it. Batch filtering may
produce an empty page with a continuation cursor. The website loads additional
lifecycle pages explicitly.

`vrdex_media_review_assignments` discovers live assigned collections with bounded
pagination under `assets:review:read` and `mcp:read`. Assignment authority is
independent of batch intake enablement; intake rollback preserves existing
review, rebase and authorized receipt reads. Assignment changes append actor,
reason and grant/revocation state to `contributionReviewerAuditEvents`; older
internal callers without a reason use `Legacy assignment command`.

New withdrawal callers use `withdrawWithReceipt` or
`vrdex_media_submission_withdraw` with submission ID, expected review version and
idempotency key. Own authorization precedes replay; competing review or stale
state yields a durable refusal. Legacy boolean wrappers remain available.
Single browser decisions, rebase, withdrawal and publication retain exact pending
input/key after response loss and expose Retry. Opposing controls stay locked.
Unresolved single-review cards remain mounted even if the committed item leaves
the reactive queue. Publication cards remain mounted while their command is
unresolved, including when the own-inventory row changes to approved before a
lost publish response is recovered. Pending recovery survives reactive updates in the mounted
page, not a full browser reload.

Upload and collection MCP failures use allowlisted bounded codes and structured
receipt metadata: `retryable`, `retryCategory`, `nextAction`, and optional bounded
`retryAfterMs`. Unknown transport/commit outcomes are `in_progress` with
`retry_same_key`; validation, capacity and stale-state refusals have distinct
correction, wait or inspection actions. Known backend codes travel as bounded `ConvexError.data.code`; raw backend
exception text is not returned. Stale or unavailable profile-link targets persist
a refusal on the exact revision. Terminal receipts remain authoritative on replay.
