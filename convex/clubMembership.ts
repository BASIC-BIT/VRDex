import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  resolveClubActor,
  readClubVisibility,
  canReadCategory,
} from "./_clubAccess";
import {
  DAY_MS,
  checkedMembershipRange,
  mergeCoverage,
  membershipMovement,
} from "./_clubMembership";
const event = v.object({
  auditId: v.string(),
  eventType: v.string(),
  occurredAt: v.number(),
  targetUserId: v.optional(v.string()),
  targetDisplayName: v.optional(v.string()),
});
const scope = {
  integrationId: v.id("communityVrchatIntegrations"),
  epochStartedAt: v.number(),
  groupId: v.string(),
};
const workerScope = {
  collectorAccountId: v.id("collectorAccounts"),
  workerKeyHash: v.string(),
  workerId: v.string(),
  fencingToken: v.number(),
};
type WorkerScope = {
  collectorAccountId: Id<"collectorAccounts">;
  workerKeyHash: string;
  workerId: string;
  fencingToken: number;
};
async function authorizeWorker(
  ctx: MutationCtx,
  args: WorkerScope & {
    integrationId: Id<"communityVrchatIntegrations">;
    epochStartedAt: number;
    groupId: string;
  },
) {
  const integration = await active(ctx, args);
  const account = await ctx.db.get(args.collectorAccountId);
  const fleet = await ctx.db
    .query("collectorFleetSettings")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  const lease = await ctx.db
    .query("collectorAccountLeases")
    .withIndex("by_integrationId_state", (q) =>
      q.eq("integrationId", args.integrationId).eq("state", "active"),
    )
    .unique();
  if (
    !account ||
    account.state !== "ready" ||
    account.killSwitchEnabled ||
    fleet?.killSwitchEnabled ||
    account.workerKeyHash !== args.workerKeyHash ||
    integration.assignedCollectorAccountId !== account._id ||
    !lease ||
    lease.collectorAccountId !== account._id ||
    lease.workerId !== args.workerId ||
    lease.fencingToken !== args.fencingToken ||
    lease.expiresAt <= Date.now()
  )
    throw new Error("Unauthorized membership worker lease.");
}
const scanResult = v.object({
  scanId: v.id("communityMembershipScans"),
  startAt: v.number(),
  endAt: v.number(),
  nextPage: v.number(),
  nextOffset: v.number(),
  complete: v.boolean(),
});
function projectScan(scan: {
  _id: Id<"communityMembershipScans">;
  startAt: number;
  endAt: number;
  nextPage: number;
  nextOffset?: number;
  complete: boolean;
}) {
  return {
    scanId: scan._id,
    startAt: scan.startAt,
    endAt: scan.endAt,
    nextPage: scan.nextPage,
    nextOffset: scan.nextOffset ?? 0,
    complete: scan.complete,
  };
}
async function active(
  ctx: QueryCtx | MutationCtx,
  args: {
    integrationId: Id<"communityVrchatIntegrations">;
    epochStartedAt: number;
    groupId: string;
  },
) {
  const integration = await ctx.db.get(args.integrationId);
  if (
    !integration ||
    integration.state !== "active" ||
    integration.killSwitchEnabled ||
    (integration.enabledFeatures && !integration.enabledFeatures.includes("analytics")) ||
    integration.vrchatGroupId !== args.groupId ||
    (integration.telemetryEpochStartedAt ?? integration.createdAt) !==
      args.epochStartedAt
  )
    throw new Error("Inactive membership collection scope.");
  return integration;
}
export const beginScan = internalMutation({
  args: { ...scope, ...workerScope, startAt: v.number(), endAt: v.number() },
  returns: v.id("communityMembershipScans"),
  handler: async (ctx, args) => {
    await authorizeWorker(ctx, args);
    checkedMembershipRange(args.startAt, args.endAt, 31 * DAY_MS);
    if (args.startAt < args.epochStartedAt || args.endAt > Date.now())
      throw new Error("Scan outside collection epoch.");
    const existing = await ctx.db
      .query("communityMembershipScans")
      .withIndex("by_scope_window", (q) =>
        q
          .eq("integrationId", args.integrationId)
          .eq("epochStartedAt", args.epochStartedAt)
          .eq("startAt", args.startAt)
          .eq("endAt", args.endAt),
      )
      .unique();
    if (existing) return existing._id;
    const pending = await ctx.db
      .query("communityMembershipScans")
      .withIndex("by_scope_complete", (q) =>
        q
          .eq("integrationId", args.integrationId)
          .eq("epochStartedAt", args.epochStartedAt)
          .eq("complete", false),
      )
      .first();
    if (pending) return pending._id;
    return ctx.db.insert("communityMembershipScans", {
      integrationId: args.integrationId,
      epochStartedAt: args.epochStartedAt,
      groupId: args.groupId,
      startAt: args.startAt,
      endAt: args.endAt,
      workerId: args.workerId,
      fencingToken: args.fencingToken,
      nextOffset: 0,
      nextPage: 0,
      complete: false,
      createdAt: Date.now(),
    });
  },
});
// Only the authenticated worker control plane may call these internal endpoints.
// A terminal page certifies the fixed scan window, never a moving now boundary.
export const ingestBatch = internalMutation({
  args: {
    ...scope,
    ...workerScope,
    scanId: v.id("communityMembershipScans"),
    pageNumber: v.number(),
    events: v.array(event),
    exhausted: v.boolean(),
    sourceCount: v.optional(v.number()),
  },
  returns: v.object({ inserted: v.number(), complete: v.boolean() }),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    if (!scan) throw new Error("Unknown membership scan.");
    await authorizeWorker(ctx, args);
    if (
      scan.integrationId !== args.integrationId ||
      scan.epochStartedAt !== args.epochStartedAt ||
      scan.groupId !== args.groupId ||
      scan.workerId !== args.workerId ||
      scan.fencingToken !== args.fencingToken
    )
      throw new Error("Foreign or stale membership scan.");
    if (
      !Number.isSafeInteger(args.pageNumber) ||
      args.pageNumber < 0 ||
      args.events.length > 100
    )
      throw new Error("Invalid membership page.");
    const sourceCount = args.sourceCount ?? args.events.length;
    if (
      !Number.isInteger(sourceCount) ||
      sourceCount < args.events.length ||
      sourceCount > 100
    )
      throw new Error("Invalid source page count.");
    if (args.pageNumber < scan.nextPage)
      return { inserted: 0, complete: scan.complete };
    if (scan.complete || args.pageNumber !== scan.nextPage)
      throw new Error("Membership page out of sequence.");
    let inserted = 0;
    for (const item of args.events) {
      if (
        !item.auditId ||
        item.auditId.length > 200 ||
        !item.eventType ||
        item.eventType.length > 200 ||
        (item.targetUserId?.length ?? 0) > 200 ||
        (item.targetDisplayName?.length ?? 0) > 200 ||
        !Number.isSafeInteger(item.occurredAt) ||
        item.occurredAt < scan.startAt ||
        item.occurredAt >= scan.endAt
      )
        throw new Error("Invalid membership event.");
      const prior = await ctx.db
        .query("communityMembershipEvents")
        .withIndex("by_audit", (q) =>
          q
            .eq("integrationId", scan.integrationId)
            .eq("epochStartedAt", scan.epochStartedAt)
            .eq("auditId", item.auditId),
        )
        .unique();
      if (prior) {
        if (
          prior.eventType !== item.eventType ||
          prior.occurredAt !== item.occurredAt ||
          prior.targetUserId !== item.targetUserId
        )
          throw new Error("Conflicting immutable audit event.");
        continue;
      }
      await ctx.db.insert("communityMembershipEvents", {
        ...item,
        integrationId: scan.integrationId,
        epochStartedAt: scan.epochStartedAt,
        groupId: scan.groupId,
        receivedAt: Date.now(),
      });
      inserted++;
    }
    if (args.exhausted) {
      for (
        let day = Math.floor(scan.startAt / DAY_MS) * DAY_MS;
        day < scan.endAt;
        day += DAY_MS
      ) {
        const prior = await ctx.db
          .query("communityMembershipCoverage")
          .withIndex("by_day", (q) =>
            q
              .eq("integrationId", scan.integrationId)
              .eq("epochStartedAt", scan.epochStartedAt)
              .eq("day", day),
          )
          .unique();
        const intervals = mergeCoverage([
          ...(prior?.intervals ?? []),
          {
            startAt: Math.max(day, scan.startAt),
            endAt: Math.min(day + DAY_MS, scan.endAt),
          },
        ]);
        if (prior)
          await ctx.db.patch(prior._id, { intervals, updatedAt: Date.now() });
        else
          await ctx.db.insert("communityMembershipCoverage", {
            integrationId: scan.integrationId,
            epochStartedAt: scan.epochStartedAt,
            day,
            intervals,
            updatedAt: Date.now(),
          });
      }
    }
    await ctx.db.patch(scan._id, {
      nextPage: scan.nextPage + 1,
      nextOffset: (scan.nextOffset ?? 0) + sourceCount,
      complete: args.exhausted,
    });
    return { inserted, complete: args.exhausted };
  },
});
export const resumeScan = internalMutation({
  args: { ...scope, ...workerScope },
  returns: v.union(scanResult, v.null()),
  handler: async (ctx, args) => {
    await authorizeWorker(ctx, args);
    const scan = await ctx.db
      .query("communityMembershipScans")
      .withIndex("by_scope_complete", (q) =>
        q
          .eq("integrationId", args.integrationId)
          .eq("epochStartedAt", args.epochStartedAt)
          .eq("complete", false),
      )
      .first();
    if (!scan) {
      const latest = await ctx.db
        .query("communityMembershipScans")
        .withIndex("by_scope_window", (q) =>
          q
            .eq("integrationId", args.integrationId)
            .eq("epochStartedAt", args.epochStartedAt),
        )
        .order("desc")
        .first();
      return latest ? projectScan(latest) : null;
    }
    await ctx.db.patch(scan._id, {
      workerId: args.workerId,
      fencingToken: args.fencingToken,
    });
    return projectScan(scan);
  },
});
async function readContext(ctx: QueryCtx, slug: string, individual: boolean) {
  const community = await ctx.db
    .query("profiles")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .unique();
  if (!community || community.profileType !== "community")
    throw new Error("Club not found.");
  const actor = await resolveClubActor(ctx, community._id);
  const visibility = await readClubVisibility(ctx.db, community._id);
  if (
    (individual && actor.kind === "none") ||
    !canReadCategory(
      actor,
      visibility,
      individual ? "individual_membership_history" : "membership_movement",
    )
  )
    throw new Error("You do not have access to this category.");
  const integration = await ctx.db
    .query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (q) =>
      q.eq("communityProfileId", community._id),
    )
    .first();
  if (
    !integration ||
    (actor.kind === "none" &&
      (integration.state !== "active" || integration.killSwitchEnabled))
  )
    return null;
  return {
    integrationId: integration._id,
    epochStartedAt:
      integration.telemetryEpochStartedAt ?? integration.createdAt,
  };
}
export const getMovementBucket = query({
  args: { communitySlug: v.string(), startAt: v.number(), endAt: v.number() },
  returns: v.object({
    joins: v.union(v.number(), v.null()),
    departures: v.union(v.number(), v.null()),
    complete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    checkedMembershipRange(args.startAt, args.endAt, 25 * 3600_000);
    const state = await readContext(ctx, args.communitySlug, false);
    const unknown = { joins: null, departures: null, complete: false };
    if (!state) return unknown;
    const intervals = [];
    for (
      let day = Math.floor(args.startAt / DAY_MS) * DAY_MS;
      day < args.endAt;
      day += DAY_MS
    ) {
      const coverage = await ctx.db
        .query("communityMembershipCoverage")
        .withIndex("by_day", (q) =>
          q
            .eq("integrationId", state.integrationId)
            .eq("epochStartedAt", state.epochStartedAt)
            .eq("day", day),
        )
        .unique();
      intervals.push(...(coverage?.intervals ?? []));
    }
    if (
      !mergeCoverage(intervals).some(
        (i) => i.startAt <= args.startAt && i.endAt >= args.endAt,
      )
    )
      return unknown;
    const rows = await ctx.db
      .query("communityMembershipEvents")
      .withIndex("by_time", (q) =>
        q
          .eq("integrationId", state.integrationId)
          .eq("epochStartedAt", state.epochStartedAt)
          .gte("occurredAt", args.startAt)
          .lt("occurredAt", args.endAt),
      )
      .take(5001);
    if (rows.length > 5000) return unknown;
    return {
      joins: rows.filter((r) => membershipMovement(r.eventType) === "join")
        .length,
      departures: rows.filter(
        (r) => membershipMovement(r.eventType) === "departure",
      ).length,
      complete: true,
    };
  },
});
export const listActivity = query({
  args: {
    communitySlug: v.string(),
    startAt: v.number(),
    endAt: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(event),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    checkedMembershipRange(args.startAt, args.endAt, 366 * DAY_MS);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Invalid membership page size.");
    const state = await readContext(ctx, args.communitySlug, true);
    if (!state) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("communityMembershipEvents")
      .withIndex("by_time", (q) =>
        q
          .eq("integrationId", state.integrationId)
          .eq("epochStartedAt", state.epochStartedAt)
          .gte("occurredAt", args.startAt)
          .lt("occurredAt", args.endAt),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      page: result.page.map(
        ({
          auditId,
          eventType,
          occurredAt,
          targetUserId,
          targetDisplayName,
        }) => ({
          auditId,
          eventType,
          occurredAt,
          ...(targetUserId ? { targetUserId } : {}),
          ...(targetDisplayName ? { targetDisplayName } : {}),
        }),
      ),
    };
  },
});
