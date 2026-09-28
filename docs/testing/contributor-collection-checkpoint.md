# Contributor collection checkpoint

## Local evidence, 2026-09-14

The synthetic policy is a sizing proposal, not an enabled hosted policy. The
default remains `baseline-v1`: three open proposals per actor, two per target,
six creations per actor per rolling day, twenty per target, and one admission
per thirty seconds. Local bridge bytes remain 144 MiB per actor and 96 MiB per
target. Current normal intake does not acquire trusted limits merely from a grant.

`convex/_contributionPolicy.ts` contains the single proposed ordinary/trusted
table and a checked-in dedicated identity allowlist. Only
`local:contributor-capacity-proof` can select `synthetic-v1`. Unknown policies,
production identities, ordinary dev identities and malformed bounds fail closed.
Adding a real dedicated staging identity requires an owner-reviewed code change.
No env variable can add an identity to the allowlist.

Run the local workflow with PowerShell:

```powershell
$env:TSX_TSCONFIG_PATH = 'apps/web/tsconfig.json'
node --import tsx scripts/prove-contributor-collection-local.ts
node --conditions=import --import tsx --test tests/backend/contribution-capacity-load.test.ts
```

The workflow committed 30 profile/link items and 20 actual decoded PNG proposals
(10 URL, 10 local), then completed 14 independent approvals, one rejection and 5 separately
granted trusted publications. It replayed an admission after a simulated lost
response, verified its in-progress status, and refused a changed declaration
before transfer. Its injected object map retained 80 objects. A
stored WebP candidate was decoded and visually inspected. This is real local
command and image-validation evidence with simulated storage, not S3, browser
authentication, or installed-client rendering evidence.

The load test admitted and completed 1,100 proposals across two actors and 110
targets, reached 1,000 open proposals for one actor, and refused the next proposal.
All transactions fit a configured 2,000,000-byte read budget. On the initial local
run, elapsed time was 31.82 seconds; admission p50 was 21.99 ms, p95 47.96 ms and
maximum 164.29 ms. The first actor retained 1,324,000 bytes and zero processing
reservations. These are `convex-test` timings with a simulated clock, not hosted
latency, concurrency throughput, or billed database-read measurements. Concurrent
finalization, downgrade, revocation and interrupted deletion have separate tests.

## Capacity and operational interfaces

`vrdex_contribution_capacity` returns policy version, grants-derived tier, scopes,
feature availability, limits, usage, remaining capacity and rolling retry time.
It explicitly reports `reservation: false`. Backlog/byte saturation has no invented
retry time. `vrdex_contribution_status` supports cursor, state, batch and exact
operation receipt lookup. A filtered page can be empty with more pages available.
`vrdex_contribution_capacity_request` accepts private evidence and a restricted
reason (`collection`, `reconsideration`, `temporary_batch`); own request status is
available through `vrdex_contribution_capacity_requests`. These are ordinary MCP
operations, not admin-only scripts. They remain available during intake pause.

Retained batch envelopes have a separate quota, including empty, archived and
legacy batches. The bound is 1,000 for baseline/ordinary actors and 10,000 for
synthetic trusted actors, matching the active-row policy scale. Current trust
determines admission. Archiving does not release this quota, and an existing
caller key still replays at or above the bound. `BATCH_ENVELOPE_LIMIT` refuses
new keys without deleting audit or receipt rows. No counter backfill is needed.
Admission and capacity discovery paginate at most the current limit plus one
indexed batch rows with an 8 MiB byte budget. A final document may cross that
budget; its 1 MiB document ceiling leaves headroom under the transaction limit.
`usage.retainedBatchesIsLowerBound` marks any incomplete count. If the page ends
before proving a count below quota, `BATCH_ENVELOPE_COUNT_INCOMPLETE` refuses new
keys. Existing keys still replay. Operators can inspect oversized legacy cleanup
metadata and sum every `reconcilePage(kind: "batches")` page for the exact count;
reconciliation also uses the byte budget and at most 40 rows per page. Exact
reconciliation alone does not override admission or delete retained records.
Batch reconciliation counts active rows only in non-archived batches. Revision
reconciliation excludes rows whose private payload has expired.

