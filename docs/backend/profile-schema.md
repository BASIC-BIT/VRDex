# Profile Schema

## Status Note

This doc captures the durable profile schema foundation from `#9` through `#13`, plus later extensions in `#20`, `#22`, `#23`, `#25`, `#26`, `#30`, `#31`, `#32`, `#33`, `#82`, `#90`, the DJ lookup genre slice, and the first file-backed media-kit and bounded appearance slices.

The implemented schema is intentionally narrow. It establishes one shared `profiles` table for people and communities plus first-slice account ownership, claim request, verification attempt, field visibility, media asset, and bounded appearance tables, without advanced moderation workflows.

One normalized link table now exists: `#200` added `profileExternalLinks` and `externalControlProofs` for the claim verification platform. See [External Control Proofs And Profile Links](#external-control-proofs-and-profile-links). That is a deliberate exception to the "no normalized link tables" posture above, and it is scoped to external assets — Discord servers, VRChat groups, and VRChat accounts. Aliases, authored blocks, and outbound links remain inline.

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
- `outboundLinks`: optional inline typed external links for owner-authored, community-submitted, reviewed, or partner-provided profile storefront/contact links
- every writer goes through `sanitizeProfileLinks` in `convex/_profileLinks.ts`, which rejects unknown link types and non-HTTPS URLs, resolves `vrcdn` input through `parseVrcdnStreamLinks` to the canonical page URL plus stream id, and stamps `source` from the caller rather than trusting the payload: `owner_authored` for the profile PATCH API and Discord claim creation, `community_submitted` for the community submit form
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
- uploaded assets can have loose labels, optional public captions, credit names
  and safe HTTP(S) credit links, and an owner-authored accessibility description
- PNG and SVG logos are required from day one
- unclaimed and community-submitted profiles may carry public logos/assets, but public projections must preserve claim, source, and trust labels
- public media-kit surfaces should support individual asset downloads and a zip of all public logos
- claimed owners can order up to 12 active public gallery images, select one
  featured image, and soft-delete or restore an item

Candidate `profileAssets` fields:

- `profileId`: owning person or community profile
- `kind`: broad asset kind such as `image` or `logo`, kept flexible enough for later expansion
- `storageKey`: optimized display object key
- `sourceStorageKey`: optional exact private source object key for uploads made
  after source preservation was introduced
- `downloadStorageKey`: optional metadata-sanitized, full-resolution download
  object key in the uploaded image format
- `originalFileName`: optional original upload filename
- `sourceUrl`: optional HTTPS URL used for import-by-download
- `mimeType` and `byteSize`: validated optimized display type and size
- optional source/download MIME, byte-size, and SHA-256 fields for the preserved
  variants
- `label`: optional loose display label
- `caption`: optional public caption or description
- `altText`: optional concise accessibility description
- `credit`: optional public creator or photographer credit
- `creditUrl`: optional public HTTP(S) credit link without embedded credentials
- `contentSha256`: normalized-content digest used to reject duplicate uploads,
  including recoverable removed assets, without exposing it publicly
- `width` and `height`: validated stored dimensions
- `visibility`: public, unlisted, or private visibility aligned with the profile visibility model
- `source`: owner-authored, community-submitted, partner-provided, moderator, import, or concierge provenance
- `uploadedBy`: authenticated subject or source attribution where available
- `uploadedAt`, `updatedAt`, and optional deletion/replacement metadata

Candidate placement fields can live on the profile or in a companion placement table:

- `profileImageAssetId`
- `bannerAssetId`
- `primaryLogoAssetId`
- ordered additional logo asset ids
- ordered gallery asset ids and an optional featured asset id
- compact/card display preference with an automatic fallback that uses profile image first and logo when no distinct profile image exists or the owner chooses logo-first display
- avatar appearance controls: border on/off, six-digit border color, bounded border thickness, bounded border softness, and `0..50` percent roundedness from square to circle

Convex automatically provides `_id` and `_creationTime`; those are not duplicated in the schema.

Owner-triggered accessibility suggestions use a separate bounded telemetry
table. It records request id, owner/profile, provider/model, result, image byte
count, latency, output length, and an error code. It does not store the image or
generated description.

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

Clerk provides authentication. `users` is VRDex's own table and remains the
identity spine every `v.id("users")` foreign key points at; `clerkUserId` links a
row to its Clerk identity. There is no `authAccounts` table — connected sign-in
providers live in Clerk. See
[`auth-sessions.md`](./auth-sessions.md).

`profileOwners` stores durable profile authority:

- `profileId`: profile receiving ownership
- `userId`: VRDex user that owns the profile
- `roleKey`: currently the singleton literal `owner`
- `state`: `"active" | "revoked"`
- `grantedByClaimRequestId`: optional claim request that granted ownership

`profileClaimRequests` stores claim review state for Discord, VRChat, VRCLinking, and manual methods. Discord methods currently distinguish `discord_person`, `discord_community`, and the stronger `discord_community_admin` flow.

`profileVerificationAttempts` stores proof-code attempts for external proof readers. Attempts have a proof code, target type, target external id, state, expiry, and optional evidence summary.

Proof reading is split by target type:

- `vrchat_user` and `vrchat_group` attempts are read by the collector fleet on
  its own schedule. `VRCHAT_PROOF_ADAPTER_URL` is optional and deliberately
  unset in production; with no adapter configured, a manual "check now" reports
  `queued` rather than failing.
- `vrclinking` attempts have no collector path at all. They require
  `VRCLINKING_PROOF_ADAPTER_URL`, because the answer comes from a community's
  delegated key rather than from a posted code.

Both adapters exist so provider behaviour is not hard-coded into the product
backend. See `docs/backend/profile-access-and-claims.md` for the claim rules
and `docs/deployment/group-telemetry-collector.md` for the fleet.

## External Control Proofs And Profile Links

`#200` splits two things a claim used to conflate: whether somebody controls an
external asset, and which profile that asset stands for. They are separate
because proving you administer a Discord server says nothing about which
community listing that server represents.

`externalControlProofs` records the first — durable evidence that a user
controls an asset:

- `userId`, `assetType` (`discord_guild` | `vrchat_group` | `vrchat_user`), `assetExternalId`
- `controlLevel`: `manager` | `administrator` | `owner` | `self`
- `state`: `"active" | "stale" | "revoked"`. `revoked` is a decision — Discord
  reported the access gone, or an operator withdrew it — and carries `revokedAt`
  and `revokedReason`. `stale` is only the passage of time: the revalidation
  sweep marks a proof whose `revalidateAfter` has passed, and re-verifying
  restores it to `active`. Both stop backing claims and delegations; only
  `revoked` says anything happened
- `evidenceSource` and `evidenceSummary`: how control was shown
- `evidenceSubjectId`: which external identity produced the evidence. A user may
  verify through more than one Discord account, and a result is only
  authoritative about the guilds of the identity that produced it
- `verifiedAt`, `revalidateAfter`, `lastRevalidatedAt`: proofs expire. A lapsed
  proof stops backing claims and delegations without deleting the record

`profileExternalLinks` records the second — a many-to-many association between a
profile and an asset:

- `profileId`, `assetType`, `assetExternalId`, optional `assetDisplayName`
- `linkRole`: `primary` | `secondary`. One community may hold several servers and
  groups; one of each kind is primary
- `state`: `"active" | "removed"`
- `linkedByUserId`: absent when an operator seeded the association rather than a
  claimant asserting it
- `verifiedByProofId`: the control proof that backed the link when it was made

The trust rule between them: a proof alone grants `claimed_unverified`
ownership. `claimed_verified` additionally requires an active link recorded by
somebody other than the claimant — otherwise a claim corroborates itself, and
any asset could verify any listing.

Links deliberately outlive proofs. A community that stops being administered by
its original claimant keeps its association; what lapses is the authority to act
on it.

Supporting tables from the same slice:

- `communityVrclinkingCredentials`: a community's delegated VRCLinking key,
  stored as a `secretRef` only — never the key itself — bound to the guild it is
  for, with rotation and consultation stamps
- `discordVerificationStates`: single-use OAuth round-trip state
- `discordVerificationWatermarks`: per Discord identity, when the newest applied
  reconciliation read that identity's guilds, so overlapping callbacks landing
  out of order cannot resurrect revoked access

## Reviewed Seed Import Staging Tables

Current recommendation:

- reviewed seed imports live in `seedImportBatches`, `seedImportCandidateProfiles`, and `seedImportCandidateFields`
- these tables preserve provenance, confidence, field visibility, review state, reviewer metadata, matched profile links, and queue-only publication metadata
- internal fake fixture tooling can create candidate rows for backend tests and review workflow development
- `seedImports:queueCandidatePublication` records a queue marker only; it does not create public `profiles` rows or overwrite existing owner-authored fields
- `seedImports:publishQueuedCandidate` consumes that queue marker and is what actually creates or promotes the public unclaimed profile, copying accepted fields only and preserving each field's reviewed visibility
- `seedImports:bulkPublishBatch` runs the same per-candidate path in cursor pages for a whole batch; see [Publication](./private-seed-operations.md#publication)
- publication requires the batch's `publicationPolicy` to be `reviewed_publication_allowed`, which an operator sets deliberately with a recorded reason; a batch with no explicit policy fails closed
- owner handoff remains a separate flow: accepting a concierge handoff still publishes nothing

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

The owner privacy mutation currently accepts these field keys: `aliases`, `tags`, `genres`, `headline`, `bio`, `about`, `avatarImageUrl`, `bannerImageUrl`, `outboundLinks`, `region`, `timezone`, `personPronouns`, `personRoleTags`, `communitySubtype`, and `communityCategoryTags`.

## Mutation Contracts

Convex schema validation cannot enforce conditional timestamp invariants, so profile mutations must preserve these application-level rules:

- set `claimedAt` when `claimState` leaves `"unclaimed"`
- set `publishedAt` when `publicationState` becomes `"published"`
- patch `updatedAt` on every profile write

Locked decision: `profiles:submitCommunityProfile` is the public community-submitted unclaimed write path. It requires `ctx.auth.getUserIdentity()` to return a signed-in identity, generates the slug server-side, publishes the profile as `creationSource: "community"` plus `claimState: "unclaimed"`, and stores narrow source attribution for later moderation and display decisions.

Current recommendation: `profileClaims:createClaimedDiscordPersonProfile` and `profileClaims:createClaimedDiscordCommunityProfile` are the explicit Discord no-match creation paths. They require Convex auth, verified email, a Discord identity VRDex has itself verified, and caller confirmation that no suitable unclaimed match exists. They create self-authored public profiles, record an approved Discord claim request, grant singleton owner authority, and leave the profile at `claimed_unverified`.

Current recommendation: Discord community Administrator verification remains the stronger server-authority path for community profiles. A verified Discord identity alone can create and control a new community profile, but it does not prove server administration and must not set `claimed_verified` by itself.

"Verified Discord identity" means a `discordVerificationWatermarks` row VRDex wrote through its own purpose-scoped OAuth round-trip — not a Discord sign-in method linked in Clerk. Clerk owns which providers an account can sign in with, and that says nothing about control of a Discord identity, so the two are deliberately unrelated. `accounts:getLinkedProviderAccount` reads the watermark.

The claimed-owner field visibility path is `profilePrivacy:updateFieldVisibility`. It requires an active profile owner, stores non-public field overrides on `profiles.fieldVisibility`, treats omitted or explicit `public` fields as the public default, patches `updatedAt`, and refreshes the profile search document so discovery follows the new field visibility.

The `migrations:backfillProfilePublicSurfacingState` internal mutation sets missing legacy `publicSurfacingState` values to `"public"` and fills `publicSurfacingUpdatedAt` so previously-written profiles keep their existing publication behavior after the surfacing-state schema addition.

The `migrations:publishGatedProfiles` internal mutation takes previously gated profiles live: it flips `draft_private` profiles to `published` and reindexes each one for search and vocabulary, since a flipped profile that is not reindexed stays invisible to discovery.

It only touches profiles that are `draft_private` **and** `public`, which is the default-private state with no explicit surfacing decision attached. It deliberately skips:

- `opted_out` profiles. This is the canonical "keep off ordinary public surfaces" signal and it is what `seedHandoffs` writes on a prepared concierge profile, including *unclaimed* ones prepared for outreach but never accepted. Those were offered on the explicit promise that nothing is published, so claim state cannot be used to discard the opt-out.
- `suppressed` profiles, which are a moderation state rather than a default.
- Profiles with an accepted `profileSuppressionRequests` row, which records someone asking not to be listed. All three request shapes are checked (profile id, slug, and pre-claim name/type), not just slug.
- Claimed profiles, because publication of an owned profile is the owner's decision.
- Profiles with a live concierge handoff invitation, which are instead marked `opted_out` with reason `Concierge handoff invitation pending.` A bare skip would advance the migration cursor, leaving a profile whose invitation later expires stuck at `draft_private` with no record of why; `opted_out` is the same state `seedHandoffs` writes on a prepared concierge profile, and the ordinary publication and suppression paths govern it from there. The migration bypasses both publication gates, so it repeats their handoff check: an invitation can reuse a legacy `draft_private` profile whose surfacing state is still `public`, and publishing it would expose the profile while its private review link is live.

Known limitation: there is currently **no** owner-facing control that changes `publicationState` or `publicSurfacingState`. `profilePrivacy:updateFieldVisibility` controls individual field visibility only. An owner who accepts a concierge handoff therefore has no self-service path to publish their profile, and needs an operator. That gap is not addressed here.

Unlike the other migrations it is **not** part of `migrations:runAll`, because publishing profiles publicly is outward-facing and not cleanly reversible. Run it deliberately:

```powershell
pnpm cx -- prod run migrations:runPublishGatedProfiles
```

Follow it with one world search rebuild, which covers every attribution that became visible and records world vocabulary with it:

```powershell
pnpm cx -- prod run search:rebuildWorldSearchDocuments
```

The migration deliberately does not reindex worlds per row; that would mean one full `worlds` scan per migrated profile. The rebuild is delta-aware — it compares each world's stored `vocabularyKeys` against the rebuilt ones and records only what appeared, releasing what went away — so running it against already-indexed worlds does not re-increment existing counts.

That runner executes `backfillProfilePublicSurfacingState` and `backfillHandoffInvitationProfileIds` first. The second gives every active handoff invitation a `profileId` — one created before its candidate was matched carries none, which would make the migration's liveness check blind to it. A legacy profile with no `publicSurfacingState` would otherwise be skipped while the publication migration's cursor advanced, and running the backfill afterwards cannot make a completed migration revisit it.

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
- `externalControlProofs.by_userId_assetType_assetExternalId`: one user's proof for a given asset, in any state
- `externalControlProofs.by_assetType_assetExternalId_state`: who currently proves control of an asset
- `externalControlProofs.by_state_revalidateAfter`: revalidation sweeps
- `profileExternalLinks.by_profileId_assetType_state`: a profile's active connections, primary first
- `profileExternalLinks.by_assetType_assetExternalId_state`: which profiles an asset backs

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
- `#27` adds field-level visibility controls and the claimed-owner privacy update surface
- `#31` adds public search behavior and any search-specific indexing
