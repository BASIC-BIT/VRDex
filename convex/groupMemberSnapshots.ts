import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { canReadProfile } from "./_profilePermissions";
import { readClubVisibility } from "./_clubAccess";
import { recordGroupMemberObservation } from "./_groupMemberSnapshots";
import type { DatabaseReader } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const DAY = 86_400_000;
const workerValidator = v.object({
  collectorAccountId: v.id("collectorAccounts"), workerId: v.string(), workerKeyHash: v.string(),
});

async function authorized(db: DatabaseReader,
  worker: { collectorAccountId: Id<"collectorAccounts">; workerId: string; workerKeyHash: string }, now: number,
  allowCooldown = false) {
  const account = await db.get(worker.collectorAccountId);
  const fleet = await db.query("collectorFleetSettings").withIndex("by_key", q => q.eq("key", "global")).first();
  return !!account && account.state === "ready" && !account.killSwitchEnabled &&
    (allowCooldown || (account.cooldownUntil ?? 0) <= now) && account.workerKeyHash === worker.workerKeyHash &&
    !fleet?.killSwitchEnabled;
}

export const claim = internalMutation({
  args: { worker: workerValidator, now: v.optional(v.number()) },
  returns: v.union(v.null(), v.object({
    linkId: v.id("profileExternalLinks"), leaseToken: v.string(), vrchatGroupId: v.string(),
  })),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    if (!await authorized(ctx.db, args.worker, now)) return null;
    const [neverPolled, due] = await Promise.all([
      ctx.db.query("profileExternalLinks").withIndex("by_assetType_state_linkRole_nextMemberPollAt", q => q.eq("assetType", "vrchat_group").eq("state", "active").eq("linkRole", "primary").eq("nextMemberPollAt", undefined)).take(30),
      ctx.db.query("profileExternalLinks").withIndex("by_assetType_state_linkRole_nextMemberPollAt", q => q.eq("assetType", "vrchat_group").eq("state", "active").eq("linkRole", "primary").gte("nextMemberPollAt", 0).lte("nextMemberPollAt", now)).take(30),
    ]);
    for (const link of [...neverPolled, ...due]) {
      const profile = await ctx.db.get(link.profileId);
      const eligible = profile?.profileType === "community" && canReadProfile("public", profile) &&
        (await readClubVisibility(ctx.db, link.profileId)).group_size.audience === "public";
      if (!eligible) {
        await ctx.db.patch(link._id, { nextMemberPollAt: now + DAY });
        continue;
      }
      let metadata = await ctx.db.query("vrchatGroupMemberMetadata")
        .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", link.assetExternalId)).unique();
      if (metadata?.lastObservedAt && metadata.lastObservedAt > now - DAY) {
        await ctx.db.patch(link._id, { nextMemberPollAt: metadata.lastObservedAt + DAY });
        continue;
      }
      if (metadata?.claimExpiresAt && metadata.claimExpiresAt > now) {
        await ctx.db.patch(link._id, { nextMemberPollAt: metadata.claimExpiresAt });
        continue;
      }
      const leaseToken = crypto.randomUUID();
      const claimExpiresAt = now + 5 * 60_000;
      if (metadata) await ctx.db.patch(metadata._id, { claimToken: leaseToken, claimExpiresAt, updatedAt: now });
      else await ctx.db.insert("vrchatGroupMemberMetadata", {
        vrchatGroupId: link.assetExternalId, claimToken: leaseToken, claimExpiresAt, updatedAt: now,
      });
      await ctx.db.patch(link._id, {
        memberPollLeaseToken: leaseToken, memberPollWorkerId: args.worker.workerId,
        nextMemberPollAt: claimExpiresAt,
      });
      return { linkId: link._id, leaseToken, vrchatGroupId: link.assetExternalId };
    }
    return null;
  },
});

export const complete = internalMutation({
  args: {
    worker: workerValidator, linkId: v.id("profileExternalLinks"), leaseToken: v.string(),
    memberCount: v.optional(v.number()), groupCreatedAt: v.optional(v.number()),
    observedAt: v.number(), now: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    if (!await authorized(ctx.db, args.worker, now, true)) return false;
    const link = await ctx.db.get(args.linkId);
    if (!link || link.memberPollLeaseToken !== args.leaseToken || link.memberPollWorkerId !== args.worker.workerId ||
      (link.nextMemberPollAt ?? 0) <= now || link.state !== "active" || link.linkRole !== "primary") return false;
    const metadata = await ctx.db.query("vrchatGroupMemberMetadata")
      .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", link.assetExternalId)).unique();
    if (!metadata || metadata.claimToken !== args.leaseToken) return false;
    if (args.memberCount !== undefined) {
      if (!Number.isSafeInteger(args.memberCount) || args.memberCount < 0 ||
        !Number.isSafeInteger(args.observedAt) || Math.abs(args.observedAt - now) > 15 * 60_000 ||
        (args.groupCreatedAt !== undefined && (!Number.isSafeInteger(args.groupCreatedAt) || args.groupCreatedAt > args.observedAt || args.groupCreatedAt < 0))) {
        throw new Error("Group member observation is malformed.");
      }
      await recordGroupMemberObservation(ctx.db, {
        vrchatGroupId: link.assetExternalId, memberCount: args.memberCount,
        observedAt: args.observedAt, ...(args.groupCreatedAt === undefined ? {} : { groupCreatedAt: args.groupCreatedAt }),
      });
    }
    await ctx.db.patch(metadata._id, { claimToken: undefined, claimExpiresAt: undefined });
    await ctx.db.patch(link._id, {
      memberPollLeaseToken: undefined, memberPollWorkerId: undefined,
      nextMemberPollAt: now + (args.memberCount === undefined ? 15 * 60_000 : DAY),
    });
    return true;
  },
});

export const release = internalMutation({
  args: { worker: workerValidator, linkId: v.id("profileExternalLinks"), leaseToken: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!await authorized(ctx.db, args.worker, Date.now(), true)) return false;
    const link = await ctx.db.get(args.linkId);
    if (!link || link.memberPollLeaseToken !== args.leaseToken || link.memberPollWorkerId !== args.worker.workerId) return false;
    const metadata = await ctx.db.query("vrchatGroupMemberMetadata")
      .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", link.assetExternalId)).unique();
    if (metadata?.claimToken !== args.leaseToken) return false;
    await ctx.db.patch(metadata._id, { claimToken: undefined, claimExpiresAt: undefined });
    await ctx.db.patch(link._id, { memberPollLeaseToken: undefined, memberPollWorkerId: undefined, nextMemberPollAt: undefined });
    return true;
  },
});
