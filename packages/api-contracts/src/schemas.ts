import * as z from "zod/v4";

import { apiRouteClasses, apiScopes, oauthApiScopes } from "./auth";

export { z };

const absoluteUrl = z.url();
const safeHttpUrl = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }, "URL must use HTTP or HTTPS without embedded credentials.");
const absoluteOrRootRelativeUrl = z
  .union([absoluteUrl, z.string().regex(/^\/(?!\/)/)])
  .meta({
    description: "An absolute URL or a same-origin root-relative URL.",
    id: "AbsoluteOrRootRelativeUrl",
  });
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

export const ProfilePublicationStateSchema = z
  .enum(["draft_private", "published"])
  .meta({ description: "Profile or event publication state for an authenticated owner inventory." });

export const ProfilePublicSurfacingStateSchema = z
  // `archived` is here because an owner can see it: a super admin may archive a
  // claimed profile, and the owner inventory then reports the state of a page
  // they still own. Leaving it out did not hide anything -- `apiJson` parses
  // this on the way out, so one archived profile threw the whole request.
  .enum(["public", "opted_out", "suppressed", "archived"])
  .meta({ description: "Profile public surfacing state for an authenticated owner inventory." });

export const ProfileCreationSourceSchema = z
  .enum(["self", "community", "concierge", "import", "moderator"])
  .meta({ description: "How the profile was originally created." });

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
    altText: z.string().optional(),
    credit: z.string().optional(),
    creditUrl: safeHttpUrl.optional(),
    downloadUrl: absoluteOrRootRelativeUrl.optional(),
    downloadByteSize: z.number().int().positive().optional(),
    downloadMimeType: z.string().optional(),
    imageUrl: absoluteOrRootRelativeUrl.optional(),
    label: z.string().optional(),
    mimeType: z.string().optional(),
    sourcePreserved: z.boolean().optional(),
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
    galleryAssets: z.array(PublicProfileAssetSchema).optional(),
    avatarAppearance: PublicProfileAvatarAppearanceSchema.optional(),
    banner: PublicProfileAssetSchema.optional(),
    featuredAsset: PublicProfileAssetSchema.optional(),
    compactDisplay: z.enum(["profile_image", "logo"]).optional(),
    logoZipUrl: absoluteOrRootRelativeUrl.optional(),
    logos: z.array(PublicProfileAssetSchema),
    primaryLogo: PublicProfileAssetSchema.optional(),
    profileImage: PublicProfileAssetSchema.optional(),
  })
  .passthrough()
  .meta({ description: "Public media kit metadata for a public profile." });

const PublicTelemetryWorldDistributionSchema = z.object({
  vrchatWorldId: z.string().startsWith("wrld_"),
  samples: z.number().int().nonnegative(),
});

const PublicTelemetryRollupSchema = z.object({
  startAt: z.number().int().nonnegative(),
  endAt: z.number().int().nonnegative(),
  durationMinutes: z.number().nonnegative(),
  currentPopulation: z.number().int().nonnegative().optional(),
  activeInstanceCount: z.number().int().nonnegative(),
  peakConcurrency: z.number().int().nonnegative(),
  playerHours: z.number().nonnegative(),
  coverageRatio: z.number().min(0).max(1),
  groupMemberCount: z.number().int().nonnegative().optional(),
  groupMemberGrowth: z.number().int().optional(),
  worldDistribution: z.array(PublicTelemetryWorldDistributionSchema),
});

export const PublicCommunityTelemetrySchema = z.object({
  schemaVersion: z.literal(1),
  rollupVersion: z.string().min(1),
  freshness: z.enum(["current", "stale"]),
  observedAt: z.number().int().nonnegative().optional(),
  definitions: z.record(z.string(), z.object({
    unit: z.string().min(1),
    grain: z.string().min(1),
    gapPolicy: z.string().min(1),
  })),
  currentPopulation: z.object({
    value: z.number().int().nonnegative(),
    activeInstanceCount: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
    coverage: z.enum(["observed", "estimated", "stale", "unknown", "degraded"]),
  }).optional(),
  populationHistory: z.array(PublicTelemetryRollupSchema).optional(),
  groupMemberCount: z.object({
    value: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
  }).optional(),
  groupMemberGrowth: z.object({
    value: z.number().int(),
    startAt: z.number().int().nonnegative(),
    endAt: z.number().int().nonnegative(),
  }).optional(),
  eventRecaps: z.array(PublicTelemetryRollupSchema.extend({
    event: z.object({ slug, title: z.string().min(1) }).optional(),
  })).optional(),
}).meta({ description: "Independently opted-in aggregate telemetry for a public community profile." });

