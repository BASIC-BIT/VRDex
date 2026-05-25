import { v } from "convex/values";

import { query } from "./_generated/server";
import { getPublicActiveWorlds, getPublicWorldEventContext } from "./_worldEvents";
import { toPublicWorld } from "./_worldPublic";
import { getWorldBySlug, validateWorldSlug } from "./_worldSlugs";

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

    return {
      ...toPublicWorld(world),
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
