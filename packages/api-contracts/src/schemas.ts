import * as z from "zod/v4";

import { apiRouteClasses, apiScopes } from "./auth";

export { z };

const absoluteUrl = z.url();
const slug = z.string().min(1).max(160);
const timestampMs = z.number().int().nonnegative();

export const ProfileTypeSchema = z
  .enum(["person", "community"])
  .meta({ description: "The public profile entity class." });

export const TrustLabelSchema = z
  .enum(["community_submitted", "unclaimed", "claimed_unverified", "claimed_verified"])
  .meta({ description: "The public trust and claim state shown for the profile." });

export const PublicClaimStateSchema = z
  .enum(["unclaimed", "claimed_unverified", "claimed_verified"])
  .meta({ description: "The public claim state without private owner account details." });

export const PublicSourceTypeSchema = z
  .enum(["manual", "owner", "community", "partner", "import", "moderator", "ai_suggested"])
  .meta({ description: "Public source or provenance class." });

export const PublicEventSourceTypeSchema = z
  .enum(["manual", "community", "partner", "import", "ai_suggested"])
  .meta({ description: "Public event source class." });

export const SourceSummarySchema = z
  .object({
    label: z.string().optional(),
    sourceType: PublicSourceTypeSchema.optional(),
    submittedAt: timestampMs.optional(),
    updatedAt: timestampMs.optional(),
    url: absoluteUrl.optional(),
  })
  .passthrough()
  .meta({ description: "Public summary for community-submitted, imported, owner-authored, or reviewed data." });

export const PublicGenreSchema = z
  .object({
    displayLabel: z.string().optional(),
    displayName: z.string().min(1),
    featured: z.boolean().optional(),
    slug: z.string().optional(),
  })
  .passthrough()
  .meta({ description: "A public genre or taxonomy label." });

export const PublicOutboundLinkSchema = z
  .object({
    label: z.string().min(1),
    source: z.string().optional(),
    type: z.string().optional(),
    url: absoluteUrl,
  })
  .passthrough()
  .meta({ description: "A public outbound link." });

