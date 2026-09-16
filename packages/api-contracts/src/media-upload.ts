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
  expectedItemRevision: z.number().int().min(1).max(5).optional(),
  idempotencyKey: z.string().min(1).max(128),
});
export const localUploadCompleteSchema = z.strictObject({
  intentId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(128),
});
export const localUploadTargetSchema = z.strictObject({
  intentId: z.string().min(1).max(200),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  transfer: z.strictObject({
    method: z.literal("POST"),
    url: z.string().url().max(16384),
    fields: z
      .record(z.string().min(1).max(256), z.string().max(32768))
      .refine((fields) => Object.keys(fields).length <= 64),
    fileField: z.literal("file"),
  }),
});
export type LocalUploadRequest = z.infer<typeof localUploadRequestSchema>;
export type LocalUploadTarget = z.infer<typeof localUploadTargetSchema>;
