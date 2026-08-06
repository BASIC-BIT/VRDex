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
  --target prod
```

The command prints counts only. It does not print source rows or field values.
For the shared development deployment, use `--target dev`.

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

All three mutations require an operator identity and reject a call with no `actor`
and no browser session; `publishQueuedCandidate` records it as `publishedBy` on the
candidate. `seedImports:bulkPublishBatch` enforces the same contract, so no path
can publish as an unknown operator.

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
- A candidate with no accepted field that is both non-private and non-empty is
  blocked with `no_publicly_visible_field`. `unlisted` counts as visible: it
  renders on the profile page and is only held back from discovery, which is a
  decision rather than an accident. Emptiness counts too -- a public `tags: []`
  beside a private set of links would otherwise satisfy the gate while
  publishing exactly the profile it exists to stop. Links are counted after
  normalization, so a field holding only an operator console URL counts as
  nothing, which is what publication will make of it. `about`, `genres` and
  `timezone` do not count at all: they reach the profile record and no part of
  the profile page renders them, so a candidate whose only public content is one
  of those publishes the same blank-looking page. Rendering them instead is a
  product decision nobody has made; until then the gate declines. The gate is
  exempted only for a merge into a profile the public can already read, which
  `isPubliclyReadableProfile` defines as `published` *and*
  `publicSurfacingState: "public"`. Surfacing alone is not enough and the
  distinction matters: a legacy `draft_private` row can carry
  `publicSurfacingState: "public"` and still 404 for every reader, so exempting
  on surfacing would have published exactly the display-name-only page this
  refuses. Where the exemption does apply, private-only seed data merging into a
  live profile is an ordinary operator decision, and blocking it stranded the
  case `matchCandidateToProfile` exists to record. `previewBatchPublication`
  uses the same predicate *and* the same exemption, reporting
  `blockedOnNoVisibleFieldCount` — the candidates this gate would actually
  refuse — beside the raw `publiclyVisibleFieldCount`. Counting fields alone made
  a batch of merges look blocked when it was not, and the driver then advised
  `--set-visibility`, which would have made imported private fields public to fix
  nothing. A dry run cannot say the opposite of what the publish gate does, and
  it must not recommend an irreversible privacy change on the strength of a
  number that is not the gate's answer. Candidates that have already published
  are excluded from that count for the same reason: `bulkPublishBatch` filters
  them out, so a blocker reported against one is a blocker on work that is
  finished. Batch
  `nwinn_2026_07_16_ad79dca17a` is why it exists: it published 405 people whose
  every field was stored private, so each live profile showed a display name and
  a slug and nothing else.
- Outbound links are normalized through `sanitizeProfileLinksLeniently`, the same
  path every other writer uses, rather than carried across as stored. VRCDN
  entries canonicalize to the public `vrcdn.live/<streamId>` page, so an operator
  panel preview URL in an export becomes the public link and dedupes against the
  stream link for the same person. Entries that cannot be normalized are dropped
  and counted rather than failing the batch, and the driver reports the counts on
  both runs — the publish run and the `--set-visibility --rederive-values` one.
  Publication reported nothing at first: a dropped link does not block a candidate
  that has other visible content, so a run said it had published fifty profiles
  while nothing said a reviewed link had been discarded on the way to one of them.
  The counts print even at zero, because "no links were dropped" is the sentence
  worth being able to read.
- Merging into an existing profile only applies accepted seed fields. Fields the
  candidate never proposed are left untouched, and the profile's original
  `publishedAt` is preserved.
- An accepted suppression request blocks publication whether it was filed by
  profile id, by slug, or as a pre-claim `displayName` + `profileType` request
  with no slug at all.
- A person candidate matched to a community profile is blocked with
  `matched_profile_type_mismatch` rather than attempting a cross-type write.
- An invalid `proposedSlug` blocks only the create path. A merge keeps the matched
  profile's slug and never allocates from the proposal, and there is no mutation for
  correcting a proposed slug, so blocking would strand a valid explicit match.
- A candidate whose proposed display name falls outside the public bounds (2-80
  characters) is blocked with `display_name_outside_public_limits`, but only when
  creating a new profile; a merge preserves the matched profile's own name. Seed
  normalization allows up to 160 and no minimum.
- Accepted fields are run through the publication mapper's own normalization at the
  gate, so an unsupported key or a malformed value (an `aliases` string instead of
  an array, a link with no label) is reported as `unsafe_public_field` rather than
  throwing mid-page and rolling back every candidate in it.
- A candidate with a live concierge handoff invitation is blocked with
  `live_handoff_invitation_blocks_publication`, checked both by candidate and by
  matched profile — several candidates can point at the same prepared profile, so
  publishing one would expose another's private handoff destination. Publishing while someone holds a
  private review link would break the promise that link was sent under, and
  queueing would invalidate the link. Revoke the invitation first with
  `seedHandoffs:revokeInvitation` if publication is genuinely intended.
  `seedImports:matchCandidateToProfile` is frozen for the same reason: an
  invitation created before a match carries no `profileId`, so repointing the
  candidate afterwards would hide it from the profile-based check.
- Accepted fields are also checked against the public profile bounds the rest of
  the app enforces (8 aliases of 60 characters, a 600-character bio, and so on).
  Private seed staging is deliberately more permissive so a source can be captured
  verbatim, so an oversized field is reported as
  `field_exceeds_public_profile_limits` rather than written to a public profile.
- Slug collision is checked on the derived base slug as well as an explicit
  `proposedSlug`, but **only when creating a new profile**. A candidate whose name
  normalizes onto an existing profile is blocked with
  `slug_collision_blocks_publication` rather than silently getting a suffixed slug.
  Resolve it with `seedImports:matchCandidateToProfile`: a matched candidate merges
  into the matched profile and keeps its slug, so the collision no longer applies.
  Genuinely distinct people sharing a name surface here too and need the same
  explicit decision.
- Published profiles carry no `sourceAttribution`. That field makes the public
  serializer render a profile as `Community submitted`, which would be false
  provenance for an operator import; `creationSource: "import"` records the real
  origin.
- A batch with no explicit `publicationPolicy` fails closed and is treated as
  `private_only`. Legacy batches need step 1 before they can publish. The seed
  lookup applies the same default rather than comparing the stored literal, so a
  legacy batch imported before the column was backfilled still shows its accepted
  rows to a `view_private_seed_lookup` holder instead of only to super-admins.
- A relaxed policy alone is not authorization. Both gates also require a non-empty
  `publicationAuthorizations` history and report `publication_not_authorized`
  otherwise, so a legacy or fixture batch that already carries
  `reviewed_publication_allowed` still has to go through step 1 to record *why*
  publication was permitted.
- Merging into an existing profile records only the vocabulary that merge actually
  introduced. `recordVocabularyTerms` increments unconditionally, so replaying the
  whole profile's vocabulary would inflate counts for terms nothing changed, and
  several candidates matched to one profile would compound it.
- Person candidates only. Community candidates return
  `candidate_profile_type_unsupported` and are skipped rather than
  half-published.
- Re-running publish on an already-published candidate returns the existing
  profile instead of creating a duplicate. Review state is immutable once a
  candidate has published: `setCandidateReviewState` and
  `setCandidateFieldReviewState` both reject a published candidate, because
  re-running publication cannot retract data that is already public. Withdraw it
  through [Suppression Requests](#suppression-requests) instead.
- Publishing a profile also schedules a rebuild of any world crediting it, since
  those worlds hid the attribution while the profile was not publicly readable.
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
pnpm ops:seed-publish -- --batch-id nwinn_2026_07_10_001 --target prod
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
  --target prod
```

