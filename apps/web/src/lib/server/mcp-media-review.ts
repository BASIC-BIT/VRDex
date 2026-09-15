import {
  commandReceiptSchema,
  reviewRebaseSchema,
  decideSelectedReviews,
  reviewDecisionSchema,
  reviewDetailSchema,
  z,
} from "@vrdex/api-contracts";
import { createHash } from "node:crypto";
import sharp from "sharp";

const MAX_STORED_CANDIDATE_BYTES = 12 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEW_EDGE = 2_048;

export const mediaReviewSubmissionIdSchema = z.string().min(1).max(200);
export const mediaReviewVersionSchema = z.string().min(1).max(128);
export const mediaReviewPageInputSchema = z.strictObject({
  profileId: z.string().min(1).max(200).optional(),
  batchId: z.string().min(1).max(200).optional(),
  status: z
    .enum(["submitted", "under_review", "approved", "rejected"])
    .optional(),
  cursor: z.string().max(8192).nullable().default(null),
  limit: z.number().int().min(1).max(40).default(20),
});
export const mediaReviewGetInputSchema = z.strictObject({
  submissionId: mediaReviewSubmissionIdSchema,
});
export const mediaReviewPreviewInputSchema = z.strictObject({
  submissionId: mediaReviewSubmissionIdSchema,
  expectedReviewVersion: mediaReviewVersionSchema,
});
export const mediaSubmissionWithdrawInputSchema = mediaReviewGetInputSchema;
export const mediaReviewListOutputSchema = z.object({
  page: z.array(z.unknown()),
  continueCursor: z.string(),
  isDone: z.boolean(),
});
export const mediaReviewPreviewOutputSchema = z.strictObject({
  submissionId: mediaReviewSubmissionIdSchema,
  reviewVersion: mediaReviewVersionSchema,
  profileDisplayName: z.string().max(1000),
  mimeType: z.literal("image/png"),
  byteLength: z.number().int().positive().max(MAX_PREVIEW_BYTES),
});
export const mediaSubmissionWithdrawOutputSchema = z.strictObject({
  withdrawn: z.boolean(),
  submissionId: mediaReviewSubmissionIdSchema,
});

export const mediaReviewToolNames = [
  "vrdex_media_review_list",
  "vrdex_media_review_get",
  "vrdex_media_review_preview",
  "vrdex_media_review_decide",
  "vrdex_media_review_rebase",
  "vrdex_media_review_decide_selected",
  "vrdex_media_submission_withdraw",
] as const;

export const mediaReviewReadToolNames = [
  "vrdex_media_review_list",
  "vrdex_media_review_get",
  "vrdex_media_review_preview",
] as const;
export const mediaReviewWriteToolNames = [
  "vrdex_media_review_decide",
  "vrdex_media_review_rebase",
  "vrdex_media_review_decide_selected",
] as const;
export const mediaSubmissionWriteToolNames = [
  "vrdex_media_submission_withdraw",
] as const;

type ReviewQueryName = "list" | "detail" | "candidate";
type ReviewMutationName = "decide" | "withdraw" | "rebase";
type StoredObject = {
  body: Uint8Array;
  contentType: string;
  contentLength?: number;
};

