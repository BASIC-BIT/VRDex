import { v } from "convex/values";

export const seedImportSourceTypeValidator = v.union(
  v.literal("partner"),
  v.literal("manual"),
  v.literal("import"),
  v.literal("community"),
  v.literal("moderator"),
);

export const seedImportBatchReviewStateValidator = v.union(
  v.literal("draft"),
  v.literal("ready_for_review"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("superseded"),
);

export const seedImportPublicationPolicyValidator = v.union(
  v.literal("private_only"),
  v.literal("reviewed_publication_allowed"),
);

export const seedImportCandidateReviewStateValidator = v.union(
  v.literal("unreviewed"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("needs_correction"),
);

export const seedImportCandidatePublicationStateValidator = v.union(
  v.literal("draft_private"),
  v.literal("review_pending"),
  v.literal("published_unclaimed"),
  v.literal("rejected"),
  v.literal("suppressed"),
);

export const seedImportFieldConfidenceValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("owner_confirmed"),
);

export const seedImportFieldReviewStateValidator = v.union(
  v.literal("unreviewed"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("needs_correction"),
);

export const seedImportFieldVisibilityValidator = v.union(
  v.literal("public"),
  v.literal("unlisted"),
  v.literal("private"),
);

export const seedImportProfileTypeValidator = v.union(
  v.literal("person"),
  v.literal("community"),
);

export const seedImportClaimStateValidator = v.union(
  v.literal("unclaimed"),
  v.literal("claimed_unverified"),
  v.literal("claimed_verified"),
);

export const seedImportAuthSubjectValidator = v.object({
  tokenIdentifier: v.string(),
  issuer: v.string(),
  subject: v.string(),
  displayName: v.optional(v.string()),
});