- `--reason` is required and is recorded on the batch in
  `publicationAuthorizations`, an append-only list recording **both** directions —
  each authorization and each revocation, with its `policy`, reason, actor, and
  timestamp — so a batch revoked and later reauthorized keeps the full history.
  Repeating either call with the same reason is a no-op rather than a second entry.
  A `reviewNote` is required in **both** directions, so a revocation always leaves a
  record rather than ending the history on the authorization it reversed. It is the durable record of the
  operator asserting the source permits public listing. The reason is also appended
  to `notes`, but `notes` is a mutable review buffer and is not the record of
  authorization.
- `--accept-fields` is the trusted-source shortcut. It accepts candidates and
  fields still marked `unreviewed`; `rejected` and `needs_correction` are always
  left alone, so trusting a source never undoes a review decision. Without this
  flag every field must already be reviewed or the candidate is skipped with
  `field_unreviewed`.
- `--limit` is the page size, not a cap, and is clamped to 10. `--accept-fields`
  patches every field of every candidate in a page and both gates rescan them, all
  in one Convex transaction, so pages stay small. The script pages with a cursor
  until the batch is drained and prints running progress. Cursor paging matters: a
  permanently blocked candidate never receives a `publishedProfileId`, so
  offset-style paging would re-read the same page forever.