export const PublicProfileAssetSchema = z
  .object({
    assetId: z.string().optional(),
    byteSize: z.number().int().positive().optional(),
    caption: z.string().optional(),
    downloadUrl: absoluteUrl.optional(),
    imageUrl: absoluteUrl.optional(),
    label: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .passthrough()
  .meta({ description: "A public profile media or brand asset." });

export const PublicProfileAvatarAppearanceSchema = z
  .object({
    borderColor: z.string(),
    borderEnabled: z.boolean(),
    borderSoftnessPx: z.number().int().nonnegative(),
    borderWidthPx: z.number().int().positive(),
    radiusPercent: z.number().int().min(0).max(50),
  })
  .passthrough()
  .meta({ description: "Bounded public avatar presentation hints." });

export const PublicProfileMediaKitSchema = z
  .object({
    additionalLogos: z.array(PublicProfileAssetSchema),
    assets: z.array(PublicProfileAssetSchema),
    avatarAppearance: PublicProfileAvatarAppearanceSchema.optional(),
    banner: PublicProfileAssetSchema.optional(),
    compactDisplay: z.enum(["profile_image", "logo"]).optional(),
    logoZipUrl: absoluteUrl.optional(),
    logos: z.array(PublicProfileAssetSchema),
    primaryLogo: PublicProfileAssetSchema.optional(),
    profileImage: PublicProfileAssetSchema.optional(),
  })
  .passthrough()
  .meta({ description: "Public media kit metadata for a public profile." });

export const PublicProfileSchema = z
  .object({
    aliases: z.array(z.string()).optional(),
    appearance: z.unknown().optional(),
    avatarImageUrl: absoluteUrl.optional(),
    bannerImageUrl: absoluteUrl.optional(),
    bio: z.string().optional(),
    displayName: z.string().min(1),
    genres: z.array(PublicGenreSchema).optional(),
    hostedEvents: z.array(z.unknown()).optional(),
    mediaKit: PublicProfileMediaKitSchema.optional(),
    outboundLinks: z.array(PublicOutboundLinkSchema).optional(),
    profileType: ProfileTypeSchema,
    slug,
    source: SourceSummarySchema.optional(),
    tags: z.array(z.string()).optional(),
    trustLabel: TrustLabelSchema,
    upcomingEvents: z.array(z.unknown()).optional(),
    worldCredits: z.array(z.unknown()).optional(),
  })
  .passthrough()
  .meta({
    description: "Public profile response. Unknown fields are preserved while the API is still stabilizing.",
    id: "PublicProfile",
  });

export const PublicProfileAssetsResponseSchema = z
  .object({
    assets: z.array(PublicProfileAssetSchema),
    displayName: z.string().min(1),
    mediaKit: PublicProfileMediaKitSchema.optional(),
    profileType: ProfileTypeSchema,
    slug,
  })
  .passthrough()
  .meta({
    description: "Public assets for a profile.",
    id: "PublicProfileAssetsResponse",
  });

export const PublicProfileLogosResponseSchema = z
  .object({
    additionalLogos: z.array(PublicProfileAssetSchema).optional(),
    displayName: z.string().min(1),
    logoZipUrl: absoluteUrl.optional(),
    logos: z.array(PublicProfileAssetSchema),
    primaryLogo: PublicProfileAssetSchema.optional(),
    profileType: ProfileTypeSchema,
    slug,
  })
  .passthrough()
  .meta({
    description: "Public logo assets for a profile.",
    id: "PublicProfileLogosResponse",
  });

export const PublicClaimStatusResponseSchema = z
  .object({
    claimState: PublicClaimStateSchema,
    displayName: z.string().min(1),
    profileType: ProfileTypeSchema,
    slug,
    trustLabel: TrustLabelSchema,
  })
  .passthrough()
  .meta({
    description: "Public claim and trust state for a public profile.",
    id: "PublicClaimStatusResponse",
  });

export const PublicSearchEntityTypeSchema = z
  .enum(["profile", "world", "event"])
  .meta({ description: "Search result entity class." });

export const PublicSearchResultSchema = z
  .object({
    entityType: PublicSearchEntityTypeSchema,
    imageUrl: absoluteUrl.optional(),
    logoImageUrl: absoluteUrl.optional(),
    profileImageUrl: absoluteUrl.optional(),
    profileType: ProfileTypeSchema.optional(),
    routePath: z.string().min(1),
    score: z.number(),
    slug,
    source: SourceSummarySchema.optional(),
    startsAt: timestampMs.optional(),
    subtitle: z.string().optional(),
    summary: z.string().optional(),
    title: z.string().min(1),
  })
  .passthrough()
  .meta({
    description: "Compact public discovery/search result.",
    id: "PublicSearchResult",
  });

export const PublicSearchResponseSchema = z
  .object({
    query: z.string(),
    results: z.array(PublicSearchResultSchema),
    type: z.enum(["all", "person", "community", "profile", "world", "event"]).optional(),
  })
  .passthrough()
  .meta({
    description: "Public search response.",
    id: "PublicSearchResponse",
  });

export const PublicEventSourceSchema = z
  .object({
    label: z.string().min(1),
    sourceType: PublicEventSourceTypeSchema,
    url: absoluteUrl.optional(),
  })
  .passthrough()
  .meta({ description: "Public event source summary." });

export const PublicEventMediaLinkSchema = z
  .object({
    label: z.string().min(1),
    presentation: z.enum(["open", "copy"]),
    type: z.enum(["event_page", "watch", "stream", "vrcdn", "discord", "ticket", "other"]),
    url: absoluteUrl,
  })
  .passthrough()
  .meta({ description: "Public event media or outbound link." });

export const PublicEventWorldSummarySchema = z
  .object({
    displayName: z.string().min(1),
    slug,
  })
  .passthrough()
  .meta({ description: "Public event world summary." });

export const PublicEventPreviewSchema = z
  .object({
    bannerImageUrl: absoluteUrl.optional(),
    communityImageUrl: absoluteUrl.optional(),
    communityName: z.string().optional(),
    communitySlug: slug.optional(),
    doorsOpenAt: timestampMs.optional(),
    endAt: timestampMs.optional(),
    participantCount: z.number().int().nonnegative().optional(),
    posterImageUrl: absoluteUrl.optional(),
    slug: slug.optional(),
    slotCount: z.number().int().nonnegative().optional(),
    source: PublicEventSourceSchema,
    startAt: timestampMs,
    summary: z.string().optional(),
    thumbnailImageUrl: absoluteUrl.optional(),
    timezone: z.string().optional(),
    title: z.string().min(1),
    worlds: z.array(PublicEventWorldSummarySchema).optional(),
  })
  .passthrough()
  .meta({
    description: "Compact public event card.",
    id: "PublicEventPreview",
  });

export const PublicEventSchema = PublicEventPreviewSchema.extend({
  authoredMediaLinks: z.array(PublicEventMediaLinkSchema).optional(),
  id: z.string(),
  mediaLinks: z.array(PublicEventMediaLinkSchema).optional(),
  notes: z.string().optional(),
  participants: z.array(z.unknown()).optional(),
  slots: z.array(z.unknown()).optional(),
  slug,
  watchSurfaceEnabled: z.boolean(),
  worlds: z.array(z.unknown()).optional(),
})
  .passthrough()
  .meta({
    description: "Public event detail response.",
    id: "PublicEvent",
  });

export const PublicEventsResponseSchema = z
  .object({
    events: z.array(PublicEventPreviewSchema),
  })
  .passthrough()
  .meta({
    description: "List of public event cards.",
    id: "PublicEventsResponse",
  });

export const PublicWorldEventPreviewSchema = z
  .object({
    bannerImageUrl: absoluteUrl.optional(),
    communityName: z.string().optional(),
    doorsOpenAt: timestampMs.optional(),
    endAt: timestampMs.optional(),
    mediaLinks: z.array(PublicEventMediaLinkSchema),
    posterImageUrl: absoluteUrl.optional(),
    slug: slug.optional(),
    source: PublicEventSourceSchema,
    startAt: timestampMs,
    summary: z.string().optional(),
    thumbnailImageUrl: absoluteUrl.optional(),
    timezone: z.string().optional(),
    title: z.string().min(1),
    worldAssociation: z.object({ confirmationState: z.literal("confirmed") }).passthrough(),
  })
  .passthrough()
  .meta({ description: "Public event card as shown in world context." });

export const PublicWorldSchema = z
  .object({
    canonicalVrchatWorldUrl: absoluteUrl.optional(),
    creatorAttributions: z.array(z.unknown()),
    description: z.string().optional(),
    displayName: z.string().min(1),
    eventContext: z
      .object({
        recent: z.array(PublicWorldEventPreviewSchema),
        upcoming: z.array(PublicWorldEventPreviewSchema),
      })
      .passthrough()
      .optional(),
    heroImageUrl: absoluteUrl.optional(),
    media: z.array(z.unknown()),
    outboundLinks: z.array(PublicOutboundLinkSchema),
    platformCompatibility: z.array(z.string()),
    slug,
    source: SourceSummarySchema.optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()),
    visibilityStatus: z.string(),
    vrchatWorldId: z.string().optional(),
  })
  .passthrough()
  .meta({
    description: "Public world detail response.",
    id: "PublicWorld",
  });

export const PublicActiveWorldSchema = z
  .object({
    activityLabel: z.literal("Hosting upcoming events"),
    displayName: z.string().min(1),
    heroImageUrl: absoluteUrl.optional(),
    nextEvent: PublicEventPreviewSchema.omit({
      bannerImageUrl: true,
      communityImageUrl: true,
      participantCount: true,
      posterImageUrl: true,
      slotCount: true,
      summary: true,
      thumbnailImageUrl: true,
      worlds: true,
    }).passthrough(),
    slug,
    summary: z.string().optional(),
    tags: z.array(z.string()),
    upcomingEventCount: z.number().int().nonnegative(),
  })
  .passthrough()
  .meta({
    description: "Public world currently hosting upcoming or live public events.",
    id: "PublicActiveWorld",
  });

export const PublicActiveWorldsResponseSchema = z
  .object({
    worlds: z.array(PublicActiveWorldSchema),
  })
  .passthrough()
  .meta({
    description: "Public active worlds response.",
    id: "PublicActiveWorldsResponse",
  });

export const ApiRouteClassSchema = z
  .enum(apiRouteClasses)
  .meta({ description: "Public API and MCP rate-limit route class." });

export const ApiScopeSchema = z.enum(apiScopes).meta({ description: "Public API or MCP credential scope." });

export const ApiRateLimitCallerKindSchema = z
  .enum(["anonymous", "personal_api_token", "oauth_client"])
  .meta({ description: "Credential class used to choose the caller's current rate-limit bucket." });

export const ApiRateLimitPolicySchema = z
  .object({
    limit: z.number().int().positive(),
    routeClass: ApiRouteClassSchema,
    windowMs: z.number().int().positive(),
  })
  .meta({ description: "Default fixed-window quota policy for a route class.", id: "ApiRateLimitPolicy" });

export const ApiRateLimitCurrentWindowSchema = z
  .object({
    limit: z.number().int().positive(),
    remaining: z.number().int().nonnegative(),
    resetAt: timestampMs,
    retryAfterSeconds: z.number().int().positive(),
    routeClass: ApiRouteClassSchema,
    windowMs: z.number().int().positive(),
  })
  .meta({ description: "The caller's current rate-limit window for this request.", id: "ApiRateLimitCurrentWindow" });

export const ApiRateLimitUsageResponseSchema = z
  .object({
    caller: z
      .object({
        authenticated: z.boolean(),
        credentialKind: ApiRateLimitCallerKindSchema,
        routeClass: ApiRouteClassSchema,
      })
      .meta({ description: "Caller classification used for rate-limit policy selection." }),
    currentWindow: ApiRateLimitCurrentWindowSchema,
    policies: z.array(ApiRateLimitPolicySchema),
  })
  .meta({
    description: "Rate-limit policy table plus the current request's effective caller window.",
    id: "ApiRateLimitUsageResponse",
  });

export const ApiMeCredentialSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("api_token"),
      ownerCommunityProfileId: z.string().optional(),
      ownerKind: z.enum(["community", "user"]),
      ownerUserId: z.string(),
      scopes: z.array(ApiScopeSchema),
      tokenId: z.string(),
      trustTier: z.enum(["personal", "trusted_partner"]),
    }),
    z.object({
      kind: z.literal("oauth"),
      applicationId: z.string().optional(),
      clientId: z.string(),
      dynamicClientId: z.string().optional(),
      ownerCommunityProfileId: z.string().optional(),
      ownerKind: z.enum(["community", "user"]).optional(),
      ownerUserId: z.string().optional(),
      scopes: z.array(ApiScopeSchema),
      subjectType: z.enum(["client", "user"]),
      trustTier: z.enum(["standard", "trusted_partner"]),
      userId: z.string().optional(),
    }),
  ])
  .meta({ description: "Validated bearer credential metadata for the current API caller.", id: "ApiMeCredential" });

