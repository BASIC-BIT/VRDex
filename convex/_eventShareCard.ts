import type { Doc } from "./_generated/dataModel";
import { firstSafeHttpsUrl, optionalField } from "./_publicFields";

export type PublicEventShareCard = {
  slug: string;
  communitySlug: string;
  communityName: string;
  title: string;
  startAt: number;
  endAt?: number;
  timezone?: string;
  status: "scheduled" | "cancelled";
  summary?: string;
  artworkImageUrl?: string;
};

/**
 * The deliberately small public projection used by link unfurls.
 *
 * Event manager notes, media-control state, source internals, and schedule
 * associations do not belong in a crawler-facing card. The caller is
 * responsible for proving that both the event and its community are public.
 */
export function toPublicEventShareCard(
  event: Doc<"events">,
  community: Doc<"profiles">,
): PublicEventShareCard | null {
  if (
    event.publicationState !== "published" ||
    event.slug === undefined ||
    event.communityProfileId !== community._id ||
    community.profileType !== "community"
  ) {
    return null;
  }

  const artworkImageUrl = firstSafeHttpsUrl(
    event.posterImageUrl,
    event.bannerImageUrl,
    event.thumbnailImageUrl,
  );

  return {
    slug: event.slug,
    communitySlug: community.slug,
    communityName: community.displayName,
    title: event.title,
    startAt: event.startAt,
    status: event.eventStatus,
    ...optionalField("endAt", event.endAt),
    ...optionalField("timezone", event.timezone),
    ...optionalField("summary", event.summary),
    ...optionalField("artworkImageUrl", artworkImageUrl),
  };
}
