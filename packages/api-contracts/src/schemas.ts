import * as z from "zod/v4";

export { z };

const absoluteUrl = z.url();
const slug = z.string().min(1).max(160);
const isoDateTime = z.iso.datetime();

export const ProfileTypeSchema = z
  .enum(["user", "community"])
  .meta({ description: "The public profile entity class." });

export const TrustLabelSchema = z
  .enum(["unverified", "claimed", "verified"])
  .meta({ description: "The public trust state shown for the profile." });

export const SourceSummarySchema = z
  .object({
    submittedBy: z.string().nullish().meta({ description: "Optional public source attribution." }),
    updatedAt: isoDateTime.nullish().meta({ description: "Last source update time when available." }),
  })
  .passthrough()
  .meta({ description: "Public summary for community-submitted or claimed profile source state." });

export const PublicGenreSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().min(1),
    slug: z.string().optional(),
  })
  .passthrough()
  .meta({ description: "A public genre or taxonomy label." });

export const PublicOutboundLinkSchema = z
  .object({
    label: z.string().min(1),
    url: absoluteUrl,
  })
  .passthrough()
  .meta({ description: "A public outbound profile link." });

export const PublicProfileAssetSchema = z
  .object({
    alt: z.string().optional(),
    contentType: z.string().optional(),
    height: z.number().int().positive().optional(),
    id: z.string().optional(),
    kind: z.string().min(1),
    url: absoluteUrl,
    width: z.number().int().positive().optional(),
  })
  .passthrough()
  .meta({ description: "A public profile media or brand asset." });

export const PublicProfileMediaKitSchema = z
  .object({
    description: z.string().optional(),
    downloadUrl: absoluteUrl.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .passthrough()
  .meta({ description: "Optional media kit metadata for a public profile." });

export const PublicProfileSchema = z
  .object({
    assets: z.array(PublicProfileAssetSchema).optional(),
    avatarUrl: absoluteUrl.optional(),
    bio: z.string().optional(),
    displayName: z.string().min(1),
    genres: z.array(PublicGenreSchema).optional(),
    links: z.array(PublicOutboundLinkSchema).optional(),
    profileType: ProfileTypeSchema,
    slug,
    source: SourceSummarySchema.optional(),
    trustLabel: TrustLabelSchema.optional(),
    updatedAt: isoDateTime.optional(),
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
    description: "Public profile slug.",
  }),
});

export const AssetPathParamsSchema = SlugPathParamsSchema;
