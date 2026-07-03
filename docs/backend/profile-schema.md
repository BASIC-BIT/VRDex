# Profile Schema

## Status Note

This doc captures the durable profile schema foundation from `#9` through `#13`, plus later extensions in `#20`, `#22`, `#23`, `#25`, `#26`, `#30`, `#31`, `#32`, `#33`, `#82`, `#90`, the DJ lookup genre slice, and the first file-backed media-kit and bounded appearance slices.

The implemented schema is intentionally narrow. It establishes one shared `profiles` table for people and communities plus first-slice account ownership, claim request, verification attempt, field visibility, media asset, and bounded appearance tables without introducing normalized link tables or advanced moderation workflows.

## Locked Decisions

- profiles are first-class records independent from the user account that may later claim them
- `profileType` is explicit and currently supports `person` and `community` through a discriminated schema union
- every profile has a canonical `slug` that is globally unique across people and communities
- claim state, publication state, and creation provenance are separate fields
- community-submitted unclaimed records are represented by `creationSource: "community"` plus `claimState: "unclaimed"`
- Discord no-match claim creation writes `creationSource: "self"` profiles and then grants owner authority through `profileOwners`
- public surfacing state is separate from ordinary publication state so valid opt-out and suppression can hide otherwise-published profiles
- account/user ownership references live in `profileOwners`; provider login alone is not ownership
- most broad profile editing mutations are deferred until auth and permissions are wired; `profiles:submitCommunityProfile` and the claim mutations are the current auth-gated write exceptions
- the community submission mutation requires a Convex authenticated identity before writing
- normalized alias and rich authored block tables are deferred to later profile presentation issues
- file-backed media-kit assets are the model for profile pictures, logos, banners, and other reusable profile images
- profile image appearance is stored as display preference metadata, not by mutating the uploaded image asset
- public profile body section ordering is bounded to known sections; duplicate entries are ignored and missing default sections are appended
- profile outbound links are currently inline typed external links; normalized link tables remain a later scaling option
- avatar and banner fields are URL placeholders for later controlled owner or concierge inputs, not ordinary community-submitted fields
- reviewed seed imports stage proposed profile facts outside `profiles` until explicit review and a later publication/merge flow; imported candidate fields are not owner-authored fields

## `profiles` Table

Core identity fields:

- `profileType`: `"person" | "community"`
- `slug`: globally unique canonical URL handle
- `displayName`: public display name
- `sortName`: normalized display-sort key for deterministic listing
- `aliases`: alternate names or searchable display variants kept inline for the first schema slice
- `searchAliases`: optional private search-only variants such as handles, underscores, old spellings, or stylized forms that should match lookup/search but should not render as public aliases
- `tags`: flexible shared discovery tags that should not silently become canonical genres
- `genres`: optional structured public genre facts for profiles, kept separate from flexible tags while normalized genre tables remain deferred

Core presentation fields:

- `headline`: optional short label or one-line positioning statement
- `bio`: optional short public bio
- `about`: optional longer owner-authored about section
- `avatarImageUrl`: optional display/avatar image URL for controlled future owner or concierge inputs
- `bannerImageUrl`: optional banner image URL for controlled future owner or concierge inputs
- `region`: optional location or scene region text
- `timezone`: optional time zone text
- `outboundLinks`: optional inline typed external links for owner-authored, reviewed, or partner-provided profile storefront/contact links
- first-class profile link types include DJ/operator lookup needs such as `vrchat_profile`, `discord`, `soundcloud`, `mixcloud`, `twitch`, `youtube`, `spotify`, `bandcamp`, `instagram`, and `linktree`, plus existing website/store/commission link types
- profile links may optionally set `presentation: "icon" | "copy"`; lookup treats Twitch as icon-only unless a link explicitly requests copy presentation, while VRCDN stream rows remain the preferred elevated stream controls
- first-slice profile genre facts include a stable `slug`, canonical `displayName`, optional short `displayLabel`, optional featured display intent, optional aliases, optional parent genre slugs, source, confidence, explicit/inferred state, and optional external IDs such as MusicBrainz genre UUID or Wikidata QID

State fields:

- `claimState`: `"unclaimed" | "claimed_unverified" | "claimed_verified"`
- `publicationState`: `"draft_private" | "published"`
- `creationSource`: `"self" | "community" | "concierge" | "import" | "moderator"`
- `publicSurfacingState`: `"public" | "opted_out" | "suppressed"`
- `publicSurfacingUpdatedAt`: optional timestamp for the latest public-surfacing state change
- `publicSurfacingReason`: optional short reason for opt-out or suppression state
- `fieldVisibility`: optional per-field visibility map using `"public" | "unlisted" | "private"`
- `claimedAt`: optional claim timestamp, present only after claim authority is established
- `publishedAt`: optional publication timestamp, present once a profile has been published
- `updatedAt`: application-maintained update timestamp that every profile mutation must refresh
- `sourceAttribution`: optional inline source metadata for community-submitted records

