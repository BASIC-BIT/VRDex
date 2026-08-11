# Profile Slugs

## Status Note

This doc captures the slug contract for `#10`.

Profiles, worlds, and events share one global slug namespace and all render from the site root as `/<slug>`. This avoids ambiguous API, card, and search lookups, and it is what makes a bare `vrdex.net/basicbit` resolvable without a type prefix.

Reservations live in `convex/_globalSlugs.ts` as three catalogs, because a name can be unavailable for three different reasons and read paths care about only one of them.

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

All three live in `convex/_globalSlugs.ts`.

- `LIVE_ROUTE_SLUGS`: a route answers here today, including prefixes installed by `next.config.ts` rewrites rather than by a directory. Next matches these before `[slug]`, so an entity holding one has no reachable page. This is the only catalog a *read* path consults, via `isLiveRouteSlug`.
- `FUTURE_ROUTE_SLUGS`: held for pages we may add. Unassignable, but nothing shadows them, so a link to one still names whoever holds it.
- `RESERVED_PREMIUM_SLUGS`: short, generic, or otherwise valuable names withheld from self-serve so they can be granted or sold later. `basicbit` and `vrdex` are here. Slugs under three characters are already unassignable, which reserves that whole space without listing it.

`isReservedSlug` unions all three and gates *assignment*. `isLiveRouteSlug` covers only the first and gates *reading*: refusing a held name when parsing a pasted URL threw away the identifier on disputes about profiles that exist, `basicbit` among them.

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

Convex does not enforce unique indexes at the schema layer. Slug uniqueness is enforced by mutations before insert or update, and it spans all three root-routed tables: a name a world or event holds is taken for a profile too, because only one of them could answer `/<slug>`.

Use `findSlugOwner` from `convex/_globalSlugs.ts`, or the `check*SlugAvailability` helper for the entity being written, which calls it. A single `by_slug` query sees one third of the namespace. Convex mutations are transactional across tables, so a check followed by an insert in the same mutation cannot race.

`profiles:submitCommunityProfile` now creates initial public slugs for authenticated community submissions. Mutations that create or update profiles must:

- normalize and validate the candidate slug
- reject invalid or reserved slugs
- reject collisions across profiles, worlds, and events, excluding the row being updated
- patch `updatedAt` with the slug write

## Out of Scope

- slug history and redirects
- custom domains
- SEO metadata
- public pages and API routes that consume slugs
