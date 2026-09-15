import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import {
  changeContributionCharge,
  reservationBytes,
} from "./_contributionCapacity";
const DAY = 86400000;
export const expirePayloads = internalMutation({
  args: {},
  returns: v.object({
    scanned: v.number(),
    expired: v.number(),
    held: v.number(),
  }),
  handler: async (ctx) => {
    const batch = await ctx.db
      .query("contributionBatches")
      .withIndex("by_payloadCleanupAfter", (q) =>
        q.gt("payloadCleanupAfter", 0).lte("payloadCleanupAfter", Date.now()),
      )
      .first();
    if (!batch) return { scanned: 0, expired: 0, held: 0 };
    const page = await ctx.db
      .query("contributionItemRevisions")
      .withIndex("by_batch_key_revision", (q) => q.eq("batchId", batch._id))
      .paginate({ numItems: 40, cursor: batch.payloadCleanupCursor ?? null });
    let expired = 0,
      held = 0,
      bytes = 0;
    for (const row of page.page) {
      if (row.payloadExpiredAt !== undefined) continue;
      const attempt = await ctx.db
        .query("contributionItemAttempts")
        .withIndex("by_revision", (q) => q.eq("revisionId", row._id))
        .unique();
      const submission = attempt?.submissionId
        ? await ctx.db.get(attempt.submissionId)
        : null;
      if (
        row.legalHoldAt !== undefined ||
        submission?.legalHoldAt !== undefined ||
        (submission &&
          ["upload_pending", "submitted", "under_review"].includes(
            submission.status,
          ))
      ) {
        held++;
        continue;
      }
      await ctx.db.patch(row._id, {
        payload: "",
        bytes: 0,
        payloadExpiredAt: Date.now(),
      });
      expired++;
      bytes += row.bytes;
    }
    const usage = await ctx.db
      .query("contributionManifestUsage")
      .withIndex("by_actor", (q) => q.eq("actorUserId", batch.actorUserId))
      .unique();
    if (expired) {
      if (
        !usage ||
        usage.retainedRevisions < expired ||
        usage.retainedBytes < bytes
      )
        throw new Error("BATCH_ACCOUNTING_INVALID");
      await ctx.db.patch(usage._id, {
        retainedRevisions: usage.retainedRevisions - expired,
        retainedBytes: usage.retainedBytes - bytes,
      });
    }
    const hasHeld = batch.payloadCleanupHeld || held > 0;
    await ctx.db.patch(batch._id, {
      payloadCleanupAfter: page.isDone
        ? hasHeld
          ? Date.now() + DAY
          : undefined
        : Date.now(),
      payloadCleanupCursor: page.isDone ? undefined : page.continueCursor,
      payloadCleanupHeld: page.isDone ? undefined : hasHeld,
    });
    return { scanned: page.page.length, expired, held };
  },
});
export const inventory = internalQuery({
  args: {
    adminUserId: v.id("users"),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!(await getAccountFeatureAccess(ctx.db, args.adminUserId)).superAdmin)
      throw new Error("CAPACITY_ADMIN_REQUIRED");
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 40)
      throw new Error("CAPACITY_PAGE_INVALID");
    const page = await ctx.db
      .query("contributionUploadReservations")
      .paginate({ cursor: args.cursor, numItems: args.limit });
    let bytes = 0,
      heldBytes = 0,
      publishedBytes = 0,
      processing = 0,
      failedReservedBytes = 0,
      oldestPendingAt: number | null = null,
      oldestCleanupAt: number | null = null,
      reviewed = 0,
      reads = 1;
    const objects = [];
    for (const row of page.page) {
      const intent = await ctx.db.get(row.intentId);
      reads++;
      const submission = intent?.targetSubmissionId
        ? await ctx.db.get(intent.targetSubmissionId)
        : null;
      if (intent?.targetSubmissionId) reads++;
      bytes += row.chargedBytes;
      publishedBytes += row.publishedBytes ?? 0;
      processing += row.processing ? 1 : 0;
      if (submission?.legalHoldAt !== undefined) heldBytes += row.chargedBytes;
      if (row.state === "failed") failedReservedBytes += row.chargedBytes;
      if (
        submission &&
        ["submitted", "under_review", "upload_pending"].includes(
          submission.status,
        )
      )
        oldestPendingAt = Math.min(
          oldestPendingAt ?? submission.createdAt,
          submission.createdAt,
        );
      if (row.chargedBytes > 0 && row.cleanupAfter <= Date.now())
        oldestCleanupAt = Math.min(
          oldestCleanupAt ?? row.cleanupAfter,
          row.cleanupAfter,
        );
      if (
        submission &&
        ["approved", "rejected"].includes(submission.status) &&
        submission.updatedAt > Date.now() - DAY
      )
        reviewed++;
      objects.push({
        intentId: row.intentId,
        actorUserId: row.actorUserId,
        profileId: row.profileId,
        chargedBytes: row.chargedBytes,
        publishedBytes: row.publishedBytes ?? 0,
        ledgerVersion: row.ledgerVersion ?? 0,
        keys: intent
          ? [
              intent.quarantineStorageKey,
              intent.sourceStorageKey,
              intent.downloadStorageKey,
              intent.storageKey,
            ].filter(Boolean)
          : [],
      });
    }
    return {
      cursor: page.continueCursor,
      isDone: page.isDone,
      scope: "page",
      scanned: page.page.length,
      reads,
      bytes,
      heldBytes,
      publishedBytes,
      processing,
      failedReservedBytes,
      oldestPendingAt,
      oldestCleanupAt,
      reviewed24h: reviewed,
      objects,
    };
  },
});
// Account existing reservations in bounded, repeatable batches; never creates grants or enables policy.
export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("contributionUploadReservations")
      .paginate({ cursor: args.cursor, numItems: 40 });
    let bytes = 0,
      processing = 0,
      updated = 0;
    for (const row of page.page) {
      if (row.ledgerVersion === 1) continue;
      bytes += row.chargedBytes;
      processing += row.processing ? 1 : 0;
      updated++;
      await ctx.db.patch(row._id, { ledgerVersion: 1 });
    }
    if (updated) {
      const old = await ctx.db
        .query("contributionCapacity")
        .withIndex("by_scope", (q) => q.eq("scope", "deployment"))
        .unique();
      if (old)
        await ctx.db.patch(old._id, {
          bytes: old.bytes + bytes,
          processing: old.processing + processing,
        });
      else
        await ctx.db.insert("contributionCapacity", {
          scope: "deployment",
          bytes,
          processing,
        });
    }
    return {
      cursor: page.continueCursor,
      isDone: page.isDone,
      updated,
      bytes,
      processing,
    };
  },
});
export const backfillSubmissions = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("profileMediaSubmissions")
      .paginate({ cursor: args.cursor, numItems: 40 });
    let updated = 0,
      unresolved = 0;
    for (const submission of page.page) {
      if (!submission.uploadIntentId) {
        if (submission.blobDeletedAt === undefined) unresolved++;
        continue;
      }
      if (
        await ctx.db
          .query("contributionUploadReservations")
          .withIndex("by_intentId", (q) =>
            q.eq("intentId", submission.uploadIntentId!),
          )
          .unique()
      )
        continue;
      const intent = await ctx.db.get(submission.uploadIntentId);
      if (!intent) {
        unresolved++;
        continue;
      }
      const processing =
        submission.status === "upload_pending" && intent.state === "pending";
      const known =
        (intent.byteSize ?? 0) +
        (intent.sourceByteSize ?? 0) +
        (intent.downloadByteSize ?? 0);
      const published = submission.status === "approved";
      const committed =
        intent.state === "uploaded" ||
        (intent.state === "consumed" && published);
      const bytes =
        submission.blobDeletedAt !== undefined
          ? 0
          : known || reservationBytes(12 * 1024 * 1024);
      const privateBytes = published ? 0 : bytes;
      await changeContributionCharge(
        ctx.db,
        {
          actorUserId: submission.submitterUserId,
          profileId: submission.profileId,
          ledgerVersion: 1,
        },
        privateBytes,
        processing ? 1 : 0,
      );
      if (published && bytes) {
        const scope = "published",
          old = await ctx.db
            .query("contributionCapacity")
            .withIndex("by_scope", (q) => q.eq("scope", scope))
            .unique();
        if (old) await ctx.db.patch(old._id, { bytes: old.bytes + bytes });
        else
          await ctx.db.insert("contributionCapacity", {
            scope,
            bytes,
            processing: 0,
          });
      }
      await ctx.db.insert("contributionUploadReservations", {
        intentId: intent._id,
        actorUserId: submission.submitterUserId,
        profileId: submission.profileId,
        ledgerVersion: 1,
        oauthClientId: intent.mcpOauthClientId ?? "browser",
        idempotencyKey: intent.mcpIdempotencyKeyHash ?? String(intent._id),
        fingerprint: intent.mcpRequestFingerprint ?? String(intent._id),
        mode: "contributor",
        expectedUpdatedAt: submission.targetProfileUpdatedAt,
        declaredBytes: intent.byteSize ?? 12 * 1024 * 1024,
        declaredType: intent.mimeType ?? "image/unknown",
        sha256: "legacy",
        chargedBytes: privateBytes,
        publishedBytes: published ? bytes : undefined,
        quarantineBytes: 0,
        processing,
        state: processing ? "pending" : committed ? "committed" : "failed",
        expiresAt: intent.expiresAt,
        cleanupAfter: intent.expiresAt + DAY,
        createdAt: submission.createdAt,
        ...(!processing
          ? {
              receipt: {
                operationId: String(intent._id),
                operationState: committed
                  ? ("committed" as const)
                  : ("refused" as const),
                resourceId: String(submission._id),
              },
            }
          : {}),
      });
      updated++;
    }
    return {
      cursor: page.continueCursor,
      isDone: page.isDone,
      updated,
      unresolved,
    };
  },
});

// Schedule old archived manifests without changing existing cursors or hold decisions.
export const backfillArchivedPayloads = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    cursor: v.string(),
    isDone: v.boolean(),
    updated: v.number(),
    unresolved: v.number(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("contributionBatches")
      .paginate({ cursor: args.cursor, numItems: 40 });
    let updated = 0,
      unresolved = 0;
    for (const batch of page.page) {
      if (!batch.archived || batch.payloadRetentionVersion === 1) continue;
      if (batch.payloadCleanupAfter !== undefined) {
        await ctx.db.patch(batch._id, { payloadRetentionVersion: 1 });
        updated++;
        continue;
      }
      if (
        !Number.isSafeInteger(batch.archivedAt) ||
        batch.archivedAt! <= 0 ||
        batch.archivedAt! > Date.now()
      ) {
        unresolved++;
        continue;
      }
      await ctx.db.patch(batch._id, {
        payloadRetentionVersion: 1,
        payloadCleanupAfter: batch.archivedAt! + 30 * DAY,
      });
      updated++;
    }
    return {
      cursor: page.continueCursor,
      isDone: page.isDone,
      updated,
      unresolved,
    };
  },
});
