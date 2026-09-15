import { z } from "zod";

const boundedId = z.string().min(1).max(200);
export const commandReceiptSchema = z.strictObject({
  operationId: boundedId,
  operationState: z.enum(["committed", "refused", "in_progress"]),
  resourceId: boundedId.optional(),
  code: z.string().min(1).max(80).optional(),
});
export type CommandReceipt = z.infer<typeof commandReceiptSchema>;
export type OperationState = CommandReceipt["operationState"];
export const reviewDecisionSchema = z.strictObject({
  submissionId: boundedId,
  expectedReviewVersion: z.string().min(1).max(128),
  decision: z.enum(["approve", "reject"]),
  privateReason: z.string().trim().min(1).max(1000),
  publicReason: z.string().trim().min(1).max(240).optional(),
  idempotencyKey: z.string().min(1).max(128),
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export const reviewPageRequestSchema = z.strictObject({
  cursor: z.string().max(8192).nullable(),
  limit: z.number().int().min(1).max(40),
  batchId: boundedId.optional(),
});
export type ReviewPageRequest = z.infer<typeof reviewPageRequestSchema>;
export const reviewSnapshotSchema = z.strictObject({
  reviewVersion: z.string().min(1).max(128),
  currentPlacement: z
    .strictObject({
      assetId: boundedId,
      placementId: boundedId,
      credit: z.string().max(1000).nullable(),
      sourceUrl: z.string().max(4096).nullable(),
    })
    .nullable(),
  currentAvatarImageUrl: z.string().max(4096).nullable(),
  currentAutomaticImageUrl: z.string().max(4096).nullable(),
  candidate: z.strictObject({
    rendition: z
      .strictObject({
        submissionId: boundedId,
        kind: z.literal("stored_candidate"),
      })
      .nullable(),
    sourceUrl: z.string().max(4096).optional(),
    sourceKind: z.enum(["url", "local"]).optional(),
    sourceDescription: z.string().max(1000).optional(),
    credit: z.string().max(1000),
    contentSha256: z.string().max(128).nullable(),
  }),
});
export type ReviewSnapshot = z.infer<typeof reviewSnapshotSchema>;

export const reviewDetailSchema = z.strictObject({
  submissionId: boundedId,
  profileId: boundedId,
  profileSlug: z.string().max(200),
  profileDisplayName: z.string().max(1000),
  profileIsPublic: z.boolean(),
  profileType: z.enum(["person", "community"]),
  requestedPlacement: z.enum([
    "profile_image",
    "banner",
    "primary_logo",
    "additional_logo",
    "gallery",
    "featured",
  ]),
  status: z.enum([
    "upload_pending",
    "submitted",
    "under_review",
    "approved",
    "rejected",
    "withdrawn",
    "superseded",
  ]),
  sourceUrl: z.string().max(4096).optional(),
  sourceKind: z.enum(["url", "local"]).optional(),
  sourceDescription: z.string().max(1000).optional(),
  label: z.string().max(1000).optional(),
  altText: z.string().max(1000).optional(),
  credit: z.string().max(1000),
  creditUrl: z.string().max(4096).optional(),
  contributorNote: z.string().max(1000).optional(),
  publicDisposition: z.string().max(240).optional(),
  approvedAssetId: boundedId.optional(),
  expiresAt: z.number(),
  targetProfileUpdatedAt: z.number(),
  currentProfileUpdatedAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  priorProposalCount: z.number().int().min(0).max(20),
  priorProposalCountTruncated: z.boolean(),
  canViewCandidate: z.boolean(),
  canSuppress: z.boolean(),
  submitterDisplayName: z.string().max(1000).optional(),
  submitterEmail: z.string().max(1000).optional(),
  submitterTokenIdentifier: z.string().max(4096).optional(),
  reviewerTokenIdentifier: z.string().max(4096).optional(),
  privateReason: z.string().max(1000).optional(),
  ...reviewSnapshotSchema.shape,
});
export type ReviewDetail = z.infer<typeof reviewDetailSchema>;

export const reviewRebaseSchema = z.strictObject({
  submissionId: boundedId,
  expectedReviewVersion: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(128),
});
export type ReviewRebase = z.infer<typeof reviewRebaseSchema>;
export const selectedReviewDecisionsSchema = z.strictObject({
  decisions: z.array(reviewDecisionSchema).min(1).max(20),
});
/** Each callback is one separately committed command. Capture the explicit set before awaiting. */
export async function decideSelectedReviews(
  input: unknown,
  decide: (input: ReviewDecision) => Promise<CommandReceipt>,
) {
  const { decisions } = selectedReviewDecisionsSchema.parse(input);
  const receipts: CommandReceipt[] = [];
  for (const decision of decisions) {
    try {
      receipts.push(await decide(decision));
    } catch {
      // The transport may have lost a response after commit. Preserve the key
      // and uncertainty so replay can retrieve the authoritative receipt.
      receipts.push({
        operationId: decision.idempotencyKey,
        resourceId: decision.submissionId,
        operationState: "in_progress",
        code: "decision_unavailable",
      });
    }
  }
  return { receipts };
}
