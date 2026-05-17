# Profile Access And Claims

## Status Note

This doc captures the permission and claim-state baseline for `#12` and `#13`.

It intentionally does not add auth, account records, public write mutations, OAuth claim flows, VRChat proof-code verification, moderation UI, role delegation, or ownership transfer.

## Read Baseline

- public users can read `published` profiles
- `draft_private` profiles are not public
- claimed owners can read their own profiles regardless of publication state once ownership is modeled
- moderators can read profiles regardless of publication state once moderator authority exists

## Edit Baseline

Ordinary public users cannot edit profiles.

Community submitters may populate only a narrow safe field set for unclaimed profiles once submission flows exist:

- `displayName`
- `aliases`
- `tags`
- `person` type-specific fields
- `community` type-specific fields

Community submitters must not set fields that imply verified authority, private contact details, billing state, ownership, custom slugs, or sensitive visibility choices. Profile creation can still generate an initial slug from submitted display text.

Claimed owners may edit normal profile fields after a claim attaches authority to the existing profile record. This baseline assumes claimed owners can edit identity, presentation, slug, tags, and type-specific profile fields, subject to future field-level visibility and abuse controls.

Moderators may override profile fields later for safety, corrections, and abuse handling. The moderation UI and detailed audit model are deferred.

## Claim States

`claimState` describes owner authority:

- `unclaimed`: no owner authority is attached yet
- `claimed_unverified`: a claimant controls the profile, but stronger verification is not complete
- `claimed_verified`: owner control and stronger verification are both established

Claim transitions preserve the same profile record and slug. Claiming a profile should not create a duplicate identity record.

Allowed ordinary transitions:

- `unclaimed` -> `claimed_unverified`
- `unclaimed` -> `claimed_verified`
- `claimed_unverified` -> `claimed_verified`

Downgrades, contested claims, transfer flows, and suppression flows require explicit moderation or ownership workflows later.

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
- set `claimedAt` when `claimState` leaves `"unclaimed"`
- preserve the profile `_id` and slug when authority changes
- patch `updatedAt` on every profile write
