import { defineTable } from "convex/server";
import { v } from "convex/values";
const receipt = v.object({
  operationId: v.string(),
  operationState: v.union(
    v.literal("committed"),
    v.literal("refused"),
    v.literal("in_progress"),
  ),
  resourceId: v.optional(v.string()),
  code: v.optional(v.string()),
});
export const contributionTables = {
  contributionBatches: defineTable({
    actorUserId: v.id("users"),
    idempotencyKey: v.string(),
    label: v.string(),
    archived: v.boolean(),
    rowCount: v.number(),
    createdAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_actor_key", ["actorUserId", "idempotencyKey"])
    .index("by_actor_archived", ["actorUserId", "archived"]),
  contributionItems: defineTable({
    actorUserId: v.id("users"),
    batchId: v.id("contributionBatches"),
    itemKey: v.string(),
    revision: v.number(),
    revisionId: v.id("contributionItemRevisions"),
    createdAt: v.number(),
  })
    .index("by_batch_key", ["batchId", "itemKey"])
    .index("by_actor", ["actorUserId"]),
  contributionItemRevisions: defineTable({
    actorUserId: v.id("users"),
    batchId: v.id("contributionBatches"),
    itemKey: v.string(),
    revision: v.number(),
    payload: v.string(),
    bytes: v.number(),
    createdAt: v.number(),
  })
    .index("by_batch_key_revision", ["batchId", "itemKey", "revision"])
    .index("by_actor", ["actorUserId"]),
  contributionItemAttempts: defineTable({
    actorUserId: v.id("users"),
    revisionId: v.id("contributionItemRevisions"),
    oauthClientId: v.string(),
    receipt,
    profileId: v.optional(v.id("profiles")),
    profileUpdatedAt: v.optional(v.number()),
    submissionId: v.optional(v.id("profileMediaSubmissions")),
    intentId: v.optional(v.id("profileAssetUploadIntents")),
    createdAt: v.number(),
  })
    .index("by_revision", ["revisionId"])
    .index("by_submissionId", ["submissionId"]),
  contributionManifestUsage: defineTable({
    actorUserId: v.id("users"),
    activeRows: v.number(),
    retainedRevisions: v.number(),
    retainedBytes: v.number(),
  }).index("by_actor", ["actorUserId"]),
  contributionBatchReviewers: defineTable({
    batchId: v.id("contributionBatches"),
    reviewerUserId: v.id("users"),
    active: v.boolean(),
    expiresAt: v.number(),
  })
    .index("by_batch_reviewer", ["batchId", "reviewerUserId"])
    .index("by_reviewer_active", ["reviewerUserId", "active"]),
};
