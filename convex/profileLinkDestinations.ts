import { allowedDestinationArtworkUrl } from "../workers/group-telemetry/profile-link-destination.mjs";
import { canReadProfile } from "./_profilePermissions";
import { visibleProfileList } from "./_profileFieldVisibility";
import { parseProfileLinkDestination } from "./_profileLinkDestination";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { DatabaseReader } from "./_generated/server";
import { queueProfileLinkDestinations } from "./_profileLinkDestinationCache";

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

// Bounded cursor sweep includes existing profiles and eventually discovers every
// publication path without rewriting profile revisions or authored labels.
export const discover = internalMutation({
  args: {},
  handler: async ctx => {
    const expired = await ctx.db.query("profileLinkDestinations").withIndex("by_lastReferencedAt", q => q.lt("lastReferencedAt", Date.now() - 7 * DAY)).take(25);
    for (const row of expired) {
      const references = await ctx.db.query("profileLinkDestinationReferences").withIndex("by_key_profile", q => q.eq("key", row.key)).take(100);
      for (const reference of references) await ctx.db.delete(reference._id);
      if (references.length < 100) await ctx.db.delete(row._id);
    }
    const state = await ctx.db.query("profileLinkDestinationSweep").first();
    const page = await ctx.db.query("profiles").paginate({cursor: state?.cursor ?? null, numItems: 25});
    for (const profile of page.page) await queueProfileLinkDestinations(ctx.db, profile, Date.now());
    const cursor = page.isDone ? null : page.continueCursor;
    if (state) await ctx.db.patch(state._id, {cursor});
    else await ctx.db.insert("profileLinkDestinationSweep", {cursor});
  },
});

export const claimPending = internalMutation({
  args: { provider: v.union(v.literal("vrchat"), v.literal("discord")), limit: v.optional(v.number()), worker: v.optional(workerValidator) },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.provider === "vrchat" && !await workerAuthorized(ctx.db, args.worker, now)) return {jobs: []};
    if (args.provider === "discord") {
      const budget = await ctx.db.query("profileLinkDestinationBudgets").withIndex("by_provider", q => q.eq("provider", "discord")).unique();
      if (budget && budget.nextAllowedAt > now) return {jobs: []};
      if (budget) await ctx.db.patch(budget._id, {nextAllowedAt: now + 60_000});
      else await ctx.db.insert("profileLinkDestinationBudgets", {provider: "discord", nextAllowedAt: now + 60_000});
    }
    const rows = await ctx.db.query("profileLinkDestinations").withIndex("by_provider_nextAttemptAt", q => q.eq("provider", args.provider).lte("nextAttemptAt", now)).take(30);
    const jobs = [];
    const limit = args.provider === "discord" ? 1 : Math.max(1, Math.min(10, args.limit ?? 1));
    for (const row of rows) {
      if (row.lastReferencedAt < now - 2 * DAY) {
        await ctx.db.patch(row._id, {nextAttemptAt: now + DAY});
        continue;
      }
      const references = await ctx.db.query("profileLinkDestinationReferences").withIndex("by_key_profile", q => q.eq("key", row.key)).take(100);
      let referencedPublicly = false;
      for (const reference of references) {
        const profile = await ctx.db.get(reference.profileId);
        const visible = profile && canReadProfile("public", profile) && visibleProfileList(profile, "outboundLinks", profile.outboundLinks ?? [], "profile_page").some(link => parseProfileLinkDestination(link)?.key === row.key);
        if (visible) { referencedPublicly = true; break; }
        await ctx.db.delete(reference._id);
      }
      if (!referencedPublicly) {
        await ctx.db.patch(row._id, {nextAttemptAt: now + DAY});
        continue;
      }
      const leaseToken = crypto.randomUUID();
      await ctx.db.patch(row._id, {leaseToken, leaseExpiresAt: now + 5 * 60_000, nextAttemptAt: now + 5 * 60_000, ...(args.worker ? {leaseWorker: args.worker} : {})});
      jobs.push({key: row.key, kind: row.kind, locator: row.locator, leaseToken});
      if (jobs.length >= limit) break;
    }
    return {jobs};
  },
});

