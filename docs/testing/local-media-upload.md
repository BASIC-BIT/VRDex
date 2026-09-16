# Local media upload verification

The local upload bridge is disabled by default. The implementation adds transport, collections and accounting boundaries. It does not enable hosted intake or raise legacy contribution limits.

## Local tests

Run `node --conditions=import --import tsx --test tests/backend/contribution-uploads.test.ts` and `node --import tsx --test tests/web/profile-asset-upload-route.test.ts tests/web/profile-asset-storage.test.ts`.

The backend tests cover admission replay, source mismatch, concurrent finalization, legacy-token refusal, revoked OAuth, lost ownership, suppressed targets, capacity downgrade, expiry, cleanup confirmation, and legal holds. The web adapter test validates real synthetic image bytes with injected storage. It overwrites quarantine during sealing and after commit, then verifies that replay returns the same receipt without reading quarantine again. This is a local simulation, not proof of an S3 transfer.

## Dedicated S3 proof

An operator must approve the exact dedicated test bucket before execution. Do not use a production bucket or provision resources from this script. Supply dedicated credentials through the ordinary AWS credential chain, or an explicitly authorized Vercel OIDC role. The script performs writes and deletes only four generated keys under `profile-assets/proof/local-upload/<random-id>/`.

Set `VRDEX_PROFILE_ASSET_BUCKET` to that exact bucket, `VRDEX_PROFILE_ASSET_REGION` to its region, and `VRDEX_MEDIA_PROOF_CONFIRM=dedicated-test-bucket`. Run:

```text
node --import tsx scripts/prove-local-media-upload.ts --approved-test-bucket=EXACT_APPROVED_BUCKET
```

The script transfers a synthetic PNG through a presigned multipart POST, reuses the form for an overwrite before sealing, seals server-selected keys with conditional writes, then overwrites quarantine again. It verifies immutable source readback, identical-write replay, refusal of conflicting sealed writes, and S3 rejection of a mismatched byte length. It deletes its generated keys in `finally`. It never sends VRDex OAuth credentials or cookies to S3.

The form remains reusable until expiry. Finalization is a separate authenticated, single-commit database command. The storage proof does not exercise a hosted MCP client or its OAuth grant. That combined client proof remains a separately authorized staging checkpoint.

## Configuration and cleanup

| Variable | Scope | Default and owner |
| --- | --- | --- |
| `VRDEX_CONTRIBUTION_UPLOADS_ENABLED` | Convex | Unset/false. BASIC approves enablement after staging proof. |
| `VRDEX_MEDIA_UPLOAD_CLEANUP_READY` | Convex | Unset/false. Operator attests worker reachability and deletion proof before enablement. |
| `VRDEX_MEDIA_CLEANUP_URL` | Convex | Exact HTTPS URL ending in `/api/internal/media-cleanup`, owned by the deployment operator. No redirects or URL credentials. |
| `VRDEX_MEDIA_CLEANUP_TOKEN` | Convex and Next server | Distinct high-entropy worker secret, owned by the deployment operator. Never expose through public env variables. |

Existing `VRDEX_PROFILE_MEDIA_KIT_ENABLED` and `VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED` still gate their respective modes. Existing Next storage bucket, region, and OIDC configuration supplies storage authority. Convex only calls the authenticated Next worker, never the storage role directly.

To recreate or rotate the worker token, generate a new random secret, update both server secret stores in a coordinated operation, then prove the worker route rejects the previous token and accepts the new one. Disable intake readiness during a mismatched-token interval. No secret values belong in source control. Hosted provisioning and rotation require separate approval.

The ten-minute cron claims at most 20 upload obligations and 20 proposal obligations. A claim contains server-selected keys and a deletion token. The worker confirms an obligation only after all its keys were deleted successfully. Failed and abandoned writes remain byte-charged until confirmation. Upload cleanup starts 24 hours after transfer expiry to allow bounded server work and in-flight transfers to settle. Daily tombstone sweeps reconcile late quarantine writes and failed-intent writes. Legal holds exclude deletion and cannot be added while a deletion token is outstanding. The existing browser admin cleanup adapters remain available.

Reservations initially charge two source-sized objects plus two 12 MiB derivatives. On seal they reconcile unique keys and actual retained byte sizes. Source and quarantine coexist until deletion. Baseline actor and target byte ceilings are 144 MiB and 96 MiB; processing ceilings are three and two. Internal capacity rows may lower these ceilings, but cannot raise the baseline. Admitted, unexpired reservations can complete after a capacity-only downgrade. Capacity discovery, separately granted higher limits, requests, temporary allowances and rollout gates are documented in [the collection checkpoint](contributor-collection-checkpoint.md).

## Contracts

`vrdex_media_upload_begin` accepts owner or contributor mode, profile revision, image/logo placement, declared MIME, byte length, SHA-256, credit, bounded provenance, and an idempotency key. A local image needs a source URL or a bounded source description. Local provenance is explicit in stored review data; existing URL intake still requires its source URL. Batch/item references bind an actor-owned staged revision and its exact declaration.

Successful admission contains only intent ID, expiry, and the POST URL/form fields with `fileField: "file"`. Quota refusal instead returns a stable terminal command receipt before any upload or counter write. Only the random quarantine key is exposed in those form fields. The complete command accepts the intent ID and idempotency key, revalidates delegation, and returns a durable receipt. The backend requires `mcp:write` plus `assets:write` for owner mode or `assets:contribute` for contributor mode. Contributor completion creates a private proposal regardless of other grants. Owner mode uses existing owner asset finalization.

## URL acquisition recovery

URL acquisition first claims a fenced processing lease, before fetching,
validating declared bytes/type/digest or writing quarantine data. Permanent
validation, unsafe-source and non-retryable HTTP 4xx failures settle the linked
attempt and release processing once. Unknown transport, timeout, HTTP 408/429
and server failures reopen same-key acquisition under the matching lease; a
stale worker cannot reset or fail a successor. Retained bytes stay charged until
confirmed deletion. Completion recovery requires the exact completion key and
current OAuth/resource authority; admission replay also rechecks current target
access, including owner loss.

Upload tickets bound URLs, field names/values/count and safe-integer expiry.
Collection payload cleanup retains revision kind independently from private
payload, so committed/refused receipt replay can reauthorize its original scope
without parsing deleted payload. Expired/superseded submissions are terminal for
correction; still-pending attempts remain blocked. Already-purged pre-change
revisions without kind metadata cannot reconstruct the original scope and fail
closed with `BATCH_PAYLOAD_EXPIRED`.
