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

const publicSurfacingState = v.union(
  v.literal("public"),
  v.literal("opted_out"),
  v.literal("suppressed"),
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

const discoverySourceType = v.union(
  v.literal("owner"),
  v.literal("community"),
  v.literal("partner"),
  v.literal("moderator"),
  v.literal("import"),
  v.literal("manual"),
  v.literal("ai_suggested"),
);

const eventMediaLinkType = v.union(
  v.literal("event_page"),
  v.literal("watch"),
  v.literal("stream"),
  v.literal("vrcdn"),
  v.literal("discord"),
  v.literal("ticket"),
  v.literal("other"),
);

const eventMediaLinkPresentation = v.union(v.literal("open"), v.literal("copy"));

const eventWorldConfirmationState = v.union(
  v.literal("unconfirmed"),
  v.literal("confirmed"),
  v.literal("disputed"),
);

const eventParticipantConfirmationState = v.union(
  v.literal("unconfirmed"),
  v.literal("confirmed"),
  v.literal("disputed"),
);

const communityCapability = v.union(
  v.literal("manage_profile"),
  v.literal("manage_events"),
  v.literal("manage_staff"),
  v.literal("manage_integrations"),
  v.literal("manage_billing"),
);

const communityAuthorityState = v.union(v.literal("active"), v.literal("revoked"));

const suppressionRequestType = v.union(
  v.literal("owner_opt_out"),
  v.literal("pre_claim_safety"),
);

const suppressionRequestState = v.union(
  v.literal("submitted"),
  v.literal("under_review"),
  v.literal("accepted"),
  v.literal("rejected"),
);

const vocabularyScope = v.union(
  v.literal("profile_tag"),
  v.literal("person_role"),
  v.literal("community_category"),
  v.literal("community_subtype"),
  v.literal("event_participant_role"),
  v.literal("event_tag"),
  v.literal("world_tag"),
  v.literal("world_creator_role"),
  v.literal("discovery_facet"),
);

const vocabularySource = v.union(
  v.literal("seeded"),
  v.literal("user_created"),
  v.literal("reviewed"),
  v.literal("imported"),
);

const searchEntityType = v.union(
  v.literal("profile"),
  v.literal("world"),
  v.literal("event"),
);

const searchPublicState = v.union(v.literal("public"), v.literal("hidden"));

const featuredPlacementSlot = v.union(
  v.literal("home_hero"),
  v.literal("home_event_wall"),
  v.literal("discover_hero"),
  v.literal("discover_rail"),
);

const featuredPlacementState = v.union(v.literal("active"), v.literal("inactive"));

const authSubject = v.object({
  tokenIdentifier: v.string(),
  issuer: v.string(),
  subject: v.string(),
  displayName: v.optional(v.string()),
});

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
  publicSurfacingState,
  publicSurfacingUpdatedAt: v.optional(v.number()),
  publicSurfacingReason: v.optional(v.string()),
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
    .index("by_publicSurfacingState_publicationState", [
      "publicSurfacingState",
      "publicationState",
    ])
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
    slug: v.optional(v.string()),
    title: v.string(),
    sortTitle: v.string(),
    startAt: v.number(),
    endAt: v.optional(v.number()),
    timezone: v.optional(v.string()),
    communityProfileId: v.optional(v.id("profiles")),
    communityName: v.optional(v.string()),
    summary: v.optional(v.string()),
    notes: v.optional(v.string()),
    posterImageUrl: v.optional(v.string()),
    mediaLinks: v.optional(
      v.array(
        v.object({
          type: eventMediaLinkType,
          label: v.string(),
          url: v.string(),
          presentation: eventMediaLinkPresentation,
        }),
      ),
    ),
    sourceType: eventSourceType,
    sourceLabel: v.string(),
    sourceUrl: v.optional(v.string()),
    submitter: v.optional(authSubject),
    publicationState,
    publishedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
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
  eventParticipants: defineTable({
    eventId: v.id("events"),
    personProfileId: v.id("profiles"),
    eventStartAt: v.number(),
    roleLabel: v.string(),
    sourceType: eventSourceType,
    sourceLabel: v.string(),
    sourceUrl: v.optional(v.string()),
    confirmationState: eventParticipantConfirmationState,
    confirmedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_personProfileId_confirmationState_eventStartAt", [
      "personProfileId",
      "confirmationState",
      "eventStartAt",
    ]),
  communityAuthorities: defineTable({
    communityProfileId: v.id("profiles"),
    subjectTokenIdentifier: v.string(),
    subject: authSubject,
    roleKey: v.string(),
    roleLabel: v.string(),
    capabilities: v.array(communityCapability),
    state: communityAuthorityState,
    grantedAt: v.number(),
    revokedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_communityProfileId_state", ["communityProfileId", "state"])
    .index("by_subjectTokenIdentifier_state", ["subjectTokenIdentifier", "state"])
    .index("by_subjectTokenIdentifier_state_communityProfileId", [
      "subjectTokenIdentifier",
      "state",
      "communityProfileId",
    ]),
  profileSuppressionRequests: defineTable({
    profileId: v.optional(v.id("profiles")),
    profileSlug: v.optional(v.string()),
    profileType: v.optional(profileType),
    displayName: v.optional(v.string()),
    requestType: suppressionRequestType,
    state: suppressionRequestState,
    requester: v.optional(authSubject),
    requesterContact: v.optional(v.string()),
    requesterNote: v.optional(v.string()),
    resolutionNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_state_createdAt", ["state", "createdAt"])
    .index("by_profileId_state", ["profileId", "state"])
    .index("by_profileSlug_state", ["profileSlug", "state"]),
  profileAuditEvents: defineTable({
    profileId: v.id("profiles"),
    action: v.string(),
    actor: v.optional(authSubject),
    sourceType,
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_profileId_createdAt", ["profileId", "createdAt"])
    .index("by_action_createdAt", ["action", "createdAt"]),
  vocabularyTerms: defineTable({
    scope: vocabularyScope,
    key: v.string(),
    label: v.string(),
    aliases: v.array(v.string()),
    source: vocabularySource,
    usageCount: v.number(),
    rank: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_scope_key", ["scope", "key"])
    .index("by_scope_rank", ["scope", "rank"])
    .searchIndex("search_label", {
      searchField: "label",
      filterFields: ["scope"],
    }),
  searchDocuments: defineTable({
    entityType: searchEntityType,
    publicState: searchPublicState,
    profileId: v.optional(v.id("profiles")),
    worldId: v.optional(v.id("worlds")),
    eventId: v.optional(v.id("events")),
    profileType: v.optional(profileType),
    slug: v.string(),
    routePath: v.string(),
    title: v.string(),
    subtitle: v.optional(v.string()),
    summary: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    searchText: v.string(),
    exactTokens: v.array(v.string()),
    vocabularyKeys: v.array(v.string()),
    trustRank: v.number(),
    freshnessAt: v.optional(v.number()),
    featuredRank: v.number(),
    sourceType: v.optional(discoverySourceType),
    sourceLabel: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_entityType_slug", ["entityType", "slug"])
    .index("by_profileId", ["profileId"])
    .index("by_worldId", ["worldId"])
    .index("by_eventId", ["eventId"])
    .index("by_publicState_entityType_featuredRank", [
      "publicState",
      "entityType",
      "featuredRank",
    ])
    .index("by_publicState_startsAt", ["publicState", "startsAt"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["publicState", "entityType"],
    }),
  searchEmbeddings: defineTable({
    searchDocumentId: v.id("searchDocuments"),
    entityType: searchEntityType,
    publicState: searchPublicState,
    embedding: v.array(v.float64()),
    model: v.string(),
    dimensions: v.number(),
    updatedAt: v.number(),
  })
    .index("by_searchDocumentId", ["searchDocumentId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["publicState", "entityType"],
    }),
  featuredPlacements: defineTable({
    slot: featuredPlacementSlot,
    state: featuredPlacementState,
    targetEntityType: searchEntityType,
    targetProfileId: v.optional(v.id("profiles")),
    targetWorldId: v.optional(v.id("worlds")),
    targetEventId: v.optional(v.id("events")),
    label: v.string(),
    reason: v.string(),
    weight: v.number(),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    sourceType: discoverySourceType,
    sourceLabel: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slot_state_weight", ["slot", "state", "weight"])
    .index("by_state_startsAt", ["state", "startsAt"]),
});