export const PublicProfileSchema = z
  .object({
    aliases: z.array(z.string()).optional(),
    appearance: z.unknown().optional(),
    avatarImageUrl: absoluteOrRootRelativeUrl.optional(),
    bannerImageUrl: absoluteOrRootRelativeUrl.optional(),
    bio: z.string().optional(),
    displayName: z.string().min(1),
    genres: z.array(PublicGenreSchema).optional(),
    hostedEvents: z.array(z.unknown()).optional(),
    /** The stable profile identity, matching `PublicEvent.id`. */
    id: z.string(),
    mediaKit: PublicProfileMediaKitSchema.optional(),
    outboundLinks: z.array(PublicOutboundLinkSchema).optional(),
    profileType: ProfileTypeSchema,
    slug,
    source: SourceSummarySchema.optional(),
    tags: z.array(z.string()).optional(),
    telemetry: PublicCommunityTelemetrySchema.optional(),
    trustLabel: TrustLabelSchema,
    upcomingEvents: z.array(z.unknown()).optional(),
    /**
     * The profile's current revision, to send back as `expectedUpdatedAt`.
     *
     * This is the read half of the write conflict check. Without it a caller had
     * no revision to pin, so two contributors correcting the same unclaimed
     * profile could only find out about each other by noticing their links gone.
     */
    updatedAt: timestampMs,
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
    logoZipUrl: absoluteOrRootRelativeUrl.optional(),
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
    avatarAppearance: PublicProfileAvatarAppearanceSchema.optional(),
    entityType: PublicSearchEntityTypeSchema,
    imageUrl: absoluteOrRootRelativeUrl.optional(),
    logoImageUrl: absoluteOrRootRelativeUrl.optional(),
    profileImageUrl: absoluteOrRootRelativeUrl.optional(),
    profileType: ProfileTypeSchema.optional(),
    routePath: z.string().min(1),
    score: z.number(),
    slug,
    source: SourceSummarySchema.optional(),
    startsAt: timestampMs.optional(),
    subtitle: z.string().optional(),
    summary: z.string().optional(),
    title: z.string().min(1),
    trustLabel: TrustLabelSchema.optional(),
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

export const McpDocumentSearchResultSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    url: absoluteUrl,
  })
  .meta({
    description: "OpenAI/ChatGPT-compatible MCP document search result.",
    id: "McpDocumentSearchResult",
  });

export const McpDocumentSearchResponseSchema = z
  .object({
    results: z.array(McpDocumentSearchResultSchema),
  })
  .meta({
    description: "OpenAI/ChatGPT-compatible MCP document search response.",
    id: "McpDocumentSearchResponse",
  });