- Flags that belong to the other mode are refused rather than ignored, in both
  directions. `--rederive-values` and `--field-keys` without `--set-visibility`
  would otherwise fall through to a bulk publication, and `--accept-fields`
  *with* `--set-visibility` was recognized and dropped: the migration selects
  fields that are already accepted and has no step that accepts one, so the run
  reported success having left every unreviewed field exactly as it was.
  Accepting a field is a review decision and has to be asked for by name.
- Unknown and repeated options are refused before the script decides which
  operation to run. This is not tidiness: the parser used to ignore what it did
  not recognize, so `--set-visibilty public --apply` left the real
  `--set-visibility` unset and the run fell through to a bulk publication, and
  `--field-key aliases` left `--field-keys` absent, which means every accepted
  field. A misspelling could pick a different destructive operation, or widen
  the one you asked for to the whole batch.
- Batches already marked `rejected` or `superseded` are refused. Those are review
  decisions; move them with `seedImports:setBatchReviewState` first if that is
  genuinely intended.
- Restoring `private_only` or un-approving the batch mid-run is a working kill
  switch. Prerequisites are relaxed only on the first page, so a later page stops
  and returns `haltedByPolicyChange` instead of re-enabling publication. A batch
  that was authorized and then restored to `private_only` also refuses to
  auto-relax on a *new* run, so a timed-out first-page retry cannot undo the
  revocation; reauthorize explicitly with `setBatchPublicationPolicy`. Moving an
  authorized batch out of `approved` is refused the same way and needs an explicit
  `setBatchReviewState`, since either rollback is a deliberate stop.
- Candidates already queued through the manual workflow proceed straight to
  publish rather than being skipped as `candidate_already_queued_for_publication`.
- Re-running is safe. Already-published candidates are excluded by
  `publishedProfileId`, so an interrupted run resumes, and a retry of the same
  authorization does not append a duplicate record.
- Re-importing the exact same permissioned payload stays idempotent after a batch
  has been authorized. Adding *new* candidates to a batch that has **ever** been
  authorized is rejected, including one since revoked to `private_only`: a later
  reauthorization would otherwise publish them under authorization records that
  never described them. Import additions as a new batch.
- Preview reads are bounded: candidate rows are capped at 2,000 and field stats
  are sampled from the first 50 candidates, because field stats need one query per
  candidate. The preview reports when either is truncated. Publication itself is
  unaffected — it pages over the whole batch.
- The final report tallies skipped candidates by blocker and lists their
  external candidate ids, so a partial success is actionable rather than silent.

`--accept-fields` bypasses per-field human review by design. It is appropriate
for a source whose data quality is trusted, and it is the operator's call, not a
default.

### Setting Field Visibility On A Batch

Publication copies each field's stored `visibility` onto the profile, so a batch
imported private publishes profiles that show nothing. The preview reports
`acceptedFieldVisibilities` and `publiclyVisibleFieldCount`, and warns when the
latter is zero; publication itself refuses with `no_publicly_visible_field`.

