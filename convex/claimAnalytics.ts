import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const DELIVERY_LEASE_MS = 60_000;
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;
const HEALTH_SCAN_LIMIT = 1_000;
const FAILED_RECOVERY_BATCH = 100;
const DELIVERED_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const DELIVERED_CLEANUP_BATCH = 200;
const LIFECYCLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const LIFECYCLE_CLEANUP_BATCH = 200;

type DeliveryClaim = { row: Doc<"claimAnalyticsOutbox"> | null };

export const claimNextForDelivery = internalMutation({
  args: {},
  handler: async (ctx): Promise<DeliveryClaim> => {
    const now = Date.now();
    const abandonedLease = await ctx.db
      .query("claimAnalyticsOutbox")
      .withIndex("by_state_leaseUntil", (query) =>
        query.eq("state", "delivering").lte("leaseUntil", now),
      )
      .first();
    const pending = abandonedLease === null
      ? await ctx.db
          .query("claimAnalyticsOutbox")
          .withIndex("by_state_nextAttemptAt", (query) =>
            query.eq("state", "pending").lte("nextAttemptAt", now),
          )
          .first()
      : null;
    const row = abandonedLease ?? pending;

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

/** Requeue a bounded stalled batch after delivery or configuration recovers. */
export const recoverUndeliveredDeliveries = internalMutation({
  args: { recoverDisabled: v.boolean() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const failed = await ctx.db
      .query("claimAnalyticsOutbox")
      .withIndex("by_state_occurredAt", (query) => query.eq("state", "failed"))
      .take(FAILED_RECOVERY_BATCH);
    const disabled = args.recoverDisabled && failed.length < FAILED_RECOVERY_BATCH
      ? await ctx.db
          .query("claimAnalyticsOutbox")
          .withIndex("by_state_occurredAt", (query) => query.eq("state", "disabled"))
          .take(FAILED_RECOVERY_BATCH - failed.length)
      : [];
    const stalled = [...failed, ...disabled];

    for (const row of stalled) {
      await ctx.db.patch(row._id, {
        state: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        leaseUntil: undefined,
      });
    }
    if (stalled.length > 0) {
      await ctx.scheduler.runAfter(0, internal.claimAnalyticsDelivery.deliverPending, {});
    }
    return { recoveredCount: stalled.length };
  },
});

/** Bound delivered dedupe history and rows from deployments that opt out. */
export const sweepDeliveredEvents = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = (args.now ?? Date.now()) - DELIVERED_RETENTION_MS;
    const delivered = await ctx.db
      .query("claimAnalyticsOutbox")
      .withIndex("by_state_deliveredAt", (query) =>
        query.eq("state", "delivered").lt("deliveredAt", cutoff),
      )
      .take(DELIVERED_CLEANUP_BATCH);
    const disabled = delivered.length < DELIVERED_CLEANUP_BATCH
      ? await ctx.db
          .query("claimAnalyticsOutbox")
          .withIndex("by_state_occurredAt", (query) =>
            query.eq("state", "disabled").lt("occurredAt", cutoff),
          )
          .take(DELIVERED_CLEANUP_BATCH - delivered.length)
      : [];
    const expired = [...delivered, ...disabled];

    await Promise.all(expired.map(async (row) => await ctx.db.delete(row._id)));
    if (expired.length === DELIVERED_CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.claimAnalytics.sweepDeliveredEvents, {});
    }
    return { deletedCount: expired.length };
  },
});

/** Keep detailed claim lifecycle diagnostics for a bounded troubleshooting window. */
export const sweepClaimLifecycleEvents = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = (args.now ?? Date.now()) - LIFECYCLE_RETENTION_MS;
    const events = await ctx.db
      .query("profileClaimLifecycleEvents")
      .withIndex("by_createdAt", (query) => query.lt("createdAt", cutoff))
      .take(LIFECYCLE_CLEANUP_BATCH);

    await Promise.all(events.map(async (event) => await ctx.db.delete(event._id)));
    if (events.length === LIFECYCLE_CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.claimAnalytics.sweepClaimLifecycleEvents, {});
    }
    return { deletedCount: events.length };
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
