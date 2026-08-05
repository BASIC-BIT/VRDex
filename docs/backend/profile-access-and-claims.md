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

Signed-out users cannot edit profiles.

What separates a community contributor from an owner is what a field describes,
not a list of field names:

- **Information about the person** is community-editable on an unclaimed
  profile. Display name, aliases, tags, outbound links, headline, bio, region,
  timezone, role tags and pronouns. Facts a third party can know and correct,
  and the reason an unclaimed profile is worth visiting at all. A few of these
  carry one extra condition, described below, and it is about whether the value
  is on screen rather than about what it describes.
- **The record itself** is not. `slug` is the profile's address, so changing it
  on someone else's behalf breaks every link already shared. Appearance --
  avatar shape, border colour, section order -- is a presentation choice
  belonging to whoever owns the profile, and is governed by `profileAppearance`
  rather than the editable-field union.

`COMMUNITY_UNEDITABLE_FIELDS` in `convex/_profilePermissions.ts` states that as
an exclusion. It replaced an allowlist, under which the default for any field
added later was "not editable" -- which is how `outboundLinks` came to be
excluded by omission rather than by decision.

Community contributors must not set fields implying verified authority, private
contact details, billing state, ownership, custom slugs, or field-visibility
choices.

A field the profile marks `private` is not community-editable either. Editing a
field means being shown its current value first, so the community may not edit
what it may not read -- otherwise the editor becomes a way to read a withheld
value by opening a form, and a blind save would overwrite one. `unlisted` is
usually not private: for most fields it renders on the profile page, so a
contributor looking at that page has already seen it — with the exceptions below.
`profiles:editableProfile` returns values only for fields the subject has
cleared, so the form shows exactly what it may change.

Visibility does not settle that on its own, because "may be shown" is not
"is shown". The public page puts role tags, category tags and free tags in a
single metadata line, and whether a given value reaches it depends on the
profile: a headline takes that row entirely, and without one the line renders
four values after deduplication. `timezone` has no place on the page at all;
only the lookup shows it, beside the region.

So those keys are treated as *not reliably shown*, and for them `unlisted` — the
state discovery excludes — means the value may be nowhere a contributor can
reach. They are withheld from community editing while `unlisted`, and editable
while `public`, because the lookup carries public values whatever the page does.
Owners keep them either way; it is their own record.

This is deliberately conservative rather than exact. Three review rounds each
found another way that re-deriving the page's layout in the permission check was
inexact — the headline, then grouped keys whose two halves render differently,
then the four-item limit — and a rule that has to mirror a component's rendering
will keep being wrong in a new way. The conservative version can cost a
contributor an edit to an unlisted value that happened to be on screen. The exact
one, whenever it drifts, lets them read a value the page never showed them, which
is the thing the rule exists to prevent.

`timezone` was briefly excluded outright, on the claim that no public surface
renders it. That was wrong about the lookup. The true claim is the narrower one:
the *profile page* does not render it.

An existing link keeps the provenance it already had, and each row says which
one it arrived with. The form posts the whole array back, so restamping on every
save would downgrade an owner-authored link to community-submitted because
somebody fixed a typo elsewhere — while matching by destination alone gets
duplicates wrong in both directions, either handing one link's source to every
row that shares its URL or promoting a community row when the owner row above it
is deleted.

The claim is not authority. `source` is accepted on the input, stripped before
normalization so it can never be stored from writer input, and honoured only
against a stored link that genuinely carries it — each stored link claimed once.
A writer asking for `owner_authored` on a link nothing has gets their own stamp.

The editor sends the `updatedAt` it loaded. Because the form posts every group it
rendered, a second person saving a display-name fix would otherwise spread stale
values over links and tags somebody else changed meanwhile, and the diff would
read those as deliberate. A mismatched version is refused rather than silently
won.

"It loaded" is the contract, not "the query currently holds". The fields are
uncontrolled, so when somebody else saves while the page is open, Convex pushes a
newer `updatedAt` while every `defaultValue` keeps the values it mounted with.
Sending the live number would pass the check with a payload built from what the
other editor just replaced — the overwrite the check exists to refuse, arriving
through the check. The editor pins the version its inputs were filled from for
the life of the form, so that save is refused and the message says to reload.

The argument is required rather than optional. A check a caller can decline by
omitting it is not a check: a cached page still running the previous
deployment's bundle, or anything calling the mutation directly, would post the
same whole-form payload and skip straight past it. Every browser save knows the
version it loaded, because it had to read the profile to fill the form.

**Media is out of scope for community editing.** A profile picture or logo is
information about the person by the rule above, and it is the most visible thing
missing from a seeded profile — but no path exists to supply one.
`profileAssets:createUploadIntentForOwnedProfile` is the only browser route to an
upload intent, and it requires ownership and refuses unclaimed profiles, so
`updateProfileFromBrowser` deliberately takes no `assets` argument rather than
declaring one no caller could satisfy. Letting any signed-in account attach
images to somebody else's profile needs a moderation answer that does not exist
yet; the field policy is the part that is ready.

