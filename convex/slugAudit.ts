import { internalQuery } from "./_generated/server";
import {
  LIVE_ROUTE_SLUGS,
  isLiveRouteSlug,
  routePrefixSubpaths,
  type EntitySubpath,
} from "./_globalSlugs";

/** The subpaths under `/<slug>` that this kind of entity uses. */
function entitySubpathsFor(kind: string): readonly EntitySubpath[] {
  if (kind === "event") {
    return ["calendar.ics", "opengraph-image"];
  }

  return kind === "world" ? ["opengraph-image"] : ["edit", "opengraph-image"];
}

/**
 * Slugs that stopped being reachable, or stopped being unique, when profiles,
 * worlds, and events moved to the site root.
 *
 * Read-only, and deliberately not a migration. Both failures need a human to pick
 * the winner: which of two entities keeps a name, and what an entity squatting a
 * route name should be called instead. A script that guessed would rename
 * somebody's public page out from under them.
 *
 * Uniqueness is enforced going forward by `check*SlugAvailability`, and the
 * reservation catalogs stop new writes from taking a route name. Neither touches
 * rows that already exist, which is exactly what this reports.
 *
 * ponytail: full table scans, because there is no index for "the same slug in a
 * different table" and this runs once per deployment by hand. If the tables outgrow
 * a single transaction's read limit, page it by `_creationTime`.
 */
export const conflicts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [profiles, worlds, events] = await Promise.all([
      ctx.db.query("profiles").collect(),
      ctx.db.query("worlds").collect(),
      ctx.db.query("events").collect(),
    ]);

    type Holder = {
      kind: string;
      id: string;
      slug: string;
      displayName: string;
      /**
       * Reported instead of a winner.
       *
       * Table order does not decide which entity the root route serves: each
       * fetcher returns null for anything its own public projection hides, so a
       * draft-private profile colliding with a published world loses to the
       * world. Calling the profile the winner because profiles are read first
       * would point an operator at renaming the live row.
       *
       * Re-deriving those three visibility predicates here would be a fourth copy
       * to keep in sync, so the audit states what each row is and leaves the
       * choice where it already belonged.
       */
      publicationState: string;
      publicSurfacingState?: string;
    };

    const holders: Holder[] = [
      ...profiles.map((profile) => ({
        kind: profile.profileType,
        id: profile._id as string,
        slug: profile.slug,
        displayName: profile.displayName,
        publicationState: profile.publicationState,
        publicSurfacingState: profile.publicSurfacingState,
      })),
      ...worlds.map((world) => ({
        kind: "world",
        id: world._id as string,
        slug: world.slug,
        displayName: world.displayName,
        publicationState: world.publicationState,
      })),
      // Events carry an optional slug, and one without a slug has no public page to
      // collide over.
      ...events.flatMap((event) =>
        event.slug === undefined
          ? []
          : [
              {
                kind: "event",
                id: event._id as string,
                slug: event.slug,
                displayName: event.title,
                publicationState: event.publicationState,
              },
            ],
      ),
    ];

    const bySlug = new Map<string, Holder[]>();
    for (const holder of holders) {
      bySlug.set(holder.slug, [...(bySlug.get(holder.slug) ?? []), holder]);
    }

    // Two entities holding one name. Only one can answer `/<slug>`, and the other's
    // canonical links, search results, and short links all render it instead.
    // Which one wins is left to the operator: see the note on `Holder`.
    const duplicates = [...bySlug.entries()]
      .filter(([, held]) => held.length > 1)
      .map(([slug, held]) => ({ slug, holders: held }));

    // A real route answers here, and Next matches it before `[slug]`. The old
    // per-entity lists did not cover every route name, so a row could already hold
    // one, and the prefixed pages that used to reach it are gone.
    const shadowedByRoute = holders.filter((holder) => isLiveRouteSlug(holder.slug));

    // Milder, and easy to miss because the public page still works. A profile
    // slugged `handoff` renders at `/handoff`, but `/handoff/edit` is matched by
    // `app/handoff/[token]` rather than the profile editor. Calendar exports and
    // generated share images are intercepted the same way. Reported so the audit
    // cannot print "nothing to migrate" over a broken nested route.
    //
    // Matched per kind against every subpath that kind uses. Share images belong to
    // profiles, worlds, and events, while edit and calendar remain kind-specific.
    //
    // Both of today's prefixes take both subpaths, having dynamic children. Asking
    // only "is this a prefix" would still have been right for them and wrong for a
    // future static `edit` child, which takes one subpath while the audit told an
    // operator to rename an event whose export still worked.
    const nestedRoutesShadowed = holders.flatMap((holder) => {
      const intercepted = routePrefixSubpaths(holder.slug);
      const lostSubpaths = entitySubpathsFor(holder.kind).filter((subpath) =>
        intercepted.includes(subpath),
      );

      return lostSubpaths.length > 0 ? [{ ...holder, lostSubpaths }] : [];
    });

    return {
      checked: { profiles: profiles.length, worlds: worlds.length, events: events.length },
      liveRouteCount: LIVE_ROUTE_SLUGS.length,
      duplicates,
      shadowedByRoute,
      nestedRoutesShadowed,
    };
  },
});
