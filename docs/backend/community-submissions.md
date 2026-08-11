# Community Submissions

## Status Note

This doc captures the first community-submitted profile flow for `#23`, plus the presentation-field boundary needed by `#22`, `#19`, and `#21`.

## Locked Decisions

- ordinary community submissions require a signed-in Convex identity before any profile write
- submitted records are normal `profiles` rows, not a separate staging object type
- submitted records are created as `creationSource: "community"`, `claimState: "unclaimed"`, and `publicationState: "published"`
- profile slugs are generated server-side from the submitted display name
- submitters cannot provide custom slugs, claim state, publication state, owner fields, freeform bios, about sections, image URLs, private contact details, or trust labels
- source attribution is stored inline for later moderation and display decisions without creating an account table yet
- community-submitted records start with `publicSurfacingState: "public"` unless later opt-out or moderation suppression changes that state

## Public Routes

- `/submit`: first community-facing submission form
- `/support`: contact, dispute, transfer, recovery, opt-out, and safety-review intake
- `/<slug>`: public person or community profile page

The `/submit` route is protected by the middleware and redirects a signed-out visitor to `/sign-in`. Clerk authenticates the browser and the backend mutation stays auth-gated, writing only for callers Convex resolves to a `users` row.

The root route reads through `profiles:getPublicBySlug`, requires `publicationState: "published"` plus `publicSurfacingState: "public"`, and returns a public projection that omits source-attribution identifiers. It passes no `profileType`: with one route serving both kinds there is no route-claimed type left to check the record against, so the stored `profileType` decides what renders.

Public source display is sanitized to labels such as `Community submitted` and submitted date. Submitter token identifiers, issuer, subject, and display name are not exposed publicly in this slice.

### The `/support` intake

Unlike `/submit`, this route is deliberately open to signed-out visitors.
Recovery is "I lost access to the account that holds my profile", so requiring a
session would exclude the case that needs it most. A session is attached to the
request when one exists.

One selector, two destinations, because the two halves have different
consequences:

- `owner_opt_out` and `pre_claim_safety` call `suppressions:requestProfileSuppression` and write `profileSuppressionRequests`. Accepting one of those retracts matching profiles from discovery through a scheduled job.
- `ownership_dispute`, `transfer`, `recovery`, and `feedback` call `supportRequests:submitSupportRequest` and write `supportRequests`, which has no automation behind it at all.

They are kept apart so a feedback row can never be one operator action away from
opting a profile out.

Both mutations resolve the profile field through `readProfileSlugFromInput`, so
a pasted profile link works on every topic. Text that names no profile is
refused rather than dropped: discarding the only identifier on a dispute without
saying so is how one arrives unactionable.

`supportRequests` carries no lifecycle state. The hourly digest
(`supportRequestDigest:sendSupportDigest`, see
[`ses-auth-email.md`](../deployment/ses-auth-email.md)) is the read path and the
operator mailbox is the workflow. `notifiedAt` unset means "not yet mailed", and
the digest sends before it stamps, so a failure between the two costs a
duplicate email rather than a lost request.

## Allowed Submission Fields

Shared fields:

- `displayName`
- `aliases`
- `tags`
- `outboundLinks`, stamped `source: "community_submitted"` rather than owner-authored, because the submitter is adding somebody else's profile

Person-specific fields:

- `person.roleTags`, collected as checkboxes over a fixed vocabulary with a
  freeform field beside it for anything outside the list. Selecting a streaming
  role reveals dedicated stream and Twitch inputs, which fold into
  `outboundLinks` rather than being separate fields. A VRCDN URL of any shape,
  including the operator panel preview URL people are handed, canonicalizes to
  `vrcdn:<streamId>`. VRCDN publishes no page for a stream, so the identifier
  is what gets stored and each surface derives the endpoint it needs from it.

Community-specific fields:

- `community.subtype`
- `community.categoryTags`

## Presentation Fields

The schema supports these owner-authored presentation fields for public pages:

- `headline`
- `bio`
- `about`
- `avatarImageUrl`
- `bannerImageUrl`

Ordinary community submissions do not set those fields in this slice. Owner, concierge, moderation, import, or claim flows can populate them only with stricter validation and audit behavior.

Editing an existing unclaimed profile is a wider set than creating one, and the
rule there is information about the person versus the record itself — see
[Profile Access And Claims](./profile-access-and-claims.md#edit-baseline).
Headline, bio, region and timezone are information about the person and are
editable there; appearance choices and the slug are not. `timezone` and the
focus items carry one extra condition, because the profile page does not render
them in every state and editing a field means being shown its current value
first — the same section says which. Media is not editable by the community
either, for want of an upload path rather than by the rule.

## Implementation Boundaries

- `#25` should make community-submitted and unverified labels consistent across cards and pages
- `#26` expands attribution into a first rollback-capable moderation trail
- `#29` adds pre-claim suppression workflow state
- `#30` enforces accepted opt-out and suppression state across public surfaces
- `#31` and `#33` add search and browse surfaces over published, publicly surfacing profiles

See also:

- `docs/backend/search-discovery.md`
- `docs/backend/vocabulary-model.md`
