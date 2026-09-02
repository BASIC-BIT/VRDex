import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

export function eventPathForSlugs(
  communitySlug: string,
  eventSlug: string,
): string {
  return `/${communitySlug}/events/${eventSlug}`;
}

export async function eventPathForRecord(
  db: DatabaseReader,
  event: Pick<Doc<"events">, "communityProfileId" | "slug">,
  eventSlug = event.slug,
): Promise<string> {
  const community = event.communityProfileId === undefined
    ? null
    : await db.get(event.communityProfileId);

  if (community?.profileType !== "community") {
    throw new Error("Event community was not found.");
  }

  return eventPathForSlugs(community.slug, eventSlug ?? "event-page");
}
