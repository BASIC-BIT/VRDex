import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { notifyOps, resolveOps } from "./_opsAlerts";
import { enqueueProductAnalytics } from "./_productAnalytics";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;
const DELIVERY_ALERT_KEY = "product-analytics-delivery";

/** Web host entry; Convex callers use enqueueProductAnalytics directly. */
export const enqueue = internalMutation({
  args: { event: v.literal("event_intake_run"), distinctId: v.string(), properties: v.any() },
  handler: async (ctx, args) => {
    await enqueueProductAnalytics(ctx.db, args);
  },
});

// Pushing nextAttemptAt out is the lease: a dead action's row comes back when it passes.
export const claimNext = internalMutation({
  args: {},
  handler: async (ctx): Promise<Doc<"productAnalyticsOutbox"> | null> => {
    const now = Date.now();
    const row = await ctx.db
      .query("productAnalyticsOutbox")
      .withIndex("by_deliveredAt_nextAttemptAt", (q) =>
        q.eq("deliveredAt", undefined).lte("nextAttemptAt", now),
      )
      .first();
    if (row === null) return null;

    const lease = {
      attemptCount: row.attemptCount + 1,
      leaseExpiresAt: now + LEASE_MS,
      nextAttemptAt: now + LEASE_MS,
    };
    await ctx.db.patch(row._id, lease);
    return { ...row, ...lease };
  },
});

export const recordSuccess = internalMutation({
  args: { outboxId: v.id("productAnalyticsOutbox") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.outboxId, { deliveredAt: Date.now(), leaseExpiresAt: undefined });
    await resolveOps(ctx, DELIVERY_ALERT_KEY);
    await ctx.scheduler.runAfter(0, internal.productAnalyticsDelivery.deliverPending, {});
  },
});

export const recordFailure = internalMutation({
  args: { outboxId: v.id("productAnalyticsOutbox") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (row === null || row.deliveredAt !== undefined) return;
    const deadLetter = row.attemptCount >= MAX_ATTEMPTS;
    await ctx.db.patch(row._id, {
      leaseExpiresAt: undefined,
      nextAttemptAt: deadLetter
        ? Number.MAX_SAFE_INTEGER
        : Date.now() + RETRY_DELAYS_MS[row.attemptCount - 1]!,
    });
    // Name the row only: distinctId and properties can carry user data.
    if (deadLetter) await notifyOps(ctx, {
      key: DELIVERY_ALERT_KEY, subject: "Product analytics delivery failing",
      body: `Outbox row ${row._id} (${row.event}) stopped retrying after ${row.attemptCount} attempts. Created ${new Date(row.createdAt).toISOString()}.`,
    });
  },
});
