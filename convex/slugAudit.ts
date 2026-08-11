import { internalQuery } from "./_generated/server";
import { LIVE_ROUTE_SLUGS, isLiveRouteSlug } from "./_globalSlugs";

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

    type Holder = { kind: string; id: string; slug: string; displayName: string };

    const holders: Holder[] = [
      ...profiles.map((profile) => ({
        kind: profile.profileType,
        id: profile._id as string,
        slug: profile.slug,
        displayName: profile.displayName,
      })),
      ...worlds.map((world) => ({
        kind: "world",
        id: world._id as string,
        slug: world.slug,
        displayName: world.displayName,
      })),
      // Events carry an optional slug, and one without a slug has no public page to
      // collide over.
      ...events.flatMap((event) =>
        event.slug === undefined
          ? []
          : [{ kind: "event", id: event._id as string, slug: event.slug, displayName: event.title }],
      ),
    ];

    const bySlug = new Map<string, Holder[]>();
    for (const holder of holders) {
      bySlug.set(holder.slug, [...(bySlug.get(holder.slug) ?? []), holder]);
    }

    // Two entities holding one name. The root route resolves profile, then world,
    // then event, so everything after the first is unreachable: its canonical
    // links, its search results, and its short links all render the winner's page.
    const duplicates = [...bySlug.entries()]
      .filter(([, held]) => held.length > 1)
      .map(([slug, held]) => ({ slug, holders: held }));

    // A real route answers here, and Next matches it before `[slug]`. The old
    // per-entity lists did not cover every route name, so a row could already hold
    // one, and the prefixed pages that used to reach it are gone.
    const shadowedByRoute = holders.filter((holder) => isLiveRouteSlug(holder.slug));

    return {
      checked: { profiles: profiles.length, worlds: worlds.length, events: events.length },
      liveRouteCount: LIVE_ROUTE_SLUGS.length,
      duplicates,
      shadowedByRoute,
    };
  },
});
