import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { parseProfileLinkDestination } from "./_profileLinkDestination";
import { canReadProfile } from "./_profilePermissions";
import { visibleProfileList } from "./_profileFieldVisibility";

export async function queueProfileLinkDestinations(db: DatabaseWriter, profile: Doc<"profiles">, now: number) {
  const publicLinks = canReadProfile("public", profile)
    ? visibleProfileList(profile, "outboundLinks", profile.outboundLinks ?? [], "profile_page") : [];
  const currentKeys = new Set(publicLinks.map(link => parseProfileLinkDestination(link)?.key));
  const oldReferences = await db.query("profileLinkDestinationReferences").withIndex("by_profile", q => q.eq("profileId", profile._id)).take(100);
  for (const reference of oldReferences) {
    if (!currentKeys.has(reference.key)) await db.delete(reference._id);
  }
  for (const link of publicLinks) {
    const target = parseProfileLinkDestination(link);
    if (!target) continue;
    const reference = await db.query("profileLinkDestinationReferences").withIndex("by_key_profile", q => q.eq("key", target.key).eq("profileId", profile._id)).unique();
    if (!reference) await db.insert("profileLinkDestinationReferences", {key: target.key, profileId: profile._id});
    const existing = await db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", target.key)).unique();
    if (existing) {
      await db.patch(existing._id, { lastReferencedAt: now });
    } else {
      await db.insert("profileLinkDestinations", { ...target, provider: target.kind === "discord_guild" ? "discord" : "vrchat", status: "pending", nextAttemptAt: now, lastReferencedAt: now });
    }
  }
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
      ...(cached?.artworkSourceUrl ? { artworkUrl: `/api/profile-link-artwork/${encodeURIComponent(target.key)}?v=${cached.observedAt ?? 0}&profile=${encodeURIComponent(profileId)}` } : {}),
      ...(cached?.observedAt !== undefined ? { observedAt: cached.observedAt } : {}),
    } };
  }));
}