export const ApiMeResponseSchema = z
  .object({
    credential: ApiMeCredentialSchema,
    rateLimit: ApiRateLimitCurrentWindowSchema,
  })
  .meta({
    description: "Current authenticated API caller and effective public-read rate-limit window.",
    id: "ApiMeResponse",
  });

export const ApiCredentialOwnerKindSchema = z
  .enum(["community", "user"])
  .meta({ description: "Developer credential owner class." });

export const ApiCredentialStatusSchema = z
  .enum(["active", "revoked"])
  .meta({ description: "Developer credential lifecycle status." });

export const ApiTokenTrustTierSchema = z
  .enum(["personal", "trusted_partner"])
  .meta({ description: "Personal API token trust tier." });

export const OAuthClientTypeSchema = z
  .enum(["public", "confidential"])
  .meta({ description: "OAuth application client type." });

export const OAuthGrantTypeSchema = z
  .enum(["authorization_code", "refresh_token", "client_credentials"])
  .meta({ description: "OAuth grant type allowed for an application." });

export const OAuthApplicationTrustTierSchema = z
  .enum(["standard", "trusted_partner"])
  .meta({ description: "OAuth application trust tier." });

export const ApiTokenSummarySchema = z
  .object({
    id: z.string().min(1),
    tokenPrefix: z.string().min(1),
    ownerKind: ApiCredentialOwnerKindSchema,
    ownerUserId: z.string().min(1),
    ownerCommunityProfileId: z.string().min(1).optional(),
    label: z.string().min(1),
    scopes: z.array(ApiScopeSchema),
    status: ApiCredentialStatusSchema,
    trustTier: ApiTokenTrustTierSchema,
    expiresAt: timestampMs.optional(),
    createdAt: timestampMs,
    updatedAt: timestampMs,
    lastUsedAt: timestampMs.optional(),
    lastUsedRouteClass: ApiRouteClassSchema.optional(),
    revokedAt: timestampMs.optional(),
    revokeReason: z.string().optional(),
  })
  .meta({
    description: "User-owned personal API token metadata. Raw token values are never returned.",
    id: "ApiTokenSummary",
  });