export const recordResult = internalMutation({
  args: {
    key: v.string(), leaseToken: v.string(), worker: v.optional(workerValidator),
    result: v.object({status: v.union(v.literal("resolved"), v.literal("invalid"), v.literal("inaccessible"), v.literal("transient")), entityId: v.optional(v.string()), displayName: v.optional(v.string()), artworkSourceUrl: v.optional(v.string()), retryAfterMs: v.optional(v.number())}),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", args.key)).unique();
    const now = Date.now();
    if (!row || row.leaseToken !== args.leaseToken || (row.leaseExpiresAt ?? 0) <= now) return {accepted: false};
    if (row.provider === "vrchat" && (!await workerAuthorized(ctx.db, args.worker, now) || !sameWorker(row.leaseWorker, args.worker))) return {accepted: false};
    const result = args.result;
    const transient = result.status === "transient";
    if (result.status === "resolved") {
      const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
      const idPattern = row.kind === "discord_guild" ? /^\d{5,25}$/ : new RegExp(`^${row.kind === "vrchat_user" ? "usr" : "grp"}_${uuid}$`, "i");
      if (!result.entityId || !idPattern.test(result.entityId) || !result.displayName?.trim() || /[\u0000-\u001f\u007f]/u.test(result.displayName)) return {accepted: false};
      if ((row.locator.startsWith("usr_") || row.locator.startsWith("grp_")) && row.locator !== result.entityId.toLowerCase()) return {accepted: false};
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
      nextAttemptAt: now + (transient ? retry : DAY + Math.floor(Math.random() * 3_600_000)),
      ...(transient ? {status: row.name ? "resolved" as const : "unavailable" as const} : {
        status: result.status === "resolved" ? "resolved" as const : result.status === "invalid" ? "invalid" as const : "unavailable" as const,
        entityId: result.status === "resolved" ? result.entityId : undefined,
        name: result.status === "resolved" ? result.displayName!.trim().slice(0, 120) : undefined,
        artworkSourceUrl: result.status === "resolved" ? allowedDestinationArtworkUrl(result.artworkSourceUrl, row.kind) : undefined,
        observedAt: now,
      }),
    });
    return {accepted: true};
  },
});

export const release = internalMutation({
  args: {key: v.string(), leaseToken: v.string(), worker: v.optional(workerValidator)},
  handler: async (ctx, args) => {
    const row = await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (!row || row.leaseToken !== args.leaseToken) return;
    if (row.provider === "vrchat" && (!await workerAuthorized(ctx.db, args.worker, Date.now(), true) || !sameWorker(row.leaseWorker, args.worker))) return;
    await ctx.db.patch(row._id, {leaseToken: undefined, leaseExpiresAt: undefined, leaseWorker: undefined, nextAttemptAt: Date.now() + 60_000});
  },
});

export const lookupArtworkSource = query({
  args: {key: v.string(), profileId: v.string()},
  handler: async (ctx, args) => {
    // Authorize against the exact rendering profile, so stale references on
    // unrelated profiles cannot hide a valid destination or widen its access.
    const profileId = ctx.db.normalizeId("profiles", args.profileId);
    const profile = profileId ? await ctx.db.get(profileId) : null;
    if (!profile || !canReadProfile("public", profile)) return null;
    if (!visibleProfileList(profile, "outboundLinks", profile.outboundLinks ?? [], "profile_page").some(link => parseProfileLinkDestination(link)?.key === args.key)) return null;
    const row = await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (!row || row.status !== "resolved" || !row.artworkSourceUrl) return null;
    return {kind: row.kind, artworkSourceUrl: row.artworkSourceUrl, observedAt: row.observedAt};
  },
});