`--set-visibility` fixes both halves — the candidate rows, so the record is
right, and the profiles already derived from them, so people can see it:

```powershell
pnpm ops:seed-publish -- `
  --batch-id nwinn_2026_07_16_ad79dca17a `
  --set-visibility public `
  --field-keys "outboundLinks,person.roleTags" `
  --actor-token operator:vrdex `
  --actor-issuer vrdex `
  --actor-subject seed-publish `
  --actor-name "VRDex operator" `
  --reason "Source permits listing these fields publicly." `
  --apply `
  --target prod
```

- Without `--apply` it is a dry run: the same counts, nothing written. This
  changes what the public sees on live profiles, so the dry run is the default.
  The dry run simulates across cursor pages rather than per page: each page
  hands the next what it decided about the profiles it accepted, so a profile
  two candidates share is counted once and a later page evaluates its gates
  against what the earlier one would have done. Without that, a dry run of a
  batch large enough to page reports a different total than the apply run it
  exists to predict.
- That carried state is bounded, and each part of it is sent only where it
  changes an answer. Which profiles the run has already counted travels in
  every mode, because the total is per profile and a profile two candidates
  share can straddle a page in all of them. The simulated visibility travels
  only where nothing was written to read it back from, so a visibility-only
  `--apply` run sends the identifiers alone. `--rederive-values` also carries
  the display name and aliases, because those are what the suppression recheck
  reads and a re-derivation is the only mode that moves them. It is the one
  part of the call that grows with
  the batch rather than the page, so it is capped; a batch with more distinct
  published profiles than the cap prints a warning saying the totals are
  approximate, rather than quietly drifting from what the write will do.
  `--limit` is not the lever, and the warning says so: the carry holds every
  distinct profile seen so far rather than one entry per page, and the mutation
  clamps the page size anyway. What degrades past the cap is the reporting, not
  the migration -- an applied run reads back what it wrote, so the writes are
  the same either way. Raising the cap is a code change, and the batch this
  exists for is well under it.
- `--field-keys` is optional; omitting it targets every accepted field. It scopes
  the whole run, not just the visibility change: with `--rederive-values`, only
  the named fields are replayed, so a run repairing links cannot overwrite live
  aliases, tags or roles nobody asked to touch. `person.roleTags` alone rebuilds
  `person` from the profile's own value with just the role tags applied, leaving
  pronouns as they are.
- **Visibility only by default.** Published profiles are community-editable, so
  replaying the seed values would silently undo every correction made since
  publication -- links fixed, tags added, a name spelled right -- while reporting
  only a count of profiles updated. Changing what is visible does not require
  changing what is there.
- `--rederive-values` opts into replaying the values as well, through the same
  builder publication uses. That is the one-time pass for a batch published
  before a normalization fix; it overwrites live values with the import
  snapshot, which is both the point and the risk. The link counts are reported
  either way, so a visibility-only run still says what a value re-derivation
  would do.
- Claimed profiles are left alone and reported as `profile_claimed`.
  Re-deriving one would overwrite whatever its owner has edited since with the
  seed snapshot.
- Suppression is rechecked per profile, not only at publication. Making an alias
  public is a way to surface an identity, and it is the one this path has: a
  profile can be publicly readable *because* the retracted name was private, and
  `--set-visibility public --field-keys aliases` then puts it on the page and in
  the search index. A profile whose surfaced names would match an accepted
  request is skipped and reported as
  `suppressed_identity_blocks_visibility_change` rather than failing the run —
  one retracted identity in a batch of 405 must not strand the other 404.
- Every applied change writes a `profileAuditEvents` row naming the operator and
  carrying the run's reason, the same as the owner visibility mutation.
  `withheldProfileRecord` builds its History from that table alone, so without it
  a claiming owner would see that their imported fields had been exposed, hidden
  or replayed and nothing about who did it or why.
