import { z } from "zod";
const key = z.string().trim().min(1).max(128);
const id = z.string().min(1).max(200);
const revision = z.number().int().min(1).max(5);
export const contributionSourceSchema = z.strictObject({
  description: z.string().trim().min(1).max(1000),
  publication: z.enum(["private_only", "public_allowed"]),
  observedAt: z.number().int().nonnegative().optional(),
  reference: z.string().trim().max(2048).optional(),
});
const link = z.strictObject({
  type: z.string().min(1).max(40),
  url: z.string().min(1).max(2048),
  label: z.string().max(120).optional(),
});
const target = {
  profileId: id.optional(),
  expectedUpdatedAt: z.number().int().nonnegative().optional(),
  dependsOnItemKey: key.optional(),
};
export const contributionItemInputSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("profile_create"),
      itemKey: key,
      source: contributionSourceSchema,
      identity: z.strictObject({
        resolution: z.enum(["new_identity", "ambiguous"]),
        evidence: z.string().trim().min(1).max(1000).optional(),
      }),
      profile: z.strictObject({
        profileType: z.enum(["person", "community"]),
        displayName: z.string().trim().min(2).max(120),
        aliases: z.array(z.string().max(120)).max(20).optional(),
        tags: z.array(z.string().max(80)).max(20).optional(),
        outboundLinks: z.array(link).max(20).optional(),
      }),
    }),
    z.strictObject({
      kind: z.literal("profile_links"),
      itemKey: key,
      source: contributionSourceSchema,
      profileId: id,
      expectedUpdatedAt: z.number().int().nonnegative(),
      links: z.array(link).max(20),
    }),
    z.strictObject({
      kind: z.literal("media"),
      itemKey: key,
      source: contributionSourceSchema,
      ...target,
      placement: z.enum(["profile_image", "primary_logo"]),
      transport: z.enum(["local", "url"]),
      sourceUrl: z.string().url().max(2048).optional(),
      credit: z.string().trim().min(1).max(120),
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
    }),
  ])
  .superRefine((item, ctx) => {
    if (item.kind === "media") {
      if (
        item.dependsOnItemKey
          ? item.profileId !== undefined ||
            item.expectedUpdatedAt !== undefined ||
            item.dependsOnItemKey === item.itemKey
          : !item.profileId || item.expectedUpdatedAt === undefined
      )
        ctx.addIssue({ code: "custom", message: "TARGET_INVALID" });
      if (item.transport === "url" && !item.sourceUrl)
        ctx.addIssue({ code: "custom", message: "SOURCE_REQUIRED" });
    }
    if (
      item.kind === "profile_create" &&
      item.identity.resolution === "new_identity" &&
      !item.identity.evidence
    )
      ctx.addIssue({ code: "custom", message: "IDENTITY_EVIDENCE_REQUIRED" });
  });
export type ContributionItemInput = z.infer<typeof contributionItemInputSchema>;
export const contributionBatchCreateSchema = z.strictObject({
  idempotencyKey: key,
  label: z.string().trim().min(1).max(120),
});
export const contributionBatchGetSchema = z.strictObject({ batchId: id });
export const contributionBatchAppendSchema = z.strictObject({
  batchId: id,
  items: z.array(contributionItemInputSchema).min(1).max(50),
});
export const contributionBatchItemsSchema = z.strictObject({
  batchId: id,
  cursor: z.string().max(4096).nullable().default(null),
  limit: z.number().int().min(1).max(40).default(40),
});
export const contributionItemSubmitSchema = z.strictObject({
  batchId: id,
  itemKey: key,
  expectedRevision: revision,
});
export const contributionItemReviseSchema = contributionItemSubmitSchema.extend(
  { item: contributionItemInputSchema },
);
export const contributionBatchArchiveSchema = contributionBatchGetSchema;
