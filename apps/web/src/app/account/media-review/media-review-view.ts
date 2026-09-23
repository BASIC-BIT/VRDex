import type { CommandReceipt } from "@vrdex/api-contracts";

const conflictCodes = new Set([
  "target_changed",
  "review_changed",
  "placement_changed",
  "target_unavailable",
]);

export function reviewDecisionMessage(
  receipt: CommandReceipt,
  decision?: "approve" | "reject",
) {
  if (receipt.operationState === "committed") {
    return {
      message: decision === "reject" ? "Rejected." : "Approved.",
      conflict: false,
    };
  }
  if (receipt.operationState === "in_progress") {
    return { message: "Decision is still in progress.", conflict: false };
  }
  if (
    receipt.code === "target_changed" ||
    receipt.code === "review_changed" ||
    receipt.code === "placement_changed"
  ) {
    return {
      message:
        "Review changed. Inspect the current images before deciding again.",
      conflict: true,
    };
  }
  if (receipt.code === "target_unavailable") {
    return {
      message: "The target profile is no longer available for this review.",
      conflict: true,
    };
  }
  return {
    message: receipt.code
      ? `Decision refused: ${receipt.code}.`
      : "Decision refused.",
    conflict: conflictCodes.has(receipt.code ?? ""),
  };
}

export function reviewPlacementImage(input: {
  submissionId?: string;
  reviewVersion?: string;
  profileId: string;
  profileSlug: string;
  profileIsPublic: boolean;
  currentPlacement: { assetId: string } | null;
  currentImage?:
    | { kind: "managed"; assetId: string }
    | { kind: "legacy" | "automatic"; url: string }
    | null;
  currentAvatarImageUrl: string | null;
  currentAutomaticImageUrl: string | null;
}) {
  const privateImage = (assetId: string) => input.submissionId && input.reviewVersion
    ? `/api/account/media-review/submissions/${encodeURIComponent(input.submissionId)}/file?${new URLSearchParams({ image: "current", assetId, reviewVersion: input.reviewVersion })}`
    : null;
  if (
    input.currentImage?.kind === "legacy" ||
    input.currentImage?.kind === "automatic"
  )
    return input.currentImage.url;
  if (input.currentImage?.kind === "managed")
    return input.profileIsPublic
      ? `/api/v0/profiles/${encodeURIComponent(input.profileSlug)}/assets/${input.currentImage.assetId}/file`
      : privateImage(input.currentImage.assetId);
  if (input.currentImage === null) return null;
  if (input.currentPlacement === null) {
    return input.currentAvatarImageUrl ?? input.currentAutomaticImageUrl;
  }
  return input.profileIsPublic
    ? `/api/v0/profiles/${encodeURIComponent(input.profileSlug)}/assets/${input.currentPlacement.assetId}/file`
    : privateImage(input.currentPlacement.assetId);
}
