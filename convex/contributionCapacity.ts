import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  contributionAuthorityArgs,
  authorizeContribution,
} from "./_contributionAuth";
import { effectiveContributionPolicy, localUploadModes, retainedBatchUsage } from "./_contributionCapacity";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { readScopedCursor, writeScopedCursor } from "./_reviewCursor";
import { resolveContributionPolicy } from "./_contributionPolicy";
import { openSubmissionCountForUser } from "./profileMediaSubmissions";
const DAY = 86400000;
export const get = internalQuery({
  args: contributionAuthorityArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    const token = await authorizeContribution(ctx, args, false);
    const policy = await effectiveContributionPolicy(ctx.db, args.actorUserId);
    const uploadModes = localUploadModes();
    const envelopes = await retainedBatchUsage(ctx.db, args.actorUserId, policy.limits.retainedBatches);
    const open = await openSubmissionCountForUser(
      ctx,
      args.actorUserId,
      Date.now(),
    );
    const usage = await ctx.db
      .query("contributionCapacity")
      .withIndex("by_scope", (q) => q.eq("scope", `actor:${args.actorUserId}`))
      .unique();
    const limits = {
      ...policy.limits,
      actorBytes: Math.min(
        policy.limits.actorBytes,
        usage?.byteLimit ?? policy.limits.actorBytes,
      ),
      actorProcessing: Math.min(
        policy.limits.actorProcessing,
        usage?.processingLimit ?? policy.limits.actorProcessing,
      ),
    };
    const manifest = await ctx.db
      .query("contributionManifestUsage")
      .withIndex("by_actor", (q) => q.eq("actorUserId", args.actorUserId))
      .unique();
    const active = await ctx.db
      .query("profileMediaSubmissions")
      .withIndex("by_submitterUserId_createdAt", (q) =>
        q
          .eq("submitterUserId", args.actorUserId)
          .gt("createdAt", Date.now() - DAY),
      )
      .order("desc")
      .take(policy.limits.dailyActor + 1);
    const window = active.filter(
      (row) => row.createdAt > Date.now() - policy.limits.burstWindowMs,
    );
    const retryAt =
      active.length >= policy.limits.dailyActor
        ? active[policy.limits.dailyActor - 1].createdAt + DAY
        : window.length >= policy.limits.burst
          ? window[policy.limits.burst - 1].createdAt +
            policy.limits.burstWindowMs
          : null;
    return {
      policyVersion: policy.version,
      tier: policy.tier,
      reservation: false,
      limits,
      deployment: {
        bytes: policy.deploymentBytes,
        concurrency: policy.deploymentProcessing,
        hostFetchesPerMinute: policy.hostFetchesPerMinute,
      },
      features: {
        bulk: policy.bulkEnabled,
        paused: policy.paused,
        localUploads: uploadModes.contributor,
        localUploadModes: uploadModes,
      },
      scopes: token.scopes,
      usage: {
        bytes: usage?.bytes ?? 0,
        processing: usage?.processing ?? 0,
        open,
        activeRows: manifest?.activeRows ?? 0,
        retainedBatches: envelopes.count,
        retainedBatchesIsLowerBound: envelopes.isLowerBound,
        retainedRevisions: manifest?.retainedRevisions ?? 0,
        retainedMetadataBytes: manifest?.retainedBytes ?? 0,
        creations24h: active.length,
      },
      remaining: {
        bytes: Math.max(0, limits.actorBytes - (usage?.bytes ?? 0)),
        concurrency: Math.max(
          0,
          limits.actorProcessing - (usage?.processing ?? 0),
        ),
        open: Math.max(0, policy.limits.openActor - open),
        creations24h: Math.max(0, policy.limits.dailyActor - active.length),
      },
      retryAt,
    };
  },
});
export const request = internalMutation({
  args: {
    ...contributionAuthorityArgs,
    key: v.string(),
    kind: v.union(
      v.literal("trusted_contributor"),
      v.literal("batch_allowance"),
    ),
    evidence: v.string(),
    reason: v.union(
      v.literal("collection"),
      v.literal("reconsideration"),
      v.literal("temporary_batch"),
    ),
    batchId: v.optional(v.id("contributionBatches")),
    rows: v.optional(v.number()),
    bytes: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.object({
    requestId: v.id("contributionCapacityRequests"),
    state: v.string(),
  }),
  handler: async (ctx, args) => {
    await authorizeContribution(ctx, args, true, undefined, false);
    if (
      !args.key.trim() ||
      args.key.length > 128 ||
      !args.evidence.trim() ||
      args.evidence.length > 2000
    )
      throw new Error("CAPACITY_REQUEST_INVALID");
    const old = await ctx.db
      .query("contributionCapacityRequests")
      .withIndex("by_actor_key", (q) =>
        q.eq("actorUserId", args.actorUserId).eq("key", args.key),
      )
      .unique();
    if (old) {
      if (
        old.evidence !== args.evidence ||
        old.kind !== args.kind ||
        old.reason !== args.reason ||
        old.batchId !== args.batchId ||
        old.rows !== args.rows ||
        old.bytes !== args.bytes ||
        old.expiresAt !== args.expiresAt
      )
        throw new Error("CAPACITY_REQUEST_CONFLICT");
      return { requestId: old._id, state: old.state };
    }
    if (args.kind === "batch_allowance") {
      const batch = args.batchId ? await ctx.db.get(args.batchId) : null;
      if (
        !batch ||
        batch.actorUserId !== args.actorUserId ||
        batch.archived ||
        !Number.isSafeInteger(args.rows) ||
        args.rows! < 1 ||
        args.rows! > 10000 ||
        !Number.isSafeInteger(args.bytes) ||
        args.bytes! < 1 ||
        args.bytes! > 20 * 1024 ** 3 ||
        !Number.isSafeInteger(args.expiresAt) ||
        args.expiresAt! <= Date.now() ||
        args.expiresAt! > Date.now() + 30 * DAY
      )
        throw new Error("CAPACITY_REQUEST_INVALID");
    } else if (
      args.batchId !== undefined ||
      args.rows !== undefined ||
      args.bytes !== undefined ||
      args.expiresAt !== undefined
    )
      throw new Error("CAPACITY_REQUEST_INVALID");
    const pending = await ctx.db
      .query("contributionCapacityRequests")
      .withIndex("by_actor_state", (q) =>
        q.eq("actorUserId", args.actorUserId).eq("state", "pending"),
      )
      .take(20);
    if (pending.length >= 20) throw new Error("CAPACITY_REQUEST_LIMIT");
    const {
      actorUserId,
      key,
      kind,
      evidence,
      reason,
      batchId,
      rows,
      bytes,
      expiresAt,
    } = args;
    const requestId = await ctx.db.insert("contributionCapacityRequests", {
      actorUserId,
      key,
      kind,
      evidence,
      reason,
      batchId,
      rows,
      bytes,
      expiresAt,
      state: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { requestId, state: "pending" };
  },
});
export const requests = internalQuery({
  args: {
    ...contributionAuthorityArgs,
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorizeContribution(ctx, args, false);
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 40)
      throw new Error("CAPACITY_PAGE_INVALID");
    const binding = `requests:${args.actorUserId}`;
    const page = await ctx.db
      .query("contributionCapacityRequests")
      .withIndex("by_actor_key", (q) => q.eq("actorUserId", args.actorUserId))
      .paginate({
        cursor: readScopedCursor(args.cursor, binding),
        numItems: args.limit,
      });
    return {
      ...page,
      continueCursor: writeScopedCursor(page.continueCursor, binding),
      page: page.page.map((r) => ({
        requestId: r._id,
        kind: r.kind,
        state: r.state,
        decisionReason: r.decisionReason,
        expiresAt: r.expiresAt,
      })),
    };
  },
});
// Internal operator boundary only. This does not accept an MCP-selected admin identity.
export const decideRequest = internalMutation({
  args: {
    adminUserId: v.id("users"),
    requestId: v.id("contributionCapacityRequests"),
    decision: v.union(
      v.literal("approved"),
      v.literal("declined"),
      v.literal("revoked"),
    ),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await getAccountFeatureAccess(ctx.db, args.adminUserId)).superAdmin)
      throw new Error("CAPACITY_ADMIN_REQUIRED");
    if (!args.reason.trim() || args.reason.length > 500)
      throw new Error("CAPACITY_REASON_REQUIRED");
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("CAPACITY_REQUEST_UNAVAILABLE");
    if (request.kind === "trusted_contributor" && args.decision === "approved")
      throw new Error("USE_ACCOUNT_FEATURE_GRANT");
    if (request.kind === "trusted_contributor" && args.decision === "revoked")
      throw new Error("USE_ACCOUNT_FEATURE_REVOKE");
    await ctx.db.patch(request._id, {
      state: args.decision,
      decisionReason: args.reason,
      decidedBy: args.adminUserId,
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const status = internalQuery({
  args: {
    ...contributionAuthorityArgs,
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
    state: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("committed"),
        v.literal("failed"),
      ),
    ),
    batchId: v.optional(v.id("contributionBatches")),
    operationId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorizeContribution(ctx, args, false);
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 40)
      throw new Error("CAPACITY_PAGE_INVALID");
    if (args.operationId) {
      const id = ctx.db.normalizeId(
        "profileAssetUploadIntents",
        args.operationId,
      );
      const row = id
        ? await ctx.db
            .query("contributionUploadReservations")
            .withIndex("by_intentId", (q) => q.eq("intentId", id))
            .unique()
        : null;
      if (!row || row.actorUserId !== args.actorUserId) {
        const refusal = await ctx.db
          .query("contributionAdmissionRefusals")
          .withIndex("by_actor_operation", (q) =>
            q
              .eq("actorUserId", args.actorUserId)
              .eq("receipt.operationId", args.operationId!),
          )
          .unique();
        if (!refusal) throw new Error("UPLOAD_UNAVAILABLE");
        return { receipt: refusal.receipt };
      }
      return {
        receipt: row.receipt ?? {
          operationId: String(row.intentId),
          operationState: "in_progress",
        },
      };
    }
    const binding = `status:${args.actorUserId}:${args.state ?? ""}:${args.batchId ?? ""}`;
    const page = await ctx.db
      .query("contributionUploadReservations")
      .withIndex("by_actor_createdAt", (q) =>
        q.eq("actorUserId", args.actorUserId),
      )
      .order("desc")
      .paginate({
        cursor: readScopedCursor(args.cursor, binding),
        numItems: args.limit,
      });
    const rows = [];
    for (const row of page.page) {
      if (args.state && row.state !== args.state) continue;
      if (
        args.batchId &&
        (!row.batchRevisionId ||
          (await ctx.db.get(row.batchRevisionId))?.batchId !== args.batchId)
      )
        continue;
      rows.push({
        operationId: String(row.intentId),
        state: row.state,
        expiresAt: row.expiresAt,
        bytes: row.chargedBytes,
        receipt: row.receipt ?? {
          operationId: String(row.intentId),
          operationState: "in_progress",
        },
      });
    }
    return {
      ...page,
      page: rows,
      continueCursor: writeScopedCursor(page.continueCursor, binding),
    };
  },
});
export const claimSourceFetch = internalMutation({
  args: { intentId: v.id("profileAssetUploadIntents") },
  returns: v.object({ allowed: v.boolean(), retryAt: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      !intent?.sourceUrl ||
      intent.state !== "pending" ||
      intent.expiresAt <= Date.now()
    )
      throw new Error("UPLOAD_UNAVAILABLE");
    const policy = resolveContributionPolicy();
    if (policy.paused) return { allowed: false };
    const host = new URL(intent.sourceUrl).hostname.toLowerCase(),
      window = Math.floor(Date.now() / 60000);
    const old = await ctx.db
      .query("contributionHostFetches")
      .withIndex("by_host_window", (q) =>
        q.eq("host", host).eq("window", window),
      )
      .unique();
    if ((old?.count ?? 0) >= policy.hostFetchesPerMinute)
      return { allowed: false, retryAt: (window + 1) * 60000 };
    if (old) await ctx.db.patch(old._id, { count: old.count + 1 });
    else
      await ctx.db.insert("contributionHostFetches", {
        host,
        window,
        count: 1,
      });
    return { allowed: true };
  },
});
