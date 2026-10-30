import { supportsNowPlayingArtwork } from "../packages/media-relay/src/artwork-policy";
import { getPublicProfileMediaKit } from "./_profileAssets";
import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { getPublicEventBySlug } from "./_eventPublic";
import { isInScheduledWatchWindow } from "./_eventRuntime";
import { canReadProfile } from "./_profilePermissions";
import { publicProfileOutboundLinks } from "./_profilePublic";
import { parseVrcdnStreamLinks } from "./_vrcdnLinks";
import type { DjMetadata, PublicContext } from "../packages/media-relay/src";

/** Source and publication policy only; live metadata and calendar continuation are independent. */
function revision(parts: unknown[]): number {
  let hash = 2166136261;
  for (const char of JSON.stringify(parts))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
function metadata(displayName: string): DjMetadata {
  return { displayName, artworkAssetId: null, artworkRevision: null };
}
async function profileMetadata(
  db: DatabaseReader,
  profile: Doc<"profiles">,
  surface: "profile_page" | "discovery",
): Promise<DjMetadata> {
  const kit = await getPublicProfileMediaKit(db, profile, { surface });
  const image =
    kit.compactDisplay === "logo" ? kit.primaryLogo : kit.profileImage;
  // The derivative route always authorizes selection on profile_page. Never
  // substitute a less-public image when discovery selected something else.
  const routeKit = surface === "profile_page" ? kit : await getPublicProfileMediaKit(db, profile, { surface: "profile_page" });
  const routeImage = routeKit.compactDisplay === "logo" ? routeKit.primaryLogo : routeKit.profileImage;
  const candidate = image && image.assetId === routeImage?.assetId ? await db.get(image.assetId) : null;
  const asset = candidate && supportsNowPlayingArtwork(candidate) ? candidate : null;
  return {
    displayName: profile.displayName,
    artworkAssetId: asset?._id ?? null,
    artworkRevision: asset ? String(Math.floor(asset.updatedAt)) : null,
  };
}
export async function authorizeRelayContext(
  db: DatabaseReader,
  context: PublicContext,
  streamId: string,
  now: number,
  continuing: boolean,
) {
  if (context.kind === "profile") {
    const id = db.normalizeId("profiles", context.profileId);
    const profile = id === null ? null : await db.get(id);
    if (
      !profile ||
      !canReadProfile("public", profile) ||
      context.linkId !== streamId
    )
      return null;
    const link = publicProfileOutboundLinks(profile, "profile_page").find(
      (link) => {
        const parsed = parseVrcdnStreamLinks(link.url);
        return (
          parsed?.streamId === streamId && parsed.directVideoUrl === undefined
        );
      },
    );
    if (!link) return null;
    return {
      contextRevision: revision([
        context.kind,
        context.profileId,
        context.linkId,
        streamId,
        profile.publicationState,
        profile.publicSurfacingState,
        profile.fieldVisibility?.outboundLinks ?? "public",
      ]),
      metadata: await profileMetadata(db, profile, "profile_page"),
    };
  }
  const id = db.normalizeId("events", context.eventId);
  const event = id === null ? null : await db.get(id);
  const projected = await getPublicEventBySlug(db, event);
  if (
    !projected ||
    !projected.watchSurfaceEnabled ||
    projected.status === "cancelled" ||
    projected.scheduleKind === "date_only" ||
    projected.startAt === undefined
  )
    return null;
  if (
    !continuing &&
    !isInScheduledWatchWindow({ ...projected, startAt: projected.startAt, now })
  )
    return null;
  if (projected.watchMode === "performer_sequence") {
    const slot = projected.slots.find(
      (slot) => slot.playbackKey === context.selectedSourceId,
    );
    if (slot?.stream?.streamId !== streamId || !slot.performer) return null;
    const slotId = db.normalizeId("eventSlots", slot.playbackKey);
    const storedSlot = slotId ? await db.get(slotId) : null;
    const performer = storedSlot?.personProfileId
      ? await db.get(storedSlot.personProfileId)
      : null;
    if (!performer) return null;
    return {
      contextRevision: revision([
        context.kind,
        context.eventId,
        context.selectedSourceId,
        streamId,
        projected.watchMode,
        performer._id,
      ]),
      metadata: await profileMetadata(db, performer, "discovery"),
    };
  }
  if (
    context.selectedSourceId !== streamId ||
    !projected.mediaLinks.some((link) => {
      if (!["watch", "stream", "vrcdn"].includes(link.type)) return false;
      const parsed = parseVrcdnStreamLinks(link.url);
      return (
        parsed?.streamId === streamId && parsed.directVideoUrl === undefined
      );
    })
  )
    return null;
  return {
    contextRevision: revision([
      context.kind,
      context.eventId,
      context.selectedSourceId,
      streamId,
      projected.watchMode,
    ]),
    metadata: metadata(projected.title),
  };
}
