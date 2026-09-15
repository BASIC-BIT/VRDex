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
  contributionAdmissionRefusals: defineTable({
    actorUserId: v.id("users"),
    clientId: v.string(),
    key: v.string(),
    fingerprint: v.string(),
    receipt,
    createdAt: v.number(),
  })
    .index("by_actor_client_key", ["actorUserId", "clientId", "key"])
    .index("by_actor_operation", ["actorUserId", "receipt.operationId"]),
  contributionCapacityRequests: defineTable({
    actorUserId: v.id("users"),
    key: v.string(),
    kind: v.union(
      v.literal("trusted_contributor"),
      v.literal("batch_allowance"),
    ),
    batchId: v.optional(v.id("contributionBatches")),
    evidence: v.string(),
    reason: v.string(),
    rows: v.optional(v.number()),
    bytes: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    usedBytes: v.optional(v.number()),
    state: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("revoked"),
    ),
    decisionReason: v.optional(v.string()),
    decidedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_actor_key", ["actorUserId", "key"])
    .index("by_actor_state", ["actorUserId", "state"])
    .index("by_batch_state", ["batchId", "state"])
    .index("by_state", ["state"]),
  contributionHostFetches: defineTable({
    host: v.string(),
    window: v.number(),
    count: v.number(),
  }).index("by_host_window", ["host", "window"]),
  contributionBatches: defineTable({
    actorUserId: v.id("users"),
    idempotencyKey: v.string(),
    label: v.string(),
    archived: v.boolean(),
    rowCount: v.number(),
    createdAt: v.number(),
    archivedAt: v.optional(v.number()),
    payloadRetentionVersion: v.optional(v.literal(1)),
    payloadCleanupAfter: v.optional(v.number()),
    payloadCleanupCursor: v.optional(v.string()),
    payloadCleanupHeld: v.optional(v.boolean()),
  })
    .index("by_actor_key", ["actorUserId", "idempotencyKey"])
    .index("by_actor_archived", ["actorUserId", "archived"])
    .index("by_payloadCleanupAfter", ["payloadCleanupAfter"]),
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
    payloadExpiredAt: v.optional(v.number()),
    legalHoldAt: v.optional(v.number()),
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
