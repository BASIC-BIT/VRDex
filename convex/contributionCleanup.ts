import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { changeContributionCharge } from "./_contributionCapacity";
import { failReservation } from "./contributionUploads";
import {
  prepareDueBlobCleanupCore,
  markBlobCleanupCompleteCore,
} from "./profileMediaSubmissions";

const workerSubject = {
  tokenIdentifier: "system:media-cleanup",
  issuer: "vrdex:system",
  subject: "media-cleanup",
};
const DAY = 24 * 60 * 60 * 1000;
export const claim = internalMutation({
  args: {},
  returns: v.object({
    uploads: v.array(
      v.object({
        reservationId: v.id("contributionUploadReservations"),
        token: v.string(),
        keys: v.array(v.string()),
      }),
    ),
    proposals: v.array(
      v.object({
        submissionId: v.id("profileMediaSubmissions"),
        cleanupToken: v.string(),
        storageKeys: v.array(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("contributionUploadReservations")
      .withIndex("by_cleanupAfter", (q) => q.lte("cleanupAfter", now))
      .take(20);
    const uploads = [];
    for (let row of due) {
      const intent = await ctx.db.get(row.intentId);
      if (!intent) throw new Error("UPLOAD_ACCOUNTING_INVALID");
      const submission = intent.targetSubmissionId
        ? await ctx.db.get(intent.targetSubmissionId)
        : null;
      if (
        submission?.legalHoldAt !== undefined ||
        (row.cleanupLeaseUntil ?? 0) > now
      ) {
        await ctx.db.patch(row._id, { cleanupAfter: now + DAY });
        continue;
      }
      const published =
        intent.state === "consumed" ||
        submission?.status === "approved" ||
        row.publishedBytes !== undefined;
      if (
        !published &&
        (row.state === "pending" || row.state === "processing")
      ) {
        await failReservation(ctx, row, "UPLOAD_EXPIRED");
        row = (await ctx.db.get(row._id))!;
      }
      const token = crypto.randomUUID();
      // A failed intent is never retried: all server writes have been fenced
      // for a full day before deletion, then tombstones reconcile late writes.
      const keys =
        row.state === "failed" && !published
          ? [
              intent.quarantineStorageKey!,
              intent.sourceStorageKey!,
              intent.downloadStorageKey!,
              intent.storageKey,
            ]
          : [intent.quarantineStorageKey!];
      await ctx.db.patch(row._id, {
        cleanupToken: token,
        cleanupLeaseUntil: now + 10 * 60 * 1000,
        cleanupAfter: now + 10 * 60 * 1000,
      });
      uploads.push({
        reservationId: row._id,
        token,
        keys: [...new Set(keys.filter((key): key is string => !!key))],
      });
    }
    return {
      uploads,
      proposals: await prepareDueBlobCleanupCore(ctx, workerSubject, true),
    };
  },
});
export const confirm = internalMutation({
  args: {
    uploads: v.array(
      v.object({
        reservationId: v.id("contributionUploadReservations"),
        token: v.string(),
      }),
    ),
    proposals: v.array(
      v.object({
        submissionId: v.id("profileMediaSubmissions"),
        cleanupToken: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.uploads.length > 20 || args.proposals.length > 20)
      throw new Error("CLEANUP_BATCH_INVALID");
    for (const item of args.uploads) {
      const row = await ctx.db.get(item.reservationId);
      if (!row || row.cleanupToken !== item.token) continue;
      const intent = await ctx.db.get(row.intentId);
      const submission = intent?.targetSubmissionId
        ? await ctx.db.get(intent.targetSubmissionId)
        : null;
      if (submission?.legalHoldAt !== undefined)
        throw new Error("CLEANUP_HELD");
      const release =
        row.state === "failed" &&
        intent?.state !== "consumed" &&
        submission?.status !== "approved" &&
        row.publishedBytes === undefined
          ? row.chargedBytes
          : row.quarantineBytes;
      await changeContributionCharge(ctx.db, row, -release, 0);
      await ctx.db.patch(row._id, {
        chargedBytes: row.chargedBytes - release,
        quarantineBytes: 0,
        cleanupToken: undefined,
        cleanupLeaseUntil: undefined,
        cleanupAfter: Date.now() + DAY,
      });
    }
    await markBlobCleanupCompleteCore(
      ctx,
      { items: args.proposals },
      workerSubject,
    );
    return null;
  },
});
export const sweep = internalAction({
  args: {},
  returns: v.object({ configured: v.boolean(), ok: v.boolean() }),
  handler: async () => {
    const url = process.env.VRDEX_MEDIA_CLEANUP_URL;
    const token = process.env.VRDEX_MEDIA_CLEANUP_TOKEN;
    if (!url || !token) return { configured: false, ok: false };
    try {
      const target = new URL(url);
      if (
        target.protocol !== "https:" ||
        target.username ||
        target.password ||
        target.pathname !== "/api/internal/media-cleanup"
      )
        return { configured: true, ok: false };
      const response = await fetch(target, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      return { configured: true, ok: response.ok };
    } catch {
      return { configured: true, ok: false };
    }
  },
});
