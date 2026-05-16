# Profile Schema

## Status Note

This doc captures the first durable profile schema slice for `#9`.

The schema is intentionally narrow. It establishes one shared `profiles` table for people and communities without introducing slug generation, auth/account links, claim flows, permissions, normalized link tables, asset tables, search-specific indexing, or type-specific profile fields.

## Locked Decisions

- profiles are first-class records independent from the user account that may later claim them
- `profileType` is explicit and currently supports `person` and `community`
- claim state, publication state, and creation provenance are separate fields
- community-submitted unclaimed records are represented by `creationSource: "community"` plus `claimState: "unclaimed"`
- account/user references are deferred until auth and claim issues define the account model
- slugs are deferred to `#10`
- type-aware person/community detail fields are deferred to `#11`
- normalized alias, link, asset, and rich authored block tables are deferred to later profile presentation issues

## `profiles` Table

Core identity fields:

- `profileType`: `"person" | "community"`
- `displayName`: public display name
- `sortName`: normalized display-sort key for deterministic listing
- `aliases`: alternate names or searchable display variants kept inline for the first schema slice

Core presentation fields:

- `headline`: optional short label or one-line positioning statement
- `bio`: optional short public bio
- `region`: optional location or scene region text
- `timezone`: optional time zone text

State fields:

- `claimState`: `"unclaimed" | "claimed_unverified" | "claimed_verified"`
- `publicationState`: `"draft_private" | "published"`
- `creationSource`: `"self" | "community" | "concierge" | "import" | "moderator"`
- `claimedAt`: optional claim timestamp, present only after claim authority is established
- `publishedAt`: optional publication timestamp, present once a profile has been published
- `updatedAt`: application-maintained update timestamp that every profile mutation must refresh

Convex automatically provides `_id` and `_creationTime`; those are not duplicated in the schema.

## State Semantics

`claimState` describes owner authority:

- `unclaimed`: no owner authority has been attached yet
- `claimed_unverified`: a claimant controls the profile, but stronger verification is not complete
- `claimed_verified`: owner control and verification are both established

`publicationState` describes public surfacing:

- `draft_private`: not public and not searchable
- `published`: eligible for public profile pages and later discovery flows, subject to future permission, trust, and opt-out rules

`creationSource` describes how the record entered the system. It is not an authority marker by itself; authority comes from `claimState` and later claim records.

## Mutation Contracts

Convex schema validation cannot enforce conditional timestamp invariants, so profile mutations must preserve these application-level rules:

- set `claimedAt` when `claimState` leaves `"unclaimed"`
- set `publishedAt` when `publicationState` becomes `"published"`
- patch `updatedAt` on every profile write

## Initial Indexes

- `by_profileType_publicationState`: public page/discovery entry points split by person vs community
- `by_publicationState_claimState`: public/trust filtering for later profile lists
- `by_claimState_profileType`: moderation and claim-review flows by claim state, with optional type splitting
- `by_creationSource_claimState`: moderation and community-submitted/unclaimed review flows
- `by_profileType_sortName`: deterministic profile listing by type

## Follow-On Boundaries

- `#10` adds canonical slugs, validation, and uniqueness rules
- `#11` adds type-aware person/community fields and documents shared vs type-specific data
- `#12` defines read/write permission behavior
- `#13` implements claim-state transitions and trust labeling behavior
- `#22` adds presentation assets and owner-authored content sections
- `#23` adds community submission flows and source attribution details
- `#27` adds field-level visibility controls
- `#31` adds public search behavior and any search-specific indexing
