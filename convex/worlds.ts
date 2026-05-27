import { v } from "convex/values";

import { query, type QueryCtx } from "./_generated/server";
import { canReadProfile } from "./_profilePermissions";
import { getProfileBySlug } from "./_profileSlugs";
import { getPublicActiveWorlds, getPublicWorldEventContext } from "./_worldEvents";
import { toPublicWorld } from "./_worldPublic";
import { getWorldBySlug, validateWorldSlug } from "./_worldSlugs";

async function getHiddenProfileKeys(ctx: QueryCtx, world: Awaited<ReturnType<typeof getWorldBySlug>>) {
  const keys = new Set<string>();

  if (world === null) {
    return keys;
  }

  await Promise.all(
    world.creatorAttributions.map(async (attribution) => {
      if (!attribution.profileSlug || !attribution.profileType) {
        return;
      }

      const profile = await getProfileBySlug(ctx.db, attribution.profileSlug);
      if (profile === null || !canReadProfile("public", profile)) {
        keys.add(`${attribution.profileType}:${attribution.profileSlug}`);
      }
    }),
  );

  return keys;
}

export const getPublicBySlug = query({
  args: {
    slug: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const validation = validateWorldSlug(args.slug);

    if (!validation.ok) {
      return null;
    }

    const world = await getWorldBySlug(ctx.db, validation.slug);

    if (world === null || world.publicationState !== "published") {
      return null;
    }

    const hiddenProfileKeys = await getHiddenProfileKeys(ctx, world);

    return {
      ...toPublicWorld(world, { hiddenProfileKeys }),
      eventContext: await getPublicWorldEventContext(ctx.db, world._id, args.now),
    };
  },
});

export const listHomeActiveWorlds = query({
  args: {
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => getPublicActiveWorlds(ctx.db, args.now, args.limit ?? 3),
});
