import {
  contributionBatchCreateSchema,
  contributionBatchAppendSchema,
  contributionBatchGetSchema,
  contributionBatchItemsSchema,
  contributionBatchArchiveSchema,
  contributionItemSubmitSchema,
  contributionItemReviseSchema,
} from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexAdminHttpClient } from "./convex-http";
import {
  createMcpMediaUploadHandlers,
  type LocalUploadDependencies,
} from "./mcp-media-upload";
export const contributionOperations = {
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
    return (
      deps.uploads ??
      createMcpMediaUploadHandlers({
        authority: deps.authority,
        admin: admin(),
      })
    ).importUrl(request);
  };
}
