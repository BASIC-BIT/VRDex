# MCP media staging lifecycle

The opt-in `apps/web/e2e/media-contribution.flow.spec.ts` exercises a real
user-delegated OAuth contribution and a different Clerk user's browser review.
It uses only synthetic accounts, a synthetic person profile and the existing
solid-color fixture image. It does not prove a live VRChat claim or a real VRCDN
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

## Preconditions

- Obtain operator approval before deploying a candidate or changing staging
  flags. Record the exact candidate, reviewed base and prior configuration.
- Target `https://staging.vrdex.net` with its existing shared development
  Convex deployment `scrupulous-corgi-247`. The fixture refuses production and
  has no production override.
- Deploy the candidate's web and backend together, then pin
  `VRDEX_E2E_EXPECTED_COMMIT` to its full SHA. The test refuses a mismatch.
- Enable the existing media-kit and media-submission flags in the web and
  backend as required by their normal import/review paths. Verify storage is
  configured. The fixture preflight runs before account creation.
- The synthetic image is the static 64px solid-color PNG at
  `/test-media/profile-image.png`. The test fetches it before creating accounts.
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

The test is separate from the ordinary `@flow` lane and requires explicit
opt-in. OAuth exchange traces and video recording are disabled. Its evidence
attachment contains the candidate, completed assertions and cleanup result,
without tokens, source bytes, account IDs or profile IDs.
Automatic retries are disabled so a cleanup failure cannot become a successful
flaky run that leaves an earlier fixture behind. CI media reports use separate
paths from the ordinary staging health and auth-session reports.
Cleanup runs in `afterEach` with a separate two-minute budget, so the test's
timeout does not consume its recovery time. Browser contexts close before
cleanup to prevent user reprovisioning. Cleanup uses the independent API request
context; subsequent evidence attachments use `testInfo`, not a live browser.

## What the test proves

1. A and B have separate Clerk identities and browser contexts. Each authorizes
   only `mcp:read mcp:write assets:contribute`.
2. A submits an image to an unclaimed person. Same-key replay returns the same
   submission; conflicting reuse and stale revisions are refused.
3. A can read the submission; B cannot enumerate it. Public profile projection
   contains no new image before review, and anonymous/A review-file requests
   return the exact sign-in-required 401 and review-access-required 403 responses.
   Unexpected backend/storage failures remain errors rather than authorization
   evidence. A cannot enter the review queue.
4. The fixture assigns only that synthetic profile to B after submission.
   Further contributor submissions to the claimed target are refused. B uses
   the normal browser review controls to approve, creating one public asset
   with `community_submitted` provenance.
5. Revoking A's grant refuses subsequent authenticated status reads while
   anonymous profile reads remain available.
6. Cleanup removes only the run's fixture objects and media rows before the
   existing profile/account cleanup removes its synthetic identities.

Assigning fixture ownership is setup for media authorization testing. It is
not evidence that the real claiming process succeeded. Unclaimed-profile
super-admin review remains covered by backend tests rather than this browser
scenario. Hidden-target refusal, quota/cooldown, import-safety and retention
timing also retain their existing backend/importer coverage.
The lifecycle does not inspect retained audit ledgers. Issue #297's staged
audit-redaction and sanitized rate-limit evidence remain separate production
rollout gates; this passing test does not close them.

## Cleanup and recovery

The fixture is restricted to exact `e2e:<runId>` profile attribution and
run-linked test email addresses. Cleanup first makes the profile ineligible,
expires intents and refuses active processing/cleanup leases or legal holds.
Storage deletion precedes row deletion so a failed object deletion retains
the metadata needed for recovery. The helper never returns object keys.

Cleanup removes the fixture's operational data, not its historical telemetry.
The existing `apiWriteAuditEvents` and `mcpToolEvents` ledgers retain synthetic
actor and target IDs after the referenced fixture rows are deleted. These are
historical request records; cleanup does not promise zero residual telemetry.
Their normal payload excludes source URLs, image content and storage keys.

Close both authenticated browser contexts before account deletion. The client
provisions a missing user row, so deleting accounts with live tabs can recreate
the Convex identities. Teardown checks account absence in both Convex and Clerk;
a successful DELETE response alone is insufficient evidence.

Run `33990507621` passed the lifecycle assertions but independently revealed
recreated user rows during teardown. It has an approved `media_recovery` dispatch
mode in Staging Deploy. It skips the deployment job entirely and invokes
`apps/web/e2e/media-recovery.ts` with that run's fixed profile ID and deployed
commit. It uses existing Actions secrets, the normal guarded media DELETE, and
account cleanup only after media/profile absence is verified. It cannot serve
as a general recovery command for another run without a reviewed change to its
identity pins. Dispatch requires the operator's exact recovery approval.
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
