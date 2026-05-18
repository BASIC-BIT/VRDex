import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

const sharedProfileFields = {
  slug: v.string(),
  displayName: v.string(),
  sortName: v.string(),
  aliases: v.array(v.string()),
  tags: v.array(v.string()),
  headline: v.optional(v.string()),
  bio: v.optional(v.string()),
  about: v.optional(v.string()),
  avatarImageUrl: v.optional(v.string()),
  bannerImageUrl: v.optional(v.string()),
  region: v.optional(v.string()),
  timezone: v.optional(v.string()),
  claimState,
  publicationState,
  creationSource,
  sourceAttribution: v.optional(
    v.object({
      submittedAt: v.number(),
      submitter: v.object({
        tokenIdentifier: v.string(),
        issuer: v.string(),
        subject: v.string(),
        displayName: v.optional(v.string()),
      }),
    }),
  ),
  // Mutations must set claimedAt/publishedAt with state transitions
  // and patch updatedAt on every profile write.
  claimedAt: v.optional(v.number()),
  publishedAt: v.optional(v.number()),
  updatedAt: v.number(),
};

export default defineSchema({
  profiles: defineTable(
    v.union(
      v.object({
        ...sharedProfileFields,
        profileType: v.literal("person"),
        person: v.object({
          pronouns: v.optional(v.string()),
          roleTags: v.array(v.string()),
        }),
      }),
      v.object({
        ...sharedProfileFields,
        profileType: v.literal("community"),
        community: v.object({
          subtype: v.optional(v.string()),
          categoryTags: v.array(v.string()),
        }),
      }),
    ),
  )
    .index("by_slug", ["slug"])
    .index("by_profileType_publicationState", ["profileType", "publicationState"])
    .index("by_publicationState_claimState", ["publicationState", "claimState"])
    .index("by_claimState_profileType", ["claimState", "profileType"])
    .index("by_creationSource_claimState", ["creationSource", "claimState"])
    .index("by_profileType_sortName", ["profileType", "sortName"]),
});
