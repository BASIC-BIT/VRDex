import type { Doc } from "./_generated/dataModel";

export function isAssetBackedPlacement(submission: Pick<Doc<"profileMediaSubmissions">, "requestKind" | "candidateAssetId" | "uploadIntentId">): boolean {
  return submission.requestKind === "identity_placement" && submission.candidateAssetId !== undefined && submission.uploadIntentId === undefined;
}
