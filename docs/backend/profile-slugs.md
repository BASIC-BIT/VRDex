# Profile Slugs

## Status Note

This doc captures the slug contract for `#10`.

Profiles, worlds, and events share one global slug namespace and all render from the site root as `/<slug>`. This avoids ambiguous API, card, and search lookups, and it is what makes a bare `vrdex.net/basicbit` resolvable without a type prefix.

Because a slug can be shadowed by a real page route, every top-level route name is held in `RESERVED_ROUTE_SLUGS` in `convex/_globalSlugs.ts` and can never be assigned. `tests/web/reserved-route-slugs.test.ts` fails when a new top-level route lands without a matching reservation. `RESERVED_PREMIUM_SLUGS` holds short, generic names back from self-serve so they can be granted or sold later.

## Rules

- slugs are lowercase ASCII only
- allowed characters are `a-z`, `0-9`, and `-`
- length must be 3 to 64 characters
- leading hyphens are invalid
- trailing hyphens are invalid
- consecutive hyphens are invalid
- reserved slugs are invalid
- canonical slugs are independent from Discord, VRChat, Google, email, or any other login identifier

## Reserved Slugs

The reserved list lives in `convex/_profileSlugs.ts` and protects current plus likely future public routes, including app routes, auth routes, profile collection routes, API surfaces, account/settings routes, and support/legal pages.

## Generation

Initial slug generation starts from a display name or owner-provided text:

1. normalize to lowercase ASCII
2. strip combining marks
3. convert non-alphanumeric runs to hyphens
4. trim leading/trailing hyphens
5. collapse repeated hyphens
6. append and revalidate a safe suffix when the base would be too short or reserved
7. trim and revalidate overlong bases
8. append numeric suffixes such as `-2`, `-3`, and later attempts when a slug is already taken

## Uniqueness

Convex does not enforce unique indexes at the schema layer. Profile slug uniqueness is enforced by mutations using the `by_slug` index before insert or update.

`profiles:submitCommunityProfile` now creates initial public slugs for authenticated community submissions. Mutations that create or update profiles must:

- normalize and validate the candidate slug
- reject invalid or reserved slugs
- query `by_slug` to reject collisions outside the current profile
- patch `updatedAt` with the slug write

## Out of Scope

- slug history and redirects
- custom domains
- SEO metadata
- public pages and API routes that consume slugs