- A batch revoked to `private_only`, moved out of `approved`, or carrying no
  recorded authorization re-derives nothing and reports `batch_not_authorized`.
  Re-derivation republishes seed data onto a live profile, so it answers to every
  lever publishing answers to, not a subset — the same
  `hasPublicationAuthorization` check both publish gates use. Honouring only
  policy and review state would let a legacy or fixture batch carrying
  `reviewed_publication_allowed` by accident replay values that the publish gate
  refuses with `publication_not_authorized`. Record permission with
  `setBatchPublicationPolicy` first. Candidate rows are still updated: setting
  visibility before authorizing a batch is preparation.

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
pnpm cx -- prod run suppressions:resolveProfileSuppression `
  '{"requestId":"<request-id>","state":"accepted","resolutionNote":"Handled over DM.","actor":{"tokenIdentifier":"operator:vrdex","issuer":"vrdex","subject":"suppression-review","displayName":"VRDex operator"}}'
```

Notes:

- `state` accepts `under_review`, `accepted`, or `rejected`. Only `accepted`
  changes a profile, and **acceptance is terminal**: an accepted request cannot be
  moved back to `under_review` or `rejected`, because that would drop it from the
  publication guard without restoring profiles already retracted. Reversing a
  retraction is a deliberate re-publication.
- Identity is re-resolved **at acceptance time**, not at request time: profile id,
  then slug, then display name and profile type. A pre-claim request filed before
  its profile existed therefore still retracts a profile that was published in
  between, and acceptance can affect more than one profile.
- The mutation returns `{ requestId, state, retractionScheduled }`. It does not
  return retracted profile ids, because retraction runs asynchronously. Observe
  completion through the profiles' `publicSurfacingState` or their
  `suppression_accepted` rows in `profileAuditEvents`.
- A slug match is only trusted when the request's stored display name and profile
  type agree with it, since a slug recorded before any profile held it can be
  acquired by someone else in the meantime.
- If nothing matches, the request is still recorded as accepted, which blocks
  future publication for that name and profile type. Every path that can put an
  identity in front of the public shares one guard, `assertIdentityNotSuppressed`:
  `profiles:submitCommunityProfile`, Discord claim creation in
  `_profileClaimCreation`, and display-name changes through
  `profiles:updateProfileForApiOwner`. Creating a profile is not the only way to
  surface one — renaming does it without creating anything — so the check belongs
  with the act of surfacing. `surfacedProfileNames` decides what counts: the
  display name, `aliases` when `fieldVisibility.aliases` is not `private`, and
  `searchAliases` always, since `createProfileSearchDocument` indexes those into
  `searchText` and `exactTokens` regardless. A private alias is omitted by both the
  public projection and the search document, so treating it as a surfaced identity
  would retract an unrelated profile over data nobody can see. Otherwise --
  submission, claim creation, API updates including alias-only ones, both seed
  gates, the publication migration, and retraction target resolution -- since a
  write could otherwise carry an unrelated display name and put the suppressed one
  in `aliases`, which the public projection exposes and search indexes. A
  rename evaluates only the *proposed* identity, so an already-retracted profile
  can still be renamed to something unrelated while it stays hidden. Seed
  publication deliberately reports a blocker instead of throwing, so a bulk page
  can skip one candidate and continue. Both throwing paths raise structured errors
  carrying `IDENTITY_SUPPRESSED`, because Convex redacts plain error messages on
  production deployments — a plain `Error` would reach the browser as a generic
  failure and tell someone to retry a permanent rejection.
- Accepting sets `opted_out`, not `suppressed`. `suppressed` stays reserved for
  moderation action rather than a request someone made about themselves, and an
  already-`suppressed` profile keeps that state.
- Acceptance itself only writes the request: `state`, `resolutionNote`,
  `resolvedBy`, and `resolvedAt`. The actual profile retraction and the world
  search rebuild are scheduled and paged. That ordering is deliberate — acceptance
  already blocks new publication through the suppression guard, so it must land
  durably even if a common name resolves to many profiles or a profile is credited
  on many worlds. An oversized transaction would otherwise roll the acceptance
  back and leave everything public.
