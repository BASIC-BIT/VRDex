# MCP media staging lifecycle

The opt-in `apps/web/e2e/media-contribution.flow.spec.ts` exercises a real
user-delegated OAuth contribution and a different Clerk user's browser and MCP
review.
It uses only synthetic accounts, a synthetic person profile and the existing
solid-color fixture images. It does not prove a live VRChat claim or a real VRCDN
stream transition.

## Current evidence boundary

Issue #297 merged in PR #298 as `bab0e6c84be6901c7203524010e3371282431fd4`.
Issue #296 merged in PR #305 as `69e689b5963bfba7efb4e3ca986fe36e11361d95`.
The September 3 handoffs predate those merges. The recorded PR verification did
not include the staged two-user media lifecycle or controlled real-stream
transition. Merged code and tool advertisement do not establish those results.

On September 4, staging served `12f32b96a22a47bb91a4d0ab57f15d085c403b97`.
The contribution flag was absent from staging Convex and Vercel configuration.
On September 5, run `33990507621` passed the lifecycle assertions against
`267be4ea8526a9a5ab4e17e76a666fd490f271c3`, but independent readback found user
rows recreated during teardown. Recovery run `33991156676` removed them.
Corrected run `33991213039` passed against
`4edc0fc2cdb49fa20623708e05fce285920b2a08`, including account absence checks.
Independent reads found no fixture profile/media rows or matching recent test
users. Restoration run `33991495268` passed and restored the captured baseline
and three temporary flags. This is synthetic media lifecycle evidence, not a
real claim or controlled stream transition.

