import { v } from "convex/values";

import { query } from "./_generated/server";
import { getHiddenWorldAttributionProfileKeys } from "./_searchDocuments";
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

    const hiddenProfileKeys = await getHiddenWorldAttributionProfileKeys(ctx.db, world);

    return {
      ...toPublicWorld(world, { hiddenProfileKeys }),
      eventContext: await getPublicWorldEventContext(ctx.db, world._id, args.now),
    };
  },
});

export const getPublicEventsBySlug = query({
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

    return await getPublicWorldEventContext(ctx.db, world._id, args.now);
  },
});

export const listHomeActiveWorlds = query({
  args: {
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => getPublicActiveWorlds(ctx.db, args.now, args.limit ?? 3),
});
