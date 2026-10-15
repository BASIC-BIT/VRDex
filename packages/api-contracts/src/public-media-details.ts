import { z } from "zod";
import { PublicProfileAssetSchema } from "./schemas";

export const PublicMediaActorSchema = z
  .object({
    displayName: z.string(),
    profileSlug: z.string(),
    profileUrl: z.string(),
  })
  .strict();
export const PublicMediaHistoryEventSchema = z
  .object({
    kind: z.enum(["uploaded", "approved", "published"]),
    at: z.number().nullable(),
    actor: PublicMediaActorSchema.nullable(),
  })
  .strict();
export const PublicProfileMediaDetailsInputSchema = z
  .object({ slug: z.string(), assetId: z.string() })
  .strict();
export const PublicProfileMediaDetailsSchema = z
  .object({
    profileSlug: z.string(),
    asset: PublicProfileAssetSchema.strict(),
    referenceUrl: PublicProfileAssetSchema.shape.creditUrl.unwrap().nullable(),
    credit: z.string().nullable(),
    uploadedBy: PublicMediaActorSchema.nullable(),
    history: z.array(PublicMediaHistoryEventSchema).max(3),
  })
  .strict();
export type PublicMediaActor = z.infer<typeof PublicMediaActorSchema>;
export type PublicMediaHistoryEvent = z.infer<
  typeof PublicMediaHistoryEventSchema
>;
export type PublicProfileMediaDetailsInput = z.infer<
  typeof PublicProfileMediaDetailsInputSchema
>;
export type PublicProfileMediaDetails = z.infer<
  typeof PublicProfileMediaDetailsSchema
>;
