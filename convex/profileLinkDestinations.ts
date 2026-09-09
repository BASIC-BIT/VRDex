import { allowedDestinationArtworkUrl } from "../workers/group-telemetry/profile-link-destination.mjs";
import { canReadProfile } from "./_profilePermissions";
import { visibleProfileList } from "./_profileFieldVisibility";
import { parseProfileLinkDestination } from "./_profileLinkDestination";
import { v } from "convex/values";
import { automaticProfileImage, hasDestinationArtwork } from "./_profileImageFallback";
import { internalMutation, mutation, query } from "./_generated/server";
import type { DatabaseReader } from "./_generated/server";
import { queueProfileLinkDestinations, syncDestinationQueue, destinationWorkHint } from "./_profileLinkDestinationCache";

const workerValidator = v.object({ collectorAccountId: v.string(), workerId: v.string(), workerKeyHash: v.string() });
type Worker = { collectorAccountId: string; workerId: string; workerKeyHash: string };
function sameWorker(left: Worker | undefined, right: Worker | undefined) {
  return !!left && !!right && left.collectorAccountId === right.collectorAccountId && left.workerId === right.workerId && left.workerKeyHash === right.workerKeyHash;
}
async function workerAuthorized(db: DatabaseReader, worker: Worker | undefined, now: number, allowCooldown = false) {
  if (!worker) return false;
  const id = db.normalizeId("collectorAccounts", worker.collectorAccountId);
  const account = id ? await db.get(id) : null;
  const fleet = await db.query("collectorFleetSettings").first();
  if (fleet?.killSwitchEnabled) return false;
  return !!account && account.state === "ready" && !account.killSwitchEnabled &&
    (allowCooldown || (account.cooldownUntil ?? 0) <= now) && account.workerKeyHash === worker.workerKeyHash;
}
const DAY = 86_400_000;

export const requestForProfile = mutation({
  args: {slug:v.string()},
  handler: async (ctx, args) => {
    const profile = await ctx.db.query("profiles").withIndex("by_slug", q => q.eq("slug",args.slug)).unique();
    if (profile) await queueProfileLinkDestinations(ctx, profile, Date.now(), {requestExisting:true});
    return null;
  },
});

export const claimPending = internalMutation({
  args: { provider: v.union(v.literal("vrchat"), v.literal("discord")), limit: v.optional(v.number()), worker: v.optional(workerValidator), dispatcherToken:v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.provider === "vrchat" && !await workerAuthorized(ctx.db, args.worker, now)) return {jobs: [], destinationWorkDueAt:await destinationWorkHint(ctx.db)};
    const budget = args.provider === "discord" ? await ctx.db.query("profileLinkDestinationBudgets").withIndex("by_provider", q => q.eq("provider", "discord")).unique() : null;
    if (args.dispatcherToken) {
      if (budget?.dispatcherToken !== args.dispatcherToken) return {jobs:[],destinationWorkDueAt:await destinationWorkHint(ctx.db)};
      await ctx.db.patch(budget._id, {dispatcherToken:undefined,dispatcherDueAt:undefined,dispatcherId:undefined});
    }
    if (budget && budget.nextAllowedAt > now) {
      await syncDestinationQueue(ctx, args.provider, now);
      return {jobs:[],destinationWorkDueAt:await destinationWorkHint(ctx.db)};
    }
    const rows = await ctx.db.query("profileLinkDestinations").withIndex("by_provider_workDueAt", q => q.eq("provider", args.provider).gt("workDueAt", undefined).lte("workDueAt", now)).take(30);
    const jobs = [];
    const limit = args.provider === "discord" ? 1 : Math.max(1, Math.min(10, args.limit ?? 1));
    for (const row of rows) {
      const references = await ctx.db.query("profileLinkDestinationReferences").withIndex("by_key_profile", q => q.eq("key", row.key)).take(100);
      let referencedPublicly = false;
      for (const reference of references) {
        const profile = await ctx.db.get(reference.profileId);
        const visible = profile && canReadProfile("public", profile) && visibleProfileList(profile, "outboundLinks", profile.outboundLinks ?? [], "profile_page").some(link => parseProfileLinkDestination(link)?.key === row.key);
        if (visible) { referencedPublicly = true; break; }
        await ctx.db.delete(reference._id);
      }
      if (!referencedPublicly) {
        await ctx.db.patch(row._id, {workDueAt:references.length === 100 ? now : undefined,leaseToken:undefined,leaseExpiresAt:undefined,leaseWorker:undefined});
        continue;
      }
      const leaseToken = crypto.randomUUID();
      await ctx.db.patch(row._id, {leaseToken, leaseExpiresAt: now + 5 * 60_000, workDueAt: now + 5 * 60_000, ...(args.worker ? {leaseWorker: args.worker} : {})});
      jobs.push({key: row.key, kind: row.kind, locator: row.locator, leaseToken});
      if (jobs.length >= limit) break;
    }
    if (jobs.length && args.provider === "discord") {
      if (budget) await ctx.db.patch(budget._id,{nextAllowedAt:now+60_000});
      else await ctx.db.insert("profileLinkDestinationBudgets",{provider:"discord",nextAllowedAt:now+60_000});
    }
    await syncDestinationQueue(ctx, args.provider, now);
    return {jobs,destinationWorkDueAt:await destinationWorkHint(ctx.db)};
  },
});

