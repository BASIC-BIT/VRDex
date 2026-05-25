import { v } from "convex/values";

import { query } from "./_generated/server";
import { toPublicWorld } from "./_worldPublic";
import { getWorldBySlug, validateWorldSlug } from "./_worldSlugs";

export const getPublicBySlug = query({
  args: {
    slug: v.string(),
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

    return toPublicWorld(world);
  },
});
