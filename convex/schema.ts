import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  apiRouteClassValidator,
  apiScopeValidator,
  apiStatusCodeClassValidator,
  apiTokenEventTypeValidator,
  apiTokenOwnerKindValidator,
  apiTokenStatusValidator,
  apiTokenTrustTierValidator,
  apiTokenValidationResultValidator,
} from "./_apiTokens";
import {
  apiWriteAuditActionValidator,
  apiWriteAuditActorKindValidator,
  apiWriteAuditResourceTypeValidator,
  apiWriteAuditResultValidator,
  mcpEventWriteToolNameValidator,
} from "./_apiWriteAuditEvents";
import { mcpEventWriteResultValidator } from "./_mcpEventWriteReceipts";
import {
  apiRateLimitEventIdentityKindValidator,
  apiRateLimitEventQuotaTierValidator,
  apiRateLimitEventTypeValidator,
} from "./_apiRateLimitEvents";
import {
  billingCustomerCreatedFromValidator,
  billingCustomerStateValidator,
  billingEntitlementSourceValidator,
  billingEntitlementStatusValidator,
  billingOwnerKindValidator,
  billingSubscriptionStatusValidator,
  stripeEnvironmentValidator,
} from "./_billing";
import {
  eventImportBatchReviewStateValidator,
  eventImportCandidatePublicationStateValidator,
  eventImportCandidateReviewStateValidator,
  eventImportCancellationStateValidator,
  eventImportFieldConfidenceValidator,
  eventImportFieldReviewStateValidator,
  eventImportFieldVisibilityValidator,
  eventImportProviderValidator,
} from "./_eventCalendarImports";
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
import {
  mcpToolEventResultValidator,
  mcpToolEventRouteClassValidator,
  mcpToolEventTypeValidator,
  mcpToolNameValidator,
} from "./_mcpToolEvents";
import {
  oauthApplicationOwnerKindValidator,
  oauthApplicationStatusValidator,
  oauthApplicationTrustTierValidator,
  oauthAccessTokenValidationResultValidator,
  oauthAuthorizationCodeStatusValidator,
  oauthAccessTokenStatusValidator,
  oauthAccessTokenSubjectTypeValidator,
  oauthCodeChallengeMethodValidator,
  oauthClientEventResultValidator,
  oauthClientEventTypeValidator,
  oauthClientSecretHashVersion,
  oauthClientSecretStatusValidator,
  oauthClientTypeValidator,
  oauthDynamicClientStatusValidator,
  oauthGrantTypeValidator,
  oauthRefreshTokenStatusValidator,
  oauthResponseTypeValidator,
  oauthTokenEndpointAuthMethodValidator,
} from "./_oauth";
import {
  seedImportBatchReviewStateValidator,
  seedImportCandidatePublicationStateValidator,
  seedImportCandidateReviewStateValidator,
  seedImportClaimStateValidator,
  seedImportFieldConfidenceValidator,
  seedImportFieldReviewStateValidator,
  seedImportFieldVisibilityValidator,
  seedImportProfileTypeValidator,
  seedImportPublicationPolicyValidator,
  seedImportSourceTypeValidator,
} from "./_seedImportValidators";
import {
  collectorAccountStateValidator,
  collectorLeaseStateValidator,
  coverageStateValidator,
  eventInstanceAssociationSourceValidator,
  eventInstanceAssociationStateValidator,
  instanceSessionStateValidator,
  publicTelemetrySettingsValidator,
  telemetryIntegrationStateValidator,
  telemetrySourceValidator,
  vrchatGroupJoinPolicyValidator,
  vrchatGroupVisibilityValidator,
} from "./_communityTelemetry";

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
  // Matches `profileAssetSource` and `profileGenreSource`, which already carry
  // this variant. A community submission is one signed-in person adding
  // somebody else's profile, so its links are neither owner-authored nor
  // reviewed, and this union was the only one of the three missing the value.
  v.literal("community_submitted"),
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
  v.literal("gallery"),
  v.literal("featured"),
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

const profilePublicSection = v.union(
  v.literal("about"),
  v.literal("events"),
  v.literal("links"),
  v.literal("media_kit"),
  v.literal("worlds"),
  v.literal("details"),
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

const eventSlotReviewState = v.union(
  v.literal("draft"),
  v.literal("confirmed"),
  v.literal("disputed"),
);

const communityCapability = v.union(
  v.literal("edit_community_profile"),
  v.literal("manage_profile"),
  v.literal("manage_roster"),
  v.literal("manage_events"),
  v.literal("manage_event_media"),
  v.literal("view_event_operations"),
  v.literal("manage_staff"),
  v.literal("manage_integrations"),
  v.literal("manage_billing"),
);

const communityAuthorityState = v.union(v.literal("active"), v.literal("revoked"));

const profileOwnerState = v.union(v.literal("active"), v.literal("revoked"));

const accountFeature = v.union(
  v.literal("super_admin"),
  v.literal("view_private_seed_lookup"),
  v.literal("use_temporal_parsing_beta"),
);

const temporalParseJobStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
);

const temporalParseOutcome = v.union(
  v.literal("resolved"),
  v.literal("needs_clarification"),
  v.literal("no_plan"),
  v.literal("provider_error"),
  v.literal("invalid_plan"),
  v.literal("timeout"),
);

const accountFeatureGrantState = v.union(
  v.literal("active"),
  v.literal("revoked"),
);

const seedHandoffInvitationState = v.union(
  v.literal("active"),
  v.literal("accepted"),
  v.literal("revoked"),
);

const profileClaimMethod = v.union(
  v.literal("discord_person"),
  v.literal("discord_community"),
  v.literal("discord_community_admin"),
  v.literal("vrchat_user_proof"),
  v.literal("vrchat_group_proof"),
  v.literal("vrclinking_attestation"),
  v.literal("handoff_invitation"),
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
  v.literal("discord_oauth"),
  v.literal("discord_bot"),
  v.literal("vrchat_api"),
  v.literal("vrclinking"),
  v.literal("manual"),
);

// An external asset a user can prove control of. Deliberately independent of
// profile type: one Discord guild can back several community profiles, and one
// community can hold several guilds and VRChat groups.
const externalAssetType = v.union(
  v.literal("discord_guild"),
  v.literal("vrchat_group"),
  v.literal("vrchat_user"),
);

// Ordered weakest to strongest by `externalControlLevelRank` in
// `_externalControl.ts`. `self` means the user proved they are that account.
const externalControlLevel = v.union(
  v.literal("manager"),
  v.literal("administrator"),
  v.literal("owner"),
  v.literal("self"),
);

const externalControlProofState = v.union(
  v.literal("active"),
  v.literal("stale"),
  v.literal("revoked"),
);