The current integration starts from main
`4ead2d0f36e86e6e93bc0a01a798b3761979ca85`, retaining the newer claiming changes.
It adds a second, different image for reviewer rejection, one normal cooldown
refusal, and bounded audit-ledger inspection. On September 8,
[run34180440620](https://github.com/BASIC-BIT/VRDex/actions/runs/34180440620)
passed all seven lifecycle stages on exact candidate
`249d93f104900e27a8cf1c99c576ef380182007e`: one expected test, zero skipped,
failed or flaky results, and verified cleanup including exact Convex and Clerk
account absence. A separate run-scoped fixture lookup also confirmed absence.
[Restoration34180823119](https://github.com/BASIC-BIT/VRDex/actions/runs/34180823119)
passed on the captured main baseline above. Final live identity and all three
temporary media flags matched their original values. The passing evidence is
limited to that candidate and the assertions described below.

## Preconditions

- Obtain operator approval before deploying a candidate or changing staging
  flags. Record the exact candidate, reviewed base and prior configuration.
- Target `https://staging.vrdex.net` with its existing shared development
  Convex deployment `scrupulous-corgi-247`. The fixture refuses production and
  has no production override.
- Deploy the candidate's web and backend together, then pin
  `VRDEX_E2E_EXPECTED_COMMIT` to its full SHA. The test refuses a mismatch.
- Enable the existing media-kit and media-submission flags in the web and
  backend. Enable contributor uploads and the cleanup-ready flag in Convex only
  after verifying the cleanup worker. Intake must be unpaused. Verify storage is
  configured. The fixture preflight runs before account creation.
- The synthetic images are static 64px solid-color PNGs at
  `/test-media/profile-image.png` and `/test-media/rejected-image.png`.
  Different content avoids the normal duplicate-image refusal. The test fetches
  both before creating accounts.
  No application-wide Playwright fixture mode is enabled.
- Supply the matching Clerk development secret/publishable keys and existing
  E2E browser token through the runner environment. A Vercel environment pull
  can contain empty sensitive values: validate nonempty values, key class and
  the served Clerk tenant. Never print credentials or commit an environment file.
- Enable `VRDEX_ENABLE_E2E_CLERK_AUTH=true`,
  `VRDEX_ENABLE_E2E_AUTH_HELPERS=true` and
  `VRDEX_E2E_MEDIA_LIFECYCLE=true` in the runner. Deployment-side E2E helpers
  and their existing secrets must already be configured.
- Local runs also require a unique, recorded `VRDEX_E2E_MEDIA_RUN_ID` such as
  `media-local-operator-1`. Actions derives it from durable run ID and attempt.

From `apps/web`, with those values loaded only into the process:

```powershell
pnpm exec playwright test media-contribution.flow.spec.ts --project=desktop-chromium
```

The existing Staging Deploy workflow also exposes a default-off
`media_lifecycle` dispatch input. After approval, dispatch that workflow on the
exact candidate branch with this input enabled. It deploys that branch through
the existing staging lane and runs the test with the repository's existing
Clerk/E2E secrets and `github.sha` pin. Automatic main deployments do not opt in.

Before enabling direct uploads, use the separate default-off
`media_cleanup_proof` input. Keep `VRDEX_CONTRIBUTION_UPLOADS_ENABLED` and
`VRDEX_MEDIA_UPLOAD_CLEANUP_READY` off. The normal URL submission path needs
staging intake temporarily unpaused, because the same contribution policy
applies to URL submissions. The proof creates one run-linked URL import,
rejects it as the synthetic profile owner, advances only that rejected
fixture's cleanup deadline, invokes the configured cleanup worker, and checks
both Convex completion and exact S3 object absence. Its guarded helper is
pinned to the designated staging Convex deployment and cannot alter production
retention. Restore the staging intake pause after the run until the direct
upload rollout is ready. A reachability-only worker response is not deletion
evidence.

After cleanup readiness and contributor uploads are enabled in staging, use
the separate default-off `media_upload_cleanup_proof` input. It creates one
run-linked contributor upload on its own synthetic profile, posts bytes to the
minted S3 endpoint, and leaves completion pending. Cleanup waits for the signed
POST to expire, confirms replay is refused, advances only that reservation's
cleanup deadline, then calls the authenticated worker. The proof checks that
the exact object is absent and the reservation is failed with `UPLOAD_EXPIRED`,
zero charged/quarantine bytes, no active processing, and zero actor/target
capacity. The ordinary fixture teardown then removes the remaining rows and
accounts. This uses a separate profile because baseline policy permits only
two open submissions on the two-user review fixture.

The test is separate from the ordinary `@flow` lane and requires explicit
opt-in. OAuth exchange traces and video recording are disabled. Its evidence
attachment contains the candidate, completed assertions and cleanup result,
without tokens, source bytes, account IDs or profile IDs.
Automatic retries are disabled so a cleanup failure cannot become a successful
flaky run that leaves an earlier fixture behind. CI media reports use separate
paths from the ordinary staging health and auth-session reports.
Cleanup runs in `afterEach` with a separate 13-minute budget for direct uploads
(two minutes in rejected-URL cleanup mode), so the test's timeout does not consume its
recovery time. Browser contexts close before
cleanup to prevent user reprovisioning. Cleanup uses the independent API request
context; subsequent evidence attachments use `testInfo`, not a live browser.

## What the test proves

1. A and B have separate Clerk identities and browser contexts. Each authorizes
   only `mcp:read assets:review:read mcp:write assets:contribute
   assets:review:write`.
2. A submits a URL image to an unclaimed person. Same-key replay returns the same
   submission; conflicting reuse and stale revisions are refused. One immediate
   new-key request must return the exact sanitized cooldown message. After
   waiting 31 seconds without changing rate policy, A reserves the second image
   with `vrdex_media_upload_begin`, posts its bytes to the minted S3 endpoint,
   and finalizes with `vrdex_media_upload_complete`. The completion receipt
   replays unchanged. This is submission-cooldown evidence, not transport-wide
   HTTP 429 or daily-quota exhaustion coverage.
3. A can read the submission; B cannot enumerate it. Public profile projection
   contains no new image before review, and anonymous/A review-file requests
   return the exact sign-in-required 401 and review-access-required 403 responses.
   Unexpected backend/storage failures remain errors rather than authorization
   evidence. A cannot enter the review queue.
4. The fixture assigns only that synthetic profile to B after submission.
   Further contributor submissions to the claimed target are refused. B rejects
   the URL image through normal browser controls. A sees the contributor
   disposition but not the private reason; B's caller-only history stays empty.
   No public asset exists after rejection, and public projection excludes the
   source URLs and review reasons. The MCP preview returns the direct upload's
   stored pixels as native image content for the inspected version. A's MCP approval
   is refused because A has no review authority. B approves the direct image through MCP,
   replays the same receipt, and the browser and public readback show one public
   asset with `community_submitted` provenance.
5. The staging-only audit inspector bounds each ledger read to 101 rows for
   the exact run-linked contributor and refuses overflow above 100. It checks
   field allowlists and absence of URL/bearer/image-data markers and the fixture's
   source URLs, private notes, upload tokens and storage keys. It returns only
   counts and a redaction boolean, requiring one accepted URL-submission audit row
   and recorded denied tool calls. It never returns ledger payloads or removes
   retained audit rows. This is bounded fixture evidence, not a global audit.
6. Revoking A's grant refuses subsequent authenticated status reads while
   anonymous profile reads remain available.
7. Cleanup freezes the fixture, waits until the minted S3 POST expires, confirms
   a replay is refused, then deletes and HEAD-checks each exact fixture object. It releases both
   upload reservations and their actor, target, deployment and published charges,
   then removes media rows before the existing profile/account cleanup removes
   its synthetic identities.

Assigning fixture ownership is setup for media authorization testing. It is
not evidence that the real claiming process succeeded. Unclaimed-profile
super-admin review remains covered by backend tests rather than this browser
scenario. Hidden-target refusal, quota/cooldown, import-safety and retention
timing also retain their existing backend/importer coverage.
The September 5 lifecycle did not inspect retained audit ledgers. September 8's
run establishes bounded fixture-ledger redaction and sanitized submission
cooldown evidence. Any wider transport rate-limit requirement still needs
separate evidence.

## Cleanup and recovery

The fixture is restricted to exact `e2e:<runId>` profile attribution and
run-linked test email addresses. Cleanup first makes the profile ineligible,
expires intents and refuses active processing/cleanup leases or legal holds.
It retains the original `mcp_local` expiry until the signed POST is no longer
usable. A retryable cleanup response carries the deadline; no object or ledger
row is deleted before that deadline. This can take about ten minutes.
If direct transfer fails before completion claims storage work, cleanup releases
only the run's pending upload reservation after that deadline, provided no
storage token or lease is active. A failure after completion claims storage work
retains its processing token and requires operator recovery.
Storage deletion precedes row deletion so a failed object deletion retains
the metadata needed for recovery. The helper never returns object keys. It
accepts `profile-assets/quarantine/local/<uuid>` only for the exact fixture's
`mcp_local` intent and refuses reservations belonging to other actors or batches.

Cleanup removes the fixture's operational data, including review receipts,
rebases, publication evidence and restrictions linked to its submissions, not
its historical telemetry.
The existing `apiWriteAuditEvents` and `mcpToolEvents` ledgers retain synthetic
actor and target IDs after the referenced fixture rows are deleted. These are
historical request records; cleanup does not promise zero residual telemetry.
Their normal payload excludes source URLs, image content and storage keys.

Close both authenticated browser contexts before account deletion. The client
provisions a missing user row, so deleting accounts with live tabs can recreate
the Convex identities. Teardown checks account absence in both Convex and Clerk;
a successful DELETE response alone is insufficient evidence.

Run `33990507621` passed the lifecycle assertions but independently revealed
recreated user rows during teardown. Staging Deploy has a `media_recovery`
dispatch mode. It skips deployment and passes the operator-supplied exact run ID,
profile ID, and deployed commit to `apps/web/e2e/media-recovery.ts`. The workflow
defaults identify run `33990507621` only; override all three inputs for another
run. The script verifies those values against the live staging deployment and
fixture before cleanup. It uses existing Actions secrets and the guarded media
DELETE, waiting up to 12 minutes if a signed upload is still valid. Account
cleanup begins only after media/profile absence is verified. Dispatch requires
the operator's exact recovery approval.
Before any deletion, an authenticated Clerk domains lookup must identify the
same primary Frontend API as the pinned deployment. A development key prefix
or an empty user lookup is insufficient. A failed, malformed, or mismatched
tenant response stops recovery. This uses the read-only domains endpoint in
the [Clerk Backend API specification](https://github.com/clerk/openapi-specs/blob/main/bapi/2025-11-10.yml).

Actions recovery IDs are `media-<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>`, so they
remain reconstructible even if the runner is killed before writing artifacts.
The exact account addresses are `<runId>-contributor+clerk_test@e2e.vrdex.net`
and `<runId>-reviewer+clerk_test@e2e.vrdex.net`. Authenticated fixture POST with
`{op:"lookup",runId}` finds the profile by its deterministic slug and verifies
exact run attribution. The test refuses to reuse an existing fixture.

If cleanup fails, the test fails and retains fixture identities. A local
`media-cleanup-recovery` attachment contains only the run/profile handles and
failed stages. Retry the authenticated fixture DELETE with those handles,
then run account cleanup. Do not delete the identities first or claim cleanup
succeeded on a best-effort response. Restore any temporary staging flags and
verify the prior deployment/configuration state after the approved run.

A retained import processing token is a distinct stop condition, including one
whose ten-minute lease has expired. Lease expiry permits another import claim;
it does not stop the old server invocation from writing its captured S3 keys.
Clearing that token based only on age could recreate orphaned objects after
cleanup. Pause for the operator, confirm the original invocation has terminated,
and obtain approval for recovery through the existing token-matched import
failure transition before retrying fixture cleanup. This test deliberately does
not promise automatic recovery from a killed server invocation. Do not replay
the import or clear the token merely to make cleanup pass.

Production contribution approval and the first legitimate public target remain
separate operator decisions. See
[the hosted MCP rollout gate](../developers/hosted-mcp-oauth-writes.md#contribution-rollout-gate).

## Media-kit publication candidate

The media-kit publication candidate extends this same opt-in fixture. Contributor A receives a run-scoped, expiring trusted-publisher grant. Reviewer B receives an expiring media-reviewer grant and an active assignment to the run collection. They remain separate accounts. The guarded fixture attaches each synthetic submission to one revision and attempt, including a replacement proposal with no upload intent. It does not grant site-admin authority.

The third image is a generated 64 by 48 PNG, distinct from both static source images. Assertions cover website publication without declarations, unchanged primary picture, selection and undo, metadata correction, ordinary review publication into the kit, explicit review comparison against a published candidate, protected removal refusal, and logical removal of an unused kit item. Removal keeps stored bytes and accounting until fixture teardown. The existing owner-claim refusal remains a separate final check.

A fourth generated image exercises successful authenticated MCP upload, completion, inspection, preview, publication, contribution readback, metadata correction, replacement proposal and distinct assigned-reviewer approval. Public render and decoded download assertions follow publication. The earlier website asset also exercises successful MCP selection and undo. Discarding the first publication response models a lost client result, then exact-key replay recovers it. Guarded fixture controls edit only the run profile's biography, transfer its unchanged primary selection to the run reviewer, and revoke only the two run-owned feature grants. Assertions refuse publisher undo after same-asset reselection, stale reviewer decisions, and publisher/reviewer receipt replay after relevant feature revocation. The body has a seven-minute limit for the expanded network/browser round and the three existing upload-rate cooldowns; teardown retains its separate expiry budget.

Teardown bounds and validates feature grants, batch revisions, attempts, assignments, media rows and receipts against the exact run actors before deleting them. Local Storybook and static Next screenshots prove UI fixture behavior only. Acceptance still requires the exact candidate deployed together to designated staging and an executed authenticated lifecycle with verified cleanup.

## Task 6 acceptance and operator ordering

Local migration tests, fixture receipts and catalog checks are preparedness, not live evidence. Required hosted acceptance remains pending until exact-candidate staging authorization and approval of Task4's exact public descriptions. Use the existing workflow_dispatch media_lifecycle route and its staging credentials; do not replace the assigned media_reviewer with site-admin authority.

The executed run must show minted upload transfer, completion and same-key recovery, stored preview, kit publication without declaration, approved-state readback, public kit render and usable decoded download, select/undo, metadata correction, kit-only removal and independent existing-asset replacement. Publication with an existing picture must leave that picture unchanged. Check the deployed media-kit feature flag and public field visibility, unrelated biography edits, stale selection refusal, protected same-asset reselection, revoked publisher/reviewer authority and replay denial after revocation. Capture desktop/mobile public kit and unchanged/selected/restored picture screenshots. A successful Publish receipt alone is insufficient.

After separately authorized deployment, preview bounded conversion from null cursor through isDone, review conflicts, then authorize apply from null cursor. Karly's exact-resource operator correction requires its own fresh preview using actual placement.updatedAt and selectionOperationId; public MCP/profile/submission timestamps cannot prove these guards. Production conversion/correction and its public render/download verification remain separate approval gates. Preserve the existing fixture expiry and exact-run cleanup assertions throughout.