export const OAuthApplicationSummarySchema = z
  .object({
    id: z.string().min(1),
    clientId: z.string().min(1),
    ownerKind: ApiCredentialOwnerKindSchema,
    ownerUserId: z.string().min(1),
    ownerCommunityProfileId: z.string().min(1).optional(),
    clientType: OAuthClientTypeSchema,
    displayName: z.string().min(1),
    description: z.string().optional(),
    logoUrl: absoluteUrl.optional(),
    docsUrl: absoluteUrl.optional(),
    privacyUrl: absoluteUrl.optional(),
    termsUrl: absoluteUrl.optional(),
    redirectUris: z.array(absoluteUrl),
    allowedGrants: z.array(OAuthGrantTypeSchema),
    allowedScopes: z.array(ApiScopeSchema),
    status: ApiCredentialStatusSchema,
    trustTier: OAuthApplicationTrustTierSchema,
    createdAt: timestampMs,
    updatedAt: timestampMs,
    lastUsedAt: timestampMs.optional(),
    reviewedAt: timestampMs.optional(),
    revokedAt: timestampMs.optional(),
    revokeReason: z.string().optional(),
    activeSecretPrefixes: z.array(z.string().min(1)),
  })
  .meta({
    description: "User-owned OAuth application metadata. Raw client secrets are never returned.",
    id: "OAuthApplicationSummary",
  });

