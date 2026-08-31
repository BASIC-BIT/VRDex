import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

export function eventPathForSlugs(
  communitySlug: string | undefined,
  eventSlug: string,
): string {
  return communitySlug
    ? `/${communitySlug}/events/${eventSlug}`
    : `/events/${eventSlug}`;
}

export async function eventPathForRecord(
  db: DatabaseReader,
  event: Pick<Doc<"events">, "communityProfileId" | "slug">,
  eventSlug = event.slug,
): Promise<string> {
  const community = event.communityProfileId === undefined
    ? null
    : await db.get(event.communityProfileId);

  return eventPathForSlugs(community?.slug, eventSlug ?? "event-page");
}
