import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseProfileLinkDestination } from "./_profileLinkDestination";
import { canReadProfile } from "./_profilePermissions";
import { visibleProfileList } from "./_profileFieldVisibility";
import { hasDestinationArtwork } from "./_profileImageFallback";

type Provider = "discord" | "vrchat";
export async function destinationWorkHint(db: DatabaseReader) {
  return (await db.query("collectorFleetSettings").withIndex("by_key", q => q.eq("key", "global")).unique())?.destinationWorkDueAt ?? null;
}

// Read the queue only when requested work changes, never from idle collector polls.
export async function syncDestinationQueue(ctx: MutationCtx, provider: Provider, now: number) {
  const first = await ctx.db.query("profileLinkDestinations").withIndex("by_provider_workDueAt", q => q.eq("provider", provider).gt("workDueAt", undefined)).first();
  const due = first?.workDueAt;
  if (provider === "vrchat") {
    const fleet = await ctx.db.query("collectorFleetSettings").withIndex("by_key", q => q.eq("key", "global")).unique();
    if (fleet) await ctx.db.patch(fleet._id, {destinationWorkDueAt: due});
    else if (due !== undefined) await ctx.db.insert("collectorFleetSettings", {key:"global",killSwitchEnabled:false,globalRequestsPerMinute:30,updatedAt:now,destinationWorkDueAt:due});
    return;
  }
  const budget = await ctx.db.query("profileLinkDestinationBudgets").withIndex("by_provider", q => q.eq("provider", "discord")).unique();
  if (due === undefined) {
    if (budget?.dispatcherId && (await ctx.db.system.get(budget.dispatcherId))?.state.kind === "pending") await ctx.scheduler.cancel(budget.dispatcherId);
    if (budget?.dispatcherToken) await ctx.db.patch(budget._id, {dispatcherToken:undefined,dispatcherDueAt:undefined,dispatcherId:undefined});
    return;
  }
  const wakeAt = Math.max(now, due, budget?.nextAllowedAt ?? 0);
  if (budget?.dispatcherToken && budget.dispatcherDueAt! <= wakeAt) return;
  if (budget?.dispatcherId && (await ctx.db.system.get(budget.dispatcherId))?.state.kind === "pending") await ctx.scheduler.cancel(budget.dispatcherId);
  const dispatcherToken = crypto.randomUUID();
  const dispatcherId = await ctx.scheduler.runAt(wakeAt, internal.profileLinkDestinationDelivery.refreshDiscord, {dispatcherToken});
  if (budget) await ctx.db.patch(budget._id, {dispatcherToken,dispatcherId,dispatcherDueAt:wakeAt});
  else await ctx.db.insert("profileLinkDestinationBudgets", {provider:"discord",nextAllowedAt:0,dispatcherToken,dispatcherId,dispatcherDueAt:wakeAt});
}

export async function queueProfileLinkDestinations(ctx: MutationCtx, profile: Doc<"profiles">, now: number, options: {requestExisting?: boolean; previousProfile?: Doc<"profiles">} = {}) {
  const db = ctx.db;
  const publicLinks = canReadProfile("public", profile)
    ? visibleProfileList(profile, "outboundLinks", profile.outboundLinks ?? [], "profile_page") : [];
  const targets = new Map(publicLinks.flatMap(link => { const target = parseProfileLinkDestination(link); return target ? [[target.key, target] as const] : []; }));
  const previous = options.previousProfile;
  const previousLinks = previous && canReadProfile("public", previous)
    ? visibleProfileList(previous, "outboundLinks", previous.outboundLinks ?? [], "profile_page") : [];
  const previousKeys = new Set(previousLinks.map(link => parseProfileLinkDestination(link)?.key));
  const changed = new Set<Provider>();
  const queued: string[] = [];
  const oldReferences = await db.query("profileLinkDestinationReferences").withIndex("by_profile", q => q.eq("profileId", profile._id)).collect();
  for (const reference of oldReferences) {
    if (targets.has(reference.key)) continue;
    await db.delete(reference._id);
    const remaining = await db.query("profileLinkDestinationReferences").withIndex("by_key_profile", q => q.eq("key", reference.key)).first();
    if (!remaining) {
      const row = await db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", reference.key)).unique();
      if (row) { if (row.workDueAt !== undefined) changed.add(row.provider); await db.delete(row._id); }
    }
  }
  for (const target of targets.values()) {
    const reference = await db.query("profileLinkDestinationReferences").withIndex("by_key_profile", q => q.eq("key", target.key).eq("profileId", profile._id)).unique();
    if (!reference) await db.insert("profileLinkDestinationReferences", {key:target.key,profileId:profile._id});
    // Reference history may be incomplete during rollout. The authored before/after
    // membership, when supplied, decides whether a save requested new work.
    if (!options.requestExisting && (previous ? previousKeys.has(target.key) : !!reference)) continue;
    const row = await db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", target.key)).unique();
    const provider = target.kind === "discord_guild" ? "discord" : "vrchat";
    if (row) {
      if ((row.leaseExpiresAt ?? 0) > now || row.workDueAt !== undefined || (row.retryEligibleAt !== undefined ? now < row.retryEligibleAt : row.observedAt !== undefined && now - row.observedAt < 86_400_000)) continue;
      await db.patch(row._id, {workDueAt:now});
    } else await db.insert("profileLinkDestinations", {...target,provider,status:"pending",workDueAt:now});
    changed.add(provider); queued.push(target.key);
  }
  for (const provider of changed) await syncDestinationQueue(ctx, provider, now);
  return queued;
}

export async function projectProfileLinkDestinations<T extends { type: string; url: string }>(db: DatabaseReader, links: T[], profileId: Doc<"profiles">["_id"]) {
  return Promise.all(links.map(async link => {
    const target = parseProfileLinkDestination(link);
    if (!target) return link;
    const cached = await db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", target.key)).unique();
    return { ...link, destination: {
      targetKey: target.key,
      kind: target.kind,
      status: cached?.status ?? "pending" as const,
      ...(cached?.entityId ? { entityId: cached.entityId } : {}),
      ...(cached?.name ? { name: cached.name } : {}),
      ...(hasDestinationArtwork(cached) ? { artworkUrl: `/api/profile-link-artwork/${encodeURIComponent(target.key)}?v=${cached!.observedAt ?? 0}&profile=${encodeURIComponent(profileId)}` } : {}),
      ...(cached?.observedAt !== undefined ? { observedAt: cached.observedAt } : {}),
    } };
  }));
}
