import {
  contributionBatchCreateSchema,
  contributionBatchAppendSchema,
  contributionBatchGetSchema,
  contributionBatchItemsSchema,
  contributionBatchArchiveSchema,
  contributionItemSubmitSchema,
  contributionItemReviseSchema,
} from "@vrdex/api-contracts";
import { z } from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexAdminHttpClient } from "./convex-http";
import {
  createMcpMediaUploadHandlers,
  type LocalUploadDependencies,
} from "./mcp-media-upload";
export const contributionOperations = {
  capacity: z.strictObject({}),
  request: z.strictObject({
    key: z.string().min(1).max(128),
    kind: z.enum(["trusted_contributor", "batch_allowance"]),
    evidence: z.string().min(1).max(2000),
    reason: z.enum(["collection", "reconsideration", "temporary_batch"]),
    batchId: z.string().optional(),
    rows: z.number().int().min(1).max(10000).optional(),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(20 * 1024 ** 3)
      .optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
  requests: z.strictObject({
    cursor: z.string().nullable().default(null),
    limit: z.number().int().min(1).max(40).default(20),
  }),
  status: z.strictObject({
    cursor: z.string().nullable().default(null),
    limit: z.number().int().min(1).max(40).default(20),
    state: z.enum(["pending", "processing", "committed", "failed"]).optional(),
    batchId: z.string().optional(),
    operationId: z.string().max(128).optional(),
  }),
  create: contributionBatchCreateSchema,
  append: contributionBatchAppendSchema,
  get: contributionBatchGetSchema,
  items: contributionBatchItemsSchema,
  archive: contributionBatchArchiveSchema,
  submit: contributionItemSubmitSchema,
  revise: contributionItemReviseSchema,
};
export type ContributionOperation = keyof typeof contributionOperations;
export function createMcpContributionHandlers(deps: {
  authority: LocalUploadDependencies["authority"];
  admin?: Pick<ReturnType<typeof convexAdminHttpClient>, "mutation" | "query">;
  uploads?: ReturnType<typeof createMcpMediaUploadHandlers>;
}) {
  const admin = () => deps.admin ?? convexAdminHttpClient();
  return async (operation: ContributionOperation, raw: unknown) => {
    const authority = await deps.authority();
    if (operation === "capacity")
      return admin().query(internal.contributionCapacity.get, authority);
    if (operation === "request") {
      const input = contributionOperations.request.parse(raw);
      return admin().mutation(internal.contributionCapacity.request, {
        ...authority,
        ...input,
        batchId: input.batchId as Id<"contributionBatches"> | undefined,
      });
    }
    if (operation === "requests")
      return admin().query(internal.contributionCapacity.requests, {
        ...authority,
        ...contributionOperations.requests.parse(raw),
      });
    if (operation === "status") {
      const input = contributionOperations.status.parse(raw);
      return admin().query(internal.contributionCapacity.status, {
        ...authority,
        ...input,
        batchId: input.batchId as Id<"contributionBatches"> | undefined,
      });
    }
    if (operation === "create")
      return admin().mutation(internal.contributionBatches.create, {
        ...authority,
        input: contributionBatchCreateSchema.parse(raw),
      });
    if (operation === "append") {
      const input = contributionBatchAppendSchema.parse(raw);
      return {
        items: await admin().mutation(internal.contributionBatches.append, {
          ...authority,
          ...input,
          batchId: input.batchId as Id<"contributionBatches">,
        }),
      };
    }
    if (operation === "get") {
      const input = contributionBatchGetSchema.parse(raw);
      return admin().query(internal.contributionBatches.get, {
        ...authority,
        batchId: input.batchId as Id<"contributionBatches">,
      });
    }
    if (operation === "items") {
      const input = contributionBatchItemsSchema.parse(raw);
      return admin().query(internal.contributionBatches.items, {
        ...authority,
        ...input,
        batchId: input.batchId as Id<"contributionBatches">,
      });
    }
    if (operation === "archive") {
      const input = contributionBatchArchiveSchema.parse(raw);
      return admin().mutation(internal.contributionBatches.archive, {
        ...authority,
        batchId: input.batchId as Id<"contributionBatches">,
      });
    }
    if (operation === "revise") {
      const input = contributionItemReviseSchema.parse(raw);
      return admin().mutation(internal.contributionBatches.revise, {
        ...authority,
        ...input,
        batchId: input.batchId as Id<"contributionBatches">,
      });
    }
    const input = contributionItemSubmitSchema.parse(raw),
      args = {
        ...authority,
        ...input,
        batchId: input.batchId as Id<"contributionBatches">,
      };
    const receipt = await admin().mutation(
      internal.contributionBatches.submit,
      args,
    );
    if (receipt.code !== "URL_UPLOAD_REQUIRED") return receipt;
    const { transport, ...request } = await admin().mutation(
      internal.contributionBatches.mediaRequest,
      { ...args, ...(await deps.authority()) },
    );
    if (transport !== "url") throw new Error("BATCH_REVISION_CHANGED");
    const uploaded = await (
      deps.uploads ??
      createMcpMediaUploadHandlers({
        authority: deps.authority,
        admin: admin(),
      })
    ).importUrl(request);
    if (uploaded.operationState !== "committed") {
      return { ...uploaded, operationId: receipt.operationId };
    }
    // The companion command owns the revision receipt. Standalone upload
    // completion continues to return its separate intent receipt.
    return admin().mutation(internal.contributionBatches.submit, {
      ...args,
      ...(await deps.authority()),
    });
  };
}
