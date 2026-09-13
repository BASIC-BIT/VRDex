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

Current profile owners and active super-admins can review. Unclaimed profiles
require super-admin authority. Global queues require super-admin authority;
owners select an owned profile. Independent approval and rejection refuse the
submitter, including super-admin submitters. `startReview` is advisory.

Queue reads use status/expiry indexes with cursor pagination of 1 to 40 rows.
Submitted and under-review queues exclude expired rows before pagination.
Detail provides an opaque review version, current managed placement and credit,
legacy avatar URL, candidate provenance, and a stored-candidate reference.
Owner projections omit moderator identity evidence and private review reasons.
Preview storage resolvers share the detail authority predicate and return only
validated linked uploaded/consumed renditions that remain available for reading.
Client responses must not expose their internal storage keys.

## Decisions and retries

`decideWithReceipt` and internal `decideForMcpActor` accept submission ID,
expected review version, approve/reject, private reason, optional public reason,
and an idempotency key. Rejection requires a public reason. Strict runtime
contracts reject unknown fields and bound input strings.

The version hashes candidate/provenance, stored upload identity, current target,
current placement and asset, and the submission's optional `reviewRevision`.
Missing revisions mean zero for existing rows. Advisory start-review updates do
not invalidate it. Approval still checks the original placement snapshot; a
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
MCP tool registration and browser comparison UI are the next implementation
phase. Deployments, account grants, and publication operations remain separate.
