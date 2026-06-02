# Reviewed Seed Import Model

## Status

Current direction for [#76](https://github.com/BASIC-BIT/VRDex/issues/76).

VRDex may import permissioned seed lists for DJs, communities, worlds, or events, but imported data must not become authoritative public truth by default.

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

- `batchId`
- `sourceName`
- `sourceType`: `partner`, `manual`, `import`, or `moderator`
- `sourceContact` optional internal owner for the import relationship
- `receivedAt`
- `importedBy`
- `reviewState`: `draft`, `ready_for_review`, `approved`, `rejected`, `superseded`
- `notes` optional internal review notes

### Candidate Profile

Represents a potential person/community profile before or after publication.

Suggested fields:

- `candidateId`
- `batchId`
- `profileType`: `person` or `community`
- `proposedDisplayName`
- `proposedSlug` optional
- `publicationState`: `draft_private`, `review_pending`, `published_unclaimed`, `rejected`, `suppressed`
- `claimState`: starts `unclaimed` unless a real claim/handoff flow grants authority
- `matchedProfileId` optional existing VRDex profile match
- `reviewerId` optional
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

This document defines the model for [#76](https://github.com/BASIC-BIT/VRDex/issues/76). It does not authorize importing real partner data or committing real partner fixtures. [#117](https://github.com/BASIC-BIT/VRDex/issues/117) owns the follow-up implementation work for schema, review UI/workflow, import tooling, and fake-data test fixtures.
