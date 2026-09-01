# Profile Slugs

## Status Note

This doc captures the slug contract for `#10`.

Profiles and worlds render from the site root as `/<slug>`. Community events
render below their community as `/<community>/events/<event>`. A bare
`vrdex.net/basicbit` therefore resolves only a profile or world.

Reservations live in `convex/_globalSlugs.ts` as four catalogs, because a name can be unavailable for four different reasons and read paths care about only one of them.

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

All four live in `convex/_globalSlugs.ts`.

- `LIVE_ROUTE_SLUGS`: `/<name>` itself resolves to something other than `[slug]` -- a page, an optional catch-all, a middleware redirect, or a `beforeFiles` rewrite. An entity holding one has no reachable page. This is the only catalog a *read* path consults, via `isLiveRouteSlug`.
- `ROUTE_PREFIX_SLUGS`: a route beneath the name matches an entity subpath. Next matches whole leaf patterns rather than claiming everything below a directory, so this is narrower than it looks: `app/developers/` has no leaf at that depth and `/developers/edit` falls through to `/[slug]/edit` like any other URL, while dynamic children under `handoff` and `l` intercept nested entity-shaped paths. `events` is held because community event routes live under `/<community>/events/...`. An entity holding one keeps its public page and loses its owner-facing subpaths, which is why `slugAudit` reports these separately.
- `HELD_ROUTE_SLUGS`: nothing serves them at all. Held for pages we may add.
- `RESERVED_PREMIUM_SLUGS`: short, generic, or otherwise valuable names withheld from self-serve so they can be granted or sold later. `basicbit` and `vrdex` are here. Slugs under three characters are already unassignable, which reserves that whole space without listing it.

`isReservedSlug` unions all four and gates *assignment*. `isLiveRouteSlug` covers only the first and gates *reading*: refusing a held name when parsing a pasted URL threw away the identifier on disputes about profiles that exist, `basicbit` among them.

`tests/web/reserved-route-slugs.test.ts` walks the app directory, traverses route groups, reads the configured rewrites, and checks both directions, so neither a new route nor a deleted one can drift from the catalog.

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

Convex does not enforce unique indexes at the schema layer. Slug uniqueness is
enforced by mutations before insert or update. Profiles and worlds share the
root slug namespace. Community event codes use a separate namespace beneath
each community route.

Use `findSlugOwner` from `convex/_globalSlugs.ts`, or the `check*SlugAvailability` helper for the entity being written, which calls it. A single `by_slug` query sees one third of the namespace. Convex mutations are transactional across tables, so a check followed by an insert in the same mutation cannot race.

`profiles:submitCommunityProfile` now creates initial public slugs for authenticated community submissions. Mutations that create or update profiles must:

- normalize and validate the candidate slug
- reject invalid or reserved slugs
- reject collisions across profiles and worlds, excluding the row being updated
- patch `updatedAt` with the slug write

## Out of Scope

- slug history and redirects
- custom domains
- SEO metadata
- public pages and API routes that consume slugs