const profileExternalLinkRole = v.union(
  v.literal("primary"),
  v.literal("secondary"),
);

const profileExternalLinkState = v.union(
  v.literal("active"),
  v.literal("removed"),
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

const shortLinkTargetType = v.union(
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
  // Clerk owns authentication and sessions. `users` stays the VRDex identity
  // spine that every other table's `v.id("users")` points at; `clerkUserId` is
  // the only link back to the auth provider.
  //
  // Required, as the second half of a two-phase change that is now complete:
  // both first-party deployments hold zero rows created under Convex Auth. It
  // was `v.optional(v.string())` until then, because a required field would have
  // made schema validation reject those rows on the very first deploy — before
  // the functions that could clean them up were installed.
  //
  // That cuts both ways now. **This revision cannot be deployed onto a database
  // that still holds legacy rows**, and the migrations that would fix one are
  // deleted here too. `docs/backend/auth-sessions.md` pins the staged revision
  // to deploy first and gives the sequence.
  users: defineTable({
    clerkUserId: v.string(),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
  })
    .index("clerkUserId", ["clerkUserId"])
    .index("email", ["email"])
    .index("phone", ["phone"]),
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
    targetProfileId: v.optional(v.id("profiles")),
    replacesAssetId: v.optional(v.id("profileAssets")),
    originalFileName: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    mimeType: v.string(),
    byteSize: v.number(),
    storageKey: v.string(),
    quarantineStorageKey: v.optional(v.string()),
    sourceStorageKey: v.optional(v.string()),
    downloadStorageKey: v.optional(v.string()),
    sourceMimeType: v.optional(v.string()),
    sourceByteSize: v.optional(v.number()),
    sourceContentSha256: v.optional(v.string()),
    downloadMimeType: v.optional(v.string()),
    downloadByteSize: v.optional(v.number()),
    downloadContentSha256: v.optional(v.string()),
    label: v.optional(v.string()),
    caption: v.optional(v.string()),
    altText: v.optional(v.string()),
    credit: v.optional(v.string()),
    creditUrl: v.optional(v.string()),
    contentSha256: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    placements: v.optional(v.array(profileAssetPlacement)),
    position: v.optional(v.number()),
    source: v.optional(profileAssetSource),
    state: profileAssetUploadIntentState,
    processingToken: v.optional(v.string()),
    processingStartedAt: v.optional(v.number()),
    processingAttempts: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.number(),
    uploadedAt: v.optional(v.number()),
    consumedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_uploadToken", ["uploadToken"])
    .index("by_state_expiresAt", ["state", "expiresAt"])
    .index("by_targetProfileId_state_expiresAt", ["targetProfileId", "state", "expiresAt"])
    .index("by_requestedBy", ["requestedBy.tokenIdentifier"]),
  profileAssets: defineTable({
    profileId: v.id("profiles"),
    storageKey: v.string(),
    sourceStorageKey: v.optional(v.string()),
    downloadStorageKey: v.optional(v.string()),
    originalFileName: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    mimeType: v.string(),
    byteSize: v.number(),
    sourceMimeType: v.optional(v.string()),
    sourceByteSize: v.optional(v.number()),
    sourceContentSha256: v.optional(v.string()),
    downloadMimeType: v.optional(v.string()),
    downloadByteSize: v.optional(v.number()),
    downloadContentSha256: v.optional(v.string()),
    label: v.optional(v.string()),
    caption: v.optional(v.string()),
    altText: v.optional(v.string()),
    credit: v.optional(v.string()),
    creditUrl: v.optional(v.string()),
    contentSha256: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
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
    sectionOrder: v.optional(v.array(profilePublicSection)),
    updatedAt: v.number(),
  }).index("by_profileId", ["profileId"]),
  profileAssetAccessibilityGenerationEvents: defineTable({
    requestId: v.string(),
    userId: v.id("users"),
    profileId: v.id("profiles"),
    provider: v.string(),
    model: v.string(),
    result: v.union(v.literal("started"), v.literal("succeeded"), v.literal("failed")),
    imageBytes: v.number(),
    descriptionLength: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_requestId", ["requestId"])
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_profileId_createdAt", ["profileId", "createdAt"]),
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
  eventImportBatches: defineTable({
    externalBatchId: v.string(),
    provider: eventImportProviderValidator,
    sourceName: v.string(),
    sourceCalendarId: v.string(),
    sourceCalendarSummary: v.optional(v.string()),
    sourceCalendarTimeZone: v.optional(v.string()),
    syncJobId: v.optional(v.string()),
    receivedAt: v.number(),
    importedBy: v.optional(authSubject),
    reviewState: eventImportBatchReviewStateValidator,
    reviewedBy: v.optional(authSubject),
    reviewedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_externalBatchId", ["externalBatchId"])
    .index("by_provider_receivedAt", ["provider", "receivedAt"])
    .index("by_reviewState_receivedAt", ["reviewState", "receivedAt"]),
  eventImportCandidates: defineTable({
    batchId: v.id("eventImportBatches"),
    externalEventId: v.string(),
    externalICalUid: v.optional(v.string()),
    sourceUpdatedAt: v.optional(v.number()),
    sourceUrl: v.optional(v.string()),
    title: v.string(),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    timezone: v.optional(v.string()),
    allDay: v.optional(v.boolean()),
    location: v.optional(v.string()),
    description: v.optional(v.string()),
    recurrenceRules: v.array(v.string()),
    recurringEventId: v.optional(v.string()),
    cancellationState: eventImportCancellationStateValidator,
    reviewState: eventImportCandidateReviewStateValidator,
    publicationState: eventImportCandidatePublicationStateValidator,
    matchedEventId: v.optional(v.id("events")),
    reviewer: v.optional(authSubject),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    publicationQueuedBy: v.optional(authSubject),
    publicationQueuedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_batchId", ["batchId"])
    .index("by_batchId_reviewState", ["batchId", "reviewState"])
    .index("by_batchId_publicationState", ["batchId", "publicationState"])
    .index("by_externalEventId", ["externalEventId"])
    .index("by_sourceUpdatedAt", ["sourceUpdatedAt"])
    .index("by_matchedEventId", ["matchedEventId"]),
  eventImportCandidateFields: defineTable({
    candidateId: v.id("eventImportCandidates"),
    fieldKey: v.string(),
    value: v.any(),
    sourceLabel: v.string(),
    sourceUrl: v.optional(v.string()),
    confidence: eventImportFieldConfidenceValidator,
    reviewState: eventImportFieldReviewStateValidator,
    visibility: eventImportFieldVisibilityValidator,
    reviewedBy: v.optional(authSubject),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_candidateId", ["candidateId"])
    .index("by_candidateId_reviewState", ["candidateId", "reviewState"])
    .index("by_candidateId_visibility", ["candidateId", "visibility"])
    .index("by_fieldKey_reviewState", ["fieldKey", "reviewState"]),
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
    eventSlotId: v.optional(v.id("eventSlots")),
    sourceProfileId: v.optional(v.id("profiles")),
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
    targetSceneId: v.optional(v.id("eventMediaScenes")),
    targetSceneKey: v.optional(v.string()),
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
  collectorFleetSettings: defineTable({
    key: v.literal("global"),
    killSwitchEnabled: v.boolean(),
    globalRequestsPerMinute: v.number(),
    updatedAt: v.number(),
    updatedBy: v.optional(authSubject),
  }).index("by_key", ["key"]),
  collectorAccounts: defineTable({
    vrchatUserId: v.string(),
    accountAlias: v.string(),
    state: collectorAccountStateValidator,
    capacity: v.number(),
    reservedHeadroom: v.number(),
    assignedGroupCount: v.number(),
    requestsPerMinute: v.number(),
    secretRef: v.string(),
    workerKeyHash: v.string(),
    credentialGeneration: v.number(),
    killSwitchEnabled: v.boolean(),
    lastHealthAt: v.optional(v.number()),
    lastHealthResult: v.optional(v.string()),
    cooldownUntil: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_vrchatUserId", ["vrchatUserId"])
    .index("by_state_assignedGroupCount", ["state", "assignedGroupCount"]),
  collectorRequestBudgetCounters: defineTable({
    scopeKey: v.string(),
    windowStartedAt: v.number(),
    requestCount: v.number(),
    updatedAt: v.number(),
  }).index("by_scopeKey", ["scopeKey"]),
  communityVrchatIntegrations: defineTable({
    communityProfileId: v.id("profiles"),
    vrchatGroupId: v.string(),
    groupVisibility: vrchatGroupVisibilityValidator,
    joinPolicy: vrchatGroupJoinPolicyValidator,
    state: telemetryIntegrationStateValidator,
    assignedCollectorAccountId: v.optional(v.id("collectorAccounts")),
    killSwitchEnabled: v.boolean(),
    requestsPerMinute: v.number(),
    leaseGeneration: v.number(),
    publicMetrics: publicTelemetrySettingsValidator,
    lastSuccessfulObservationAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    nextPollAt: v.optional(v.number()),
    consecutiveFailures: v.number(),
    backoffUntil: v.optional(v.number()),
    disconnectedAt: v.optional(v.number()),
    telemetryEpochStartedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_communityProfileId", ["communityProfileId"])
    .index("by_vrchatGroupId", ["vrchatGroupId"])
    .index("by_assignedCollectorAccountId_state", ["assignedCollectorAccountId", "state"])
    .index("by_state_nextPollAt", ["state", "nextPollAt"]),
  collectorAccountLeases: defineTable({
    integrationId: v.id("communityVrchatIntegrations"),
    collectorAccountId: v.id("collectorAccounts"),
    workerId: v.string(),
    fencingToken: v.number(),
    state: collectorLeaseStateValidator,
    claimedAt: v.number(),
    expiresAt: v.number(),
    releasedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_integrationId_state", ["integrationId", "state"])
    .index("by_collectorAccountId_state_expiresAt", ["collectorAccountId", "state", "expiresAt"])
    .index("by_expiresAt", ["expiresAt"]),
  communityPopulationObservations: defineTable({
    integrationId: v.id("communityVrchatIntegrations"),
    idempotencyKey: v.string(),
    totalPopulation: v.number(),
    activeInstanceCount: v.number(),
    worldDistribution: v.array(v.object({
      vrchatWorldId: v.string(),
      population: v.number(),
      instanceCount: v.number(),
    })),
    observedAt: v.number(),
    source: telemetrySourceValidator,
    collectorVersion: v.string(),
    coverageState: coverageStateValidator,
    coverageWindowId: v.optional(v.id("collectionCoverageWindows")),
    fencingToken: v.number(),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_integrationId_observedAt", ["integrationId", "observedAt"]),
  instanceSessions: defineTable({
    integrationId: v.id("communityVrchatIntegrations"),
    communityProfileId: v.id("profiles"),
    providerInstanceId: v.string(),
    providerLocation: v.string(),
    vrchatWorldId: v.string(),
    worldId: v.optional(v.id("worlds")),
    source: telemetrySourceValidator,
    state: instanceSessionStateValidator,
    openedAt: v.number(),
    lastObservedAt: v.number(),
    closedAt: v.optional(v.number()),
    consecutiveMisses: v.number(),
    updatedAt: v.number(),
  })
    .index("by_integrationId_state", ["integrationId", "state"])
    .index("by_integrationId_providerInstanceId_state", ["integrationId", "providerInstanceId", "state"])
    .index("by_integrationId_providerLocation_state", ["integrationId", "providerLocation", "state"])
    .index("by_integrationId_providerLocation_state_openedAt", [
      "integrationId",
      "providerLocation",
      "state",
      "openedAt",
    ])
    .index("by_communityProfileId_openedAt", ["communityProfileId", "openedAt"])
    .index("by_worldId_openedAt", ["worldId", "openedAt"]),
  collectionCoverageWindows: defineTable({
    integrationId: v.id("communityVrchatIntegrations"),
    state: coverageStateValidator,
    reason: v.optional(v.string()),
    source: telemetrySourceValidator,
    collectorVersion: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    requestStatusClass: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_integrationId_startedAt", ["integrationId", "startedAt"])
    .index("by_integrationId_state_startedAt", ["integrationId", "state", "startedAt"]),
  instancePopulationObservations: defineTable({
    integrationId: v.id("communityVrchatIntegrations"),
    sessionId: v.id("instanceSessions"),
    idempotencyKey: v.string(),
    providerInstanceId: v.string(),
    vrchatWorldId: v.string(),
    population: v.number(),
    observedAt: v.number(),
    source: telemetrySourceValidator,
    collectorVersion: v.string(),
    coverageState: coverageStateValidator,
    coverageWindowId: v.optional(v.id("collectionCoverageWindows")),
    fencingToken: v.number(),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_integrationId_observedAt", ["integrationId", "observedAt"])
    .index("by_sessionId_observedAt", ["sessionId", "observedAt"]),
  communityMemberCountObservations: defineTable({
    integrationId: v.id("communityVrchatIntegrations"),
    communityProfileId: v.id("profiles"),
    idempotencyKey: v.string(),
    vrchatGroupId: v.string(),
    memberCount: v.number(),
    observedAt: v.number(),
    source: telemetrySourceValidator,
    collectorVersion: v.string(),
    coverageState: coverageStateValidator,
    coverageWindowId: v.optional(v.id("collectionCoverageWindows")),
    fencingToken: v.number(),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_integrationId_observedAt", ["integrationId", "observedAt"])
    .index("by_communityProfileId_observedAt", ["communityProfileId", "observedAt"]),
  eventInstanceAssociations: defineTable({
    eventId: v.id("events"),
    sessionId: v.id("instanceSessions"),
    communityProfileId: v.id("profiles"),
    source: eventInstanceAssociationSourceValidator,
    confidence: v.number(),
    state: eventInstanceAssociationStateValidator,
    actor: v.optional(authSubject),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_eventId_state", ["eventId", "state"])
    .index("by_sessionId_state", ["sessionId", "state"])
    .index("by_communityProfileId_state", ["communityProfileId", "state"])
    .index("by_communityProfileId_createdAt", ["communityProfileId", "createdAt"]),
  communityTelemetryRollups: defineTable({
    communityProfileId: v.id("profiles"),
    eventId: v.optional(v.id("events")),
    grain: v.union(v.literal("hour"), v.literal("day"), v.literal("event")),
    bucketStartAt: v.number(),
    bucketEndAt: v.number(),
    rollupVersion: v.string(),
    currentPopulation: v.optional(v.number()),
    activeInstanceCount: v.number(),
    peakConcurrency: v.number(),
    playerMinutes: v.number(),
    coverageRatio: v.number(),
    groupMemberCount: v.optional(v.number()),
    groupMemberGrowth: v.optional(v.number()),
    worldDistribution: v.array(v.object({ vrchatWorldId: v.string(), samples: v.number() })),
    computedAt: v.number(),
  })
    .index("by_communityProfileId_grain_bucketStartAt", ["communityProfileId", "grain", "bucketStartAt"])
    .index("by_eventId_rollupVersion", ["eventId", "rollupVersion"]),
  communityTelemetryAuditEvents: defineTable({
    communityProfileId: v.optional(v.id("profiles")),
    integrationId: v.optional(v.id("communityVrchatIntegrations")),
    collectorAccountId: v.optional(v.id("collectorAccounts")),
    actor: v.optional(authSubject),
    workerId: v.optional(v.string()),
    action: v.string(),
    result: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_communityProfileId_createdAt", ["communityProfileId", "createdAt"])
    .index("by_collectorAccountId_createdAt", ["collectorAccountId", "createdAt"]),
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
  apiTokens: defineTable({
    tokenPrefix: v.string(),
    verifierHash: v.string(),
    hashVersion: v.literal("sha256-pepper-v1"),
    ownerKind: apiTokenOwnerKindValidator,
    ownerUserId: v.id("users"),
    ownerCommunityProfileId: v.optional(v.id("profiles")),
    label: v.string(),
    scopes: v.array(apiScopeValidator),
    status: apiTokenStatusValidator,
    trustTier: apiTokenTrustTierValidator,
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    lastUsedRouteClass: v.optional(apiRouteClassValidator),
    revokedAt: v.optional(v.number()),
    revokedByUserId: v.optional(v.id("users")),
    revokeReason: v.optional(v.string()),
  })
    .index("by_tokenPrefix", ["tokenPrefix"])
    .index("by_ownerUserId_createdAt", ["ownerUserId", "createdAt"])
    .index("by_ownerUserId_status_createdAt", ["ownerUserId", "status", "createdAt"])
    .index("by_ownerKind_ownerUserId_createdAt", ["ownerKind", "ownerUserId", "createdAt"])
    .index("by_ownerKind_ownerUserId_status_createdAt", [
      "ownerKind",
      "ownerUserId",
      "status",
      "createdAt",
    ])
    .index("by_ownerCommunityProfileId_status_createdAt", [
      "ownerCommunityProfileId",
      "status",
      "createdAt",
    ])
    .index("by_status_expiresAt", ["status", "expiresAt"])
    .index("by_revokedByUserId", ["revokedByUserId"]),
  apiTokenEvents: defineTable({
    tokenId: v.optional(v.id("apiTokens")),
    tokenPrefix: v.optional(v.string()),
    ownerKind: v.optional(apiTokenOwnerKindValidator),
    ownerUserId: v.optional(v.id("users")),
    ownerCommunityProfileId: v.optional(v.id("profiles")),
    routeClass: apiRouteClassValidator,
    eventType: apiTokenEventTypeValidator,
    result: apiTokenValidationResultValidator,
    requiredScopes: v.array(apiScopeValidator),
    grantedScopes: v.optional(v.array(apiScopeValidator)),
    statusCodeClass: v.optional(apiStatusCodeClassValidator),
    createdAt: v.number(),
  })
    .index("by_tokenId_createdAt", ["tokenId", "createdAt"])
    .index("by_ownerUserId_createdAt", ["ownerUserId", "createdAt"])
    .index("by_ownerCommunityProfileId_createdAt", ["ownerCommunityProfileId", "createdAt"])
    .index("by_routeClass_createdAt", ["routeClass", "createdAt"])
    .index("by_eventType_createdAt", ["eventType", "createdAt"]),
  apiRateLimitEvents: defineTable({
    routeClass: apiRouteClassValidator,
    identityKind: apiRateLimitEventIdentityKindValidator,
    quotaTier: apiRateLimitEventQuotaTierValidator,
    eventType: apiRateLimitEventTypeValidator,
    limit: v.number(),
    remaining: v.number(),
    retryAfterSeconds: v.number(),
    resetAt: v.number(),
    windowMs: v.number(),
    createdAt: v.number(),
  })
    .index("by_routeClass_createdAt", ["routeClass", "createdAt"])
    .index("by_identityKind_createdAt", ["identityKind", "createdAt"])
    .index("by_routeClass_identityKind_createdAt", ["routeClass", "identityKind", "createdAt"]),
  apiWriteAuditEvents: defineTable({
    action: apiWriteAuditActionValidator,
    actorKind: apiWriteAuditActorKindValidator,
    idempotencyKeyHash: v.optional(v.string()),
    mcpToolName: v.optional(mcpEventWriteToolNameValidator),
    oauthClientId: v.optional(v.string()),
    oauthTokenId: v.optional(v.string()),
    ownerUserId: v.optional(v.id("users")),
    requestId: v.optional(v.string()),
    resourceType: apiWriteAuditResourceTypeValidator,
    result: apiWriteAuditResultValidator,
    routeClass: apiRouteClassValidator,
    targetProfileId: v.optional(v.id("profiles")),
    targetEventId: v.optional(v.id("events")),
    targetIntentId: v.optional(v.id("profileAssetUploadIntents")),
    assetIds: v.optional(v.array(v.id("profileAssets"))),
    createdAt: v.number(),
  })
    .index("by_routeClass_createdAt", ["routeClass", "createdAt"])
    .index("by_action_createdAt", ["action", "createdAt"])
    .index("by_ownerUserId_createdAt", ["ownerUserId", "createdAt"]),
  mcpEventWriteReceipts: defineTable({
    ownerUserId: v.id("users"),
    oauthClientId: v.string(),
    toolName: mcpEventWriteToolNameValidator,
    idempotencyKeyHash: v.string(),
    requestFingerprint: v.string(),
    result: mcpEventWriteResultValidator,
    createdAt: v.number(),
  }).index("by_owner_client_tool_key", [
    "ownerUserId",
    "oauthClientId",
    "toolName",
    "idempotencyKeyHash",
  ]),
  oauthApplications: defineTable({
    clientId: v.string(),
    ownerKind: oauthApplicationOwnerKindValidator,
    ownerUserId: v.id("users"),
    ownerCommunityProfileId: v.optional(v.id("profiles")),
    clientType: oauthClientTypeValidator,
    displayName: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    docsUrl: v.optional(v.string()),
    privacyUrl: v.optional(v.string()),
    termsUrl: v.optional(v.string()),
    redirectUris: v.array(v.string()),
    allowedGrants: v.array(oauthGrantTypeValidator),
    allowedScopes: v.array(apiScopeValidator),
    status: oauthApplicationStatusValidator,
    trustTier: oauthApplicationTrustTierValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedByUserId: v.optional(v.id("users")),
    revokeReason: v.optional(v.string()),
  })
    .index("by_clientId", ["clientId"])
    .index("by_ownerUserId_createdAt", ["ownerUserId", "createdAt"])
    .index("by_ownerUserId_status_createdAt", ["ownerUserId", "status", "createdAt"])
    .index("by_ownerKind_ownerUserId_createdAt", ["ownerKind", "ownerUserId", "createdAt"])
    .index("by_ownerKind_ownerUserId_status_createdAt", [
      "ownerKind",
      "ownerUserId",
      "status",
      "createdAt",
    ])
    .index("by_ownerCommunityProfileId_createdAt", ["ownerCommunityProfileId", "createdAt"])
    .index("by_ownerCommunityProfileId_status_createdAt", [
      "ownerCommunityProfileId",
      "status",
      "createdAt",
    ])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_revokedByUserId", ["revokedByUserId"]),
  oauthApplicationSecrets: defineTable({
    applicationId: v.id("oauthApplications"),
    clientId: v.string(),
    secretPrefix: v.string(),
    verifierHash: v.string(),
    hashVersion: v.literal(oauthClientSecretHashVersion),
    status: oauthClientSecretStatusValidator,
    label: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedByUserId: v.optional(v.id("users")),
  })
    .index("by_applicationId_status_createdAt", ["applicationId", "status", "createdAt"])
    .index("by_clientId_status_createdAt", ["clientId", "status", "createdAt"])
    .index("by_secretPrefix", ["secretPrefix"])
    .index("by_revokedByUserId", ["revokedByUserId"]),
  oauthDynamicClients: defineTable({
    clientId: v.string(),
    clientName: v.string(),
    clientUri: v.optional(v.string()),
    logoUri: v.optional(v.string()),
    redirectUris: v.array(v.string()),
    primaryRedirectHost: v.string(),
    grantTypes: v.array(oauthGrantTypeValidator),
    responseTypes: v.array(oauthResponseTypeValidator),
    tokenEndpointAuthMethod: oauthTokenEndpointAuthMethodValidator,
    contacts: v.array(v.string()),
    softwareId: v.optional(v.string()),
    softwareVersion: v.optional(v.string()),
    allowedScopes: v.array(apiScopeValidator),
    resource: v.string(),
    status: oauthDynamicClientStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    promotedApplicationId: v.optional(v.id("oauthApplications")),
    revokedAt: v.optional(v.number()),
  })
    .index("by_clientId", ["clientId"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_primaryRedirectHost_createdAt", ["primaryRedirectHost", "createdAt"]),
  oauthClientEvents: defineTable({
    applicationId: v.optional(v.id("oauthApplications")),
    dynamicClientId: v.optional(v.id("oauthDynamicClients")),
    clientId: v.optional(v.string()),
    accessTokenId: v.optional(v.string()),
    secretPrefix: v.optional(v.string()),
    ownerKind: v.optional(oauthApplicationOwnerKindValidator),
    ownerUserId: v.optional(v.id("users")),
    ownerCommunityProfileId: v.optional(v.id("profiles")),
    routeClass: apiRouteClassValidator,
    eventType: oauthClientEventTypeValidator,
    result: oauthClientEventResultValidator,
    validationResult: v.optional(oauthAccessTokenValidationResultValidator),
    createdAt: v.number(),
  })
    .index("by_applicationId_createdAt", ["applicationId", "createdAt"])
    .index("by_clientId_createdAt", ["clientId", "createdAt"])
    .index("by_ownerUserId_createdAt", ["ownerUserId", "createdAt"])
    .index("by_routeClass_createdAt", ["routeClass", "createdAt"])
    .index("by_eventType_createdAt", ["eventType", "createdAt"]),
  oauthConsentTransactions: defineTable({
    transactionHash: v.string(),
    userId: v.id("users"),
    clientId: v.string(),
    redirectUri: v.string(),
    resource: v.string(),
    scopes: v.array(apiScopeValidator),
    codeChallenge: v.string(),
    codeChallengeMethod: oauthCodeChallengeMethodValidator,
    state: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_transactionHash", ["transactionHash"])
    .index("by_userId_expiresAt", ["userId", "expiresAt"])
    .index("by_expiresAt", ["expiresAt"]),
  mcpToolEvents: defineTable({
    toolName: mcpToolNameValidator,
    routeClass: mcpToolEventRouteClassValidator,
    eventType: mcpToolEventTypeValidator,
    result: mcpToolEventResultValidator,
    ownerUserId: v.optional(v.id("users")),
    oauthClientId: v.optional(v.string()),
    oauthTokenId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    idempotencyKeyHash: v.optional(v.string()),
    targetEventId: v.optional(v.id("events")),
    createdAt: v.number(),
  })
    .index("by_toolName_createdAt", ["toolName", "createdAt"])
    .index("by_routeClass_createdAt", ["routeClass", "createdAt"])
    .index("by_routeClass_toolName_createdAt", ["routeClass", "toolName", "createdAt"])
    .index("by_ownerUserId_createdAt", ["ownerUserId", "createdAt"]),
  oauthAuthorizationCodes: defineTable({
    codeHash: v.string(),
    applicationId: v.optional(v.id("oauthApplications")),
    dynamicClientId: v.optional(v.id("oauthDynamicClients")),
    clientId: v.string(),
    userId: v.id("users"),
    redirectUri: v.string(),
    resource: v.string(),
    scopes: v.array(apiScopeValidator),
    codeChallenge: v.string(),
    codeChallengeMethod: oauthCodeChallengeMethodValidator,
    status: oauthAuthorizationCodeStatusValidator,
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_codeHash", ["codeHash"])
    .index("by_clientId_expiresAt", ["clientId", "expiresAt"])
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_status_expiresAt", ["status", "expiresAt"]),
  oauthRefreshTokens: defineTable({
    tokenHash: v.string(),
    applicationId: v.optional(v.id("oauthApplications")),
    dynamicClientId: v.optional(v.id("oauthDynamicClients")),
    clientId: v.string(),
    userId: v.id("users"),
    resource: v.string(),
    scopes: v.array(apiScopeValidator),
    status: oauthRefreshTokenStatusValidator,
    issuedAt: v.number(),
    expiresAt: v.number(),
    rotatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    replacedByTokenHash: v.optional(v.string()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_clientId_expiresAt", ["clientId", "expiresAt"])
    .index("by_userId_expiresAt", ["userId", "expiresAt"])
    .index("by_status_expiresAt", ["status", "expiresAt"]),
  oauthAccessTokens: defineTable({
    tokenId: v.string(),
    applicationId: v.optional(v.id("oauthApplications")),
    dynamicClientId: v.optional(v.id("oauthDynamicClients")),
    clientId: v.string(),
    subjectType: oauthAccessTokenSubjectTypeValidator,
    userId: v.optional(v.id("users")),
    resource: v.string(),
    scopes: v.array(apiScopeValidator),
    status: oauthAccessTokenStatusValidator,
    issuedAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedByClientId: v.optional(v.string()),
  })
    .index("by_tokenId", ["tokenId"])
    .index("by_clientId_expiresAt", ["clientId", "expiresAt"])
    .index("by_applicationId_issuedAt", ["applicationId", "issuedAt"])
    .index("by_dynamicClientId_issuedAt", ["dynamicClientId", "issuedAt"])
    .index("by_status_expiresAt", ["status", "expiresAt"])
    // The only `v.id("users")` reference on an unbounded table with no way to
    // look it up. One row per issued access token, so checking whether a user is
    // still referenced would otherwise mean reading the whole table.
    .index("by_userId", ["userId"]),
  temporalPrewarmLeases: defineTable({
    key: v.string(),
    ownerUserId: v.id("users"),
    requestedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_key", ["key"])
    .index("by_ownerUserId", ["ownerUserId"]),
  temporalParsingPreferences: defineTable({
    userId: v.id("users"),
    retainInputs: v.boolean(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
  temporalParseJobs: defineTable({
    ownerUserId: v.id("users"),
    credentialId: v.optional(v.string()),
    continuationTokenHash: v.string(),
    idempotencyKeyHash: v.optional(v.string()),
    idempotencyFingerprint: v.optional(v.string()),
    continuationNonce: v.optional(v.string()),
    inputText: v.optional(v.string()),
    inputHash: v.optional(v.string()),
    inputLength: v.number(),
    status: temporalParseJobStatus,
    timeZone: v.string(),
    locale: v.optional(v.string()),
    country: v.optional(v.string()),
    subdivision: v.optional(v.string()),
    referenceInstant: v.string(),
    retainInput: v.boolean(),
    outcome: v.optional(temporalParseOutcome),
    result: v.optional(v.any()),
    errorCode: v.optional(v.string()),
    errorDetail: v.optional(v.string()),
    modelRevision: v.optional(v.string()),
    inferenceLatencyMs: v.optional(v.number()),
    totalLatencyMs: v.optional(v.number()),
    estimatedCostMicros: v.optional(v.number()),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_continuationTokenHash", ["continuationTokenHash"])
    .index("by_ownerUserId_idempotencyKeyHash", ["ownerUserId", "idempotencyKeyHash"])
    .index("by_ownerUserId_status_createdAt", ["ownerUserId", "status", "createdAt"])
    .index("by_ownerUserId_createdAt", ["ownerUserId", "createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"]),
  accountFeatureGrants: defineTable({
    userId: v.id("users"),
    feature: accountFeature,
    state: accountFeatureGrantState,
    grantedBy: authSubject,
    grantedAt: v.number(),
    expiresAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    revokedBy: v.optional(authSubject),
    revokedAt: v.optional(v.number()),
    revokeReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_userId_feature_state", ["userId", "feature", "state"])
    .index("by_feature_state_expiresAt", ["feature", "state", "expiresAt"]),
  billingCustomerMappings: defineTable({
    ownerKind: billingOwnerKindValidator,
    userId: v.optional(v.id("users")),
    profileId: v.optional(v.id("profiles")),
    profileType: v.optional(profileType),
    stripeCustomerId: v.string(),
    stripeEnvironment: stripeEnvironmentValidator,
    email: v.optional(v.string()),
    state: billingCustomerStateValidator,
    createdFrom: billingCustomerCreatedFromValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
    lastStripeEventId: v.optional(v.string()),
    lastStripeEventCreatedAt: v.optional(v.number()),
  })
    .index("by_stripeCustomerId_environment", [
      "stripeCustomerId",
      "stripeEnvironment",
    ])
    .index("by_userId_state", ["userId", "state"])
    .index("by_profileId_state", ["profileId", "state"])
    .index("by_ownerKind_state_updatedAt", ["ownerKind", "state", "updatedAt"]),
  billingSubscriptionSnapshots: defineTable({
    billingCustomerMappingId: v.id("billingCustomerMappings"),
    ownerKind: billingOwnerKindValidator,
    userId: v.optional(v.id("users")),
    profileId: v.optional(v.id("profiles")),
    profileType: v.optional(profileType),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    stripeEnvironment: stripeEnvironmentValidator,
    status: billingSubscriptionStatusValidator,
    rawStripeStatus: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
    stripeLookupKey: v.optional(v.string()),
    quantity: v.optional(v.number()),
    cancelAtPeriodEnd: v.boolean(),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
    cancelAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    latestInvoiceId: v.optional(v.string()),
    lastStripeEventId: v.optional(v.string()),
    lastStripeEventCreatedAt: v.optional(v.number()),
    snapshotAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_stripeSubscriptionId_environment", [
      "stripeSubscriptionId",
      "stripeEnvironment",
    ])
    .index("by_billingCustomerMappingId_status", [
      "billingCustomerMappingId",
      "status",
    ])
    .index("by_userId_status", ["userId", "status"])
    .index("by_profileId_status", ["profileId", "status"])
    .index("by_status_currentPeriodEnd", ["status", "currentPeriodEnd"]),
  billingEntitlementSnapshots: defineTable({
    ownerKind: billingOwnerKindValidator,
    userId: v.optional(v.id("users")),
    profileId: v.optional(v.id("profiles")),
    profileType: v.optional(profileType),
    source: billingEntitlementSourceValidator,
    entitlementKey: v.string(),
    status: billingEntitlementStatusValidator,
    sourceSubscriptionSnapshotId: v.optional(v.id("billingSubscriptionSnapshots")),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeEnvironment: v.optional(stripeEnvironmentValidator),
    quantity: v.optional(v.number()),
    limit: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    statusReason: v.optional(v.string()),
    lastStripeEventId: v.optional(v.string()),
    snapshotAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_entitlementKey_status", [
      "userId",
      "entitlementKey",
      "status",
    ])
    .index("by_profileId_entitlementKey_status", [
      "profileId",
      "entitlementKey",
      "status",
    ])
    .index("by_entitlementKey_status", ["entitlementKey", "status"])
    .index("by_sourceSubscriptionSnapshotId", ["sourceSubscriptionSnapshotId"])
    .index("by_status_expiresAt", ["status", "expiresAt"]),
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
    .index("by_profileId_userId_state_updatedAt", ["profileId", "userId", "state", "updatedAt"])
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
    // True when verification only recorded a control proof and link for a
    // profile the claimant already owned verified — no ownership changed and no
    // claim request was written. Persisted because the UI cannot reconstruct it
    // from claim state afterwards, and reporting such a proof as a completed
    // claim inflates the funnel with connection additions.
    connectionOnly: v.optional(v.boolean()),
    // Paces the collector so a pending attempt is not re-read from the
    // provider on every worker pass.
    lastCheckedAt: v.optional(v.number()),
    // The collector that was served this attempt. `recordProofCheckResult`
    // accepts a verdict only from this collector, so one leaked worker key
    // cannot attest arbitrary attempts it was never given.
    lastCheckedByCollectorAccountId: v.optional(v.id("collectorAccounts")),
  })
    .index("by_profileId_state", ["profileId", "state"])
    .index("by_profileId_userId_state_updatedAt", ["profileId", "userId", "state", "updatedAt"])
    .index("by_userId_state", ["userId", "state"])
    .index("by_state_expiresAt", ["state", "expiresAt"])
    // targetType precedes lastCheckedAt so collector-eligible attempts are
    // selected by the index rather than filtered after the fact; filtering
    // afterwards let never-stamped vrclinking rows hold the head of the scan
    // window forever and starve the queue.
    .index("by_state_targetType_lastCheckedAt", ["state", "targetType", "lastCheckedAt"])
    // Creation rate per claimant and target, independent of state. The open
    // attempt cap counts only `pending` rows, so cancelling one frees its slot
    // immediately — and because the adapter cooldown lives on the attempt row,
    // a fresh attempt starts with none. Without this index there was no way to
    // see the attempts a claimant had just discarded.
    .index("by_userId_targetType_createdAt", ["userId", "targetType", "createdAt"]),
  // A user proved they control an external asset. This is deliberately not a
  // claim: proving you administer a Discord guild says nothing about which
  // VRDex profile that guild represents. Profile ownership is granted only
  // when a proof is paired with a `profileExternalLinks` row.
  externalControlProofs: defineTable({
    userId: v.id("users"),
    assetType: externalAssetType,
    assetExternalId: v.string(),
    assetDisplayName: v.optional(v.string()),
    controlLevel: externalControlLevel,
    state: externalControlProofState,
    evidenceSource: profileVerificationEvidenceSource,
    // Which external identity the evidence came from — for Discord, the
    // provider account id that completed the OAuth round-trip. A user may
    // verify through more than one Discord account, and a later result is only
    // authoritative about the guilds of the identity that produced it.
    evidenceSubjectId: v.optional(v.string()),
    evidenceSummary: v.optional(v.string()),
    verifiedAt: v.number(),
    revalidateAfter: v.optional(v.number()),
    lastRevalidatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_assetType_assetExternalId", ["userId", "assetType", "assetExternalId"])
    .index("by_userId_state", ["userId", "state"])
    .index("by_assetType_assetExternalId_state", ["assetType", "assetExternalId", "state"])
    .index("by_state_revalidateAfter", ["state", "revalidateAfter"]),
  // A community operator's delegated VRCLinking API key, held so VRDex can read
  // that guild's Discord-to-VRChat linkage.
  //
  // Only a reference is stored. VRCLinking keys are account-scoped and grant
  // broad read over every guild the granting account can see, so the token
  // itself lives in the operator secret store and is resolved by the adapter,
  // never by Convex. `guildId` records the single guild this delegation is
  // authorized for, so a key that can technically read more cannot be used to.
  communityVrclinkingCredentials: defineTable({
    communityProfileId: v.id("profiles"),
    guildId: v.string(),
    secretRef: v.string(),
    state: v.union(v.literal("active"), v.literal("revoked")),
    delegatedByUserId: v.id("users"),
    // Three separate facts, because conflating them makes one of them wrong.
    // `lastRotatedAt` is a selection cursor only: every row a selection pass
    // considers is stamped, eligible or not, or ineligible rows pin the head of
    // the index forever. `lastConsultedAt` is operator-visible and means the
    // reference was actually sent to the adapter. `lastUsedAt` records only the
    // consultation that matched, so an operator's audit trail is not noise from
    // every other community's proofs.
    lastRotatedAt: v.optional(v.number()),
    lastConsultedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    lastResultSummary: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
    revokedReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_communityProfileId_state", ["communityProfileId", "state"])
    .index("by_guildId_state", ["guildId", "state"])
    .index("by_state_lastRotatedAt", ["state", "lastRotatedAt"])
    .index("by_delegatedByUserId", ["delegatedByUserId"]),
  // Short-lived CSRF state for the purpose-scoped Discord guild-verification
  // OAuth round-trip. Stored server-side rather than in a cookie so the flow
  // survives browser restarts and stays bound to the signed-in user.
  discordVerificationStates: defineTable({
    userId: v.id("users"),
    state: v.string(),
    returnTo: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),
  // Orders OAuth reconciliations for one Discord identity.
  //
  // Overlapping callbacks can land out of order, and the proof rows alone
  // cannot order them: a result with no manageable guilds writes no proof and
  // revokes nothing, so it leaves no trace for a later-arriving older result to
  // lose against — which is exactly the case where that older result would
  // resurrect access Discord had just reported as gone.
  //
  // A counter rather than a timestamp. `Date.now()` in two action workers can
  // tie or run backwards under clock skew, and this decides whether revoked
  // access comes back. `issuedGeneration` is reserved before the guild read;
  // `appliedGeneration` is the newest result already written.
  discordVerificationWatermarks: defineTable({
    userId: v.id("users"),
    discordUserId: v.string(),
    issuedGeneration: v.number(),
    appliedGeneration: v.number(),
    // Stamped only when a reconciliation actually lands, unlike `updatedAt`,
    // which `reserveGuildVerificationGeneration` bumps before the guild read.
    // Selecting the current Discord identity needs a success-only timestamp, or
    // a reservation that then failed would outrank a completed verification.
    appliedAt: v.optional(v.number()),
    // When `issuedGeneration` was drawn. A reservation whose callback dies
    // without applying would otherwise suppress every earlier reader forever,
    // so an outstanding one stops counting once it is older than a round-trip
    // could plausibly take.
    issuedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId_discordUserId", ["userId", "discordUserId"]),
  // Many-to-many association between a profile and an external asset. One
  // community may hold several Discord guilds and VRChat groups (one marked
  // `primary`), and one guild may back several community profiles.
  profileExternalLinks: defineTable({
    profileId: v.id("profiles"),
    assetType: externalAssetType,
    assetExternalId: v.string(),
    assetDisplayName: v.optional(v.string()),
    linkRole: profileExternalLinkRole,
    state: profileExternalLinkState,
    // Absent when an operator seeded the association rather than a claimant
    // asserting it. That distinction is what makes the association usable as
    // independent corroboration of a claim.
    linkedByUserId: v.optional(v.id("users")),
    verifiedByProofId: v.optional(v.id("externalControlProofs")),
    createdAt: v.number(),
    updatedAt: v.number(),
    removedAt: v.optional(v.number()),
  })
    .index("by_profileId_state", ["profileId", "state"])
    .index("by_profileId_assetType_state", ["profileId", "assetType", "state"])
    .index("by_assetType_assetExternalId_state", ["assetType", "assetExternalId", "state"])
    .index("by_profileId_assetType_assetExternalId", [
      "profileId",
      "assetType",
      "assetExternalId",
    ])
    .index("by_linkedByUserId", ["linkedByUserId"]),
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
    resolvedBy: v.optional(authSubject),
    resolvedAt: v.optional(v.number()),
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
  seedImportBatches: defineTable({
    externalBatchId: v.string(),
    sourceName: v.string(),
    sourceType: seedImportSourceTypeValidator,
    sourceContact: v.optional(v.string()),
    receivedAt: v.number(),
    sourceObservedAt: v.optional(v.number()),
    publicationPolicy: v.optional(seedImportPublicationPolicyValidator),
    // Append-only: the durable record of each time publication was authorized.
    // `notes` is a mutable review buffer and cannot hold this, and a batch can be
    // revoked to private_only and later reauthorized with a new reason.
    publicationAuthorizations: v.optional(
      v.array(
        v.object({
          // Both directions are recorded, so the history shows why publication was
          // permitted *and* why it was revoked. `policy` is optional for rows
          // written before revocations were recorded.
          policy: v.optional(seedImportPublicationPolicyValidator),
          reason: v.string(),
          authorizedBy: v.optional(authSubject),
          authorizedAt: v.number(),
        }),
      ),
    ),
    importedBy: v.optional(authSubject),
    reviewState: seedImportBatchReviewStateValidator,
    reviewedBy: v.optional(authSubject),
    reviewedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_externalBatchId", ["externalBatchId"])
    .index("by_reviewState_receivedAt", ["reviewState", "receivedAt"])
    .index("by_sourceType_receivedAt", ["sourceType", "receivedAt"]),
  seedImportCandidateProfiles: defineTable({
    batchId: v.id("seedImportBatches"),
    externalCandidateId: v.string(),
    importFingerprint: v.optional(v.string()),
    profileType: seedImportProfileTypeValidator,
    proposedDisplayName: v.string(),
    proposedSlug: v.optional(v.string()),
    reviewState: seedImportCandidateReviewStateValidator,
    publicationState: seedImportCandidatePublicationStateValidator,
    claimState: seedImportClaimStateValidator,
    matchedProfileId: v.optional(v.id("profiles")),
    reviewer: v.optional(authSubject),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    publicationQueuedBy: v.optional(authSubject),
    publicationQueuedAt: v.optional(v.number()),
    publishedProfileId: v.optional(v.id("profiles")),
    publishedAt: v.optional(v.number()),
    publishedBy: v.optional(authSubject),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_batchId", ["batchId"])
    .index("by_batchId_reviewState", ["batchId", "reviewState"])
    .index("by_batchId_publicationState", ["batchId", "publicationState"])
    .index("by_batchId_externalCandidateId", ["batchId", "externalCandidateId"])
    .index("by_externalCandidateId", ["externalCandidateId"])
    .index("by_matchedProfileId", ["matchedProfileId"])
    .searchIndex("search_proposedDisplayName", {
      searchField: "proposedDisplayName",
      filterFields: ["profileType", "publicationState"],
    }),
  seedImportCandidateFields: defineTable({
    candidateId: v.id("seedImportCandidateProfiles"),
    fieldKey: v.string(),
    value: v.any(),
    sourceLabel: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceType: seedImportSourceTypeValidator,
    sourceObservedAt: v.optional(v.number()),
    lastCheckedAt: v.optional(v.number()),
    confidence: seedImportFieldConfidenceValidator,
    reviewState: seedImportFieldReviewStateValidator,
    visibility: seedImportFieldVisibilityValidator,
    reviewedBy: v.optional(authSubject),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_candidateId", ["candidateId"])
    .index("by_candidateId_reviewState", ["candidateId", "reviewState"])
    .index("by_candidateId_visibility", ["candidateId", "visibility"])
    .index("by_fieldKey_reviewState", ["fieldKey", "reviewState"]),
  seedHandoffInvitations: defineTable({
    tokenHash: v.string(),
    candidateId: v.id("seedImportCandidateProfiles"),
    profileId: v.optional(v.id("profiles")),
    offeredFieldIds: v.array(v.id("seedImportCandidateFields")),
    state: seedHandoffInvitationState,
    createdBy: authSubject,
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedBy: v.optional(authSubject),
    revokedAt: v.optional(v.number()),
    revokeReason: v.optional(v.string()),
    acceptedByUserId: v.optional(v.id("users")),
    acceptedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_candidateId_state", ["candidateId", "state"])
    .index("by_profileId_state", ["profileId", "state"])
    .index("by_acceptedByUserId", ["acceptedByUserId"]),
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
  shortLinks: defineTable({
    code: v.string(),
    targetType: shortLinkTargetType,
    targetProfileId: v.optional(v.id("profiles")),
    targetWorldId: v.optional(v.id("worlds")),
    targetEventId: v.optional(v.id("events")),
    createdAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_targetProfileId", ["targetProfileId"])
    .index("by_targetWorldId", ["targetWorldId"])
    .index("by_targetEventId", ["targetEventId"]),
});
