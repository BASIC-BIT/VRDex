import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import {
  subjectHasCommunityCapability,
  type AuthSubject,
} from "./_communityAuthority";
import { userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import {
  eventProfileBroadcastInputChoices,
  resolveBroadcastInput,
  broadcastInputPublicUrl,
} from "./_eventBroadcastSources";
export async function canManageEventMedia(
  db: DatabaseReader,
  event: Doc<"events">,
  subject: AuthSubject,
  userId?: Id<"users"> | null,
): Promise<boolean> {
  if (event.communityProfileId === undefined) {
    return false;
  }

  if (
    userId !== undefined &&
    userId !== null &&
    (await userOwnsProfile(db, event.communityProfileId, userId))
  ) {
    return true;
  }

  return subjectHasCommunityCapability(
    db,
    event.communityProfileId,
    subject,
    "manage_event_media",
  );
}

export async function eventMediaSourceProjectionAvailable(
  db: DatabaseReader,
  source: Doc<"eventMediaSources">,
) {
  const projected =
    source.profileProjection ||
    (source.eventSlotId !== undefined &&
      source.sourceProfileId !== undefined &&
      source.key === `slot-${source.eventSlotId}`);
  if (!projected) return true;
  const slot =
    source.eventSlotId === undefined ? null : await db.get(source.eventSlotId);
  if (!slot?.personProfileId || slot.eventId !== source.eventId) return false;
  const profile = await db.get(slot.personProfileId);
  if (!profile || !canReadProfile("public", profile)) return false;
  const input = resolveBroadcastInput({
    choices: eventProfileBroadcastInputChoices(profile),
    explicitInput: slot.broadcastInput,
    legacySelectedStreamId: slot.selectedStreamId,
  });
  return (
    input !== undefined &&
    broadcastInputPublicUrl(input) === source.publicUrl &&
    source.projectionAvailable !== false
  );
}
