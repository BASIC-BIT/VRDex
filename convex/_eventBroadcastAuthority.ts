import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import {
  subjectHasCommunityCapability,
  type AuthSubject,
} from "./_communityAuthority";
import { userOwnsProfile } from "./_profileOwnership";
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
