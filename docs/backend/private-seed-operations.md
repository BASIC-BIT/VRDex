# Private Seed Operations

## Status

Operator runbook for permissioned private seed imports, reviewed lookup access,
and concierge handoff invitations.

## Safety Boundary

Locked behavior:

- Real source files stay outside the repository.
- The operator must confirm permission to use the source before importing it.
- Permissioned JSON imports receive `private_only` publication policy on import.
- A `private_only` batch cannot publish. Its candidates stay out of public
  profiles, search documents, public APIs, and anonymous lookup until an
  operator explicitly relaxes the batch policy.
- Operator review, source freshness, link reachability, and owner confirmation
  remain separate states.
- PostHog flags never authorize private Convex reads.

Publication is an explicit per-batch operator decision, never a default. See
[Publication](#publication).

## Input Shape

Omit `sourceObservedAt` when the source date is unknown. Add `lastCheckedAt` to
an individual field only after a real recheck.

```json
{
  "permissioned": true,
  "batchId": "nwinn_2026_07_10_001",
  "sourceName": "NWinn",
  "sourceType": "partner",
  "receivedAt": "2026-07-10T00:00:00.000Z",
  "candidates": [
    {
      "candidateId": "nwinn-dj-001",
      "proposedDisplayName": "DJ Example",
      "fields": [
        {
          "fieldKey": "outboundLinks",
          "value": [
            {
              "type": "twitch",
              "label": "Twitch",
              "url": "https://twitch.tv/example"
            }
          ],
          "sourceLabel": "NWinn DJ master list",
          "sourceType": "partner",
          "confidence": "medium",
          "visibility": "private"
        }
      ]
    }
  ]
}
```

Allowed profile fields are `aliases`, `tags`, `genres`, `headline`, `bio`,
`about`, `outboundLinks`, `region`, `timezone`, `person.pronouns`, and
`person.roleTags`. Private contacts, raw account identifiers, private notes,
unknown fields, embedded URL credentials, non-HTTPS links, and unsupported link
types are rejected.

## Import

Run from a non-protected worktree. The script rejects files inside the repo,
keeps each Convex CLI invocation below a conservative Windows command-line
limit, and safely resumes a partially completed batch by skipping existing
candidate IDs only when their normalized import fingerprints match. A changed
payload under an existing candidate ID fails instead of silently retaining
stale data. Imported observation and checked timestamps cannot be in the future.

```powershell
pnpm ops:seed-import:json -- `
  --file C:\private\nwinn-djs.json `
  --actor-token operator:vrdex `
  --actor-issuer vrdex `
  --actor-subject seed-import `
  --actor-name "VRDex operator" `
  --prod
```

The command prints counts only. It does not print source rows or field values.
For a named development or preview deployment, replace `--prod` with
`--deployment <deployment-name>`.

## Review And Freshness

Use the internal review mutations with the IDs returned by the Convex operator
tools or review snapshot query:

- `seedImports:setBatchReviewState`
- `seedImports:setCandidateReviewState`
- `seedImports:setCandidateFieldReviewState`
- `seedImports:getBatchReviewSnapshot`

`Reviewed` means accepted for the intended private use. It does not mean
current or owner-verified. The field review mutation accepts `lastCheckedAt`
only when an actual recheck occurred and rejects future timestamps.

## Publication

Publishing a private batch takes three deliberate steps. Each one re-checks the
gates, so a policy change or a suppression request between steps stops the
publish.

1. **Relax the batch policy.** `seedImports:setBatchPublicationPolicy` moves a
   batch from `private_only` to `reviewed_publication_allowed`. A `reviewNote`
   is required and is recorded on the batch, because this is the record of the
   operator asserting the source permits public listing.
2. **Queue each candidate.** `seedImports:queueCandidatePublication` marks
   intent and validates review state, slug, and suppression. It writes no
   public data.
3. **Publish.** `seedImports:publishQueuedCandidate` creates or promotes the
   public unclaimed profile, indexes it for search and vocabulary, and records
   `publishedProfileId` / `publishedAt` on the candidate.

Publish behavior worth knowing:

- An `unreviewed` field **blocks** the candidate with `field_unreviewed` rather
  than being skipped, at both the queue and publish gates. Every field must be
  reviewed before that candidate can publish; use `--accept-fields` for a trusted
  source. `rejected` fields alone are simply not copied.
- Only `accepted` fields are copied onto the profile.
- Each copied field keeps its reviewed `visibility`. Publication uses the shared
  seed field mapper in `reviewed` mode; the concierge handoff path uses the same
  mapper in `private` mode, which forces every field private. Publishing with the
  concierge default would produce a profile with nothing visible on it.
- Merging into an existing profile only applies accepted seed fields. Fields the
  candidate never proposed are left untouched, and the profile's original
  `publishedAt` is preserved.
- An accepted suppression request blocks publication whether it was filed by
  profile id, by slug, or as a pre-claim `displayName` + `profileType` request
  with no slug at all.
- A person candidate matched to a community profile is blocked with
  `matched_profile_type_mismatch` rather than attempting a cross-type write.
- Slug collision is checked on the derived base slug as well as an explicit
  `proposedSlug`. A candidate whose name normalizes onto an existing profile is
  blocked with `slug_collision_blocks_publication` rather than silently getting a
  suffixed slug, so two profiles for the same person need a deliberate
  `seedImports:matchCandidateToProfile` call. Genuinely distinct people sharing a
  name also surface here and need the same explicit decision.
- Published profiles carry no `sourceAttribution`. That field makes the public
  serializer render a profile as `Community submitted`, which would be false
  provenance for an operator import; `creationSource: "import"` records the real
  origin.
- A batch with no explicit `publicationPolicy` fails closed and is treated as
  `private_only`. Legacy batches need step 1 before they can publish.
- Person candidates only. Community candidates return
  `candidate_profile_type_unsupported` and are skipped rather than
  half-published.
- Re-running publish on an already-published candidate returns the existing
  profile instead of creating a duplicate.
- An accepted `profileSuppressionRequests` row blocks publication. See
  [Suppression Requests](#suppression-requests) for how a request is accepted.
- Restoring `private_only` blocks future publication but does not retract
  profiles already published from the batch. Retract those with
  `suppressions:resolveProfileSuppression`.

Ineligible candidates return `published: false` with a blocker list rather than
throwing, so a bulk run can skip and continue.

### Bulk Publishing A Batch

Doing the three steps by hand is one call per candidate per field, which is not
practical for a few hundred people. `pnpm ops:seed-publish` drives the whole
batch.

Preview first. Without `--apply` it writes nothing and prints counts only, so it
is safe to run against production:

```powershell
pnpm ops:seed-publish -- --batch-id nwinn_2026_07_10_001 --prod
```

Then publish:

```powershell
pnpm ops:seed-publish -- `
  --batch-id nwinn_2026_07_10_001 `
  --actor-token operator:vrdex `
  --actor-issuer vrdex `
  --actor-subject seed-publish `
  --actor-name "VRDex operator" `
  --reason "Source confirmed public listing is permitted." `
  --accept-fields `
  --limit 25 `
  --apply `
  --prod
```

- `--reason` is required and is recorded on the batch. It is the record of the
  operator asserting the source permits public listing.
- `--accept-fields` is the trusted-source shortcut. It accepts candidates and
  fields still marked `unreviewed`; `rejected` and `needs_correction` are always
  left alone, so trusting a source never undoes a review decision. Without this
  flag every field must already be reviewed or the candidate is skipped with
  `field_unreviewed`.
- `--limit` is the page size, not a cap. The script pages with a cursor until the
  batch is drained and prints running progress. Cursor paging matters: a
  permanently blocked candidate never receives a `publishedProfileId`, so
  offset-style paging would re-read the same page forever.
- Batches already marked `rejected` or `superseded` are refused. Those are review
  decisions; move them with `seedImports:setBatchReviewState` first if that is
  genuinely intended.
- Restoring `private_only` or un-approving the batch mid-run is a working kill
  switch. Prerequisites are relaxed only on the first page, so a later page stops
  and returns `haltedByPolicyChange` instead of re-enabling publication.
- Candidates already queued through the manual workflow proceed straight to
  publish rather than being skipped as `candidate_already_queued_for_publication`.
- Re-running is safe. Already-published candidates are excluded by
  `publishedProfileId`, so an interrupted run resumes.
- Preview field counts are sampled from the first 250 candidates, because field
  stats need one query per candidate. The preview says so when it samples;
  candidate counts are always exact.
- The final report tallies skipped candidates by blocker and lists their
  external candidate ids, so a partial success is actionable rather than silent.

`--accept-fields` bypasses per-field human review by design. It is appropriate
for a source whose data quality is trusted, and it is the operator's call, not a
default.

## Suppression Requests

`suppressions:requestProfileSuppression` is public and records a `submitted`
request. It changes nothing on its own.

`suppressions:resolveProfileSuppression` is the operator side. Accepting a
request sets every matching profile to `publicSurfacingState: "opted_out"`,
records a `suppression_accepted` audit event, and reindexes the profile so it
drops out of search results. This is both the retraction path for an
already-public profile and what makes the accepted-suppression publication guard
reachable.

```powershell
pnpm exec convex run --prod suppressions:resolveProfileSuppression `
  '{"requestId":"<request-id>","state":"accepted","resolutionNote":"Handled over DM."}'
```

Notes:

- `state` accepts `under_review`, `accepted`, or `rejected`. Only `accepted`
  changes a profile.
- Identity is re-resolved **at acceptance time**, not at request time: profile id,
  then slug, then display name and profile type. A pre-claim request filed before
  its profile existed therefore still retracts a profile that was published in
  between, and acceptance can affect more than one profile — the return value is
  `appliedToProfileIds`.
- A slug match is only trusted when the request's stored display name and profile
  type agree with it, since a slug recorded before any profile held it can be
  acquired by someone else in the meantime.
- If nothing matches, the request is still recorded as accepted, which blocks
  future seed publication for that name and profile type.
- Accepting sets `opted_out`, not `suppressed`. `suppressed` stays reserved for
  moderation action rather than a request someone made about themselves, and an
  already-`suppressed` profile keeps that state.
- Retraction also rebuilds the search documents of any world that credits the
  profile, so searching the retracted name stops surfacing its world
  associations.
- Known limitation: retraction does **not** reconcile `vocabularyTerms`. Nothing
  in the codebase decrements vocabulary usage, so a tag or genre contributed by a
  retracted profile can still appear in discovery vocabulary with its usage count.
  Reference-counted vocabulary is a separate change.

## Lookup Grants

The first grant for the operator is `super_admin`. Beta users receive only
`view_private_seed_lookup`; beta lookup returns reviewed candidates and accepted
fields only from `private_only` import batches that are not rejected or
superseded, while a super-admin can inspect unreviewed private staging records
across import policies.

```powershell
pnpm exec convex run --prod accountFeatureGrants:grant `
  '{"userId":"<convex-user-id>","feature":"view_private_seed_lookup","grantedBy":{"tokenIdentifier":"operator:vrdex","issuer":"vrdex","subject":"seed-access"}}'
```

Add `expiresAt` as epoch milliseconds for a temporary grant. Revoke with
`accountFeatureGrants:revoke`. Grant, expiry, and revocation are enforced in
Convex even when PostHog is unavailable or stale.

## Handoff Invitations

Create an invitation after selecting a private person candidate. `--field-ids`
is optional, so a recipient can claim a prepared display-name identity without
keeping any optional imported fields.

```powershell
pnpm ops:seed-handoff:create -- `
  --candidate-id <candidate-id> `
  --field-ids <field-id>,<field-id> `
  --actor-token operator:vrdex `
  --actor-issuer vrdex `
  --actor-subject concierge-handoff `
  --actor-name "VRDex operator" `
  --base-url https://vrdex.gg `
  --prod
```

For a named development or preview deployment, replace `--prod` with
`--deployment <deployment-name>`.

The script generates a 256-bit token and prints the link once. Convex stores
only its SHA-256 hash. Invitations expire within 90 days, are revocable through
`seedHandoffs:revokeInvitation`, and can be accepted once.

Handoffs fail closed when their import batch is rejected or superseded.
Likewise, an offered field that is later rejected or marked
`needs_correction` is removed from preview and cannot be accepted.

The recipient can inspect every prepared link, remove any optional field, sign
in through a same-origin return path, and explicitly confirm the selected
details only after verified email. The
result is a private `claimed_unverified` profile with owner authority. Accepted
fields become `owner_confirmed`; deselected fields are not copied and are
removed from a reused concierge profile.

## Outreach Copy

Close friend:

> Hey, I made a thing called VRDex and put together a private starting profile
> for you using links already shared with NWinn for events. It is not public.
> This link lets you review it, make an account, and claim it if you want:
> `<handoff-link>`

Broader contact:

> Hi - I am building VRDex, a VRChat-first directory for people, communities,
> and events. I prepared a private starting profile from links already shared
> for event operations. Nothing is published by accepting it; the link lets you
> review the details, create an account, and take control of the profile:
> `<handoff-link>`

Do not send raw import files, internal candidate IDs, or review notes with an
invitation.

## Analytics

Authorized lookup mirrors `seed_lookup_beta=true` to PostHog and evaluates the
Terraform-managed `seed-lookup-beta` UI flag. Beta UI fails closed until the
flag resolves true; super-admins bypass the UI flag. Convex remains
authoritative.
Events include only result-count buckets and access scope; they exclude names,
queries, links, source rows, handoff tokens, and raw account identifiers.

Handoff, lookup, sign-in, account, submission, and editor routes are excluded
from session replay. URL sanitization removes queries and normalizes handoff
tokens before pageview capture.
