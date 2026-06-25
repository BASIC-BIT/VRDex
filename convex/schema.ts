import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

import {
  eventMediaActorSurfaceValidator,
  eventMediaCommandStatusValidator,
  eventMediaCommandTypeValidator,
  eventMediaComplianceGateStateValidator,
  eventMediaOutputAccountModelValidator,
  eventMediaOutputStateValidator,
  eventMediaOutputTypeValidator,
  eventMediaProgramStateValidator,
  eventMediaPublicLinkValidator,
  eventMediaSceneTypeValidator,
  eventMediaSecretStorageValidator,
  eventMediaSessionStatusValidator,
  eventMediaSourcePurposeValidator,
  eventMediaSourceStateValidator,
  eventMediaSourceTypeValidator,
  eventMediaVrcdnRegionValidator,
  eventMediaWorkerArtifactLinkValidator,
  eventMediaWorkerProviderValidator,
  eventMediaWorkerTaskStatusValidator,
} from "./_eventMediaControl";

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

const fieldVisibilityState = v.union(
  v.literal("public"),
  v.literal("unlisted"),
  v.literal("private"),
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
  v.literal("vrchat_profile"),
  v.literal("vrcdn"),
  v.literal("discord"),
  v.literal("soundcloud"),
  v.literal("mixcloud"),
  v.literal("twitch"),
  v.literal("youtube"),
  v.literal("spotify"),
  v.literal("bandcamp"),
  v.literal("instagram"),
  v.literal("linktree"),
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

const profileLinkPresentation = v.union(v.literal("icon"), v.literal("copy"));

const profileGenreSource = v.union(
  v.literal("owner_selected"),
  v.literal("community_submitted"),
  v.literal("partner_import"),
  v.literal("manual_review"),
  v.literal("llm_suggested"),
);

const profileGenreConfidence = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

const profileGenre = v.object({
  slug: v.string(),
  displayName: v.string(),
  displayLabel: v.optional(v.string()),
  aliases: v.optional(v.array(v.string())),
  parentGenreSlugs: v.optional(v.array(v.string())),
  featured: v.optional(v.boolean()),
  source: profileGenreSource,
  confidence: profileGenreConfidence,
  explicit: v.boolean(),
  externalIds: v.optional(
    v.object({
      musicBrainzGenreId: v.optional(v.string()),
      wikidataQid: v.optional(v.string()),
      discogsStyleId: v.optional(v.string()),
      everyNoiseId: v.optional(v.string()),
      rateYourMusicGenreId: v.optional(v.string()),
      allMusicStyleId: v.optional(v.string()),
    }),
  ),
});

const profileAssetSource = v.union(
  v.literal("owner_authored"),
  v.literal("community_submitted"),
  v.literal("partner_provided"),
  v.literal("moderator"),
  v.literal("import"),
  v.literal("concierge"),
);

const profileAssetVisibility = v.union(
  v.literal("public"),
  v.literal("unlisted"),
  v.literal("private"),
);

const profileAssetState = v.union(v.literal("active"), v.literal("deleted"));

const profileAssetUploadIntentState = v.union(
  v.literal("pending"),
  v.literal("uploaded"),
  v.literal("consumed"),
  v.literal("expired"),
);

const profileAssetPlacement = v.union(
  v.literal("profile_image"),
  v.literal("banner"),
  v.literal("primary_logo"),
  v.literal("additional_logo"),
);

const profileAssetDisplayPreference = v.union(
  v.literal("auto"),
  v.literal("profile_image"),
  v.literal("logo"),
);

const profileAvatarAppearance = v.object({
  borderEnabled: v.boolean(),
  borderColor: v.string(),
  borderWidthPx: v.optional(v.number()),
  borderSoftnessPx: v.optional(v.number()),
  radiusPercent: v.number(),
});

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

const eventSlotReviewState = v.union(
  v.literal("draft"),
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

const profileOwnerState = v.union(v.literal("active"), v.literal("revoked"));

const profileClaimMethod = v.union(
  v.literal("discord_person"),
  v.literal("discord_community_admin"),
  v.literal("vrchat_user_proof"),
  v.literal("vrchat_group_proof"),
  v.literal("vrclinking_attestation"),
  v.literal("manual"),
);

const profileClaimRequestState = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("expired"),
);

const profileVerificationTargetType = v.union(
  v.literal("vrchat_user"),
  v.literal("vrchat_group"),
  v.literal("vrclinking"),
);

const profileVerificationAttemptState = v.union(
  v.literal("pending"),
  v.literal("verified"),
  v.literal("failed"),
  v.literal("expired"),
);

const profileVerificationEvidenceSource = v.union(
  v.literal("discord_api"),
  v.literal("vrchat_api"),
  v.literal("vrclinking"),
  v.literal("manual"),
);

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
  v.literal("profile_genre"),
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

const eventMediaOutputCredential = v.object({
  storage: eventMediaSecretStorageValidator,
  secretRef: v.string(),
  authorizedAt: v.optional(v.number()),
  authorizedBy: v.optional(authSubject),
});

const eventMediaVrcdnSetup = v.object({
  ingestRegion: v.optional(eventMediaVrcdnRegionValidator),
  targetVideoBitrateKbps: v.optional(v.number()),
  keyframeIntervalSeconds: v.optional(v.union(v.literal(1), v.literal(2))),
  audioSampleRateHz: v.optional(v.literal(48000)),
  targetAudioBitrateKbps: v.optional(v.number()),
});

const eventMediaOutputCompliance = v.object({
  sourceConsent: eventMediaComplianceGateStateValidator,
  destinationAuthority: eventMediaComplianceGateStateValidator,
  providerRules: eventMediaComplianceGateStateValidator,
  rightsClearedMedia: eventMediaComplianceGateStateValidator,
});

const fieldVisibility = v.object({
  aliases: v.optional(fieldVisibilityState),
  tags: v.optional(fieldVisibilityState),
  genres: v.optional(fieldVisibilityState),
  headline: v.optional(fieldVisibilityState),
  bio: v.optional(fieldVisibilityState),
  about: v.optional(fieldVisibilityState),
  avatarImageUrl: v.optional(fieldVisibilityState),
  bannerImageUrl: v.optional(fieldVisibilityState),
  outboundLinks: v.optional(fieldVisibilityState),
  region: v.optional(fieldVisibilityState),
  timezone: v.optional(fieldVisibilityState),
  personPronouns: v.optional(fieldVisibilityState),
  personRoleTags: v.optional(fieldVisibilityState),
  communitySubtype: v.optional(fieldVisibilityState),
  communityCategoryTags: v.optional(fieldVisibilityState),
});

const sharedProfileFields = {
  slug: v.string(),
  displayName: v.string(),
  sortName: v.string(),
  aliases: v.array(v.string()),
  searchAliases: v.optional(v.array(v.string())),
  tags: v.array(v.string()),
  genres: v.optional(v.array(profileGenre)),
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
        handle: v.optional(v.string()),
        presentation: v.optional(profileLinkPresentation),
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
  fieldVisibility: v.optional(fieldVisibility),
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
  ...authTables,
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
    .index("by_sourceSubmitterTokenIdentifier", [
      "sourceAttribution.submitter.tokenIdentifier",
    ])
    .index("by_claimState_profileType", ["claimState", "profileType"])
    .index("by_creationSource_claimState", ["creationSource", "claimState"])
    .index("by_profileType_sortName", ["profileType", "sortName"]),
  profileAssetUploadIntents: defineTable({
    uploadToken: v.string(),
    requestedBy: authSubject,
    originalFileName: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    mimeType: v.string(),
    byteSize: v.number(),
    storageKey: v.string(),
    state: profileAssetUploadIntentState,
    createdAt: v.number(),
    expiresAt: v.number(),
    uploadedAt: v.optional(v.number()),
    consumedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_uploadToken", ["uploadToken"])
    .index("by_state_expiresAt", ["state", "expiresAt"])
    .index("by_requestedBy", ["requestedBy.tokenIdentifier"]),
  profileAssets: defineTable({
    profileId: v.id("profiles"),
    storageKey: v.string(),
    originalFileName: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    mimeType: v.string(),
    byteSize: v.number(),
    label: v.optional(v.string()),
    caption: v.optional(v.string()),
    visibility: profileAssetVisibility,
    source: profileAssetSource,
    uploadedBy: authSubject,
    uploadedAt: v.number(),
    state: profileAssetState,
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_profileId", ["profileId"])
    .index("by_profileId_state_visibility", ["profileId", "state", "visibility"]),
  profileAssetPlacements: defineTable({
    profileId: v.id("profiles"),
    assetId: v.id("profileAssets"),
    placement: profileAssetPlacement,
    position: v.number(),
    state: profileAssetState,
    updatedAt: v.number(),
  })
    .index("by_profileId_placement_state_position", [
      "profileId",
      "placement",
      "state",
      "position",
    ])
    .index("by_profileId_state", ["profileId", "state"])
    .index("by_assetId", ["assetId"]),
  profileAssetDisplayPreferences: defineTable({
    profileId: v.id("profiles"),
    compactDisplay: profileAssetDisplayPreference,
    avatarAppearance: v.optional(profileAvatarAppearance),
    updatedAt: v.number(),
  }).index("by_profileId", ["profileId"]),
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
    doorsOpenAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    timezone: v.optional(v.string()),
    communityProfileId: v.optional(v.id("profiles")),
    communityName: v.optional(v.string()),
    summary: v.optional(v.string()),
    notes: v.optional(v.string()),
    posterImageUrl: v.optional(v.string()),
    bannerImageUrl: v.optional(v.string()),
    thumbnailImageUrl: v.optional(v.string()),
    watchSurfaceEnabled: v.optional(v.boolean()),
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
  eventSlots: defineTable({
    eventId: v.id("events"),
    eventStartAt: v.number(),
    position: v.number(),
    startAt: v.number(),
    endAt: v.optional(v.number()),
    personProfileId: v.optional(v.id("profiles")),
    displayLabel: v.string(),
    roleLabel: v.string(),
    sourceType: eventSourceType,
    sourceLabel: v.string(),
    sourceUrl: v.optional(v.string()),
    confidence: v.number(),
    reviewState: eventSlotReviewState,
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_eventId_startAt", ["eventId", "startAt"])
    .index("by_eventId_reviewState_startAt", ["eventId", "reviewState", "startAt"])
    .index("by_personProfileId_reviewState_startAt", [
      "personProfileId",
      "reviewState",
      "startAt",
    ]),
  eventMediaPrograms: defineTable({
    eventId: v.id("events"),
    communityProfileId: v.optional(v.id("profiles")),
    state: eventMediaProgramStateValidator,
    currentSourceId: v.optional(v.id("eventMediaSources")),
    currentSceneId: v.optional(v.id("eventMediaScenes")),
    currentOutputId: v.optional(v.id("eventMediaOutputs")),
    activeSessionId: v.optional(v.id("eventMediaSessions")),
    publicLinks: v.array(eventMediaPublicLinkValidator),
    directFallbackLinks: v.array(eventMediaPublicLinkValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_eventId_updatedAt", ["eventId", "updatedAt"])
    .index("by_communityProfileId_state", ["communityProfileId", "state"])
    .index("by_state_updatedAt", ["state", "updatedAt"]),
  eventMediaSources: defineTable({
    programId: v.id("eventMediaPrograms"),
    eventId: v.id("events"),
    key: v.string(),
    position: v.number(),
    type: eventMediaSourceTypeValidator,
    purpose: eventMediaSourcePurposeValidator,
    state: eventMediaSourceStateValidator,
    label: v.string(),
    ownerProfileId: v.optional(v.id("profiles")),
    publicUrl: v.optional(v.string()),
    privateConfigRef: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_programId_position", ["programId", "position"])
    .index("by_programId_key", ["programId", "key"])
    .index("by_eventId_state", ["eventId", "state"]),
  eventMediaScenes: defineTable({
    programId: v.id("eventMediaPrograms"),
    eventId: v.id("events"),
    key: v.string(),
    position: v.number(),
    type: eventMediaSceneTypeValidator,
    label: v.string(),
    sourceId: v.optional(v.id("eventMediaSources")),
    visualSourceId: v.optional(v.id("eventMediaSources")),
    audioSourceId: v.optional(v.id("eventMediaSources")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_programId_position", ["programId", "position"])
    .index("by_programId_key", ["programId", "key"]),
  eventMediaOutputs: defineTable({
    programId: v.id("eventMediaPrograms"),
    eventId: v.id("events"),
    key: v.string(),
    type: eventMediaOutputTypeValidator,
    accountModel: eventMediaOutputAccountModelValidator,
    state: eventMediaOutputStateValidator,
    label: v.string(),
    region: v.optional(v.string()),
    credential: v.optional(eventMediaOutputCredential),
    vrcdnSetup: v.optional(eventMediaVrcdnSetup),
    compliance: v.optional(eventMediaOutputCompliance),
    playbackLinks: v.array(eventMediaPublicLinkValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_programId_key", ["programId", "key"])
    .index("by_programId_state", ["programId", "state"])
    .index("by_eventId_type", ["eventId", "type"]),
  eventMediaCommands: defineTable({
    programId: v.id("eventMediaPrograms"),
    eventId: v.id("events"),
    sessionId: v.optional(v.id("eventMediaSessions")),
    commandType: eventMediaCommandTypeValidator,
    status: eventMediaCommandStatusValidator,
    actor: v.optional(authSubject),
    actorSurface: eventMediaActorSurfaceValidator,
    targetSourceId: v.optional(v.id("eventMediaSources")),
    targetSourceKey: v.optional(v.string()),
    targetOutputId: v.optional(v.id("eventMediaOutputs")),
    targetOutputKey: v.optional(v.string()),
    publicFallbackLinks: v.array(eventMediaPublicLinkValidator),
    note: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    claimedByWorkerId: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    createdAt: v.number(),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_programId_status_createdAt", ["programId", "status", "createdAt"])
    .index("by_sessionId_status_createdAt", ["sessionId", "status", "createdAt"])
    .index("by_eventId_createdAt", ["eventId", "createdAt"])
    .index("by_idempotencyKey", ["idempotencyKey"]),
  eventMediaSessions: defineTable({
    programId: v.id("eventMediaPrograms"),
    eventId: v.id("events"),
    outputId: v.optional(v.id("eventMediaOutputs")),
    status: eventMediaSessionStatusValidator,
    workerId: v.optional(v.string()),
    workerRuntime: v.optional(v.string()),
    workerProvider: v.optional(eventMediaWorkerProviderValidator),
    workerTaskDefinitionArn: v.optional(v.string()),
    workerTaskId: v.optional(v.string()),
    workerTaskStatus: v.optional(eventMediaWorkerTaskStatusValidator),
    workerTaskStatusReason: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    currentSourceId: v.optional(v.id("eventMediaSources")),
    currentSceneId: v.optional(v.id("eventMediaScenes")),
    artifactLinks: v.optional(v.array(eventMediaWorkerArtifactLinkValidator)),
    health: v.optional(
      v.object({
        lastHeartbeatAt: v.number(),
        outputBitrateKbps: v.optional(v.number()),
        audioPresent: v.optional(v.boolean()),
        droppedSegmentCount: v.optional(v.number()),
        commandFailureCount: v.optional(v.number()),
      }),
    ),
    scheduledStartAt: v.optional(v.number()),
    readyDeadlineAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    stopRequestedAt: v.optional(v.number()),
    stoppedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_programId_status", ["programId", "status"])
    .index("by_eventId_status", ["eventId", "status"])
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_workerId_status", ["workerId", "status"])
    .index("by_leaseExpiresAt", ["leaseExpiresAt"]),
  eventMediaAuditEvents: defineTable({
    programId: v.id("eventMediaPrograms"),
    eventId: v.id("events"),
    sessionId: v.optional(v.id("eventMediaSessions")),
    commandId: v.optional(v.id("eventMediaCommands")),
    sourceId: v.optional(v.id("eventMediaSources")),
    outputId: v.optional(v.id("eventMediaOutputs")),
    actor: v.optional(authSubject),
    actorSurface: eventMediaActorSurfaceValidator,
    action: v.string(),
    publicSummary: v.optional(v.string()),
    privateSummary: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_programId_createdAt", ["programId", "createdAt"])
    .index("by_eventId_createdAt", ["eventId", "createdAt"])
    .index("by_commandId", ["commandId"]),
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
  profileOwners: defineTable({
    profileId: v.id("profiles"),
    userId: v.id("users"),
    roleKey: v.literal("owner"),
    state: profileOwnerState,
    grantedByClaimRequestId: v.optional(v.id("profileClaimRequests")),
    grantedAt: v.number(),
    revokedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_profileId_state", ["profileId", "state"])
    .index("by_userId_state", ["userId", "state"])
    .index("by_profileId_roleKey_state", ["profileId", "roleKey", "state"]),
  profileClaimRequests: defineTable({
    profileId: v.optional(v.id("profiles")),
    profileSlug: v.optional(v.string()),
    profileType,
    requestedDisplayName: v.optional(v.string()),
    userId: v.id("users"),
    method: profileClaimMethod,
    state: profileClaimRequestState,
    discordGuildId: v.optional(v.string()),
    discordGuildName: v.optional(v.string()),
    vrchatTargetId: v.optional(v.string()),
    evidenceSource: v.optional(profileVerificationEvidenceSource),
    evidenceSummary: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    verifiedAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_profileId_state", ["profileId", "state"])
    .index("by_userId_state", ["userId", "state"])
    .index("by_method_state", ["method", "state"]),
  profileVerificationAttempts: defineTable({
    profileId: v.id("profiles"),
    userId: v.id("users"),
    method: profileClaimMethod,
    targetType: profileVerificationTargetType,
    targetExternalId: v.string(),
    proofCode: v.string(),
    state: profileVerificationAttemptState,
    evidenceSource: v.optional(profileVerificationEvidenceSource),
    evidenceSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    verifiedAt: v.optional(v.number()),
  })
    .index("by_profileId_state", ["profileId", "state"])
    .index("by_userId_state", ["userId", "state"])
    .index("by_state_expiresAt", ["state", "expiresAt"]),
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
  e2eAuthCodes: defineTable({
    email: v.string(),
    code: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_email", ["email"]),
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
      filterFields: ["publicState", "entityType", "profileType"],
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
