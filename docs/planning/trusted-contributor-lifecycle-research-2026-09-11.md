# Trusted contributor research: media lifecycle

Status: research findings and candidate directions, not approved policy.

Inspected source: `74cf6b8a8e96cadf9622aba1cddaef9d0c35930b`, September 11, 2026. This is a read-only code audit with a documentation artifact. Deployed behavior and current environment flags are UNKNOWN in this audit. No ingestion, grants, publication, or production operations were performed. Private motivating evidence was not copied here.

## Current boundaries

Source anchors below are repository-relative file and line references at the inspected commit.

| Control | Current source behavior | Source |
| --- | --- | --- |
| Open backlog per contributor | 3 across all profiles | `convex/profileMediaSubmissions.ts:32-35,135-150` |
| Open backlog per target | 2 across all contributors | `convex/profileMediaSubmissions.ts:34,153-168` |
| Creation budget per contributor | 6 in rolling preceding 24 hours, all statuses count | `convex/profileMediaSubmissions.ts:171-203` |
| Creation budget per target | 20 in rolling preceding 24 hours | Same |
| Burst pacing | 30 seconds since contributor's last created proposal | Same |
| Open definition | `upload_pending`, `submitted`, `under_review`, with `expiresAt > now` | `convex/profileMediaSubmissions.ts:32,135-168` |
| Upload reservation | 30 minutes; processing lease 10 minutes, maximum 3 attempts | `convex/_profileAssets.ts:13-17` |
| Review lifetime | Successful upload gives proposal 30 days to expiry | `convex/_profileAssets.ts:1021-1025` |
| Blob retention | Rejection/withdrawal gets 30 further days; expired proposals get expiry plus 30 days | `convex/profileMediaSubmissions.ts:1214-1238,1311-1332,1481-1502` |
| File bound | 12 MiB per validated representation; 8192 source dimension, 4096 stored dimension | `convex/_profileAssets.ts:13`, `apps/web/src/lib/server/profile-asset-validation.ts:10-11,233-242,308-320` |
| Public asset capacity | 12 active public assets per profile, checked after attachment | `convex/_profileAssets.ts:231-245,907` |

These are different controls. Raising only the daily budget cannot overcome the open backlog cap. Expired proposals stop consuming open capacity before physical deletion, so open count is not a storage budget. The reviewed paths have no aggregate contributor byte budget, global queued-byte budget, or review-throughput admission mechanism. File limits alone do not bound cumulative retained storage.

Browser creation requires active browser session and verified email. Targets must be published/public and unclaimed. Browser supports person profile-image and community primary-logo proposals. Hosted MCP preparation additionally restricts targets to person profiles and the profile-image placement. Both share the same hard-coded limits and feature flag (`convex/profileMediaSubmissions.ts:50-53,215-246,353-426,118-132,620-681`). No trusted-contributor override exists in these paths.

## Review, claim, and publication

`reviewerContext` accepts `superAdmin` or profile ownership. For unclaimed profiles it requires `superAdmin`, despite error text calling this a moderator. It does not check a distinct community moderator or trusted-reviewer capability (`convex/profileMediaSubmissions.ts:249-268`). Ownership means an active profileOwners row for this user/profile (`convex/_profileOwnership.ts:34-57`).

`startReview` and `decide` reject the submitting user even if they otherwise have authority. The record stores a reviewer when review starts, but `decide` does not enforce exclusive assignment to that reviewer. A different currently authorized reviewer may decide. There is no review lease or takeover workflow (`convex/profileMediaSubmissions.ts:1240-1307`).

MCP revalidates public/unclaimed/person state and the original profile timestamp before final import (`convex/profileMediaSubmissions.ts:819-868`). Claim approval changes claim state and profile timestamp in the ownership transaction (`convex/_profileOwnership.ts:118-135`). After an upload has become submitted, a later claim does not automatically discard it: the new owner may review, and superAdmin retains review authority. Decision requires a public target and current reviewer authority, but does not require the target still be unclaimed (`convex/profileMediaSubmissions.ts:1281-1307`). This distinction should be explicit in any future policy.

Approval checks the profile timestamp supplied by the reviewer and compares current placement against the placement snapshotted at proposal creation (`convex/profileMediaSubmissions.ts:1305-1307,1348-1359`). A competing approved proposal changes placement, causing the older proposal to refuse approval. Refresh alone cannot repair a stale stored placement snapshot; there is no rebase action in this module. This is a concrete bulk-review UX gap, even though the current failure text suggests refreshing.

Approval consumes the proposal upload, creates a public active asset with `source: community_submitted` and the original submitter as `uploadedBy`, and replaces the singleton placement. Displaced assets with no remaining placement are retired. Submission stores reviewer, reason, approval asset ID, and decision timestamp; profile audit records the action (`convex/profileMediaSubmissions.ts:1391-1425`; `convex/_profileAssets.ts:754-845,897-907`). Approval and consumption run in the mutation transaction. The attachment helper does not itself bump the profile timestamp; placement comparison remains essential for competing approvals.

