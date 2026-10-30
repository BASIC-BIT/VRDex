import type { TimelineSchedule } from "./_eventTimelineTypes";
import type { publicProfileGenres } from "./_profilePublic";

type ProfileIdentity = { id: string; slug: string; displayName: string };
export type DiscoveryEventCandidate = {
  id: string;
  slug: string;
  href: string;
  title: string;
  host: ProfileIdentity;
  schedule: TimelineSchedule;
  posterImageUrl?: string;
};
type ProfileSignal = ProfileIdentity & { genres: ReturnType<typeof publicProfileGenres> };
export type DiscoveryProfileSignal =
  | (ProfileSignal & { profileType: "person" })
  | (ProfileSignal & { profileType: "community"; imageUrl?: string; logoImageUrl?: string; bannerImageUrl?: string });
/** Genres remain on their source profiles; they are not event assignments. */
export type DiscoveryEventSignal = {
  eventId: string;
  performers: DiscoveryProfileSignal[];
  manualLabels: string[];
  coverage: "complete" | "partial";
};
export type DiscoveryPage<T> = { items: T[]; cursor: string | null; complete: boolean };
export type DiscoveryEventRequest = {
  now: number;
  timeZone: string;
  band: 0 | 1 | 2 | 3;
  kind: "timed" | "date_only";
  direction: "asc" | "desc";
  cursor?: string;
};

export type FavoriteLineupArgs = { eventIds: string[]; favoriteProfileIds: string[] };
export type FavoriteLineupResult = {
  items: Array<{ eventId: string; performers: Array<Pick<DiscoveryProfileSignal, "id" | "slug" | "displayName">> }>;
};
