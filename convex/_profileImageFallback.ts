import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { isProfileFieldVisible, visibleProfileList, type ProfileVisibilitySurface } from "./_profileFieldVisibility";
import { parseProfileLinkDestination } from "./_profileLinkDestination";

/** Legacy user images have no provenance and may be current-avatar artwork. */
export function hasDestinationArtwork(row: Doc<"profileLinkDestinations"> | null) {
  return !!row?.artworkSourceUrl && row.status === "resolved" &&
    (row.kind !== "vrchat_user" || row.artworkType === "profile_picture");
}

export function profileImageSources(profile: Doc<"profiles">, surface: ProfileVisibilitySurface) {
  return visibleProfileList(profile, "outboundLinks", profile.outboundLinks ?? [], surface).flatMap(link => {
    const target = parseProfileLinkDestination(link);
    if (!target || (profile.profileType === "person" ? target.kind !== "vrchat_user" : target.kind === "vrchat_user")) return [];
    return [{ ...target, label: link.label || link.url }];
  });
}

export async function automaticProfileImage(db: DatabaseReader, profile: Doc<"profiles">, surface: ProfileVisibilitySurface, hasAuthoredPlacement = false): Promise<string | undefined> {
  if (profile.imageFallback?.disabled || hasAuthoredPlacement || profile.avatarImageUrl || !isProfileFieldVisible(profile, "avatarImageUrl", surface)) return undefined;
  const sources = profileImageSources(profile, surface);
  let selected = sources.slice(0, 1);
  if (profile.profileType === "community") {
    selected = (["vrchat_group", "discord_guild"] as const).flatMap(kind => {
      const preferredKey = kind === "vrchat_group" ? profile.imageFallback?.vrchatGroupKey : profile.imageFallback?.discordGuildKey;
      const candidates = sources.filter(source => source.kind === kind);
      const source = candidates.find(source => source.key === preferredKey) ?? candidates[0];
      return source ? [source] : [];
    });
  } else if (sources.length > 1) {
    const connections = await db.query("profileExternalLinks").withIndex("by_profileId_state", q => q.eq("profileId", profile._id).eq("state", "active")).collect();
    const primary = connections.find(link => link.assetType === "vrchat_user" && link.linkRole === "primary");
    const source = sources.find(source => source.locator === primary?.assetExternalId);
    if (source) selected = [source];
  }
  for (const source of selected) {
    const cached = await db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", source.key)).unique();
    if (hasDestinationArtwork(cached)) return `/api/profile-link-artwork/${encodeURIComponent(source.key)}?v=${cached!.observedAt ?? 0}&profile=${encodeURIComponent(profile._id)}&size=512&surface=${surface}`;
  }
  return undefined;
}