export const recordResult = internalMutation({
  args: {
    key: v.string(), leaseToken: v.string(), worker: v.optional(workerValidator),
    result: v.object({status: v.union(v.literal("resolved"), v.literal("invalid"), v.literal("inaccessible"), v.literal("transient")), entityId: v.optional(v.string()), displayName: v.optional(v.string()), artworkSourceUrl: v.optional(v.string()), artworkType: v.optional(v.union(v.literal("profile_picture"),v.literal("group_icon"),v.literal("server_icon"))), retryAfterMs: v.optional(v.number())}),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", args.key)).unique();
    const now = Date.now();
    if (!row || row.leaseToken !== args.leaseToken || (row.leaseExpiresAt ?? 0) <= now) return {accepted: false,destinationWorkDueAt:await destinationWorkHint(ctx.db)};
    if (row.provider === "vrchat" && (!await workerAuthorized(ctx.db, args.worker, now, true) || !sameWorker(row.leaseWorker, args.worker))) return {accepted: false,destinationWorkDueAt:await destinationWorkHint(ctx.db)};
    const result = args.result;
    const transient = result.status === "transient";
    if (result.status === "resolved") {
      const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
      const idPattern = row.kind === "discord_guild" ? /^\d{5,25}$/ : new RegExp(`^${row.kind === "vrchat_user" ? "usr" : "grp"}_${uuid}$`, "i");
      if (!result.entityId || !idPattern.test(result.entityId) || !result.displayName?.trim() || /[\u0000-\u001f\u007f]/u.test(result.displayName)) return {accepted: false,destinationWorkDueAt:await destinationWorkHint(ctx.db)};
      if ((row.locator.startsWith("usr_") || row.locator.startsWith("grp_")) && row.locator !== result.entityId.toLowerCase()) return {accepted: false,destinationWorkDueAt:await destinationWorkHint(ctx.db)};
    }
    const retry = Number.isFinite(result.retryAfterMs) ? Math.max(60_000, Math.min(DAY, result.retryAfterMs!)) : 15 * 60_000;
    if (transient && row.provider === "discord") {
      const budget = await ctx.db.query("profileLinkDestinationBudgets").withIndex("by_provider", q => q.eq("provider", "discord")).unique();
      if (budget) await ctx.db.patch(budget._id, {nextAllowedAt: Math.max(budget.nextAllowedAt, now + retry)});
    }
    // Successful binding replacement is atomic, including clearing a previous
    // guild's image when the new guild has no image. Invalid/private targets
    // clear branding; only temporary transport failures preserve it.
    await ctx.db.patch(row._id, {
      leaseToken: undefined, leaseExpiresAt: undefined, leaseWorker: undefined,
      workDueAt: undefined,
      retryEligibleAt: result.status === "resolved" ? undefined : now + retry,
      ...(transient ? {status: row.name ? "resolved" as const : "unavailable" as const} : {
        status: result.status === "resolved" ? "resolved" as const : result.status === "invalid" ? "invalid" as const : "unavailable" as const,
        entityId: result.status === "resolved" ? result.entityId : undefined,
        name: result.status === "resolved" ? result.displayName!.trim().slice(0, 120) : undefined,
        artworkSourceUrl: result.status === "resolved" ? allowedDestinationArtworkUrl(result.artworkSourceUrl, row.kind) : undefined,
        artworkType: result.status === "resolved" ? result.artworkType : undefined,
        observedAt: now,
      }),
    });
    await syncDestinationQueue(ctx, row.provider, now);
    return {accepted: true,destinationWorkDueAt:await destinationWorkHint(ctx.db)};
  },
});

export const release = internalMutation({
  args: {key: v.string(), leaseToken: v.string(), worker: v.optional(workerValidator)},
  handler: async (ctx, args) => {
    const row = await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (!row || row.leaseToken !== args.leaseToken || (row.leaseExpiresAt ?? 0) <= Date.now()) return {destinationWorkDueAt:await destinationWorkHint(ctx.db)};
    if (row.provider === "vrchat" && (!await workerAuthorized(ctx.db, args.worker, Date.now(), true) || !sameWorker(row.leaseWorker, args.worker))) return {destinationWorkDueAt:await destinationWorkHint(ctx.db)};
    await ctx.db.patch(row._id, {leaseToken: undefined, leaseExpiresAt: undefined, leaseWorker: undefined, workDueAt: Date.now() + 60_000});
    await syncDestinationQueue(ctx, row.provider, Date.now());
    return {destinationWorkDueAt:await destinationWorkHint(ctx.db)};
  },
});

export const lookupArtworkSource = query({
  args: {key: v.string(), profileId: v.string(), surface: v.optional(v.union(v.literal("profile_page"),v.literal("discovery"))), profileImage: v.optional(v.boolean())},
  handler: async (ctx, args) => {
    // Authorize against the exact rendering profile, so stale references on
    // unrelated profiles cannot hide a valid destination or widen its access.
    const profileId = ctx.db.normalizeId("profiles", args.profileId);
    const profile = profileId ? await ctx.db.get(profileId) : null;
    if (!profile || !canReadProfile("public", profile)) return null;
    const surface = args.surface ?? "profile_page";
    if (!visibleProfileList(profile, "outboundLinks", profile.outboundLinks ?? [], surface).some(link => parseProfileLinkDestination(link)?.key === args.key)) return null;
    if (args.profileImage) {
      const placements = await ctx.db.query("profileAssetPlacements").withIndex("by_profileId_state", q => q.eq("profileId",profile._id).eq("state","active")).collect();
      const selected = await automaticProfileImage(ctx.db, profile, surface, placements.some(p => p.placement === "profile_image" || p.placement === "primary_logo"));
      if (!selected || !selected.startsWith(`/api/profile-link-artwork/${encodeURIComponent(args.key)}?`)) return null;
    }
    const row = await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (!row || !hasDestinationArtwork(row)) return null;
    return {kind: row.kind, artworkSourceUrl: row.artworkSourceUrl, observedAt: row.observedAt};
  },
});
