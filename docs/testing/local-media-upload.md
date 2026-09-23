# Local media upload verification

The local upload bridge is disabled by default. The implementation adds transport, collections and accounting boundaries. It does not enable hosted intake or raise legacy contribution limits.

## Local tests

Run `node --conditions=import --import tsx --test tests/backend/contribution-uploads.test.ts` and `node --import tsx --test tests/web/profile-asset-upload-route.test.ts tests/web/profile-asset-storage.test.ts`.

The backend tests cover admission replay, source mismatch, concurrent finalization, legacy-token refusal, revoked OAuth, lost ownership, suppressed targets, capacity downgrade, expiry, cleanup confirmation, and legal holds. The web adapter test validates real synthetic image bytes with injected storage. It overwrites quarantine during sealing and after commit, then verifies that replay returns the same receipt without reading quarantine again. This is a local simulation, not proof of an S3 transfer.

Run `node --import tsx --test tests/web/contribution-adapter-recovery.test.ts` for adapter recovery against the in-memory Convex backend. It covers signing failure, concurrent same-key signing, replay authority, worker fences, and legacy source-host throttling followed by same-key completion.

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

Capacity discovery reports `features.localUploads` for contributor mode and
`features.localUploadModes` for both modes. These values use the same upload,
cleanup-readiness, cleanup URL/token and mode-specific feature gates as admission.
They describe configuration readiness, not a reservation or a grant of authority.

To recreate or rotate the worker token, generate a new random secret, update both server secret stores in a coordinated operation, then prove the worker route rejects the previous token and accepts the new one. Disable intake readiness during a mismatched-token interval. No secret values belong in source control. Hosted provisioning and rotation require separate approval.

The ten-minute cron claims at most 20 upload obligations and 20 proposal obligations. A claim contains server-selected keys and a deletion token. The worker confirms an obligation only after all its keys were deleted successfully. Failed and abandoned writes remain byte-charged until confirmation. Upload cleanup starts 24 hours after transfer expiry to allow bounded server work and in-flight transfers to settle. Daily tombstone sweeps reconcile late quarantine writes and failed-intent writes. Legal holds exclude deletion and cannot be added while a deletion token is outstanding. The existing browser admin cleanup adapters remain available.

Reservations initially charge two source-sized objects plus two 12 MiB derivatives. On seal they reconcile unique keys and actual retained byte sizes. Source and quarantine coexist until deletion. Baseline actor and target byte ceilings are 144 MiB and 96 MiB; processing ceilings are three and two. Internal capacity rows may lower these ceilings, but cannot raise the baseline. Admitted, unexpired reservations can complete after a capacity-only downgrade. Capacity discovery, separately granted higher limits, requests, temporary allowances and rollout gates are documented in [the collection checkpoint](contributor-collection-checkpoint.md).

## Contracts

`vrdex_media_upload_begin` accepts owner or contributor mode, profile revision, image/logo placement, declared MIME, byte length, SHA-256, credit, bounded provenance, and an idempotency key. A local image needs a source URL or a bounded source description. Local provenance is explicit in stored review data; existing URL intake still requires its source URL. Batch/item references bind an actor-owned staged revision and its exact declaration.

Successful admission contains only intent ID, expiry, and the POST URL/form fields with `fileField: "file"`. Quota refusal instead returns a stable terminal command receipt before any upload or counter write. Each actor can retain up to 256 admission-refusal receipts across OAuth clients. At that cap, a new refusal returns `UPLOAD_REFUSAL_RECEIPT_LIMIT` as an unadmitted error with no operation ID or status-queryable receipt. Existing receipts still replay, and valid new admissions remain available. An incomplete 8 MiB bounded count also fails closed for a fresh refusal. Only the random quarantine key is exposed in those form fields. The complete command accepts the intent ID and idempotency key, revalidates delegation, and returns a durable receipt. The backend requires `mcp:write` plus `assets:write` for owner mode or `assets:contribute` for contributor mode. Contributor completion creates a private proposal regardless of other grants. Owner mode uses existing owner asset finalization.

The initial signing request holds a private fence until target generation settles. Concurrent admission replay returns `in_progress`. Signing failure records `UPLOAD_TARGET_UNAVAILABLE` and releases processing once; same-key replay returns that refusal. Signing failures after a target was issued cannot cancel its reservation. Bytes stay charged until confirmed cleanup.

The adapter reports a terminal signing failure only after the backend acknowledges that it failed the matching pending reservation. Replay signing failures and unacknowledged settlement return `UPLOAD_ACQUISITION_RETRY` with same-key retry guidance. A later replay reads the stored result, including a refusal whose acknowledgement was lost. A failed settlement RPC alone does not confirm a terminal outcome.

## URL acquisition recovery

The HTTP classifier and tool callbacks require transport and resource scopes.
Collection reads accept either contribution grant or `assets:review:read`;
collection writes accept either contribution grant. Append and revise require
the grant for each supplied item kind. Upload begin requires the grant for its
declared mode. Submit and complete recheck stored revision kind or upload mode
in Convex and return a recoverable insufficient-scope challenge when the token
needs the other grant. Alternative grants are not cumulative requirements.
Backend ownership, assignment, verification and target restrictions still apply.

Reviewer current-image URLs bind the submission, managed asset and inspected
review version. The authenticated route reuses detail authority, including
private-target super-admin and owner access and public-target assigned-reviewer
limits. Background artwork leases do not change a review version; destination
identity, status, artwork or observation changes still invalidate it.

Legacy proposal imports treat source-host throttling as transient. Before any source fetch or storage write, the matching worker reopens its lease and refunds the unused processing attempt. The proposal remains `upload_pending` and the same key may resume after the host window resets. The hosted handler returns `CONTRIBUTION_HOST_RATE`, `in_progress`, `retry_same_key`, and a bounded 60-second retry delay in structured content and matching JSON text. Admitted capacity stays charged, and retry rechecks live OAuth and target authority.

URL acquisition first claims a fenced processing lease, before fetching,
validating declared bytes/type/digest or writing quarantine data. Permanent
validation, unsafe-source and non-retryable HTTP 4xx failures settle the linked
attempt and release processing once. Unknown transport, timeout, HTTP 408/429
and server failures reopen same-key acquisition under the matching lease; a
stale worker cannot reset or fail a successor. Retained bytes stay charged until
confirmed deletion. Completion recovery requires the exact completion key and
current OAuth/resource authority. Terminal batch-linked completion replay checks
retained revision kind and batch ownership independently of the private payload,
so actual payload expiry does not hide the receipt. Missing retained kind after
purge fails closed; unfinished work still requires the full manifest. Admission
replay also rechecks current target
access, including owner loss.

Upload tickets bound URLs, field names/values/count and safe-integer expiry.
Collection payload cleanup retains revision kind independently from private
payload, so committed/refused receipt replay can reauthorize its original scope
without parsing deleted payload. Expired/superseded submissions are terminal for
correction; still-pending attempts remain blocked. Already-purged pre-change
revisions without kind metadata cannot reconstruct the original scope and fail
closed with `BATCH_PAYLOAD_EXPIRED`.
