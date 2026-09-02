import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const DELIVERY_LEASE_MS = 60_000;
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;
const HEALTH_SCAN_LIMIT = 1_000;

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

/** Aggregate-only delivery health for the hosted claim analytics pipeline. */
export const deliveryOperationalHealth = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const states = ["pending", "delivering", "failed", "disabled"] as const;
    const rowsByState = await Promise.all(
      states.map(async (state) =>
        await ctx.db
          .query("claimAnalyticsOutbox")
          .withIndex("by_state_occurredAt", (query) => query.eq("state", state))
          .take(HEALTH_SCAN_LIMIT + 1),
      ),
    );
    const [pending, delivering, failed, disabled] = rowsByState;
    const oldestOutstanding = [...pending, ...delivering]
      .sort((left, right) => left.occurredAt - right.occurredAt)[0];

    return {
      pendingCount: Math.min(pending.length, HEALTH_SCAN_LIMIT),
      deliveringCount: Math.min(delivering.length, HEALTH_SCAN_LIMIT),
      failedCount: Math.min(failed.length, HEALTH_SCAN_LIMIT),
      disabledCount: Math.min(disabled.length, HEALTH_SCAN_LIMIT),
      oldestPendingAgeMs:
        oldestOutstanding === undefined
          ? null
          : Math.max(0, args.now - oldestOutstanding.occurredAt),
      scanLimitReached: rowsByState.some((rows) => rows.length > HEALTH_SCAN_LIMIT),
    };
  },
});