export const DeveloperTokensResponseSchema = z
  .object({
    tokens: z.array(ApiTokenSummarySchema),
  })
  .meta({
    description: "User-owned personal API token list.",
    id: "DeveloperTokensResponse",
  });

export const DeveloperOAuthAppsResponseSchema = z
  .object({
    applications: z.array(OAuthApplicationSummarySchema),
  })
  .meta({
    description: "User-owned OAuth application list.",
    id: "DeveloperOAuthAppsResponse",
  });

export const ApiProblemSchema = z
  .object({
    detail: z.string().optional(),
    instance: z.string().optional(),
    status: z.number().int().min(100).max(599),
    title: z.string().min(1),
    type: z.string().min(1),
  })
  .meta({
    description: "RFC 9457 problem details error response.",
    id: "ApiProblem",
  });

export const SlugPathParamsSchema = z.object({
  slug: slug.meta({
    description: "Public slug.",
  }),
});

export const SearchQueryParamsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().meta({ description: "Maximum result count." }),
  q: z.string().optional().meta({ description: "Search query text." }),
  type: z
    .enum(["all", "person", "community", "profile", "world", "event"])
    .optional()
    .meta({ description: "Optional search result type filter." }),
});

export const LimitQueryParamsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().meta({ description: "Maximum result count." }),
});

export const DeveloperCredentialListQueryParamsSchema = z.object({
  includeRevoked: z.boolean().optional().meta({ description: "Include revoked credentials." }),
  limit: z.number().int().min(1).max(100).optional().meta({ description: "Maximum result count." }),
});

export const AssetPathParamsSchema = SlugPathParamsSchema;
