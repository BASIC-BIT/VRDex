import type { CommandReceipt } from "@vrdex/api-contracts";

const conflictCodes = new Set(["review_changed", "placement_changed", "target_unavailable"]);

export function reviewDecisionMessage(receipt: CommandReceipt, decision?: "approve" | "reject") {
  if (receipt.operationState === "committed") {
    return { message: decision === "reject" ? "Rejected." : "Approved.", conflict: false };
  }
  if (receipt.operationState === "in_progress") {
    return { message: "Decision is still in progress.", conflict: false };
  }
  if (receipt.code === "review_changed" || receipt.code === "placement_changed") {
    return { message: "Review changed. Inspect the current images before deciding again.", conflict: true };
  }
  if (receipt.code === "target_unavailable") {
    return { message: "The target profile is no longer available for this review.", conflict: true };
  }
  return {
    message: receipt.code ? `Decision refused: ${receipt.code}.` : "Decision refused.",
    conflict: conflictCodes.has(receipt.code ?? ""),
  };
}

export function reviewPlacementImage(input: {
  profileId: string;
  profileSlug: string;
  profileIsPublic: boolean;
  currentPlacement: { assetId: string } | null;
  currentAvatarImageUrl: string | null;
}) {
  if (input.currentPlacement === null) return input.currentAvatarImageUrl;
  return input.profileIsPublic
    ? `/api/v0/profiles/${encodeURIComponent(input.profileSlug)}/assets/${input.currentPlacement.assetId}/file`
    : `/api/account/media-kit/${input.profileId}/assets/${input.currentPlacement.assetId}/file`;
}