The separately granted `trusted_contributor` feature conveys capacity only.
`accountFeatureGrants.grant` can link a request ID; revoke and expiry use the
existing internal grant operations. No migration creates grants. Temporary batch
allowances require internal super-admin review, bind the actor, batch, maximum
rows, cumulative reserved bytes and expiry, and apply only under `synthetic-v1`.
They do not change target limits, reviewer/publisher authority or source policy.
Expiry/downgrade permits an admitted unexpired reservation to finish; revocation
and intake pause block completion. Read/status/review/withdrawal remain available.

New local and legacy URL intake share creation limits and the reservation ledger.
Admission quota refusals are terminal receipts; an in-progress attempt remains
distinct. Fresh delegation is checked before replay. Bytes include source,
quarantine and derivatives, and are released only after confirmed deletion.
Published objects transfer to a separate published-storage counter. Deployment
byte admission includes that counter. Held objects remain charged.

Fresh admission refusals are limited to 256 retained receipts per actor across
OAuth clients. Existing receipt replay and successful upload admission remain
available at the limit. A further fresh refusal returns
`UPLOAD_REFUSAL_RECEIPT_LIMIT` with no durable operation ID or receipt; it is
not a status-queryable command outcome. The indexed count reads at most 256
rows and 8 MiB; an incomplete read fails closed. Historical receipts remain
retained. Expired source-host minute counters are removed in bounded scheduled
pages, with continuation for a full page. Pending-request limits count only
unexpired batch allowances, and approval permits one active allowance per
batch. Expired historical approvals remain available for audit.

`contributionOperations.inventory` is an internal super-admin paginated query
(at most 40 reservations) returning object-key inventory, page totals, pending
age, cleanup lag, reviewed count in the past day, failed reserved bytes and an
explicit query-read count. Sum every page, take minima for oldest timestamps,
and deduplicate keys before reconciling with storage. Page results are not global
totals. Failed reserved bytes are a cost input, not a billed-cost claim. Hosted
read billing, derivative amplification, reviewer throughput and cleanup latency
still require measurement against the approved deployment and storage inventory.

## Checked-in configuration

All variables below are Convex deployment-scoped, owned by the self-hosting
operator; BASIC approves changes on BASIC's deployments. Recreate them from this
table and `convex/_contributionPolicy.ts`; never put secret values in git.

| Name | Default | Meaning |
| --- | --- | --- |
| `VRDEX_CONTRIBUTION_POLICY` | `baseline-v1` | Explicit policy selection; synthetic identity guard applies |
| `VRDEX_CONTRIBUTION_BATCHES_ENABLED` | false | Bulk collection intake switch |
| `VRDEX_CONTRIBUTION_INTAKE_PAUSED` | false | Stops new intake and finalization, preserves reads and decisions |
| `VRDEX_CONTRIBUTION_DEPLOYMENT_BYTES` | 100 GiB | Proposed unmeasured deployment storage bound |
| `VRDEX_CONTRIBUTION_DEPLOYMENT_CONCURRENCY` | 16 | Proposed unmeasured import bound |
| `VRDEX_CONTRIBUTION_HOST_FETCHES_PER_MINUTE` | 30 | Proposed unmeasured initial source-host fetch bound |

These global bounds apply to both baseline and synthetic policies. Global values
are conservative operator choices requiring measurement, not
universal safe production values. Existing upload, cleanup-readiness, storage,
OAuth and publication switches remain required. Source-host admission counts
initial fetch requests; SSRF/redirect restrictions remain in the fetch adapter.

## Rollout, reconciliation and rollback