export type MediaReviewDependencies<TActor extends string = string> = {
  actorUserId: TActor;
  now: () => number;
  verifyContributorEmail: (actorUserId: TActor) => Promise<boolean>;
  query: (
    name: ReviewQueryName,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  mutate: (
    name: ReviewMutationName,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  readStoredObject: (storageKey: string) => Promise<StoredObject | null>;
};

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
type ToolResult = {
  content: Array<TextContent | ImageContent>;
  structuredContent?: Record<string, unknown>;
  isError?: true;
};

function jsonResult(value: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function refusal(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

async function attestation<TActor extends string>(
  dependencies: MediaReviewDependencies<TActor>,
) {
  const emailVerified = await dependencies
    .verifyContributorEmail(dependencies.actorUserId)
    .catch(() => false);
  return {
    actorUserId: dependencies.actorUserId,
    emailVerified,
    emailVerificationAttestedAt: dependencies.now(),
  };
}

async function rasterPreview(body: Uint8Array) {
  // Re-decode the bounded source for each size, preserving aspect ratio and
  // keeping lossless PNG output. Eight halvings bound CPU even for noisy input.
  for (let edge = MAX_PREVIEW_EDGE; edge >= 16; edge = Math.floor(edge / 2)) {
    const preview = await sharp(body, {
      limitInputPixels: 16_777_216,
      sequentialRead: true,
    })
      .rotate()
      .resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (preview.byteLength <= MAX_PREVIEW_BYTES) return preview;
  }
  throw new Error("Preview limit exceeded.");
}

export function createMcpMediaReviewHandlers<TActor extends string>(
  dependencies: MediaReviewDependencies<TActor>,
) {
  return {
    async list(input: unknown): Promise<ToolResult> {
      const value = mediaReviewPageInputSchema.parse(input);
      const result = await dependencies.query("list", {
        ...(await attestation(dependencies)),
        ...(value.batchId === undefined ? {} : { batchId: value.batchId }),
        ...(value.profileId === undefined
          ? {}
          : { profileId: value.profileId }),
        ...(value.status === undefined ? {} : { status: value.status }),
        paginationOpts: { numItems: value.limit, cursor: value.cursor },
      });
      return jsonResult(mediaReviewListOutputSchema.parse(result));
    },

    async get(input: unknown): Promise<ToolResult> {
      const value = mediaReviewGetInputSchema.parse(input);
      const result = await dependencies.query("detail", {
        ...(await attestation(dependencies)),
        ...value,
      });
      if (result === null)
        return refusal("The media submission is unavailable for review.");
      return jsonResult(reviewDetailSchema.parse(result));
    },

    async preview(input: unknown): Promise<ToolResult> {
      const value = mediaReviewPreviewInputSchema.parse(input);
      const auth = await attestation(dependencies);
      const args = { ...auth, submissionId: value.submissionId };
      const before = reviewDetailSchema
        .nullable()
        .parse(await dependencies.query("detail", args));
      if (before === null || before.candidate.rendition === null) {
        return refusal("The candidate is unavailable for review.");
      }
      if (before.reviewVersion !== value.expectedReviewVersion) {
        return refusal(
          "The review changed. Inspect the current detail before requesting a preview.",
        );
      }
      const descriptor = z
        .strictObject({
          storageKey: z.string().min(1).max(4096),
          mimeType: z.string().min(1).max(100),
          originalFileName: z.string().max(1000).optional(),
          profileDisplayName: z.string().max(1000),
        })
        .nullable()
        .parse(await dependencies.query("candidate", args));
      if (descriptor === null)
        return refusal("The candidate is unavailable for review.");
      const stored = await dependencies.readStoredObject(descriptor.storageKey);
      if (
        stored === null ||
        stored.body.byteLength === 0 ||
        stored.body.byteLength > MAX_STORED_CANDIDATE_BYTES ||
        (stored.contentLength !== undefined &&
          stored.contentLength !== stored.body.byteLength) ||
        stored.contentType !== descriptor.mimeType ||
        before.candidate.contentSha256 === null ||
        createHash("sha256").update(stored.body).digest("hex") !==
          before.candidate.contentSha256
      ) {
        return refusal(
          "The stored candidate no longer matches the inspected review detail.",
        );
      }
      const after = reviewDetailSchema
        .nullable()
        .parse(await dependencies.query("detail", args));
      if (
        after === null ||
        after.reviewVersion !== before.reviewVersion ||
        after.candidate.rendition === null
      ) {
        return refusal(
          "The review changed while the preview was prepared. Inspect it again.",
        );
      }
      let preview: Buffer;
      try {
        preview = await rasterPreview(stored.body);
      } catch {
        return refusal("The stored candidate could not be rendered safely.");
      }
      if (preview.byteLength > MAX_PREVIEW_BYTES)
        return refusal("The rendered preview is too large to return.");
      const structuredContent = {
        submissionId: value.submissionId,
        reviewVersion: before.reviewVersion,
        profileDisplayName: descriptor.profileDisplayName,
        mimeType: "image/png",
        byteLength: preview.byteLength,
      };
      return {
        content: [
          {
            type: "image",
            data: preview.toString("base64"),
            mimeType: "image/png",
          },
        ],
        structuredContent,
      };
    },

    async decide(input: unknown): Promise<ToolResult> {
      const value = reviewDecisionSchema.parse(input);
      const receipt = commandReceiptSchema.parse(
        await dependencies.mutate("decide", {
          ...(await attestation(dependencies)),
          ...value,
        }),
      );
      return jsonResult(receipt);
    },

    async rebase(input: unknown): Promise<ToolResult> {
      const value = reviewRebaseSchema.parse(input);
      return jsonResult(
        commandReceiptSchema.parse(
          await dependencies.mutate("rebase", {
            ...(await attestation(dependencies)),
            ...value,
          }),
        ),
      );
    },
    async decideSelected(input: unknown): Promise<ToolResult> {
      return jsonResult(
        await decideSelectedReviews(input, async (value) =>
          commandReceiptSchema.parse(
            await dependencies.mutate("decide", {
              ...(await attestation(dependencies)),
              ...value,
            }),
          ),
        ),
      );
    },
    async withdraw(input: unknown): Promise<ToolResult> {
      const value = mediaSubmissionWithdrawInputSchema.parse(input);
      const withdrawn = z.boolean().parse(
        await dependencies.mutate("withdraw", {
          actorUserId: dependencies.actorUserId,
          submissionId: value.submissionId,
        }),
      );
      return jsonResult({ withdrawn, submissionId: value.submissionId });
    },
  };
}