export const McpDocumentFetchResponseSchema = z
  .object({
    id: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
    text: z.string().min(1),
    title: z.string().min(1),
    url: absoluteUrl,
  })
  .meta({
    description: "OpenAI/ChatGPT-compatible MCP document fetch response.",
    id: "McpDocumentFetchResponse",
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
    bannerImageUrl: absoluteOrRootRelativeUrl.optional(),
    communityAvatarAppearance: PublicProfileAvatarAppearanceSchema.optional(),
    communityImageUrl: absoluteOrRootRelativeUrl.optional(),
    communityName: z.string().optional(),
    communitySlug: slug.optional(),
    doorsOpenAt: timestampMs.optional(),
    endAt: timestampMs.optional(),
    participantCount: z.number().int().nonnegative().optional(),
    nextSlots: z
      .array(
        z.object({
          displayLabel: z.string(),
          endAt: timestampMs.optional(),
          performer: z
            .object({
              displayName: z.string(),
              slug,
            })
            .optional(),
          roleLabel: z.string(),
          startAt: timestampMs,
        }),
      )
      .optional(),
    posterImageUrl: absoluteOrRootRelativeUrl.optional(),
    slug: slug.optional(),
    slotCount: z.number().int().nonnegative().optional(),
    source: PublicEventSourceSchema,
    startAt: timestampMs,
    status: z.enum(["scheduled", "cancelled"]).optional(),
    summary: z.string().optional(),
    thumbnailImageUrl: absoluteOrRootRelativeUrl.optional(),
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

export const ApiEventCreateRequestSchema = z
  .object({
    title: z.string().min(2).max(120),
    communitySlug: slug,
    startAt: timestampMs,
    doorsOpenAt: timestampMs.optional(),
    endAt: timestampMs.optional(),
    timezone: z.string().max(64).optional(),
    worldSlug: slug.optional(),
    preferredSlug: slug.optional(),
    summary: z.string().max(240).optional(),
    notes: z.string().max(1_200).optional(),
    sourceLabel: z.string().max(120).optional(),
    sourceUrl: absoluteUrl.optional(),
    posterImageUrl: absoluteUrl.optional(),
    bannerImageUrl: absoluteUrl.optional(),
    thumbnailImageUrl: absoluteUrl.optional(),
    watchSurfaceEnabled: z.boolean().optional(),
    mediaLinks: z
      .array(
        z
          .object({
            type: z.enum(["event_page", "watch", "stream", "vrcdn", "discord", "ticket", "other"]),
            label: z.string().min(1).max(80),
            url: absoluteUrl,
            presentation: z.enum(["open", "copy"]).optional(),
          })
          .passthrough(),
      )
      .max(8)
      .optional(),
    participantLinks: z
      .array(
        z
          .object({
            personSlug: slug,
            roleLabel: z.string().max(48).optional(),
            sourceLabel: z.string().max(120).optional(),
            sourceUrl: absoluteUrl.optional(),
            notes: z.string().max(1_200).optional(),
          })
          .passthrough(),
      )
      .max(80)
      .optional(),
    slotLinks: z
      .array(
        z
          .object({
            personSlug: slug.optional(),
            displayLabel: z.string().min(1).max(120),
            roleLabel: z.string().max(48).optional(),
            startAt: timestampMs,
            endAt: timestampMs.optional(),
            sourceLabel: z.string().max(120).optional(),
            sourceUrl: absoluteUrl.optional(),
            notes: z.string().max(1_200).optional(),
          })
          .passthrough(),
      )
      .max(80)
      .optional(),
  })
  .meta({
    description:
      "Create a public event attached to a community profile owned by the current authenticated API user.",
    id: "ApiEventCreateRequest",
  });

export const ApiEventUpdateRequestSchema = ApiEventCreateRequestSchema.partial()
  .extend({
    doorsOpenAt: timestampMs.nullable().optional(),
    endAt: timestampMs.nullable().optional(),
    timezone: z.string().max(64).nullable().optional(),
    worldSlug: slug.nullable().optional(),
    summary: z.string().max(240).nullable().optional(),
    notes: z.string().max(1_200).nullable().optional(),
    sourceUrl: absoluteUrl.nullable().optional(),
    posterImageUrl: absoluteUrl.nullable().optional(),
    bannerImageUrl: absoluteUrl.nullable().optional(),
    thumbnailImageUrl: absoluteUrl.nullable().optional(),
  })
  .superRefine((value, context) => {
    const replacesParticipants = value.participantLinks !== undefined;
    const replacesSlots = value.slotLinks !== undefined;

    if (replacesParticipants !== replacesSlots) {
      context.addIssue({
        code: "custom",
        message: "Event participantLinks and slotLinks must be supplied together when replacing lineup data.",
        path: replacesParticipants ? ["slotLinks"] : ["participantLinks"],
      });
    }
  })
  .meta({
    description:
      "Update a public event attached to a community profile owned by the current authenticated API user. Omitted fields are preserved; null clears optional scalar fields and the world relation; empty arrays clear collection fields.",
    id: "ApiEventUpdateRequest",
  });

export const ApiEventWriteResponseSchema = z
  .object({
    eventId: z.string().min(1),
    slug,
    eventPath: z.string().min(1),
    shortLinkCode: z.string().min(1).optional(),
    shortLinkPath: z.string().min(1).optional(),
  })
  .meta({
    description: "Created or updated event write result.",
    id: "ApiEventWriteResponse",
  });

export const ProfileLinkTypeSchema = z
  .enum([
    "vrchat_profile",
    "vrcdn",
    "discord",
    "soundcloud",
    "mixcloud",
    "twitch",
    "youtube",
    "spotify",
    "bandcamp",
    "instagram",
    "linktree",
    "website",
    "gumroad",
    "jinxxy",
    "payhip",
    "woocommerce",
    "kofi",
    "patreon",
    "commissions",
    "generic_store",
    "other",
  ])
  .meta({ description: "Outbound profile link provider.", id: "ProfileLinkType" });

export const ApiProfileLinkInputSchema = z
  .object({
    type: ProfileLinkTypeSchema,
    // Deliberately not `safeHttpUrl`: a `vrcdn` link is normally pasted from the
    // player URLs VRCDN hands out, which use `rtspt://` and stream endpoints.
    // Those are resolved to the `vrcdn:<streamId>` identifier server-side, and
    // every other type is rejected there unless it is already HTTPS.
    url: z.string().min(1).max(2_048),
    label: z.string().min(1).max(120).optional(),
    handle: z.string().min(1).max(160).optional(),
    presentation: z.enum(["icon", "copy"]).optional(),
  })
  .meta({
    description:
      "Outbound profile link supplied by a profile owner or a community contributor. VRDex records which, and the public profile renders the distinction.",
    id: "ApiProfileLinkInput",
  });

export const ApiProfileUpdateRequestSchema = z
  .object({
    displayName: z.string().min(2).max(80).optional(),
    aliases: z.array(z.string().max(60)).max(8).optional(),
    tags: z.array(z.string().max(32)).max(12).optional(),
    headline: z.string().max(160).nullable().optional(),
    bio: z.string().max(600).nullable().optional(),
    region: z.string().max(80).nullable().optional(),
    timezone: z.string().max(80).nullable().optional(),
    person: z
      .object({
        pronouns: z.string().max(80).nullable().optional(),
        roleTags: z.array(z.string().max(32)).max(12).optional(),
      })
      .optional(),
    community: z
      .object({
        subtype: z.string().max(40).nullable().optional(),
        categoryTags: z.array(z.string().max(32)).max(12).optional(),
      })
      .optional(),
    outboundLinks: z.array(ApiProfileLinkInputSchema).max(20).optional(),
    /**
     * The `updatedAt` the writer last read, pinning what they are editing.
     *
     * Required, not optional, and with no exemption for owning the profile.
     * `outboundLinks` replaces the whole list, so any two writers who each read
     * before either wrote silently drop the other's links -- and owning a
     * profile does not make you its only writer, since the same person can have
     * the edit form open while an agent writes through a tool. A guard the
     * caller can decline by leaving the field out is not a guard.
     *
     * Read it from the profile's `updatedAt`. A pin the profile has moved past
     * answers 409; re-read and send again.
     */
    expectedUpdatedAt: timestampMs,
  })
  .meta({
    description:
      "Update editable metadata for a profile the current authenticated API user owns, or for an unclaimed profile as a community correction.",
    id: "ApiProfileUpdateRequest",
  });

export const ApiProfileSubmitRequestSchema = z
  .object({
    profileType: ProfileTypeSchema,
    displayName: z.string().min(2).max(80),
    aliases: z.array(z.string().max(60)).max(8).optional(),
    tags: z.array(z.string().max(32)).max(12).optional(),
    person: z
      .object({
        roleTags: z.array(z.string().max(32)).max(12).optional(),
      })
      .optional(),
    community: z
      .object({
        subtype: z.string().max(40).optional(),
        categoryTags: z.array(z.string().max(32)).max(12).optional(),
      })
      .optional(),
    outboundLinks: z.array(ApiProfileLinkInputSchema).max(20).optional(),
  })
  .meta({
    description:
      "Create an unclaimed community-sourced profile credited to the current authenticated API user.",
    id: "ApiProfileSubmitRequest",
  });

export const ApiProfileWriteResponseSchema = z
  .object({
    profileId: z.string().min(1),
    slug,
    profileType: ProfileTypeSchema,
    profilePath: z.string().min(1),
    /**
     * Whether the saved profile is readable at `profilePath`.
     *
     * False for a draft or opted-out profile its owner is entitled to edit. A
     * client that reads the profile back to confirm a write needs this to tell
     * "there is deliberately no public page" apart from "the write did not
     * surface", which otherwise look identical from a 404.
     */
    publiclyViewable: z.boolean(),
  })
  .meta({
    description: "Saved profile identifiers, public path, and whether that path is readable.",
    id: "ApiProfileWriteResponse",
  });

export const ProfileAssetPlacementSchema = z
  .enum(["profile_image", "banner", "primary_logo", "additional_logo", "gallery", "featured"])
  .meta({ description: "Profile media-kit placement to apply after upload completion." });

export const ProfileAssetMimeTypeSchema = z
  .enum(["image/png", "image/svg+xml", "image/jpeg", "image/webp"])
  .meta({ description: "Supported profile media upload MIME type." });

export const ApiProfileAssetUploadIntentCreateRequestSchema = z
  .object({
    originalFileName: z.string().min(1).max(180).optional(),
    sourceUrl: absoluteUrl.optional(),
    mimeType: ProfileAssetMimeTypeSchema,
    byteSize: z.number().int().positive().max(12 * 1024 * 1024).optional(),
    label: z.string().max(80).optional(),
    caption: z.string().max(240).optional(),
    altText: z.string().max(180).optional(),
    credit: z.string().max(120).optional(),
    creditUrl: safeHttpUrl.optional(),
    placements: z.array(ProfileAssetPlacementSchema).max(8).optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .refine((value) => value.originalFileName !== undefined || value.sourceUrl !== undefined, {
    message: "Send originalFileName for direct uploads or sourceUrl for server-side imports.",
  })
  .superRefine((value, context) => {
    if (
      value.originalFileName !== undefined &&
      value.sourceUrl === undefined &&
      value.byteSize === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "File uploads require byteSize.",
        path: ["byteSize"],
      });
    }
    const placements = value.placements ?? [];
    if (placements.includes("featured") && !placements.includes("gallery")) {
      context.addIssue({
        code: "custom",
        message: "Featured media must also be a gallery item.",
        path: ["placements"],
      });
    }
    if (
      placements.some((placement) => placement === "gallery" || placement === "featured") &&
      !value.label?.trim()
    ) {
      context.addIssue({
        code: "custom",
        message: "Gallery images require a title.",
        path: ["placements"],
      });
    }
  })
  .meta({
    description:
      "Create a one-time profile media upload intent for a claimed profile owned by the current authenticated API user. Gallery placement requires a nonblank label; featured placement also requires gallery.",
    id: "ApiProfileAssetUploadIntentCreateRequest",
  });

export const ApiProfileAssetUploadIntentCreateResponseSchema = z
  .object({
    profileId: z.string().min(1),
    slug,
    profileType: ProfileTypeSchema,
    profilePath: z.string().min(1),
    intentId: z.string().min(1),
    uploadToken: z.string().min(1),
    uploadUrl: z.string().min(1),
    directUploadUrl: z.string().min(1).optional(),
    uploadTokenHeader: z.literal("x-vrdex-upload-token"),
    expiresAt: timestampMs,
  })
  .meta({
    description:
      "One-time upload target and upload-token header for profile media. The token is only valid for this upload intent.",
    id: "ApiProfileAssetUploadIntentCreateResponse",
  });

export const ProfileAssetUploadIntentPathParamsSchema = z
  .object({
    intentId: z.string().min(1).meta({ description: "Profile asset upload intent id." }),
  })
  .meta({ description: "Profile asset upload intent path parameters." });

export const ProfileAssetUploadTokenHeaderSchema = z
  .object({
    "x-vrdex-upload-token": z.string().min(1).meta({
      description: "One-time upload token returned by the profile asset upload-intent creation endpoint.",
    }),
  })
  .meta({ description: "Profile asset upload-token header." });

export const ApiProfileAssetDirectUploadTargetResponseSchema = z
  .object({
    url: z.url(),
    fields: z.record(z.string(), z.string()),
    expiresAt: timestampMs,
  })
  .meta({
    description:
      "Short-lived private object-storage form target for one exact profile-media source upload.",
    id: "ApiProfileAssetDirectUploadTargetResponse",
  });

export const ApiProfileAssetUploadIntentCompleteResponseSchema = z
  .object({
    intentId: z.string().min(1),
    storageKey: z.string().min(1),
    mimeType: ProfileAssetMimeTypeSchema,
    byteSize: z.number().int().positive().max(12 * 1024 * 1024),
    assetIds: z.array(z.string().min(1)),
  })
  .meta({
    description:
      "Completed profile media upload result. API-created targeted intents include attached asset ids; untargeted submission intents return an empty assetIds array.",
    id: "ApiProfileAssetUploadIntentCompleteResponse",
  });

export const ApiProfileAssetUploadErrorResponseSchema = z
  .object({
    error: z.string().min(1),
  })
  .meta({
    description: "Profile asset upload transport error response.",
    id: "ApiProfileAssetUploadErrorResponse",
  });

export const ApiProfileAssetStorageProbeResponseSchema = z
  .object({
    checkedAt: z.string().min(1),
    configured: z.boolean(),
    storageReachable: z.boolean(),
  })
  .meta({
    description: "Profile asset storage probe result.",
    id: "ApiProfileAssetStorageProbeResponse",
  });

export const ApiSimpleErrorResponseSchema = z
  .object({
    error: z.string().min(1),
  })
  .meta({
    description: "Simple JSON error response.",
    id: "ApiSimpleErrorResponse",
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

export const PublicWorldEventsResponseSchema = z
  .object({
    recent: z.array(PublicWorldEventPreviewSchema),
    upcoming: z.array(PublicWorldEventPreviewSchema),
  })
  .passthrough()
  .meta({
    description: "Public world event context response.",
    id: "PublicWorldEventsResponse",
  });

export const PublicWorldSchema = z
  .object({
    canonicalVrchatWorldUrl: absoluteUrl.optional(),
    creatorAttributions: z.array(z.unknown()),
    description: z.string().optional(),
    displayName: z.string().min(1),
    eventContext: PublicWorldEventsResponseSchema.optional(),
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
export const OAuthApiScopeSchema = z.enum(oauthApiScopes).meta({
  description: "Scope available to third-party OAuth applications.",
});

export const ApiRateLimitCallerKindSchema = z
  .enum(["anonymous", "personal_api_token", "oauth_client"])
  .meta({ description: "Credential class used to choose the caller's current rate-limit bucket." });

export const ApiRateLimitQuotaTierSchema = z
  .enum(["standard", "trusted_partner"])
  .meta({ description: "Effective quota tier applied to the caller's current rate-limit window." });

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
        quotaTier: ApiRateLimitQuotaTierSchema,
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

export const ApiMeProfileSummarySchema = z
  .object({
    id: z.string().min(1),
    slug,
    profileType: ProfileTypeSchema,
    displayName: z.string().min(1),
    headline: z.string().optional(),
    claimState: PublicClaimStateSchema,
    publicationState: ProfilePublicationStateSchema,
    publicSurfacingState: ProfilePublicSurfacingStateSchema,
    creationSource: ProfileCreationSourceSchema,
    claimedAt: timestampMs.optional(),
    publishedAt: timestampMs.optional(),
    updatedAt: timestampMs,
    /**
     * The fields an update replaces wholesale rather than merges into.
     *
     * Present because a writer cannot safely send them without knowing what is
     * there: an agent adding one link to a profile whose links it could not read
     * would post a one-element array and delete the rest. The scalar fields are
     * not here, and do not need to be -- omitting one from an update preserves
     * it, so only the replace-not-merge fields are unsafe to write blind.
     *
     * `source` is absent by design. It is assigned by the server from who is
     * writing, and echoing it back would invite a client to send it.
     */
    aliases: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    outboundLinks: z.array(ApiProfileLinkInputSchema).optional(),
    person: z
      .object({
        pronouns: z.string().optional(),
        roleTags: z.array(z.string()).optional(),
      })
      .optional(),
    community: z
      .object({
        subtype: z.string().optional(),
        categoryTags: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .meta({
    description:
      "Profile summary for the current authenticated API user, carrying the revision and the replace-not-merge fields an update has to send back.",
    id: "ApiMeProfileSummary",
  });

export const ApiMeCommunitySummarySchema = ApiMeProfileSummarySchema.extend({
  profileType: z.literal("community"),
}).meta({
  description: "Compact community profile summary for the current authenticated API user.",
  id: "ApiMeCommunitySummary",
});

export const ApiMeEventSummarySchema = z
  .object({
    id: z.string().min(1),
    slug: slug.optional(),
    title: z.string().min(1),
    startAt: timestampMs,
    doorsOpenAt: timestampMs.optional(),
    endAt: timestampMs.optional(),
    timezone: z.string().optional(),
    communityProfileId: z.string().min(1).optional(),
    communitySlug: slug.optional(),
    communityName: z.string().optional(),
    summary: z.string().optional(),
    sourceType: PublicEventSourceTypeSchema,
    sourceLabel: z.string().min(1),
    publicationState: ProfilePublicationStateSchema,
    watchSurfaceEnabled: z.boolean(),
    createdAt: timestampMs.optional(),
    publishedAt: timestampMs.optional(),
    updatedAt: timestampMs,
  })
  .meta({
    description: "Compact community-managed event summary for the current authenticated API user.",
    id: "ApiMeEventSummary",
  });

export const ApiMeProfilesResponseSchema = z
  .object({
    profiles: z.array(ApiMeProfileSummarySchema),
  })
  .meta({
    description: "Profile inventory for the current authenticated API user.",
    id: "ApiMeProfilesResponse",
  });

export const ApiMeCommunitiesResponseSchema = z
  .object({
    communities: z.array(ApiMeCommunitySummarySchema),
  })
  .meta({
    description: "Community profile inventory for the current authenticated API user.",
    id: "ApiMeCommunitiesResponse",
  });

export const ApiMeEventsResponseSchema = z
  .object({
    events: z.array(ApiMeEventSummarySchema),
  })
  .meta({
    description: "Community-managed event inventory for the current authenticated API user.",
    id: "ApiMeEventsResponse",
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

export const DeveloperTokenCreateRequestSchema = z
  .object({
    label: z.string().min(1).max(80),
    scopes: z.array(ApiScopeSchema).optional(),
    expiresAt: timestampMs.optional(),
  })
  .meta({
    description: "Create a user-owned personal API token. The raw token value is returned once.",
    id: "DeveloperTokenCreateRequest",
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
    allowedScopes: z.array(OAuthApiScopeSchema),
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
    description: "User- or community-owned OAuth application metadata. Raw client secrets are never returned.",
    id: "OAuthApplicationSummary",
  });

export const DeveloperOAuthAppCreateRequestSchema = z
  .object({
    clientType: OAuthClientTypeSchema.optional(),
    displayName: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    logoUrl: z.string().min(1).optional(),
    docsUrl: z.string().min(1).optional(),
    privacyUrl: z.string().min(1).optional(),
    termsUrl: z.string().min(1).optional(),
    redirectUris: z.array(z.string().min(1)).min(1).max(10),
    allowedGrants: z.array(OAuthGrantTypeSchema).optional(),
    allowedScopes: z.array(OAuthApiScopeSchema).optional(),
    ownerCommunitySlug: slug.optional(),
  })
  .meta({
    description:
      "Create a user-owned or community-owned OAuth application. Confidential clients receive a one-time client secret value.",
    id: "DeveloperOAuthAppCreateRequest",
  });

export const DeveloperOAuthAppUpdateRequestSchema = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
    description: z.string().max(500).nullable().optional(),
    logoUrl: z.string().min(1).nullable().optional(),
    docsUrl: z.string().min(1).nullable().optional(),
    privacyUrl: z.string().min(1).nullable().optional(),
    termsUrl: z.string().min(1).nullable().optional(),
    redirectUris: z.array(z.string().min(1)).min(1).max(10).optional(),
    allowedGrants: z.array(OAuthGrantTypeSchema).min(1).optional(),
    allowedScopes: z.array(OAuthApiScopeSchema).min(1).optional(),
  })
  .meta({
    description:
      "Update editable metadata, redirects, scopes, and grants for a user-owned or community-owned OAuth application.",
    id: "DeveloperOAuthAppUpdateRequest",
  });

export const DeveloperTokensResponseSchema = z
  .object({
    tokens: z.array(ApiTokenSummarySchema),
  })
  .meta({
    description: "User-owned personal API token list.",
    id: "DeveloperTokensResponse",
  });

export const DeveloperTokenResponseSchema = z
  .object({
    token: ApiTokenSummarySchema,
  })
  .meta({
    description: "User-owned personal API token response.",
    id: "DeveloperTokenResponse",
  });

export const DeveloperTokenCreateResponseSchema = z
  .object({
    token: ApiTokenSummarySchema,
    tokenValue: z.string().min(1),
  })
  .meta({
    description: "Created personal API token plus one-time raw token value.",
    id: "DeveloperTokenCreateResponse",
  });

export const DeveloperOAuthAppsResponseSchema = z
  .object({
    applications: z.array(OAuthApplicationSummarySchema),
  })
  .meta({
    description: "User-owned and community-owned OAuth application list.",
    id: "DeveloperOAuthAppsResponse",
  });

export const DeveloperOAuthAppResponseSchema = z
  .object({
    application: OAuthApplicationSummarySchema,
  })
  .meta({
    description: "User-owned or community-owned OAuth application response.",
    id: "DeveloperOAuthAppResponse",
  });

export const DeveloperOAuthAppCreateResponseSchema = z
  .object({
    application: OAuthApplicationSummarySchema,
    clientSecretValue: z.string().min(1).optional(),
  })
  .meta({
    description: "Created OAuth application plus one-time client secret value for confidential clients.",
    id: "DeveloperOAuthAppCreateResponse",
  });

export const DeveloperOAuthAppSecretCreateRequestSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
  })
  .meta({
    description: "Create an additional secret for a user-owned or community-owned confidential OAuth application.",
    id: "DeveloperOAuthAppSecretCreateRequest",
  });

export const DeveloperOAuthAppSecretCreateResponseSchema = z
  .object({
    application: OAuthApplicationSummarySchema,
    clientSecretValue: z.string().min(1),
  })
  .meta({
    description: "Updated OAuth application plus one-time client secret value.",
    id: "DeveloperOAuthAppSecretCreateResponse",
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

const limitParam = (max: number) =>
  z.number().int().min(1).max(max).optional().meta({ description: "Maximum result count." });

function boundedLimit(value: string | null, options: { fallback: number; max: number }) {
  if (value === null || value.trim() === "") {
    return options.fallback;
  }

  const limit = Number(value);

  if (!Number.isInteger(limit)) {
    return options.fallback;
  }

  return Math.max(1, Math.min(limit, options.max));
}

function parseBooleanFlag(value: string | null) {
  return value === "true";
}

const searchTypeValues = ["all", "person", "community", "profile", "world", "event"] as const;
type SearchQueryType = (typeof searchTypeValues)[number];

export const SearchQueryParamsSchema = z.object({
  limit: limitParam(50),
  q: z.string().optional().meta({ description: "Search query text." }),
  type: z.enum(searchTypeValues).optional().meta({ description: "Optional search result type filter." }),
});

const searchTypes = new Set<SearchQueryType>(searchTypeValues);

export function parseSearchQueryParams(searchParams: URLSearchParams): {
  limit: number;
  q: string;
  type: SearchQueryType;
} {
  const rawType = searchParams.get("type");
  const candidate = {
    limit: boundedLimit(searchParams.get("limit"), { fallback: 24, max: 50 }),
    q: searchParams.get("q")?.trim() ?? "",
    type: rawType !== null && searchTypes.has(rawType as SearchQueryType) ? (rawType as SearchQueryType) : "all",
  };

  return SearchQueryParamsSchema.parse(candidate) as { limit: number; q: string; type: SearchQueryType };
}

export const PublicEventsListQueryParamsSchema = z.object({
  limit: limitParam(24),
});

export function parsePublicEventsListQueryParams(searchParams: URLSearchParams, fallback = 8): { limit: number } {
  return PublicEventsListQueryParamsSchema.parse({
    limit: boundedLimit(searchParams.get("limit"), { fallback, max: 24 }),
  }) as { limit: number };
}

export const PublicActiveWorldsQueryParamsSchema = z.object({
  limit: limitParam(6),
});

export function parsePublicActiveWorldsQueryParams(searchParams: URLSearchParams): { limit: number } {
  return PublicActiveWorldsQueryParamsSchema.parse({
    limit: boundedLimit(searchParams.get("limit"), { fallback: 3, max: 6 }),
  }) as { limit: number };
}

export const ApiMeInventoryQueryParamsSchema = z.object({
  limit: limitParam(100),
});

export function parseApiMeInventoryQueryParams(searchParams: URLSearchParams): { limit: number } {
  return ApiMeInventoryQueryParamsSchema.parse({
    limit: boundedLimit(searchParams.get("limit"), { fallback: 50, max: 100 }),
  }) as { limit: number };
}

export const DeveloperCredentialListQueryParamsSchema = z.object({
  includeRevoked: z.boolean().optional().meta({ description: "Include revoked credentials." }),
  limit: limitParam(100),
});

export function parseDeveloperCredentialListQueryParams(searchParams: URLSearchParams): {
  includeRevoked: boolean;
  limit: number;
} {
  return DeveloperCredentialListQueryParamsSchema.parse({
    includeRevoked: parseBooleanFlag(searchParams.get("includeRevoked")),
    limit: boundedLimit(searchParams.get("limit"), { fallback: 50, max: 100 }),
  }) as { includeRevoked: boolean; limit: number };
}

export const ApiTokenPathParamsSchema = z.object({
  tokenId: z.string().min(1).meta({ description: "API token id returned by the developer token list." }),
});

export const OAuthClientPathParamsSchema = z.object({
  clientId: z.string().min(1).meta({ description: "OAuth client id." }),
});

export const AssetPathParamsSchema = z.object({
  slug: slug.meta({
    description: "Public profile slug.",
  }),
  assetId: z.string().min(1).meta({
    description: "Public profile asset id.",
  }),
});
