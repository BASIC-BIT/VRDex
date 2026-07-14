import type { Doc } from "./_generated/dataModel";
import { normalizeSafePrivateSeedFieldValue } from "./_seedImports";

export function projectSafePrivateSeedField(
  field: Doc<"seedImportCandidateFields">,
) {
  try {
    return {
      id: field._id,
      fieldKey: field.fieldKey,
      value: normalizeSafePrivateSeedFieldValue(field.fieldKey, field.value),
      sourceLabel: field.sourceLabel,
      confidence: field.confidence,
      reviewState: field.reviewState,
      visibility: field.visibility,
      sourceObservedAt: field.sourceObservedAt,
      lastCheckedAt: field.lastCheckedAt,
      reviewedAt: field.reviewedAt,
    };
  } catch {
    return null;
  }
}

export function canIncludePrivateSeedCandidate(
  candidate: Pick<
    Doc<"seedImportCandidateProfiles">,
    "claimState" | "profileType" | "publicationState" | "reviewState"
  >,
  publicationPolicy: Doc<"seedImportBatches">["publicationPolicy"] | undefined,
  batchReviewState: Doc<"seedImportBatches">["reviewState"] | undefined,
  superAdmin: boolean,
): boolean {
  if (
    candidate.profileType !== "person" ||
    (candidate.publicationState !== "draft_private" &&
      candidate.publicationState !== "review_pending")
  ) {
    return false;
  }

  return superAdmin || (
    publicationPolicy === "private_only" &&
    batchReviewState !== "rejected" &&
    batchReviewState !== "superseded" &&
    candidate.claimState === "unclaimed" &&
    candidate.reviewState === "accepted"
  );
}