- An operator identity is required. `resolveProfileSuppression` throws without
  `actor` and no browser session, because a pre-claim request matching no profile
  writes no audit event, and an accepted request must never block publication with
  no record of who decided it. Re-accepting an already-accepted request is a no-op
  rather than an error, so a retry after a timeout does not overwrite the original
  resolver or duplicate audit rows.
- Known limitation: events keep denormalized identity strings that survive
  retraction. An event stores `communityName` directly, and both the event search
  document and the public event page deliberately fall back to it when the linked
  profile is not publicly readable; an `eventSlots` row likewise keeps a
  `displayLabel` that is commonly the performer's exact name, still emitted by
  `toPublicEvent` when the linked profile becomes unreadable. Retracting a profile
  therefore does not remove its name from events it hosts or performs at.
  Suppressing either needs a decision about what an event should display instead,
  which is public copy and needs owner sign-off.
- Seed publication reconciles `vocabularyTerms` in both directions: a merge records
  terms it introduces and releases terms it removes, so replacing a visible tag no
  longer leaves the old one inflated.
- Retraction releases the profile's public vocabulary, and the world reindex
  reconciles the before/after delta of each world's `vocabularyKeys`, so a creator
  role that becomes visible is recorded and one that becomes hidden is released.
  Deltas rather than replays, since `recordVocabularyTerms` only increments.
- Known limitation: the vocabulary model is still not reference-counted, which is
  why every release floors at zero — a shared term has no owner, so a stray release
  must not corrupt it. Counts are reconciled along the paths this PR touches, not
  globally.

## Lookup Grants

The first grant for the operator is `super_admin`. Beta users receive only
`view_private_seed_lookup`; beta lookup returns reviewed candidates and accepted
fields only from `private_only` import batches that are not rejected or
superseded, while a super-admin can inspect unreviewed private staging records
across import policies.

`seedAccess:lookupPeople` covers every publication state for a super-admin, and
`draft_private`, `review_pending` and `published_unclaimed` for the narrower
grant — and for a published candidate it reads the *live profile's* claim state
rather than the candidate's own. Claim flows patch `profiles.claimState` and
never revisit the candidate row, so the candidate still reads `unclaimed` long
after someone took ownership; a profile that cannot be loaded counts as claimed. Publishing used to move a candidate out of the lookup entirely, so the
operator surface covered exactly the records that had not shipped yet.
`rejected` and `suppressed` stay super-admin-only: both record a decision to stop
handling that person.

Each publication state answers to the policy that permits it. A row that has not
shipped is visible only while its batch is still `private_only`, which is the
promise this grant is scoped to. A published row cannot be held to that —
publishing required the batch to be relaxed past `private_only` in the first
place, and demanding it there is what hid the 405 the moment they went live — so
it requires the batch to still allow publication instead. "Was relaxed once" is
not "is still permitted": revoking a batch back to `private_only` after it has
published withdraws these rows from the narrower grant, the same way it withdraws
the right to publish more. Super-admins keep seeing them, because "why is this
person gone?" is the question they are there to answer.

Each search reads until it has collected `limit` rows the viewer may see, rather
than taking a window sized to the answer and filtering it afterwards. Eligibility
depends on the candidate's batch and on the live profile it published to, neither
of which the search index can filter on, so a fixed window held however many
eligible rows happened to fall inside it — for a common name whose leading
matches all belonged to a rejected batch, none, and the surface reported "no
records" for somebody the lane holds one for. `LOOKUP_SCAN_LIMIT` caps the walk
at 300 rows per state so a three-character query against a large withdrawn batch
does not read the whole batch.

The per-state results are then interleaved rather than concatenated. Each state
collects up to the full limit on its own, so appending them and slicing would
spend the whole limit on whichever state filled first — a common name with
enough `draft_private` matches would drop every published row, hiding the
published imports this surface was widened to recover. Round-robin rather than a
relevance merge, because a search score is not comparable across separate
searches and there is no honest way to rank them against each other.

