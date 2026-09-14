import { z } from "zod";
export const localUploadRequestSchema = z.strictObject({
  mode: z.enum(["owner", "contributor"]),
  profileId: z.string().min(1).max(200),
  expectedUpdatedAt: z.number().int().nonnegative(),
  placement: z.enum(["profile_image", "primary_logo"]),
  contentType: z.enum([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml",
  ]),
  byteLength: z
    .number()
    .int()
    .min(1)
    .max(12 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  credit: z.string().trim().min(1).max(120),
  sourceUrl: z.string().max(2048).optional(),
  sourceDescription: z.string().trim().min(1).max(1000).optional(),
  batchId: z.string().min(1).max(200).optional(),
  itemKey: z.string().min(1).max(128).optional(),
  idempotencyKey: z.string().min(1).max(128),
});
export const localUploadCompleteSchema = z.strictObject({
  intentId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(128),
});
export const localUploadTargetSchema = z.strictObject({
  intentId: z.string(),
  expiresAt: z.number(),
  transfer: z.strictObject({
    method: z.literal("POST"),
    url: z.string().url(),
    fields: z.record(z.string(), z.string()),
    fileField: z.literal("file"),
  }),
});
export type LocalUploadRequest = z.infer<typeof localUploadRequestSchema>;
export type LocalUploadTarget = z.infer<typeof localUploadTargetSchema>;
