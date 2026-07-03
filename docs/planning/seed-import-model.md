# Reviewed Seed Import Model

## Status

Current direction for [#76](https://github.com/BASIC-BIT/VRDex/issues/76).

VRDex may import permissioned seed lists for DJs, communities, worlds, or events, but imported data must not become authoritative public truth by default.

## Implementation Status

Locked decision:

- [#117](https://github.com/BASIC-BIT/VRDex/issues/117) adds the first backend foundation for reviewed profile seed imports using fake fixtures only.
- The implemented write surface is internal-only. There is no public import write API and no public profile publication mutation for unreviewed imports.
- `seedImports:queueCandidatePublication` is a queue marker only. It can move a reviewed candidate to `published_unclaimed`, but it does not create or update a public `profiles` row.

Current recommendation:

- Treat `seedImportBatches`, `seedImportCandidateProfiles`, and `seedImportCandidateFields` as review/audit staging tables.
- Keep real partner ingestion, reviewer UI, owner handoff, merge behavior, and actual profile creation as follow-up work.
- Continue using fake `.invalid` fixtures until partner-specific permission, retention, deletion, and reviewer expectations are documented.

## Locked Decisions

- Do not commit real partner spreadsheets, raw third-party contact exports, or private list data.
- Imported records need provenance, review state, confidence, claim/handoff state, correction paths, and opt-out handling.
- Imported fields are not owner-confirmed unless the owner actually confirms them.
- Partner-provided data must not bypass owner visibility controls after claim.
- Publication defaults should be safe and reviewed.

## Domain Objects

### Seed Import Batch

Represents one ingestion job from a permissioned source.

Suggested fields:

- `batchId` or implementation `_id`
- `externalBatchId` for source/fixture idempotency
- `sourceName`
- `sourceType`: `partner`, `manual`, `import`, `community`, or `moderator`
- `sourceContact` optional internal owner for the import relationship
- `receivedAt`
- `importedBy`
- `reviewState`: `draft`, `ready_for_review`, `approved`, `rejected`, `superseded`
- `reviewedBy` optional reviewer metadata
- `reviewedAt` optional review timestamp
- `notes` optional internal review notes

### Candidate Profile

Represents a potential person/community profile before or after publication.

Suggested fields:

- `candidateId`
- `batchId`
- `profileType`: `person` or `community`
- `proposedDisplayName`
- `proposedSlug` optional
- `reviewState`: `unreviewed`, `accepted`, `rejected`, or `needs_correction`
- `publicationState`: `draft_private`, `review_pending`, `published_unclaimed`, `rejected`, `suppressed`
- `claimState`: starts `unclaimed` unless a real claim/handoff flow grants authority
- `matchedProfileId` optional existing VRDex profile match
- `reviewer` optional reviewer metadata
- `reviewedAt` optional review timestamp
- `reviewNote` optional internal note
- `publicationQueuedBy` optional reviewer metadata when the queue marker is set
- `publicationQueuedAt` optional queue marker timestamp
- `createdAt`
- `updatedAt`

### Imported Field

Represents one proposed fact, not a whole record.

Suggested fields:

- `candidateId`
- `fieldKey`
- `value`
- `sourceLabel`
- `sourceUrl` optional public source URL
- `sourceType`: `partner`, `manual`, `import`, `community`, `moderator`
- `confidence`: `low`, `medium`, `high`, or `owner_confirmed`
- `reviewState`: `unreviewed`, `accepted`, `rejected`, `needs_correction`
- `visibility`: `public`, `unlisted`, or `private`
- `reviewedBy` optional
- `reviewedAt` optional

## Publication Defaults

Default to `draft_private` for imported candidates until the batch has an explicit review decision.

`Permissioned source` means a partner, moderator, or maintainer-provided source that VRDex is allowed to review for candidate profile creation. It does not mean the source is owner-confirmed or safe to publish without review.

`Safe public fields` are fields that are already designed for public profile display, such as display name, public role tags, public summary, and public `https` outbound links. Private contacts, raw provider IDs, private notes, and unreviewed third-party assertions are not safe public fields.

An explicit review decision must exist at the batch, candidate, and field level before publication. Batch approval alone does not automatically accept every candidate field.

Implemented guard behavior for the first slice:

- batch `reviewState` must be `approved`
- candidate `reviewState` must be `accepted`
- candidate `publicationState` must be `review_pending`
- candidate `claimState` must still be `unclaimed`
- fields cannot remain `unreviewed` or `needs_correction`
- accepted public fields must be on the safe public field allowlist
- accepted public `outboundLinks` must contain HTTPS URLs
- owner-confirmed field confidence is blocked because no owner confirmation flow exists in this slice
- matched claimed profiles, opted-out profiles, suppressed profiles, accepted suppression requests, invalid proposed slugs, and conflicting slugs block queueing

Publishing an imported profile should create an unclaimed public profile only when:

- the source is permissioned
- the fields are safe public fields
- the record passes review
- there is no matching opted-out or suppressed profile/entity
- public copy clearly labels the entry as imported, partner-provided, reviewed, community-submitted, or unclaimed as appropriate

Never publish private contact details, raw account identifiers, unreviewed personal notes, or scraped third-party data.

## Claim, Correction, And Opt-Out

Imported profiles must support:

- claim request path from the real owner
- correction request path from the subject or community
- suppression/opt-out handling before and after claim
- merge path when the import matches an existing claimed profile
- audit trail that preserves source and review decisions

After claim, owner visibility controls apply to imported facts. If an owner hides a field, public API, search, cards, profile pages, and partner exports must respect that choice.

## Interactions With Existing Profiles

- Existing claimed profile: imports create proposed fields only. They must not overwrite owner-authored fields, owner-hidden fields, private fields, or claim state. Owner visibility wins after claim.
- Existing unclaimed or community-submitted profile: `matchedProfileId` can connect the candidate to the existing profile. Review decides whether to merge, preserve both community and import provenance labels, or reject the candidate.
- Concierge or handoff draft: imported fields may seed a `draft_private` profile prepared for handoff. Fields become `owner_confirmed` only after the recipient confirms them through a real claim or handoff flow.
- Existing opted-out or suppressed entity: public publication is blocked. Internal review/audit state can remain only as needed for suppression, dispute handling, or abuse prevention.

## Fake Fixture Shape

Use fake fixtures only:

```json
{
  "batchId": "seed_fake_2026_001",
  "sourceName": "Example Partner Directory",
  "sourceType": "partner",
  "receivedAt": "2026-06-01T00:00:00.000Z",
  "reviewState": "draft",
  "candidates": [
    {
      "candidateId": "candidate_fake_dj_001",
      "profileType": "person",
      "proposedDisplayName": "DJ Example",
      "publicationState": "draft_private",
      "claimState": "unclaimed",
      "fields": [
        {
          "fieldKey": "person.roleTags",
          "value": ["DJ", "Host"],
          "sourceLabel": "Example Partner Directory",
          "sourceType": "partner",
          "confidence": "medium",
          "reviewState": "unreviewed",
          "visibility": "public"
        },
        {
          "fieldKey": "outboundLinks",
          "value": [{ "type": "website", "url": "https://example.invalid/dj-example" }],
          "sourceLabel": "Example Partner Directory",
          "sourceType": "partner",
          "confidence": "medium",
          "reviewState": "unreviewed",
          "visibility": "public"
        }
      ]
    }
  ]
}
```

## Implementation Boundary

This document defines the model for [#76](https://github.com/BASIC-BIT/VRDex/issues/76). It does not authorize importing real partner data or committing real partner fixtures.

Implemented in [#117](https://github.com/BASIC-BIT/VRDex/issues/117):

- Convex staging tables for import batches, candidate profiles, and candidate fields
- internal fake fixture import helper keyed by `example_partner_directory_2026_001`
- internal review mutations for batch, candidate, and field decisions
- internal review snapshot queries
- internal candidate/profile matching helper
- queue-only publication guard and marker
- backend helper tests for fake fixture creation and publication blockers

Deferred after [#117](https://github.com/BASIC-BIT/VRDex/issues/117):

- real partner import tooling
- reviewer UI
- public reviewer-facing APIs
- owner claim/handoff confirmation for imported fields
- actual profile creation, merge, or overwrite behavior
- public profile/search/API surfacing of imported candidate data
