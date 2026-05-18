# Profile Schema

## Status Note

This doc captures the durable profile schema foundation started in `#9` and extended through `#10`, `#11`, `#12`, `#13`, `#22`, and `#23`.

The schema is intentionally narrow. It establishes one shared `profiles` table for people and communities without introducing account tables, full claim flows, normalized link tables, asset tables, or advanced moderation workflows.

## Locked Decisions

- profiles are first-class records independent from the user account that may later claim them
- `profileType` is explicit and currently supports `person` and `community` through a discriminated schema union
- every profile has a canonical `slug` that is globally unique across people and communities
- claim state, publication state, and creation provenance are separate fields
- community-submitted unclaimed records are represented by `creationSource: "community"` plus `claimState: "unclaimed"`
- account/user references are deferred until auth and claim issues define the account model
- most public write mutations are deferred until auth and permissions are wired; `profiles:submitCommunityProfile` is the current auth-gated exception
- the community submission mutation requires a Convex authenticated identity before writing
- normalized alias, link, asset, and rich authored block tables are deferred to later profile presentation issues
- avatar and banner fields are URL placeholders for later controlled owner or concierge inputs, not ordinary community-submitted fields

## `profiles` Table

Core identity fields:

- `profileType`: `"person" | "community"`
- `slug`: globally unique canonical URL handle
- `displayName`: public display name
- `sortName`: normalized display-sort key for deterministic listing
- `aliases`: alternate names or searchable display variants kept inline for the first schema slice
- `tags`: flexible shared discovery tags or genres, without imposing a rigid taxonomy

Core presentation fields:

- `headline`: optional short label or one-line positioning statement
- `bio`: optional short public bio
- `about`: optional longer owner-authored about section
- `avatarImageUrl`: optional display/avatar image URL for controlled future owner or concierge inputs
- `bannerImageUrl`: optional banner image URL for controlled future owner or concierge inputs
- `region`: optional location or scene region text
- `timezone`: optional time zone text

State fields:

- `claimState`: `"unclaimed" | "claimed_unverified" | "claimed_verified"`
- `publicationState`: `"draft_private" | "published"`
- `creationSource`: `"self" | "community" | "concierge" | "import" | "moderator"`
- `claimedAt`: optional claim timestamp, present only after claim authority is established
- `publishedAt`: optional publication timestamp, present once a profile has been published
- `updatedAt`: application-maintained update timestamp that every profile mutation must refresh
- `sourceAttribution`: optional inline source metadata for community-submitted records

Type-specific fields:

- `person.pronouns`: optional short pronoun text
- `person.roleTags`: flexible role/type tags such as DJ, VJ, host, photographer, or performer
- `community.subtype`: optional short subtype text such as venue, collective, brand, or agency
- `community.categoryTags`: flexible category tags for community discovery and presentation

Convex automatically provides `_id` and `_creationTime`; those are not duplicated in the schema.

## State Semantics

`claimState` describes owner authority:

- `unclaimed`: no owner authority has been attached yet
- `claimed_unverified`: a claimant controls the profile, but stronger verification is not complete
- `claimed_verified`: owner control and verification are both established

`publicationState` describes public surfacing:

- `draft_private`: not public and not searchable
- `published`: eligible for public profile pages and later discovery flows, subject to permission, trust, and opt-out rules

`creationSource` describes how the record entered the system. It is not an authority marker by itself; authority comes from `claimState` and later claim records.

## Mutation Contracts

Convex schema validation cannot enforce conditional timestamp invariants, so profile mutations must preserve these application-level rules:

- set `claimedAt` when `claimState` leaves `"unclaimed"`
- set `publishedAt` when `publicationState` becomes `"published"`
- patch `updatedAt` on every profile write

The first write path is `profiles:submitCommunityProfile`. It requires `ctx.auth.getUserIdentity()` to return a signed-in identity, generates the slug server-side, publishes the profile as `creationSource: "community"` plus `claimState: "unclaimed"`, and stores narrow source attribution for later moderation and display decisions.

## Initial Indexes

- `by_slug`: canonical profile lookup and mutation-enforced slug uniqueness
- `by_profileType_publicationState`: public page/discovery entry points split by person vs community
- `by_publicationState_claimState`: public/trust filtering for later profile lists
- `by_claimState_profileType`: moderation and claim-review flows by claim state, with optional type splitting
- `by_creationSource_claimState`: moderation and community-submitted/unclaimed review flows
- `by_profileType_sortName`: deterministic profile listing by type

## Follow-On Boundaries

- `#10` adds canonical slugs, validation, and uniqueness rules
- `#11` adds type-aware person/community fields and documents shared vs type-specific data
- `#12` defines read/write permission behavior
- `#13` defines claim-state transitions and trust labeling behavior
- `#22` added presentation fields and public-page rendering for avatar/banner, short bio, and longer about content
- `#23` added the authenticated community submission mutation and source attribution details
- `#27` adds field-level visibility controls
- `#31` adds public search behavior and any search-specific indexing
