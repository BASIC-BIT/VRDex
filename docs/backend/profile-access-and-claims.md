# Profile Access And Claims

## Status Note

This doc captures the permission and claim-state baseline for `#12` and `#13`, plus later auth, ownership, field-visibility, Discord claim, and VRChat proof-code slices.

It intentionally does not add moderation UI, role delegation, ownership transfer, contested-claim resolution, or a hard-coded VRCLinking API integration.

## Read Baseline

- public users can read `published` profiles
- `draft_private` profiles are not public
- claimed owners can read their own profiles regardless of publication state once ownership is modeled
- moderators can read profiles regardless of publication state once moderator authority exists

## Edit Baseline

Ordinary public users cannot edit profiles.

Community submitters may populate only a narrow safe field set for unclaimed profiles through `profiles:submitCommunityProfile`:

- `displayName`
- `aliases`
- `tags`
- `person` type-specific fields
- `community` type-specific fields

Community submitters must not set fields that imply verified authority, private contact details, billing state, ownership, custom slugs, or sensitive visibility choices. Profile creation can still generate an initial slug from submitted display text.

The current public mutation requires a Convex authenticated identity and stores source attribution. Freeform bios, about text, avatar URLs, banner URLs, private contact details, and custom slugs are intentionally outside the ordinary community-submission field set.

Claimed owners may edit normal profile fields after a claim attaches authority to the existing profile record. This baseline assumes claimed owners can edit identity, presentation, slug, tags, and type-specific profile fields, subject to future field-level visibility and abuse controls.

Moderators may override profile fields later for safety, corrections, and abuse handling. The moderation UI and detailed audit model are deferred.

## Ownership Records

`profileOwners` records are the durable owner authority link between Convex Auth `users` and `profiles`.

Locked decision: ownership is attached to a profile record, not inferred from provider login alone.

- `roleKey` is currently the singleton literal `owner`
- only one active owner may exist for a profile at a time
- repeated grants for the same active owner are idempotent
- grants to a different active owner must fail until a future transfer or moderation flow revokes the old owner
- claim approval must update the profile search document because trust rank and public trust labels can change

## Claim States

`claimState` describes owner authority:

- `unclaimed`: no owner authority is attached yet
- `claimed_unverified`: a claimant controls the profile, but stronger verification is not complete
- `claimed_verified`: owner control and stronger verification are both established

Claim transitions preserve the same profile record and slug. Claiming a profile should not create a duplicate identity record.

Allowed ordinary transitions are real state changes only:

- `unclaimed` -> `claimed_unverified`
- `unclaimed` -> `claimed_verified`
- `claimed_unverified` -> `claimed_verified`

Downgrades, contested claims, transfer flows, and suppression flows require explicit moderation or ownership workflows later.

A weaker approval method must not downgrade an already verified profile. For example, a later Discord person claim leaves an existing `claimed_verified` profile verified instead of moving it back to `claimed_unverified`.

## Claim Methods

Current claim-level actions require a signed-in Convex Auth user with a verified email address.

Locked decision: claiming a suitable existing unclaimed profile attaches ownership to that existing profile record and preserves its `_id`, slug, source history, and related references.

Current recommendation: the no-match creation path is explicit. `profileClaims:createClaimedDiscordPersonProfile` and `profileClaims:createClaimedDiscordCommunityProfile` require the caller to confirm that no suitable unclaimed match exists before a new self-created profile is written.