`profiles:updateProfileFromBrowser` serves both subjects and resolves which one
applies from ownership: the profile's owner edits as `claimed_owner`, anyone
else editing an unclaimed profile edits as `community_submitter`, and a non-owner
editing a claimed profile is refused. Links carry the subject's provenance, so a
contributor's links are stored `community_submitted` rather than
`owner_authored`.

Edits apply directly rather than queueing for review, matching community
submissions, which publish immediately. An edit that changes a value writes a
`profileAuditEvents` row naming the actor and the fields that actually changed,
readable by the profile's owner and by an operator holding
`view_private_seed_lookup` through `seedAccess:withheldProfileRecord`.

"Actually changed" is the contract, not "was submitted". The editor posts every
field group it rendered on every save, so recording the payload's keys would
report aliases, tags, links and roles as updated because somebody fixed a typo in
the display name — and a save that changed nothing would still write a row. A
no-op save writes no patch, no reindex and no history. The public API's own write
ledger (`apiWriteAuditEvents`) is separate and records the request regardless: a
write that changed nothing is still a write that was made.

`profiles:submitCommunityProfile` creates a profile from the same field set,
requires an authenticated identity, and stores source attribution. Creation
generates an initial slug from submitted display text.

Claimed owners may edit normal profile fields after a claim attaches authority to the existing profile record. This baseline assumes claimed owners can edit identity, presentation, slug, tags, and type-specific profile fields, subject to future field-level visibility and abuse controls.

Moderators may override profile fields later for safety, corrections, and abuse handling. The moderation UI and detailed audit model are deferred.

## Ownership Records

`profileOwners` records are the durable owner authority link between VRDex `users` and `profiles`. `users` is VRDex's own table, keyed to Clerk by `clerkUserId`.

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

Current claim-level actions require a signed-in user whose Clerk token asserts a verified email address. The check reads the token claim rather than the mirrored `emailVerificationTime` column — see [`auth-sessions.md`](./auth-sessions.md).

Locked decision: claiming a suitable existing unclaimed profile attaches ownership to that existing profile record and preserves its `_id`, slug, source history, and related references.

Current recommendation: the no-match creation path is explicit. `profileClaims:createClaimedDiscordPersonProfile` and `profileClaims:createClaimedDiscordCommunityProfile` require the caller to confirm that no suitable unclaimed match exists before a new self-created profile is written.

- Discord person claims require a linked Discord provider account and grant `claimed_unverified` owner control for an existing person profile.
- Discord person no-match creation requires a linked Discord provider account, creates a `creationSource: "self"` person profile, records an approved `discord_person` claim request, and grants `claimed_unverified` owner control.
- Discord community claims run through a purpose-scoped OAuth round-trip (`identify guilds`) in `discordVerification`, not through a bot token. `startGuildVerification` sends the user to Discord, `completeGuildVerification` reads every guild the token can see and records an `externalControlProofs` row for each guild the user owns or holds Administrator or Manage Server in, then revokes the token. `profileConnections:claimCommunityWithVerifiedGuild` grants owner control against one of those proofs. It grants `claimed_verified` only when the guild already backs the listing through an association somebody other than the claimant recorded; otherwise ownership is granted at `claimed_unverified`, because controlling a server is not evidence that the server is this listing's. The bot-token path (`profileClaims:verifyDiscordCommunityAdminClaim`) remains for the legacy `discord_community_admin` request flow.
- Discord community no-match creation requires a linked Discord provider account, creates a `creationSource: "self"` community profile, records an approved `discord_community` claim request, and grants `claimed_unverified` owner control.
- Current recommendation: OAuth guild verification is the stronger server-authority path. A linked-account-only community creation is owner-controlled but not `claimed_verified` unless a later guild-control, VRChat group, manual, or equivalent stronger verification flow succeeds. VRCLinking is not among them: it attests a person's VRChat identity, so `startVrchatProof` accepts `targetType: "vrclinking"` only for a person profile.
- The same rule governs VRChat proofs and the legacy bot-token path: proving control of the target grants ownership, and `claimed_verified` additionally requires a pre-existing association recorded by somebody else. `profileConnections:recordOperatorAssociation` is that writer — an internal mutation run with the deployment key, deliberately with no self-service surface.
- VRChat user proof requires a person profile and creates a proof-code attempt with `targetType: "vrchat_user"`.
- VRChat group proof requires a community profile and creates a proof-code attempt with `targetType: "vrchat_group"`.
- VRCLinking uses the same attempt table with `targetType: "vrclinking"`, but answers from a community's delegated API key rather than from a posted proof code. Person profiles only: it attests that a Discord identity is linked to a claimed VRChat account, and records a `vrchat_user` asset. The delegated key belongs to a community; the claim it supports does not.
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