Type-specific fields:

- `person.pronouns`: optional short pronoun text
- `person.roleTags`: flexible role/type tags such as DJ, VJ, host, photographer, or performer
- `community.subtype`: optional short subtype text such as venue, collective, brand, or agency
- `community.categoryTags`: flexible category tags for community discovery and presentation

## Follow-On Profile Media Kit Assets

Current recommendation:

- people and communities should share the same file-backed media-kit asset system
- profile picture/avatar, banner, primary logo, additional ordered logos, and other public image placements should reference assets instead of becoming separate one-off URL fields over time
- public profile images can be reused by event lineup and host cards when their field visibility allows the image on discovery surfaces
- user-provided public HTTPS image URLs should be treated as import sources; VRDex should reject private/internal destinations, copy bounded PNG/SVG/JPEG/WebP responses into managed object storage such as S3, and serve the VRDex-owned object as the canonical asset
- one uploaded asset can fill multiple placements, such as both profile picture and primary logo
- public UX should say `primary logo` and `additional logos` instead of `non-primary` or defaulting to `alternative logo`
- uploaded assets can have loose labels and optional public captions; separate required accessibility text is not part of the first slice
- PNG and SVG logos are required from day one
- unclaimed and community-submitted profiles may carry public logos/assets, but public projections must preserve claim, source, and trust labels
- public media-kit surfaces should support individual asset downloads and a zip of all public logos

Candidate `profileAssets` fields:

- `profileId`: owning person or community profile
- `kind`: broad asset kind such as `image` or `logo`, kept flexible enough for later expansion
- `storageKey`: canonical managed-storage object key
- `originalFileName`: optional original upload filename
- `sourceUrl`: optional HTTPS URL used for import-by-download
- `mimeType`: validated stored MIME type, including PNG and SVG support for logos
- `byteSize`: stored object size
- `label`: optional loose display label
- `caption`: optional public caption or description
- `visibility`: public, unlisted, or private visibility aligned with the profile visibility model
- `source`: owner-authored, community-submitted, partner-provided, moderator, import, or concierge provenance
- `uploadedBy`: authenticated subject or source attribution where available
- `uploadedAt`, `updatedAt`, and optional deletion/replacement metadata

Candidate placement fields can live on the profile or in a companion placement table:

- `profileImageAssetId`
- `bannerAssetId`
- `primaryLogoAssetId`
- ordered additional logo asset ids
- compact/card display preference with an automatic fallback that uses profile image first and logo when no distinct profile image exists or the owner chooses logo-first display
- avatar appearance controls: border on/off, six-digit border color, bounded border thickness, bounded border softness, and `0..50` percent roundedness from square to circle

Convex automatically provides `_id` and `_creationTime`; those are not duplicated in the schema.

## Bounded Profile Appearance

Locked decision:

- avatar frame controls are presentation metadata only and never mutate the stored image asset
- public profile section ordering is constrained to `about`, `events`, `links`, `media_kit`, `worlds`, and `details`
- section ordering normalization removes duplicates, ignores unknown values, and appends any missing default sections so public pages always stay complete
- raw HTML, arbitrary CSS, premium effects, and generic page-builder blocks are outside the baseline bounded customization slice

Current recommendation:

- theme presets should remain a small enum mapped to shared design tokens when implemented, not owner-authored color strings or CSS
- the first owner-facing customization editor should stay focused on avatar frame controls and the constrained public section order
- premium animated effects and richer styling should remain a follow-on system after this calm, readable baseline is stable

## Ownership And Claim Tables

Convex Auth provides the `users` and `authAccounts` tables used by account and provider-link flows.

`profileOwners` stores durable profile authority:

- `profileId`: profile receiving ownership
- `userId`: Convex Auth user that owns the profile
- `roleKey`: currently the singleton literal `owner`
- `state`: `"active" | "revoked"`
- `grantedByClaimRequestId`: optional claim request that granted ownership

`profileClaimRequests` stores claim review state for Discord, VRChat, VRCLinking, and manual methods. Discord methods currently distinguish `discord_person`, `discord_community`, and the stronger `discord_community_admin` flow.

`profileVerificationAttempts` stores proof-code attempts for external proof readers. Attempts have a proof code, target type, target external id, state, expiry, and optional evidence summary.

The first automated proof reader is an adapter action configured by `VRCHAT_PROOF_ADAPTER_URL`; it avoids hard-coding guessed VRChat or VRCLinking API behavior into the product backend.

## Reviewed Seed Import Staging Tables

Current recommendation:

- reviewed seed imports live in `seedImportBatches`, `seedImportCandidateProfiles`, and `seedImportCandidateFields`
- these tables preserve provenance, confidence, field visibility, review state, reviewer metadata, matched profile links, and queue-only publication metadata
- internal fake fixture tooling can create candidate rows for backend tests and review workflow development
- `seedImports:queueCandidatePublication` records a queue marker only; it does not create public `profiles` rows or overwrite existing owner-authored fields
- actual publication, merge, owner handoff, and public surfacing remain deferred until the claim, suppression, and field-ownership rules are implemented end to end