- Discord person claims require a linked Discord provider account and grant `claimed_unverified` owner control for an existing person profile.
- Discord person no-match creation requires a linked Discord provider account, creates a `creationSource: "self"` person profile, records an approved `discord_person` claim request, and grants `claimed_unverified` owner control.
- Discord community claims run through a purpose-scoped OAuth round-trip (`identify guilds`) in `discordVerification`, not through a bot token. `startGuildVerification` sends the user to Discord, `completeGuildVerification` reads every guild the token can see and records an `externalControlProofs` row for each guild the user owns or holds Administrator or Manage Server in, then revokes the token. `profileConnections:claimCommunityWithVerifiedGuild` grants `claimed_verified` owner control against one of those proofs. The bot-token path (`profileClaims:verifyDiscordCommunityAdminClaim`) remains for the legacy `discord_community_admin` request flow.
- Discord community no-match creation requires a linked Discord provider account, creates a `creationSource: "self"` community profile, records an approved `discord_community` claim request, and grants `claimed_unverified` owner control.
- Current recommendation: OAuth guild verification is the stronger server-authority path. A linked-account-only community creation is owner-controlled but not `claimed_verified` unless a later guild-control, VRChat group, VRCLinking, manual, or equivalent stronger verification flow succeeds.
- VRChat user proof requires a person profile and creates a proof-code attempt with `targetType: "vrchat_user"`.
- VRChat group proof requires a community profile and creates a proof-code attempt with `targetType: "vrchat_group"`.
- VRCLinking uses the same attempt table with `targetType: "vrclinking"`, but answers from a community's delegated API key rather than from a posted proof code.
- A claimant may hold at most `MAX_OPEN_PROOF_ATTEMPTS` unexpired pending attempts per target type. Re-requesting an attempt that already exists returns the same code and is not subject to the cap.

Proof reading has two paths, chosen by target type:

- **VRChat user and group proofs** are read by the collector fleet. `VRCHAT_PROOF_ADAPTER_URL` is optional; with no adapter configured, `profileClaims:verifyVrchatProofViaAdapter` returns `queued` and `communityTelemetry:claimPendingProofChecks` hands the attempt to a collector, which reads the target's bio or group description with the service-account session and reports the verdict back. See `docs/deployment/claim-verification-enablement.md`.
- **VRCLinking proofs** go to `VRCLINKING_PROOF_ADAPTER_URL` (`workers/vrclinking-adapter`). Convex sends the claimant's Discord id plus secret-store *references* for up to five delegated guild credentials; the adapter resolves each reference through IAM and asks VRCLinking whether that Discord id is linked in the guild. Convex never holds a delegated token.

Both paths return whether control was proved plus an evidence summary, and record an `externalControlProofs` row on success.

## Field Visibility

Profile field visibility supports three states:

- `public`: visible on direct profile pages and eligible for discovery/search/card projections
- `unlisted`: visible on direct profile pages but omitted from discovery/search/card projections
- `private`: omitted from all public projections

`displayName`, `slug`, `profileType`, and trust labels remain public while the profile itself is public.

Claimed owners update supported field visibility through `profilePrivacy:updateFieldVisibility`. The mutation requires a signed-in account with an active `profileOwners` owner record for the claimed profile, rejects unknown field keys or states, stores public defaults compactly, and refreshes the profile search document after the profile row changes.

Field visibility is separate from profile-level opt-out. Hiding a field controls which details appear on public surfaces; opt-out and suppression decide whether the profile should surface publicly at all.

## Trust Labels

Initial trust labels map from `claimState` plus `creationSource`:

- `community_submitted`: `claimState: "unclaimed"` and `creationSource: "community"`
- `unclaimed`: no owner authority has been attached
- `claimed_unverified`: owner control exists, stronger verification is pending
- `claimed_verified`: owner control and verification are established

These labels are business-logic helpers only. Final UI copy and visual treatment belong to public profile and trust-label issues.

## Mutation Contracts

Future claim mutations must:

- validate allowed claim-state transitions
- handle no-op writes outside the claim transition helper
- set `claimedAt` when `claimState` leaves `"unclaimed"`
- preserve the profile `_id` and slug when authority changes
- patch `updatedAt` on every profile write
- use `profileOwners` for durable owner authority instead of interpreting provider login as ownership by itself

Owner privacy mutations must:

- require active owner authority for the target profile
- reject unknown field visibility keys and states
- patch `updatedAt` on profile writes
- refresh discovery/search projections when field visibility changes
