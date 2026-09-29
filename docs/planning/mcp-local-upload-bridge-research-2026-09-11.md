# Local image uploads through MCP

Status: research and current recommendation, 2026-09-11. This connects the existing upload proposal to [trusted contributors and bulk contributions](./trusted-contributors-and-bulk-contributions.md) and [website/MCP review](./media-review-workflow-research-2026-09-11.md). No upload authorization was minted, no image was submitted, and no runtime policy changed.

## Located prior work

The durable handoff is [issue #340, Local-file media upload through hosted MCP](https://github.com/BASIC-BIT/VRDex/issues/340), opened on 2026-09-11 and still open when inspected. It proposes adding `begin_upload` and `complete_upload` to owner media management, a ten-minute upload authorization, and HTTPS byte transfer outside MCP JSON-RPC. Contributor uploads are a follow-up in that issue. It explicitly proposes revising the older non-goal against returning upload credentials to an MCP client.

Local Claude session metadata and likely transcripts did not establish which session authored the issue. The issue itself matches the requested research and is the source used here. Its proposal is not evidence of implemented behavior or owner approval of every credential detail. This research did not edit the issue or start/resume its authoring task.

Current recommendation: retain the issue's control/byte-transfer split and use one bridge for both owner and contributor paths. Owner finalization may publish an owned asset. Contributor finalization creates only a private proposal, which can then be reviewed through the website or MCP. The distinction belongs in backend authorization and lifecycle transitions, not in which client sends the file.

## Current code and corrections to the issue

Code inspected at `74cf6b8a8e96cadf9622aba1cddaef9d0c35930b`.

| Existing component | Verified behavior | Consequence for the proposal |
| --- | --- | --- |
| [Direct-upload route](../../apps/web/src/app/api/v0/profile-assets/upload-intents/[intentId]/direct-upload/route.ts), `POST` | Requires `x-vrdex-upload-token`, checks an intent, returns an S3 POST URL and form fields | This route authorizes a storage transfer; it does not accept raw `curl --data-binary` image bytes |
| [Storage helper](../../apps/web/src/lib/server/profile-asset-storage.ts), `createProfileAssetDirectUploadTarget` | Presigned POST, maximum ten-minute expiry, exact size/type, private quarantine key | Reuse this helper and private bucket, returning an explicit multipart-form transfer descriptor rather than an ambiguous upload URL |
| [Completion route](../../apps/web/src/app/api/v0/profile-assets/upload-intents/[intentId]/route.ts), `POST` | Uses the same upload token, reads multipart bytes or quarantine object, validates and finalizes | The legacy token is not an upload-only authority that inherently requires a later OAuth call |
| [Backend upload intents](../../convex/profileAssets.ts), `claimUploadIntentForStorage` and `markUploadIntentUploaded` | Authenticate the stored upload token and processing claim; downstream finalization can consume an owner intent into a public asset | A new MCP-issued byte capability must not gain access to this legacy completion path |
| [Intent construction](../../convex/_profileAssets.ts), `createProfileAssetUploadIntentRecord` | Stores upload token and creates quarantine/source/download/display keys; normal intent lifetime is 30 minutes | Ten-minute MCP authorization and separated completion authority are changes to implement, not existing guarantees |
| [Public API docs](../developers/public-api.md), profile asset uploads | Describe direct authorization, S3 upload, token-authenticated completion and public owner asset creation | The issue's example and claim of OAuth-required finalization need reconciliation with the actual transport |

Reuse the existing validation and storage services. Do not simply expose an existing intent's upload token as the proposed weaker credential. Existing API callers can retain their contract; new MCP-issued intents must have an explicit issuer/purpose that the legacy token-completion route refuses.

## Protocol evidence

The current published tool specification supports image content in tool results, suitable for review previews. That does not provide a portable local-file argument for uploads. [MCP tool results](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-result)

[SEP-2631](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2631) remained a draft when checked. It proposes file-transfer authorization and HTTPS transfers outside JSON-RPC. [SEP-2356](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2356) was closed in its favor on June 26, 2026. Follow the transfer-descriptor shape where useful, but do not advertise draft methods as supported or wait for their adoption to offer a VRDex tool-based bridge. Actual client support still needs testing.

AWS documents presigned URLs as bearer access that can be reused until expiry and can replace an object at the same key. Therefore a signed transfer URL alone does not prove single use. The existing POST helper has expiry/size/type conditions but no application-level consumption check at S3. Treat its transfer descriptor as potentially replayable until expiry. Application finalization can still be exactly once. [AWS presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

## Proposed transfer contract

Use existing owner/contributor tool families, with a local-upload input variant. Exact operation names remain proposed. A client that can read a local file requests authorization through MCP, transfers bytes using ordinary HTTPS, then calls MCP again. It does not publish the file elsewhere first or pass a local path to the remote server.

1. `begin_upload` takes target, expected target/media revision, metadata/credit, optional batch/item reference, declared byte size, declared MIME type, locally computed SHA-256 of the selected bytes, and idempotency key. The server derives actor, owner/contributor mode, and permitted placement from validated delegation and target authority. It reserves the same row/byte/concurrency quotas as URL intake. Minting many unused descriptors must not create free storage reservations.
2. Return an intent reference, expiry, and explicit transfer descriptor containing method, HTTPS URL, required headers or multipart fields, file-field name, and bounds. For reuse of today's S3 helper, the descriptor is multipart POST with the supplied fields and a `file` part. It is not a raw binary POST. Do not return the existing general-purpose `uploadToken`. A temporary quarantine key in the required S3 form is an intentional capability detail; never return source/download/display storage keys or private source-message URLs.
3. The client uploads the selected file to that private quarantine target. Possessing this descriptor permits only writing the bounded quarantine object. It cannot read private media, change target or metadata, create placements, approve a proposal, or call legacy token completion. Give it a random quarantine key unrelated to the original filename. No cookie or OAuth bearer token is sent to S3.
4. `complete_upload` takes the intent reference and request identity under fresh user-delegated OAuth. It rechecks scopes, actor, target/ownership, contribution status, policy and quota reservation. It reads the object once, verifies actual length, MIME and digest against the selected bytes, decodes/sanitizes it, checks duplicates, and seals the validated result into server-only immutable storage keys. Validation is server-owned; the client never asserts that an upload passed.
5. Commit only the sealed content identity. Owner mode applies permitted placements and returns the new media version. Contributor mode transitions to submitted private review data and returns the proposal/attempt status, never a publication approval. Review previews then render this stored candidate, not the mutable quarantine object or a source URL.

The intent's finalization is single-commit and replayable. The underlying signed transfer is short-lived, potentially repeatable byte access. If strict single-transfer enforcement is required, use a VRDex-controlled byte-ingress endpoint that consumes a capability with a processing lease. That is a different implementation choice with payload/runtime costs and should not be described as free reuse of presigned POST.

Bind finalization to the digest supplied by the authenticated caller before minting. Otherwise an attacker who obtains a leaked descriptor could substitute another same-size/type image before finalization. After validation, never reread a replaceable quarantine key as the approved source. A later overwrite cannot change the sealed candidate. Still test overwrite-before-read, overwrite-during-validation, lost response, concurrent completion, and source-preserving downloads.

The ten-minute lifetime limits new storage requests, not necessarily an upload already accepted by storage just before expiry. Recheck intent expiry before finalization. An expired/unfinalized upload needs an explicit new attempt; do not reopen a consumed intent or reset quotas by minting a fresh key automatically. Keep orphan reconciliation after transfer expiry because a late storage replay can recreate a quarantine object after earlier cleanup.

## Credentials, cancellation, and recovery

Issue #340 intentionally places a narrow authorization in client/model context. Prefer host-managed transfer data when a tested client supports it; otherwise document that the descriptor is a temporary bearer credential. Redact form signatures and other transfer secrets from application logs, tool-event rows, errors, and public artifacts. Do not promise that the MCP client's own transcript will omit them. This is a deliberate revision of the prior credential-output non-goal, with a narrower authority boundary than the legacy token.

Revoking OAuth, losing target ownership/authority, or an intake suspension blocks new authorizations and finalization. A capacity-only trust downgrade instead applies baseline limits to new intake. An already admitted, unexpired upload may finalize within its original row/byte reservation, without increasing that reservation or extending its deadline. This matches the canonical contribution policy for URL uploads.

Neither account-policy change nor cancellation instantly revokes a presigned descriptor already accepted by S3. That descriptor may continue writing its quarantine object until expiry, but cannot itself publish. Cancellation marks the intent ineligible for finalization and releases reservations only as their resources are actually reclaimed. Do not claim immediate byte-transfer revocation without a mediated endpoint that rechecks authority.

Status reads identify the durable actor/batch/item and attempt. Completed attempts return the same result without transferring again. A lost begin response may return a fresh short-lived descriptor for the same still-pending authorized intent after checking its reservation; the credential expiry must not extend the intent deadline. A known rejected or expired attempt may be replaced deliberately. An uncertain completion must first be resolved by receipt/status, never treated as an instruction to upload with a new key.

The bridge should serve ordinary and trusted contributors under their respective effective limits. A trusted transport means the server minted a bounded authorization; it does not mean its holder earned contributor trust or may self-publish. Existing owner authority remains separate as well.

BASIC has since approved a separate bounded trusted-publisher permission, as recorded in the canonical brief. Contributor upload completion still produces a private proposal. An eligible publisher then explicitly publishes a clearly sourced own contribution into an empty image/logo slot on a public unclaimed profile. Other cases require independent review. Upload credentials never invoke that publication permission; publisher grant/delegation, current slot and candidate version are checked by a separate action.

## Acceptance and integration

The first proof should exercise an actual local PNG in Claude Code and Codex, including the required multipart form transfer and returned native review preview. A web-only MCP client may have no way to read a local file or send the transfer; mark that capability unavailable and keep its supported URL/browser intake path. Do not infer local-file support from successful `tools/list` or from a draft protocol extension.

Use separate synthetic contributor and reviewer accounts for the independent-review path. Demonstrate local file to private proposal, preview from stored bytes, rejection/approval in MCP, public readback only after approval, and the same result in the website. Also test owner uploads, credit/provenance, size/MIME/digest mismatch, wrong actor/target, expiry, cancellation, quota reservation, overwrite/replay, OAuth revocation, claimed-target change, legacy completion bypass, sensitive-output redaction, and cleanup after late transfers. No live community images need to be approved as a test.

Keep issue #340 as the upload work reference. The canonical design now includes review as a required preceding or accompanying slice, rather than leaving a larger private queue as the completed product. Update the existing non-goal/deferral, API/MCP contracts, OAuth consent and client guide only when this revised behavior is implemented and approved. This research adds a proposal pointer without changing current runtime documentation into a capability claim.