SuperAdmin can suppress an approved asset; owners cannot restore moderator-suppressed or retired media (`convex/profileMediaSubmissions.ts:1430-1469`; `convex/profileAssets.ts:1786-1805`). Trusted submission capacity should not implicitly confer suppression, ownership, or review privileges.

## Provenance and duplicates

Submission records preserve source URL, credit, optional credit URL, contributor note, actor identity, original target identity/version, content hash and decision linkage (`convex/schema.ts:850-895`). MCP upload intents also preserve OAuth client/token/request attribution and idempotency fingerprint, and record API write audit events (`convex/profileMediaSubmissions.ts:685-728,869-888`). Private reviewer reasons and submitter email/token details are restricted to superAdmin review output; owners get less evidence (`convex/profileMediaSubmissions.ts:305-350`). Do not publish internal batch manifests or private source-message context by default.

Exact content-hash checks occur before object writes and again during finalization. Finalization scans all historical profile assets, and indexes matching submitted/under_review/approved proposals. Approval checks active assets again. Rejected and withdrawn proposals may be reproposed; historical approved proposals and deleted profile assets can still block identical content. Matching submitted rows are not filtered by expiry, so an expired row can remain a duplicate until lifecycle cleanup transitions it (`convex/profileMediaSubmissions.ts:892-936,1360-1367`; `convex/_profileAssets.ts:961-973,1004-1019`). Review shows at most 20 previous same-profile/hash proposals with a truncation indicator (`convex/profileMediaSubmissions.ts:310-322`).

Hash equality is not identity reconciliation or visual similarity. It does not deduplicate renamed profiles, changed encodings, different crops, or source claims. Future batch staging should report exact duplicates separately from possible identity matches and preserve the operator's confirmed mapping.

## Client and reviewer scaling

MCP contributor listing reads up to 40 of each status and returns only the newest 40 overall, with no pagination (`convex/profileMediaSubmissions.ts:1002-1070`). Large donations cannot reliably resume or inspect all results through this API. Browser review already uses indexed pagination, oldest first, with 40-row pages, but performs one-item review and decision (`convex/profileMediaSubmissions.ts:1167-1211`; `apps/web/src/app/account/media-review/media-review-panel.tsx:18-51,195-201,245-246`). There is no persisted collection manifest, per-item source ID, batch cursor, or mixed-result batch endpoint in this media schema.

MCP idempotency is actor/client/key scoped. Existing intents replay completed state or resume pending work. Refusal receipts are also durable, including cooldown and capacity refusals, and return the original refusal for the same key (`convex/profileMediaSubmissions.ts:490-634`). A future retry contract must distinguish a retry of accepted work from a new admission attempt after transient refusal. Merely telling clients to retry the same key later will not unblock the current refusal path.

Candidate previews use a browser-authenticated storage route, private/no-store headers, CSP sandbox and nosniff. Backend authorizes review access before returning the storage key (`convex/profileMediaSubmissions.ts:1131-1165`; `apps/web/src/app/api/account/media-review/submissions/[submissionId]/file/route.ts:37-97`). There is no contributor-wide preview authority inferred from submission status.

Cleanup is request-driven: superAdmin browser POST reserves records, deletes objects, then acknowledges completion. Each invocation scans the oldest 50 records per open status to mark expired items and returns at most 20 cleanup candidates. Legal holds block deletion; once reservation begins, a new hold is rejected. Tokens make retries explicit (`convex/profileMediaSubmissions.ts:1473-1632`; `apps/web/src/app/api/account/media-review/cleanup/route.ts:21-50`). `convex/crons.ts` contains no media-submission cleanup schedule. This path needs bounded automatic draining and observability before bulk retained storage is treated as operationally supported.

## Candidate implementation priorities

1. Centralize effective contribution policy by actor, with separate backlog, creation, burst, inflight, retained-byte and target-contention controls. Return remaining capacity, reset conditions, retry timing and publication mode through ordinary MCP capability/status tools. Preserve transactional admission.
2. Add persistent batch manifests and per-item outcomes using source-backed IDs and stable request identity. Stage metadata first; admit a bounded upload window. Paginate actor/batch results and expose individual resumption. Keep client-visible failures structured and distinguish transient admission from permanent refusal.
3. Keep trusted capacity and review authority separate. Introduce a narrowly scoped reviewer capability if review should be delegated beyond superAdmin. Initially retain independent media publication decisions, while allowing owners their existing media-management path. Explicitly decide claimed-target routing and superseded-placement resolution.
4. Add batch-oriented review with previews, provenance, exact duplicates, changed-target conflicts, and per-item decision results. Support selecting a reviewed group without making one stale item fail the whole batch. Never infer correctness from submission count alone.
5. Add expiry-indexed draining, storage accounting and cleanup telemetry; replace all-history profile asset scans with bounded/indexed hash lookups where scale warrants it. Distinguish an upload reservation, review expiry and physical-retention deadline in schema and status responses.

Owner decisions remain open: acceptable initial normal/trusted capacity, whether trusted media can ever publish without another reviewer, who grants review rights, treatment of existing proposals after a claim, and retention/service expectations for large collections. Numerical limits should be selected alongside reviewer throughput and aggregate storage budgets, not presented as evidence-derived constants.