## State Semantics

`claimState` describes owner authority:

- `unclaimed`: no owner authority has been attached yet
- `claimed_unverified`: a claimant controls the profile, but stronger verification is not complete
- `claimed_verified`: owner control and verification are both established

`publicationState` describes public surfacing:

- `draft_private`: not public and not searchable
- `published`: eligible for public profile pages and later discovery flows, subject to permission, trust, and opt-out rules

`publicSurfacingState` describes whether an otherwise-published profile is allowed to appear on ordinary public surfaces:

- `public`: profile can appear on profile pages, search, discovery, event participant references, and linked attribution surfaces
- `opted_out`: valid owner opt-out; hide from ordinary public surfaces
- `suppressed`: moderation/safety suppression; hide from ordinary public surfaces

`creationSource` describes how the record entered the system. It is not an authority marker by itself; authority comes from `claimState` and later claim records.

`fieldVisibility` controls public projection surfaces for eligible fields including aliases, tags, genres, text, images, links, region/timezone, and type-specific role/category fields:

- `public`: direct profile page plus discovery/search/card projections
- `unlisted`: direct profile page only
- `private`: hidden from public projections

`displayName`, `slug`, `profileType`, and trust labels remain public while the profile itself is public.

## Mutation Contracts

Convex schema validation cannot enforce conditional timestamp invariants, so profile mutations must preserve these application-level rules:

- set `claimedAt` when `claimState` leaves `"unclaimed"`
- set `publishedAt` when `publicationState` becomes `"published"`
- patch `updatedAt` on every profile write

Locked decision: `profiles:submitCommunityProfile` is the public community-submitted unclaimed write path. It requires `ctx.auth.getUserIdentity()` to return a signed-in identity, generates the slug server-side, publishes the profile as `creationSource: "community"` plus `claimState: "unclaimed"`, and stores narrow source attribution for later moderation and display decisions.

Current recommendation: `profileClaims:createClaimedDiscordPersonProfile` and `profileClaims:createClaimedDiscordCommunityProfile` are the explicit Discord no-match creation paths. They require Convex auth, verified email, a linked Discord account, and caller confirmation that no suitable unclaimed match exists. They create self-authored public profiles, record an approved Discord claim request, grant singleton owner authority, and leave the profile at `claimed_unverified`.

Current recommendation: Discord community Administrator verification remains the stronger server-authority path for community profiles. A linked Discord account alone can create and control a new community profile, but it does not prove server administration and must not set `claimed_verified` by itself.

The `migrations:backfillProfilePublicSurfacingState` internal mutation sets missing legacy `publicSurfacingState` values to `"public"` and fills `publicSurfacingUpdatedAt` so previously-written profiles keep their existing publication behavior after the surfacing-state schema addition.

Deploy-time migrations use `@convex-dev/migrations` and are run by `migrations:runAll` after production function deploys when `CONVEX_DEPLOY_KEY` is configured.

## Initial Indexes

- `by_slug`: canonical profile lookup and mutation-enforced slug uniqueness
- `by_profileType_publicationState`: public page/discovery entry points split by person vs community
- `by_publicationState_claimState`: public/trust filtering for later profile lists
- `by_publicSurfacingState_publicationState`: public suppression and opt-out enforcement
- `by_claimState_profileType`: moderation and claim-review flows by claim state, with optional type splitting
- `by_creationSource_claimState`: moderation and community-submitted/unclaimed review flows
- `by_profileType_sortName`: deterministic profile listing by type
- `profileOwners.by_profileId_roleKey_state`: active owner singleton enforcement
- `profileOwners.by_userId_state`: account profile ownership lookup
- `profileClaimRequests.by_profileId_state`: profile claim review lookup
- `profileVerificationAttempts.by_state_expiresAt`: pending proof attempt expiry scans

## Implementation Boundaries

- `#10` adds canonical slugs, validation, and uniqueness rules
- `#11` adds type-aware person/community fields and documents shared vs type-specific data
- `#12` defines read/write permission behavior
- `#13` defines claim-state transitions and trust labeling behavior
- `#22` added presentation fields and public-page rendering for avatar/banner, short bio, and longer about content
- `#23` added the authenticated community submission mutation and source attribution details
- `#25` and `#26` add public trust/source labeling and the first audit trail
- `#30` adds public surfacing suppression enforcement
- `#31`, `#32`, and `#33` add universal public search/discovery surfaces
- `#82` added inline typed external links for first-slice creator commerce/profile links, with public `https` filtering
- `#90` adds scoped vocabulary normalization for tags, roles, categories, and discovery facets
- the DJ lookup genre slice adds optional inline `profiles.genres` plus `profile_genre` vocabulary/search indexing as the minimal bridge to a later normalized genre graph
- `#27` adds field-level visibility controls
- `#31` adds public search behavior and any search-specific indexing