1. Deploy additive readers/indexes first with intake disabled. Old records omit
   new ledger and publication fields; readers tolerate them and do not invent
   historical reviewer attribution.
2. Keep intake paused while running `contributionOperations.backfill` in cursor
   pages of 40, then `backfillSubmissions`, then `backfillArchivedPayloads`, each
   from a null cursor until its `isDone` result. These internal mutations never
   enable policy or issue grants. Inspect every unresolved count. Consumed approved
   intents retain committed receipts and published accounting; cleanup excludes
   their published keys even if a reservation state is inconsistent. Archived
   payload scheduling derives from `archivedAt` plus 30 days and preserves existing
   cursors and legal holds. Missing, invalid or future archive timestamps remain
   unresolved without a deletion deadline; resolve their history before rollout.
   A retention-version marker makes completed scheduling repeatable without
   rescheduling already expired payloads.
3. Page `inventory`, compare unique object keys and actual S3 HEAD/list sizes,
   and reconcile actor, target, deployment and published counters. Missing objects,
   untracked legacy records and unknown sizes block elevated rollout. Backfill
   conservatively reserves unknown legacy sizes. Do not certify accounting from
   a database-only inventory.
   Pending legacy submissions reserve declared source bytes plus worst-case
   derivative capacity, then settle actual source/download/display bytes on seal.
4. Prove cleanup retries, held-object exclusion, published transfer, lost-response
   replay and intake pause on the exact approved dedicated deployment. Archived
   private manifest payloads expire after 30 days, except unresolved review and
   legal hold; retained bytes/revisions are released only when payloads expire.
   Minimal receipts and publication audits remain indefinitely pending an explicit
   owner-approved retention/deletion policy.
5. Owner approves exact initial recipients, grant expiry/reconsideration terms,
   reviewer staffing and measured operational bounds. Proposed initial recipients
   and staffing are not yet selected. Do not promote accounts from volume alone.
6. Roll back with `VRDEX_CONTRIBUTION_INTAKE_PAUSED=true` and bulk intake disabled.
   Keep readers, review/withdrawal, receipt tables and scheduled cleanup deployed.
   Do not remove schema fields or roll back to writers that ignore reservations.

## Unrun external gates and exact opt-in sequence

No hosted bucket, deployment, grant, OAuth client or configuration was changed.
Each target and mutation needs direct owner approval before these steps:

1. Approve the exact isolated deployment, test profiles/accounts, bucket/prefix,
   client registrations, scopes and cleanup owner. Add that deployment identity
   to the reviewed allowlist before selecting the proposed policy. Confirm it is
   absent from all production runtime identities.
2. Run the existing [dedicated S3 proof](local-media-upload.md#dedicated-s3-proof)
   with `--approved-test-bucket=EXACT_APPROVED_BUCKET`. Its four generated keys
   under `profile-assets/proof/local-upload/<uuid>/` are deleted in `finally`.
3. Through installed Codex and Claude Code, discover capacity, create/append one
   50-row collection (30 profile/link plus 20 real media), transfer both URL/local
   candidates, and verify own status and stable cross-client receipts. Independently
   review 15 and explicitly publish 5 using the separate grant. Read the actual
   stored previews in both clients and save screenshots with operation IDs.
4. In the authenticated browser, verify independent reviewer and contributor
   sessions, local-time status, stored-image rendering, rejection, withdrawal,
   pause and permission revocation. Capture screenshots and VLM review.
5. Archive manifests, withdraw/reject remaining test proposals, and verify cleanup
   acknowledgements against the exact generated keys. Remove test publications
   through approved owner/admin commands, preserve audit receipts, then revoke
   temporary grants and restore the approved disabled configuration. Record any
   held objects that cannot yet be deleted.

Actual S3 transfer, Clerk sessions, Codex/Claude rendering, hosted multi-user load,
costs, cleanup-lag measurements and reviewer staffing remain unverified gates.
