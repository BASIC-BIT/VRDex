import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const profileType = v.union(v.literal("person"), v.literal("community"));

const claimState = v.union(
  v.literal("unclaimed"),
  v.literal("claimed_unverified"),
  v.literal("claimed_verified"),
);

const publicationState = v.union(
  v.literal("draft_private"),
  v.literal("published"),
);

const creationSource = v.union(
  v.literal("self"),
  v.literal("community"),
  v.literal("concierge"),
  v.literal("import"),
  v.literal("moderator"),
);

export default defineSchema({
  profiles: defineTable({
    profileType,
    displayName: v.string(),
    sortName: v.string(),
    aliases: v.array(v.string()),
    headline: v.optional(v.string()),
    bio: v.optional(v.string()),
    region: v.optional(v.string()),
    timezone: v.optional(v.string()),
    claimState,
    publicationState,
    creationSource,
    // Mutations must set claimedAt/publishedAt with state transitions
    // and patch updatedAt on every profile write.
    claimedAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_profileType_publicationState", ["profileType", "publicationState"])
    .index("by_publicationState_claimState", ["publicationState", "claimState"])
    .index("by_claimState_profileType", ["claimState", "profileType"])
    .index("by_creationSource_claimState", ["creationSource", "claimState"])
    .index("by_profileType_sortName", ["profileType", "sortName"]),
});
