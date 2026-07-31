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
- `/p/<slug>`: public person profile page
- `/c/<slug>`: public community profile page

The `/submit` route is protected by the middleware and redirects a signed-out visitor to `/sign-in`. Clerk authenticates the browser and the backend mutation stays auth-gated, writing only for callers Convex resolves to a `users` row.

Both public profile routes read through `profiles:getPublicBySlug`, require `publicationState: "published"` plus `publicSurfacingState: "public"`, verify the requested route type matches the stored `profileType`, and return a public projection that omits source-attribution identifiers.

Public source display is sanitized to labels such as `Community submitted` and submitted date. Submitter token identifiers, issuer, subject, and display name are not exposed publicly in this slice.

## Allowed Submission Fields

Shared fields:

- `displayName`
- `aliases`
- `tags`

Person-specific fields:

- `person.roleTags`

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

## Implementation Boundaries

- `#25` should make community-submitted and unverified labels consistent across cards and pages
- `#26` expands attribution into a first rollback-capable moderation trail
- `#29` adds pre-claim suppression workflow state
- `#30` enforces accepted opt-out and suppression state across public surfaces
- `#31` and `#33` add search and browse surfaces over published, publicly surfacing profiles

See also:

- `docs/backend/search-discovery.md`
- `docs/backend/vocabulary-model.md`
