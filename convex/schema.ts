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

const sourceType = v.union(
  v.literal("owner"),
  v.literal("community"),
  v.literal("partner"),
  v.literal("moderator"),
  v.literal("import"),
);

const profileType = v.union(v.literal("person"), v.literal("community"));

const worldVisibilityStatus = v.union(
  v.literal("unknown"),
  v.literal("private"),
  v.literal("community_labs"),
  v.literal("public"),
);

const platformCompatibility = v.union(v.literal("pc"), v.literal("android"), v.literal("ios"));

const worldCreatorRole = v.union(
  v.literal("world_author"),
  v.literal("builder"),
  v.literal("venue_operator"),
  v.literal("community_operator"),
  v.literal("media_credit"),
  v.literal("storefront_owner"),
);

const worldLinkType = v.union(
  v.literal("vrchat_world"),
  v.literal("website"),
  v.literal("gumroad"),
  v.literal("jinxxy"),
  v.literal("payhip"),
  v.literal("woocommerce"),
  v.literal("kofi"),
  v.literal("patreon"),
  v.literal("commissions"),
  v.literal("generic_store"),
  v.literal("other"),
);

const profileLinkType = v.union(
  v.literal("website"),
  v.literal("gumroad"),
  v.literal("jinxxy"),
  v.literal("payhip"),
  v.literal("woocommerce"),
  v.literal("kofi"),
  v.literal("patreon"),
  v.literal("commissions"),
  v.literal("generic_store"),
  v.literal("other"),
);

const linkSource = v.union(
  v.literal("owner_authored"),
  v.literal("reviewed"),
  v.literal("partner_provided"),
);

const eventSourceType = v.union(
  v.literal("manual"),
  v.literal("community"),
  v.literal("partner"),
  v.literal("import"),
  v.literal("ai_suggested"),
);

const eventWorldConfirmationState = v.union(
  v.literal("unconfirmed"),
  v.literal("confirmed"),
  v.literal("disputed"),
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
  outboundLinks: v.optional(
    v.array(
      v.object({
        type: profileLinkType,
        label: v.string(),
        url: v.string(),
        source: linkSource,
      }),
    ),
  ),
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
  worlds: defineTable({
    slug: v.string(),
    displayName: v.string(),
    sortName: v.string(),
    tags: v.array(v.string()),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    vrchatWorldId: v.optional(v.string()),
    canonicalVrchatWorldUrl: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    visibilityStatus: worldVisibilityStatus,
    platformCompatibility: v.array(platformCompatibility),
    heroImageUrl: v.optional(v.string()),
    media: v.array(
      v.object({
        kind: v.union(v.literal("image"), v.literal("video"), v.literal("link")),
        url: v.string(),
        label: v.optional(v.string()),
        credit: v.optional(v.string()),
      }),
    ),
    creatorAttributions: v.array(
      v.object({
        role: worldCreatorRole,
        displayName: v.string(),
        profileId: v.optional(v.id("profiles")),
        profileSlug: v.optional(v.string()),
        profileType: v.optional(v.union(v.literal("person"), v.literal("community"))),
        sourceLabel: v.optional(v.string()),
      }),
    ),
    outboundLinks: v.array(
      v.object({
        type: worldLinkType,
        label: v.string(),
        url: v.string(),
        source: linkSource,
      }),
    ),
    publicationState,
    creationSource,
    sourceAttribution: v.optional(
      v.object({
        sourceType,
        label: v.string(),
        url: v.optional(v.string()),
        submittedAt: v.optional(v.number()),
        confirmedAt: v.optional(v.number()),
      }),
    ),
    publishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_vrchatWorldId", ["vrchatWorldId"])
    .index("by_publicationState_sortName", ["publicationState", "sortName"]),
  events: defineTable({
    title: v.string(),
    sortTitle: v.string(),
    startAt: v.number(),
    endAt: v.optional(v.number()),
    timezone: v.optional(v.string()),
    communityProfileId: v.optional(v.id("profiles")),
    communityName: v.optional(v.string()),
    summary: v.optional(v.string()),
    sourceType: eventSourceType,
    sourceLabel: v.string(),
    sourceUrl: v.optional(v.string()),
    publicationState,
    updatedAt: v.number(),
  })
    .index("by_publicationState_startAt", ["publicationState", "startAt"])
    .index("by_communityProfileId_startAt", ["communityProfileId", "startAt"]),
  eventWorlds: defineTable({
    eventId: v.id("events"),
    worldId: v.id("worlds"),
    eventStartAt: v.number(),
    sourceType: eventSourceType,
    confidence: v.number(),
    confirmationState: eventWorldConfirmationState,
    confirmedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_worldId", ["worldId"])
    .index("by_eventId", ["eventId"])
    .index("by_worldId_confirmationState", ["worldId", "confirmationState"])
    .index("by_worldId_confirmationState_eventStartAt", [
      "worldId",
      "confirmationState",
      "eventStartAt",
    ]),
  worldProfileCredits: defineTable({
    worldId: v.id("worlds"),
    profileSlug: v.string(),
    profileType,
    role: worldCreatorRole,
    sourceLabel: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_profileType_profileSlug", ["profileType", "profileSlug"])
    .index("by_worldId", ["worldId"]),
});
