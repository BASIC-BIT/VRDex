# Trusted contributors and bulk contributions

Status: research and design brief, 2026-09-11. BASIC approved the bounded trusted-publisher policy below; numerical limits and implementation details remain recommendations. Policy approval is not implementation or operational authorization. No account grants, production limits, media decisions, ingestion, or deployments were changed.

## Recommendation

Make collection donation an ordinary contribution workflow. Raise baseline media capacity enough to accept a useful collection, add an attainable trusted-contributor grant for larger work, and let both use the existing MCP contribution tools. Add durable batch identity, private staging, paginated status, and selected-item review. Trust should initially change capacity. A separate, narrowly scoped reviewer grant should let reliable people review other contributors' media without becoming super-admins.

MCP must support the complete review loop as well as intake. A reviewer should be able to list assigned work, see the actual candidate and current image, inspect provenance, approve or reject exact items, and recover interrupted decisions through ordinary MCP tools. The website uses the same backend rules. Deliver usable review before enabling larger intake limits.

Fold in [upload-intent bridge issue #340](https://github.com/BASIC-BIT/VRDex/issues/340). A local-file client receives a short-lived byte-transfer authorization through MCP, sends the file over HTTPS, then finalizes through authenticated MCP. Include both owner and contributor modes in the design; contributor finalization creates a private proposal. [Upload research](./mcp-local-upload-bridge-research-2026-09-11.md) identifies required corrections to the issue's transport example and credential boundary. [Fresh review research](./media-review-workflow-research-2026-09-11.md) traces the browser implementation and missing MCP operations.

Locked decision, approved by BASIC on 2026-09-11: add a separately granted trusted-publisher permission. It allows self-publication when filling an empty image/logo slot on a public unclaimed profile with a clear identity match, source, and credit. Replacements, uncertain identity or attribution, disputes, and previously rejected/suppressed material require independent review. Contributor permissions cannot override a claimed profile's owner. Record self-publication as trusted publication, without implying independent review. Preserve provenance, correction history, revocation, and the option to request another opinion. Use occasional review of published work to check quality. Exact public-facing wording is not approved by this policy decision.

Trusted-contributor capacity, trusted-publisher authority, and reviewer authority are separate grants; holding one does not confer the others. BASIC is a sensible initial publisher candidate, and the qualification path must remain available to other reliable contributors. Granting any account that authority remains a later operational action. Ordinary profile creation and eligible profile corrections already publish directly in VRDex; preserve that single-item behavior and introduce explicit staged collection work. A batch is not permission to publish every row, and contributor trust is not proof that a profile or external identity is verified.

The product value is concrete: a community can donate an existing performer directory, stream links, and images once, reconcile them with VRDex, and resume the remaining work without an operator script. This follows the operator workflow in [product direction](./product-direction.md), while retaining owner control and keeping basic collaboration out of paid tiers.

## Evidence and boundaries

| Evidence | Finding | Confidence and limitation |
| --- | --- | --- |
| Local source at `74cf6b8a8e96cadf9622aba1cddaef9d0c35930b` | Backend and hosted MCP behavior traced below | Verified source, not a production mutation test |
| Public [deployment metadata](https://vrdex.net/api/deployment), read on 2026-09-11 | Production reports that same commit and matching browser/server Convex targets | Confirms website deployment identity and configuration, not the deployed Convex function revision |
| Anonymous `tools/list` at [hosted MCP](https://vrdex.net/mcp), read on 2026-09-11 | 16 tools advertised, including profile creation/correction and media submission/status | Does not prove a particular client has loaded the tools or granted the necessary scopes |
| Current task's callable tool inventory | No authenticated VRDex connector exposed | Caller quota, current grant state, and authenticated runtime behavior are UNKNOWN here |
| Private ingestion-owner evidence inspected locally | A legitimate multi-profile donation stopped after three private media proposals; further source inventory remained | Corroborates the reported cap refusal. It is evidence from the ingestion owner, not an independently repeated write in this task |
| External primary-source comparison | Capacity, contribution quality, publication authority, and review authority can be separated | Analogies inform design; they do not establish suitable VRDex quota numbers |

Private source messages, identities, attachment URLs, filenames, and reconciliation records are deliberately absent from this brief. The original ingestion task retains that evidence and remains the ingestion owner. No new refusal probe was sent because it would attempt a contribution and can create a durable refusal receipt.

Owner direction, distinct from verified implementation: BASIC should be eligible for the proposed trusted-contributor path; others must be able to qualify over time. Normal limits should support large legitimate donations. Contributors should use ordinary MCP tools. These requirements and the approved publisher policy do not authorize a grant to BASIC now.

BASIC required review on both the website and MCP and integration of temporary-upload research, then approved bounded trusted self-publication. Current code still prevents same-user approval. Implement the new publication path explicitly; do not simulate independence by switching clients or tokens. No live submissions were approved by these design decisions.

## Current contribution paths

### Profiles, links, identity, and ownership

`createCommunityProfileRecord` creates published, public, unclaimed person or community profiles. It stamps community source attribution, checks suppressions, creates audit records, and indexes the result. It allocates an available slug; it does not establish that a new name is a unique person. MCP creation receipts prevent same-key repeats, but a fresh key can still create a second identity record. See [profiles.ts](../../convex/profiles.ts), especially `createCommunityProfileRecord`, `submitCommunityProfileForMcpActor`, and `updateProfileForMcpActor`.

Eligible non-owners can correct a public unclaimed profile. Claimed profiles require ownership, and hidden or inaccessible targets are refused. Corrections require `expectedUpdatedAt`. `outboundLinks` replaces the entire list, with a maximum of 20 links. The backend preserves supported stored provenance rather than accepting a caller's invented owner attribution. See [profile permissions](../../convex/_profilePermissions.ts), [profile updates](../../convex/_profileUpdates.ts), [link normalization](../../convex/_profileLinks.ts), and [ownership](../../convex/_profileOwnership.ts).

A contributor grant must not bypass ownership, suppression, field visibility, external-control proof, or claim rules. Matching an exact stream link is useful reconciliation evidence, not an ownership proof. Bulk design must preserve existing links, exact Twitch and VRCDN handles, and immutable VRChat IDs when corroborated. Names and image filenames alone do not establish identity. Unknown stream handles remain unknown.

### Media intake and review

The detailed source trace is in [media lifecycle research](./trusted-contributor-lifecycle-research-2026-09-11.md). Key facts from [profileMediaSubmissions.ts](../../convex/profileMediaSubmissions.ts) are:

| Control | Current behavior |
| --- | --- |
| Open proposals per submitting user | 3 across all profiles and contribution entry points |
| Open proposals per target | 2 across submitting users |
| Creation count per user | 6 in the preceding 24 hours, not a midnight reset |
| Creation count per target | 20 in the preceding 24 hours |
| Per-user creation cooldown | 30 seconds |
| Open definition | `upload_pending`, `submitted`, or `under_review`, with `expiresAt > now` |
| Pending upload lifetime | 30 minutes |
| Submitted proposal lifetime | 30 days |
| Per-image input bound | 12 MiB, with further stored-image and decoding bounds |
| Published media capacity | 12 active assets per profile, independent of proposal capacity |
| MCP status inventory | Newest 40 combined rows, no cursor |

The creation count includes rows later withdrawn, rejected, or expired. Processing existing proposals frees open capacity but does not erase creation history. Raising an HTTP limit or changing an OAuth app's tier cannot lift these hard-coded database caps.

MCP accepts a public HTTPS still image for a public unclaimed person profile's `profile_image`. Browser contribution also supports the community `primary_logo` path. MCP requires credit, current profile revision, current email-verification attestation, and an idempotency key. Intake requires `VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED`. The downloader validates destinations, pins public addresses through redirects, bounds processing, and preserves private source evidence. A query-bearing fetch URL is not suitable public credit by default. See [hosted MCP](../../apps/web/src/lib/server/vrdex-mcp.ts), [media importer](../../apps/web/src/lib/server/profile-media-mcp-import.ts), and [source URL policy](../../packages/api-contracts/src/profile-media-source.ts).

No public asset exists until approval. Unclaimed-profile review currently requires `superAdmin`, not a generic moderator grant. A current owner can review a proposal after claim, but nobody can decide their own submission, including a super-admin. Approval rechecks target and placement state and creates an attributed asset; reviewers can reject and super-admins can suppress an approved asset. Contributor trust would not automatically change any of these checks.

Cleanup is currently an explicit admin operation, with bounded scans and object deletion, rather than demonstrated unattended queue maintenance. Expiry can release logical quota before bytes are deleted. Larger intake therefore needs separate stored-byte accounting and reliable cleanup; an open-row count is not a storage budget.

### OAuth, HTTP limits, and resumability

| Tool | Required delegated scopes |
| --- | --- |
| `vrdex_profile_submit` | `mcp:write profile:contribute` |
| `vrdex_profile_update` | `mcp:write profile:write`; non-owner correction also checks `profile:contribute` |
| `vrdex_profile_media_submit` | `mcp:write assets:contribute` |
| `vrdex_list_my_media_submissions` | `mcp:read assets:contribute` |
| `vrdex_list_my_profiles` | `mcp:read profile:read` |
| `vrdex_profile_media_manage` | `mcp:write assets:write`, with owner authorization |

Hosted writes require a user-delegated token. Token and application records are checked on calls. The normal HTTP write policy is 30 requests per minute; authenticated MCP reads have a separate policy. OAuth client/owner aggregate limits also apply. The existing `trusted_partner` app tier multiplies selected HTTP policies by 100. It is an application credential policy, not evidence that all users of that app are trusted contributors. See [rate-limit policies](../../apps/web/src/lib/server/api-rate-limit.ts), [OAuth validation](../../convex/oauthApps.ts), and [MCP documentation](../developers/hosted-mcp-oauth-writes.md).

Media requests have durable intent/fingerprint handling and processing leases. A completed replay need not fetch an expired source URL. Capacity and cooldown refusals also receive actor/client/key-scoped receipts. Reusing such a refused key returns the same refusal even after capacity becomes available. Current MCP refusals are mostly explanatory text, without quota counts or a reliable retry time. An uncertain write must not become a fresh-key retry. These details prevent a naive loop from safely implementing a bulk workflow.

### Existing private seed imports

VRDex already has `seedImportBatches`, `seedImportCandidateProfiles`, and `seedImportCandidateFields`. They separate source permissions, field visibility, matching, review, and publication. Internal mutations include preview and bulk publication. Authorized batches cannot silently acquire additional candidates under an earlier publication decision. Private lookup and publication also enforce current claim and suppression rules. See [seed-import model](./seed-import-model.md), [seed imports](../../convex/seedImports.ts), [seed access](../../convex/_seedAccess.ts), and [schema](../../convex/schema.ts).

These are useful existing rules, but the internal operator interface is not an ordinary contributor workflow. Do not make its mutations public or share its private directory access merely to support bulk donation. Reuse field-validation and publication rules behind contributor-authorized functions. The first media batch slice can attach a small batch envelope to existing submissions; the profile/link staging slice should reuse seed candidates through a bounded adapter with per-submitter authorization. Keep media lifecycle state in `profileMediaSubmissions`, rather than duplicating it in seed fields.

## Proposed trust model

Locked policy distinction: submission capacity, bounded self-publication, and reviewing others are separate. Current implementation recommendation: two capacity classes, ordinary and trusted, plus independent publisher and reviewer grants. Reuse the existing expiring/revocable account-grant pattern in [account feature model](../../convex/_accountFeatureModel.ts). Do not introduce a public reputation score or paid trust tier.

| Capability | Ordinary contributor | Trusted contributor | Trusted publisher | Media reviewer |
| --- | --- | --- | --- | --- |
| Submit through ordinary MCP | Yes | Yes, same tools | Under own capacity | Under own capacity |
| Larger collection capacity | Baseline | Higher | Not automatic | Not automatic |
| Read private contributions | Own items | Own items | Own items | Assigned review scope only |
| Publish own media without independent review | No | Not from capacity grant | Eligible empty-slot additions only | Not from reviewer grant |
| Approve another user's media | No | No | Not from publisher grant | Within review scope |
| Edit another owner's claimed profile | No | No | No | No |
| Grant trust, access all private seeds, or administer OAuth | No | No | No | No |

Initially, existing super-admins grant and revoke contributor capacity, publisher, and limited reviewer permissions separately. BASIC may receive explicit bootstrap grants in a later authorized change through this same mechanism, keyed to the durable user ID. Do not special-case a display name, email, token, or client app in code. Publisher qualification should assess reliable sourcing and identity matching, not volume alone; record supporting examples and reasons as with contributor trust.

For v1, limited reviewers work on explicitly assigned batches. A super-admin assigns a reviewer to a batch, with an auditable revocation path. The reviewer must hold both an active reviewer grant and an active assignment; enforce both on queue listings, candidate previews, private evidence, and decisions. The grant alone exposes no deployment-wide queue or private seed data. Unbatched proposals retain the existing owner/super-admin path. Assignment permits review of that batch's eligible items, not approval of future or changed items under an earlier selection. Removing either the assignment or grant stops the next protected read or decision. Submitter account details and unrelated moderation history remain restricted.

Any contributor can request trust from their contribution history. Reviewers assess representative accepted work, correct identity matching, provenance and credit, avoidance of duplicates, and response to corrections. A suggested evidence packet is one coherent collection or 10 reviewed contributions across several profiles, including any corrected mistakes. That is a prompt for assessment, not an automatic threshold or a minimum that excludes strong external evidence. Pending review delays must not make qualification impossible. Record reviewed examples, grantor, reason, date, and optional expiry. Do not reward raw volume, likes, purchases, or account age as substitutes for quality.

A first-time donor with a credible large collection can request a temporary capacity allowance for that batch. It changes capacity only, is bounded by rows/bytes/expiry, and does not establish lasting trust. Use the same request and review mechanism rather than a second operator-only ingestion channel.

Revocation takes effect on the next state-changing operation, including the final transition of an in-flight import. A trust downgrade returns the actor to baseline; it does not delete valid pending work, hide their receipts, or revoke OAuth grants. If usage exceeds the new limit, allow review/withdrawal and status reads while refusing new reservations. Abuse suspension is separate and can stop all intake. Preserve reasons and a reconsideration path, with moderation-sensitive detail restricted. Review previously published work when an incident warrants it; do not automatically erase it because a grant ended.

For a capacity-only downgrade, an already admitted, unexpired upload may finalize within its original row/byte reservation even when the actor is now above baseline. It cannot enlarge the reservation or extend its deadline. Check the current grant and preserve this explicit reservation rule at finalization. Revoked OAuth, lost target authority, or an intake suspension still blocks finalization. New intake uses baseline limits. This prevents URL and local uploads from disagreeing about whether a capacity downgrade cancels accepted work.

## Proposed initial limits

These are engineering starting targets, not measured safe production limits. Adopt them only after byte accounting, pagination, cleanup, and review validation. Keep definitions in one checked-in policy consumed by browser, MCP, backend enforcement, and documentation. Self-hosters can lower the deployment ceiling; clients see effective values.

| Control | Ordinary | Trusted | Purpose |
| --- | --- | --- | --- |
| Open media proposals per actor | 100 | 1,000 | Pending-work capacity |
| Open media proposals per target, all actors combined | 10 | 10 | Avoid one profile dominating review; trust does not reserve the whole target |
| Media creations per actor, rolling 24 hours | 200 | 1,000 | Bound acquisition/churn even when proposals close |
| Media creations per target, rolling 24 hours | 20 | 20 | Retain a separate target abuse bound |
| Media admission burst | 6 per minute | 12 per minute | Replace the fixed 30-second cooldown; retain HTTP limits |
| Concurrent imports per actor | 2 | 4 | Bound active downloads and decoding |
| Private retained media bytes per actor | 2 GiB | 20 GiB | Include pending, withdrawn, rejected, expired, and cleanup-in-flight bytes |
| Active manifest rows per actor | 1,000 | 10,000 | Permit lightweight planning before downloading images |
| Manifest append page | At most 50 rows | At most 50 rows | Bounded validation and responses |

For manifest capacity, count every row in a non-archived batch, including completed and deferred rows. Archiving releases active-row capacity but does not cancel pending media, erase receipts, or release stored-media bytes. Bound retained manifest item revisions separately at 10,000 ordinary and 100,000 trusted revisions per actor, with at most 8 KiB of normalized metadata per revision and five revisions per item. Archived private source payloads expire after 30 days unless required for an unresolved review or legal hold; held payloads continue to count. Keep the minimal receipt and publication audit separately under an explicit retention policy. Refuse new manifest revisions when retained capacity is exhausted and show that reason. These are proposed bounds to validate alongside database costs, not current behavior.

Keep the existing 12 MiB per-image input bound and published-profile asset capacity initially. A collection of alternatives can be staged without publishing all its images. Community logos should reach MCP parity with the existing browser path in the bulk slice. Contributor galleries, banners, and audio/video remain separate placement work; metadata for an unsupported item may be retained with an explicit unsupported status, but must not appear successfully submitted. Local-file transport is included through the upload bridge. It uses the same quotas and does not expand a contributor's allowed placements. Existing owner placements remain available under owner authority.

At the input ceiling, 100 images are about 1.17 GiB and 1,000 about 11.72 GiB before stored derivatives and retained closed proposals. Byte quotas can therefore bind before row quotas. Reserve the maximum permitted stored output before downloading, reconcile actual stored bytes on completion, and release bytes only after confirmed deletion or an accounted transfer to published storage. Approval transfers accounting rather than making storage free. Retention and legal holds need separate operator reporting. Bound deployment-wide bytes, concurrent processing, and source-host fetch rates as well; no universal global value is justified by current measurements.

The initial ordinary allowance accommodates a 50-image donation without granting trust. It does not mean every row is suitable for intake or publication. A hundred items at an assumed one to three minutes of review each takes roughly 1.7 to 5 reviewer hours; a thousand takes roughly 17 to 50. These are planning calculations, not observed throughput. Independent review needs staff capacity, with aging alerts before 30-day expiry and a temporary intake pause when the oldest actionable work or storage pressure exceeds the chosen operating budget. Pausing expensive intake should still permit status reads and lightweight manifest corrections.

## Contribution workflow

1. The client reads effective permissions and capacity, then searches existing public profiles. It creates a private batch manifest with a stable caller key, source description, source-use basis, and intended scope. Source permissions and contributor reliability are separate checks.
2. The client appends bounded item pages. Each item has a stable source-record key, candidate target or unresolved match, operation kind, private provenance reference, source-observed date if known, and the proposed field changes or media locator. The source-observed date stays unknown when unavailable. Do not use import time as freshness evidence.
3. Preflight classifies each item as ready, duplicate, needs identity review, stale, unavailable, unsupported, or capacity-blocked. Exact VRChat IDs and corroborated canonical link destinations help matching. Name similarity suggests candidates only. Exact image hashes deduplicate bytes; changed crops or renditions still need visual review. Never expose another user's private candidate as a duplicate result.
4. The donor reviews the proposed changes and selects the ready subset. Existing `vrdex_profile_submit`, `vrdex_profile_update`, and `vrdex_profile_media_submit` handle their corresponding operations, with optional batch/item references. Profile and link batch mode stages changes until the donor explicitly commits that reviewed subset; media submission still creates private proposals. Existing single-item callers retain their current semantics.
5. Before each write, the server rechecks scopes, contributor access, profile eligibility, expected revision, source restrictions, and capacity. A profile created earlier in the batch supplies its actual ID and revision to dependent media work. Link updates merge against the fresh existing list and preserve stored provenance. A changed target returns a conflict for reassessment, not an automatic overwrite.
6. A publisher may explicitly publish their own eligible empty-slot items after inspecting the stored previews and evidence. All other items follow independent review through the website or MCP, with target/current image, preview, evidence, credit, duplicates and conflict warnings. Record exact viewed revisions for either action. Each item commits independently and returns its own result. New or changed rows are not covered by an earlier selection.
7. The client resumes from durable item status. Completed items are skipped, uncertain items are resolved by receipt, and blocked items explain the needed action. Approved media becomes a public asset through the current lifecycle; private evidence remains private. The batch reports partial completion until every item has a terminal disposition or an explicit deferral.

For an image-placement conflict, current code's refresh instruction is insufficient because the submission retains its original placement snapshot. V1 should let a currently authorized reviewer propose an explicit rebase against the current image, preserving the old snapshot in the audit. Rebase requires review-write delegation and current resource authority. An ordinary donor can request review or withdraw/resubmit; contribution scope does not grant rebase or reviewer evidence access. The independent reviewer must view and decide the rebased revision. Never repair the snapshot silently while approving. Rejection or deferral remains available without a rebase.

No batch-level approval may override a private-only source restriction, authorize later appended items, or turn a claimed profile into a community-editable one. If claim or ownership changes during staging, stop that item's publication and route it to the current owner's permitted workflow. Do not let a donor who later becomes the owner approve their own existing media proposal.

For correction after publication, keep a mapping from each batch item to created assets and changed fields, plus their prior values and resulting revisions in private audit records. Suppression can stop an unsafe image. Revert only changes still attributable to the batch and unchanged since publication; later owner edits become conflicts. Avoid a one-click blind rollback of a whole collection.

## MCP contract and minimal architecture

### Review and upload are first-class MCP operations

Add a distinct explicit trusted-publication operation for an actor's own proposals in both transports. Proposed MCP delegation is `mcp:write assets:publish`; the exact scope and tool name remain implementation recommendations. It requires the active publisher grant and an inspected candidate revision, not review-write permission or batch assignment. Publisher-only detail/preview access is restricted to the caller's own items. Existing contribution scopes cannot silently acquire publication authority. Intake and upload completion still create private proposals; publication is a separate explicit operation.

At the publication transaction, require a public unclaimed target, an actually empty permitted slot, no applicable dispute/rejection/suppression block, sufficient source/credit and confirmed identity mapping, current candidate/target revision, and active delegated publisher authority. A slot filled by another action becomes an independent-review conflict. Record `publicationMethod` and publisher identity separately from independent reviewer attribution, with a durable receipt. Revocation blocks new publication even if an earlier upload reservation may finish. Previously rejected/suppressed material must not regain eligibility through a fresh proposal key; retain applicable content/provenance and target restrictions across attempts. Exact detection/storage rules remain implementation work, and uncertain cases route to review.

Use one backend review policy and transition implementation with browser-session and validated OAuth wrappers. Do not give the MCP an artificial browser identity. Add separate proposed `assets:review:read` and `assets:review:write` scopes, paired with the corresponding MCP transport scope. Existing contribution and owner-edit grants do not silently acquire private-review access or decision authority. Fresh review delegation still intersects with current owner/super-admin authority or the limited-reviewer grant plus batch assignment.

| Proposed operation | Required behavior |
| --- | --- |
| `vrdex_list_media_reviews` | Paginated authorized queue/history, batch/profile/status filters, expiry and allowed actions. Exclude expired work from the default actionable queue |
| `vrdex_get_media_review` | Exact target, source/provenance projection, credit, duplicates, disposition and opaque review version. Restrict account details and moderation notes |
| `vrdex_get_media_review_preview` | Native MCP image content generated from stored candidate/current image, bound to that review version. Use a bounded safe rendition; do not refetch the donor's source URL |
| `vrdex_decide_media_review` | Explicit item, viewed version, approve/reject, final metadata/reasons and per-item idempotency key. Atomically recheck authority, target, bytes, expiry and placement; return applied/replayed/conflict/refused |
| `vrdex_rebase_media_review` | Auditable explicit revision against current target/placement, invalidating prior viewed versions. Never approves as a side effect |
| `vrdex_withdraw_media_submission` | Own-item withdrawal under contribution delegation, with version/receipt handling. Review rights are unnecessary |
| Local `begin_upload` / `complete_upload` variants | Existing media tool families authorize transfer and finalize validated bytes. Owner completion can publish; contributor completion only submits for review |

An optional bounded decision wrapper can accept at most 20 exact items with individual viewed versions, decisions and receipts. It executes the same single-item transition and reports partial results. Never approve a filter, a cursor, or every future row in a batch. The website offers the same selected-item operation and current/candidate comparison. Start-review remains advisory rather than an exclusive lock or a mandatory extra click. A competing decision or withdrawal returns current state; it does not get retried with a fresh approval key.

Native image output is already part of the published [MCP tool result specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-result). Test image rendering in Codex and Claude Code before claiming reviewer usability. Detail access and native previews use the same resource authorization as decisions. A preview response identifies returned bytes; it cannot prove that a person or model examined them. Metadata-only clients cannot provide visual-review confidence. Legal holds, cleanup, and asset suppression remain separate administrative powers; ordinary review write scope does not include them.

The upload authorization is a different capability from a preview read. The existing direct-upload route returns an S3 multipart POST descriptor, not a raw-byte ingress URL. Its legacy token can also reach publication-capable completion. New MCP upload intents must therefore separate upload authority from OAuth-authenticated finalization and reject legacy token-only completion. Keep transfer descriptors short-lived and private, bind to target/purpose/size/type and the caller's predeclared file digest, and seal validated bytes before review. A signed storage transfer may be reusable until expiry even though application finalization commits only once. See [the bridge analysis](./mcp-local-upload-bridge-research-2026-09-11.md) for replay, revocation, overwrite and cleanup requirements.

Returning a transfer descriptor is a narrow proposed exception to the prior no-upload-credential-output rule. Return only the descriptor needed for that private quarantine upload; never the general-purpose legacy token, source/display/download storage keys, or unrelated private source data. Application logs and errors redact its secrets, while client transcript retention remains a client concern. A server-minted transfer path is available under ordinary or trusted contributor quotas; the word trusted here does not confer reviewer or publication authority.

### Batch and capacity contracts

Keep existing contribution tool names. Add optional `batchId` and `itemKey`, and an explicit staging mode for profile/link work. A single small batch companion tool can create, append, inspect, and request the selected-item commit of a manifest. This remains ordinary MCP, with no local operator script or separate login. Its name and exact schema are implementation decisions. Avoid one huge binary or all-or-nothing array request.

Add a read-only contribution-capability query under existing contribution scopes. Return policy version, current capacity class, allowed operations, effective ceilings, caller usage, remaining capacity, reset/expiry times when knowable, permitted target types, review requirement, supported batch protocol version, and feature availability. Filter by the actual grant and resource visibility. This is a snapshot, not an admission reservation. A higher contributor tier cannot expand an OAuth scope; the effective action is the intersection of delegation, account capability, target authority, and deployment policy.

Extend `vrdex_list_my_media_submissions` with cursor pagination, status and batch filters, and exact own-item/receipt lookup. Include expiry and a safe last-result code. Keep private URLs, storage keys, raw hashes, tokens, other contributors' rows, and internal moderation notes out of ordinary status results. The explicit transfer descriptor and authorized reviewer detail above have separate narrow contracts. Capability reads and paginated status remain usable when a write quota is full or trust is downgraded.

Return structured per-item errors with `code`, `category`, `operationState`, `retryable`, optional `retryAfterSeconds`, and the required next action. Categories distinguish capacity, burst, rolling daily count, bytes, target conflict, scope, validation, and uncertain outcome. Do not fabricate a retry time for review backlog. Return HTTP retry headers for HTTP throttling and structured tool data for application limits.

Preserve existing same-key semantics for existing clients. In batch mode, the durable identity is actor + batch + item, surviving OAuth refresh or a changed client app after renewed authorization. Record the client used for each attempt. Each attempt has an immutable fingerprint and receipt. A known pre-reservation quota refusal may get a new attempt key after the block clears; an uncertain attempt must first be resolved with its existing key. A refreshed signed URL or corrected payload is a new item revision after the preceding attempt is known terminal. Do not silently reinterpret an old refusal receipt or refetch an already completed image.

Suggested implementation responsibilities:

- Account grants hold `trusted_contributor` and a separate limited media-review capability. The existing grant model supplies active/revoked state and expiry; grant audit records add reasons and evidence references. A small batch-review assignment record supplies the resource scope that the existing boolean grant model lacks.
- Add `trusted_publisher` independently, with separate delegated publication scope and publication-method attribution. Reuse asset attachment validation while keeping independent review decisions and trusted publication as distinct authorized operations.
- A batch envelope and bounded item records hold ownership, item keys, immutable revisions, attempt/receipt references, dependencies, private source references, and publication mappings. Existing media rows remain authoritative for media state. Reuse seed candidate/field rules for staged profile data through contributor-safe functions, without inheriting seed-lookup grants.
- One backend policy/admission module enforces actor and target counts across all clients and browser routes. Count active work using indexed bounded queries initially; do not keep the current `.take(4)`-style assumptions after increasing limits. Use transactional reservations for concurrency and bytes, with expiry/reconciliation. Promote counters only where query cost warrants it, and test concurrent admission.
- Existing storage processing handles each image with bounded leases and retry limits. Add scheduled, bounded cleanup with legal-hold and orphan reconciliation before increased intake. Keep deployment concurrency below measured decoder and backend capacity.
- Existing review screens and new MCP review tools share versions, authorization, private image reads, decisions and receipts. Screens gain batch filters, selected-item decisions, and the narrow authorization check. They should show data and differences rather than an explanatory trust dashboard. Exact public copy remains subject to BASIC's review.

## Alternatives and tradeoffs

| Alternative | Assessment |
| --- | --- |
| Raise only the three hard-coded caps | Fast relief, but no complete status beyond 40 items, no durable collection state, and unresolved cleanup/reviewer load. Insufficient as the finished bulk workflow |
| Mark a shared OAuth app `trusted_partner` | Changes transport budgets for its users and still does not solve media caps. Wrong authority boundary |
| Make trusted contributors super-admins | Grants unrelated access and still forbids self-review. Reject |
| Automatic reputation levels | Adds gaming and explanation problems before there is enough contribution history. Defer |
| Bounded trusted self-publication | Approved policy: separate grant for clearly sourced own contributions filling empty slots on unclaimed profiles. Replacements and uncertain/disputed or previously rejected/suppressed material require independent review |
| Review only a random sample of trusted media | Lower cost, but unreviewed private proposals would become public. Treat as a publication-policy change, not a batch-review optimization |
| Temporary batch capacity for newcomers | Recommended alongside baseline access. It supports large credible first donations without treating volume as permanent trust |
| Force every contribution through the existing operator seed scripts | Reuses backend machinery but fails the ordinary-MCP requirement. Reuse the rules behind an authorized product path instead |

The [community research note](./trusted-contributor-community-research-2026-09-11.md) contains primary-source details. [Wikipedia autopatrol](https://en.wikipedia.org/wiki/Wikipedia:Autopatrolled) separates reliable creation from reviewing others and does not guarantee rights for meeting counts. [OSM import guidance](https://wiki.openstreetmap.org/wiki/Import/Guidelines) supports documented, reconcilable, correctable collections. [Discourse's trust guide](https://blog.discourse.org/2018/06/understanding-discourse-trust-levels/) illustrates graduated limits and separately assignable permissions. VRDex should borrow these distinctions, not their numerical thresholds or complete governance processes.

## Implementation outline and validation

The [implementation plan](../superpowers/plans/2026-09-12-contributor-upload-and-review.md) translates this design into one PR with three internal phases, code boundaries, test cases, and release evidence. The plan preserves the approved publisher policy; execution and operational grants remain separate steps.

Three coherent slices are preferable to a large reputation project. This is proposed future work, not authorization to implement it.

| Slice | Scope and completion evidence |
| --- | --- |
| 1. Usable review in website and MCP | Shared backend review authority, dedicated read/write delegation, paginated queue/detail/stored-image preview, decisions with receipts, and own withdrawal. Begin with existing owner/super-admin resource authority, then add limited batch reviewers when batches exist. Demonstrate two distinct staged users, both clients rendering actual candidates, website parity, lost-response replay, competing decisions, and same-user refusal. Keep intake thresholds unchanged |
| 2. Upload bridge and collection workflow | Integrate issue #340's local-file bridge for owner and contributor modes, corrected transfer/finalization authority and its required quota reservations/orphan cleanup, durable batch/items, profile/link staging via seed rules, community-logo parity, provenance/dedup, limited reviewer assignments, selected-item decisions/rebase, and partial resume. Demonstrate a synthetic 50-item mixed collection, local and URL images, preserved links, ambiguity, expired transfers and interruption. Prove listing beyond 40 and at least 1,000 manifest rows |
| 3. Measured capacity and controlled rollout | Shared ordinary/trusted policy and grants, effective-capacity discovery, transactional byte/concurrency reservations, scheduled cleanup, legal-hold/orphan accounting, post-publication correction and backlog visibility. Validate intended row/byte limits and multi-user load. Pilot higher thresholds only after separate owner authorization and a working intake-to-review loop |

The v0.9 checkpoint is a staged, synthetic end-to-end collection with one interruption and several conflicts. It includes local-file transfer, stored-image review, approval/rejection and readback entirely through MCP, plus the equivalent website actions. Measure reviewer minutes per accepted item, pending-age distribution, duplicate/identity-conflict rate, stored bytes per item including derivatives, failed-fetch cost, cleanup lag, and database reads. Do not treat a successful small batch as proof that the 1,000-item trusted ceiling is affordable. Load-test the intended ceiling and aggregate multi-user pressure before enabling it.

The slice-two 50-item proof uses a dedicated staging/test deployment with synthetic data and a bounded test policy, for example 30 profile/link items and 20 media proposals followed through actual review. Production retains its current limits. The test override must be unavailable in production and documented in the proof record with its effective limits and cleanup. A metadata-only manifest or a bypass of the review transition does not satisfy this checkpoint. Slice three determines the real deployment policy from measurements.

Include the approved publisher path in slice two and the checkpoint. Prove an eligible own-item publication through both website and MCP, refusal for replacement/claimed/disputed/uncertain or previously rejected/suppressed material, publisher revocation, a concurrent empty-slot fill, and honest publication-method audit. Preserve independent same-user refusal. Empty means no existing image presented in that slot, including a legacy image fallback; an absent managed placement alone is insufficient. A publisher can route an eligible item to independent review instead. Periodic checks of published work should inform grant retention and corrections; the review cadence remains an operating recommendation.

Required tests cover missing scopes, app trust versus user trust, hidden/claimed/suppressed targets, self-review, reviewer scope and revocation, donor downgrade while importing, concurrent actor/target/byte reservations, cross-client item replay, terminal refusal versus indeterminate attempts, cursor isolation, signed-source redaction, duplicate variants, preservation of existing links, changed profile/placement after review, private-only batch sources, append after selection, and cleanup with legal holds. Upload tests additionally cover actual multipart transfer, declared digest/size/type mismatch, expiry, replayed quarantine writes, immutable finalization, and token-only completion bypass. Review tests include native image rendering, two simultaneous reviewers, source changes after intake, and parity of browser/MCP decisions. Browser review changes need screenshot and visual review evidence before UI completion. No UI design completion is claimed by this brief.

Rollout should use a separate bulk-intake switch while keeping existing status and review available. Raising limits or granting BASIC trust is a later authorized operational step. Rollback can pause new bulk intake or lower ceilings without discarding pending work, receipts, or evidence. Existing public assets need a separate review/correction decision; changing a feature flag does not unpublish them.

Update hosted MCP contracts and client guidance, media lifecycle testing docs, seed-import boundary docs, account/reviewer operations, cleanup runbooks, self-hosting configuration definitions, and public help copy together with implementation. Capture expected configuration names, scope, and owner in checked-in deployment definitions. No new infrastructure provider or paid contributor tier is required by this design; pricing and aggregate budgets remain unmeasured.

## Remaining owner decisions

1. Who should receive the initial separate publisher grants, and what evidence should establish publisher qualification? BASIC is the proposed initial candidate; no grant has been applied. The bounded self-publication policy itself is approved.
2. Are 100 ordinary and 1,000 trusted open media proposals suitable starting targets, subject to measured storage and review capacity? Temporary batch allowances can handle larger credible first donations without permanent promotion.
3. Who should be the initial independent reviewers, and what recurring review capacity can they actually provide? Recommend a limited reviewer grant; do not promise a review service level until people and throughput are known.
4. Confirm the proposed v1 contributor media boundary: person profile images and browser-equivalent community logos, including local-file upload. Broader contributor galleries need separate placement scope. Codex and Claude Code are the initial proposed upload/review client proofs; other clients need their actual transfer and image-rendering capabilities checked.

Interview later: test one novice donor with a large existing collection and one reviewer processing it. Verify that identity conflicts, capacity pauses, and partial completion make sense without reading implementation documentation. Use the results to adjust limits and workflow, without inventing a reputation score first.
