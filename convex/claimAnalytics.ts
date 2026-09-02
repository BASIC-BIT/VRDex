import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

const DELIVERY_LEASE_MS = 60_000;
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;

type DeliveryClaim = { row: Doc<"claimAnalyticsOutbox"> | null };

export const claimNextForDelivery = internalMutation({
  args: {},
  handler: async (ctx): Promise<DeliveryClaim> => {
    const now = Date.now();
    const pending = await ctx.db
      .query("claimAnalyticsOutbox")
      .withIndex("by_state_nextAttemptAt", (query) =>
        query.eq("state", "pending").lte("nextAttemptAt", now),
      )
      .first();
    const abandonedLease = pending === null
      ? await ctx.db
          .query("claimAnalyticsOutbox")
          .withIndex("by_state_leaseUntil", (query) =>
            query.eq("state", "delivering").lte("leaseUntil", now),
          )
          .first()
      : null;
    const row = pending ?? abandonedLease;

    if (row === null) {
      return { row: null };
    }

    await ctx.db.patch(row._id, {
      state: "delivering",
      attemptCount: row.attemptCount + 1,
      leaseUntil: now + DELIVERY_LEASE_MS,
    });

    return {
      row: {
        ...row,
        state: "delivering",
        attemptCount: row.attemptCount + 1,
        leaseUntil: now + DELIVERY_LEASE_MS,
      },
    };
  },
});

export const disableDelivery = internalMutation({
  args: { outboxId: v.id("claimAnalyticsOutbox") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (row?.state === "delivering") {
      await ctx.db.patch(row._id, { state: "disabled", leaseUntil: undefined });
      await ctx.scheduler.runAfter(0, internal.claimAnalyticsDelivery.deliverPending, {});
    }
  },
});

export const recordDeliverySuccess = internalMutation({
  args: { outboxId: v.id("claimAnalyticsOutbox") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (row?.state === "delivering") {
      await ctx.db.patch(row._id, {
        state: "delivered",
        deliveredAt: Date.now(),
        leaseUntil: undefined,
      });
      await ctx.scheduler.runAfter(0, internal.claimAnalyticsDelivery.deliverPending, {});
    }
  },
});

export const recordDeliveryFailure = internalMutation({
  args: { outboxId: v.id("claimAnalyticsOutbox") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (row?.state !== "delivering") return;

    if (row.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
      await ctx.db.patch(row._id, { state: "failed", leaseUntil: undefined });
      return;
    }

    const delay = RETRY_DELAYS_MS[Math.min(row.attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
    await ctx.db.patch(row._id, {
      state: "pending",
      nextAttemptAt: Date.now() + delay,
      leaseUntil: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.claimAnalyticsDelivery.deliverPending, {});
    await ctx.scheduler.runAfter(delay, internal.claimAnalyticsDelivery.deliverPending, {});
  },
});