`seedAccess:withheldProfileRecord` answers the profile-level question — what a
profile holds that its public page does not show, plus its edit history. It is
read-only, and it returns `null` rather than throwing for everyone else, because
it renders on public profile pages. It exists so that "what does production hold
for this person?" stops being a question that needs a deploy key, which cannot be
scoped read-only and can therefore also deploy code.

It answers by slug, so who may call it is scoped deliberately: the profile's own
owner, any super-admin, and a `view_private_seed_lookup` holder only when the
import record behind the profile is one the name lookup would still return.
Without that the beta grant could read hidden fields and edit history for any
profile whose slug someone guessed, because a direct Convex call is not bounded
by the public page this renders on.

The candidate is the whole test. `creationSource` was checked alongside it and
was wrong and redundant at once: reaching a candidate whose `publishedProfileId`
is this profile already proves it came from the seed lane, and publishing a
candidate by *merging* into an existing profile keeps that profile's original
`creationSource` — so a merged seed profile appeared in the name lookup, which
asks the candidate, and then refused to open from the link beside it, which asked
the profile.

The two surfaces run the same predicate over the same rows rather than each
judging what it happens to hold. This query is handed a slug, so it walks
`seedImportCandidateProfiles.by_publishedProfileId` back to the candidate and its
batch before deciding. Half the rule lives on the batch — policy revoked to
`private_only`, review withdrawn to `rejected` or `superseded`, the candidate no
longer accepted — and none of those touch the published profile, so a check
reading only the profile kept answering long after the lookup had stopped. A
profile with no candidate behind it has nothing to check against and is refused.

Sharing the predicate makes the grant person-only here too, because
`lookupPeople` is person-only and the shared rule carries that. An imported
community profile is outside what this grant was issued for; its owner and any
super-admin still read the record.

What counts as withheld is "no surface shows it", not "it is not public". Only
`about` is in that state whatever its visibility says: it reaches the profile row
and the public projection, and no component reads it — the page's About section
renders `bio`. Reading `public` as though it meant *shown* left that value
invisible from both directions at once, held back from the panel for being public
and absent from the page for never having been rendered, which made a deploy key
the only way to read it. That is what this panel replaced.

`genres` and `timezone` were treated the same way and should not have been. The
profile page does not render them, but the public lookup does at `public`
visibility, through `LookupGenres` and `LookupIdentity`. The publication gate
still declines to count them, and that is a different and narrower claim: the
gate exists to stop publishing a *profile page* that shows a name and a slug, and
a genre in a search result does not fill that page.

The panel groups by where a value is missing from rather than by its visibility,
because the two part company for exactly the cases worth telling apart. Each
field carries `onProfilePage`, so an `unlisted` alias — on the page, out of
search — is filed apart from an `unlisted` timezone or an `unlisted` tag, which
may be on no surface at all.

"May be" is the honest word. The page shows role tags, category tags and free
tags in one metadata line that a headline takes over, and that otherwise renders
four values after deduplication, so whether a particular one appears depends on
what else the profile holds. `onProfilePage` reports those as not-on-page rather
than re-deriving the layout — the same conservative call
`_profilePermissions.ts` makes, erring the other way round because the surfaces
differ: the permission errs toward withholding an edit, this errs toward showing
an operator a value they may also be able to find on the page.

```powershell
pnpm cx -- prod run accountFeatureGrants:grant `
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
  --target prod
```

For the shared development deployment, use `--target dev`.

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

The preview shows links through the same normalizer the accept writes them with,
so what the recipient confirms is what gets stored. The two used to disagree: the
preview listed the raw seed value while the write canonicalized it, so a link
whose host no longer matched its provider vanished between confirming and saving,
and a VRCDN operator panel preview URL was shown to the person being handed the
profile rather than the public `vrcdn.live` page it resolves to. A link field
where nothing survives normalization is withheld from the preview entirely rather
than offered as an empty list somebody would confirm.

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
