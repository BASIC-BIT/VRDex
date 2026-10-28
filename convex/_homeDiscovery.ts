import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { eventPathForSlugs } from "./_eventPaths";
import { getPublishedCommunity, isPublicEventPerformer } from "./_eventPublic";
import { eventDateForInstant } from "./_eventSchedule";
import { timelineSchedule } from "./_eventTimeline";
import type { DiscoveryEventCandidate, DiscoveryEventRequest, DiscoveryProfileSignal } from "./_homeDiscoveryTypes";
import { getPublicProfileCompactImages } from "./_profileAssets";
import { canReadProfile } from "./_profilePermissions";
import { publicProfileGenres } from "./_profilePublic";
import { optionalField, safePublicImageUrl } from "./_publicFields";

export const DISCOVERY_PAGE_SIZE = 12;
export const DISCOVERY_ROSTER_SIZE = 8;
const day = 86_400_000;
export function discoveryCursor(raw: string | undefined, scope: string): string | null {
  if (raw === undefined) return null;
  try {
    if (raw.length > 16_384) throw new Error();
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 ||
      !("scope" in value) || value.scope !== scope || !("databaseCursor" in value) ||
      typeof value.databaseCursor !== "string" || value.databaseCursor.length === 0) throw new Error();
    return value.databaseCursor;
  } catch { throw new Error("Invalid discovery cursor"); }
}
export function discoveryContinuation(scope: string, page: { isDone: boolean; continueCursor: string }) {
  return page.isDone ? null : JSON.stringify({ version: 1, scope, databaseCursor: page.continueCursor });
}
function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * day).toISOString().slice(0, 10);
}
/** Find the first real instant of a local date, including skipped midnights. */
function dateStart(date: string, timeZone: string) {
  const nominal = Date.parse(`${date}T00:00:00Z`);
  let lo = nominal - 2 * day;
  let hi = nominal + 2 * day;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  while (lo < hi) {
    const middle = Math.floor((lo + hi) / 2);
    const parts = formatter.formatToParts(middle);
    const local = `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
    if (local < date) lo = middle + 1; else hi = middle;
  }
  return lo;
}
export function discoveryBounds(args: DiscoveryEventRequest) {
  if (!Number.isSafeInteger(args.now) || args.now < 0 || !Number.isFinite(new Date(args.now + 92 * day).getTime())) throw new Error("Invalid discovery time");
  if (/^[+-]/.test(args.timeZone)) throw new Error("Invalid discovery timezone");
  let today: string;
  try { today = eventDateForInstant(args.now, args.timeZone); } catch { throw new Error("Invalid discovery timezone"); }
  const offsets = [0, 7, 30, 90, null] as const;
  const from = addDays(today, offsets[args.band]);
  const next = offsets[args.band + 1];
  const until = next === null || next === undefined ? undefined : addDays(today, next);
  return { from, until, startAt: args.band === 0 ? args.now : dateStart(from, args.timeZone),
    endAt: until === undefined ? undefined : dateStart(until, args.timeZone) };
}
export function discoveryRequestScope(args: DiscoveryEventRequest) {
  return JSON.stringify(["events", args.now, args.timeZone, args.band, args.kind, args.direction]);
}
export function discoveryReads(db: DatabaseReader) {
  const profiles = new Map<Id<"profiles">, Promise<Doc<"profiles"> | null>>();
  return {
    async profile(id: Id<"profiles">) {
      let pending = profiles.get(id);
      if (pending === undefined) { pending = db.get(id); profiles.set(id, pending); }
      return pending;
    },
    async candidate(event: Doc<"events">): Promise<DiscoveryEventCandidate | null> {
      if (event.publicationState !== "published" || event.eventStatus !== "scheduled" || !event.slug) return null;
      const schedule = timelineSchedule(event);
      if (schedule === null) return null;
      const community = await getPublishedCommunity(db, event, profiles);
      if (community === undefined) return null;
      return { id: event._id, slug: event.slug, href: eventPathForSlugs(community.slug, event.slug), title: event.title,
        host: { id: community._id, slug: community.slug, displayName: community.displayName }, schedule,
        ...optionalField("posterImageUrl", safePublicImageUrl(event.posterImageUrl)) };
    },
    async performer(id: Id<"profiles"> | undefined) {
      if (id === undefined) return null;
      const profile = await this.profile(id);
      return isPublicEventPerformer(profile) ? discoveryProfile(db, profile) : null;
    },
  };
}
export async function discoveryProfile(db: DatabaseReader, profile: Doc<"profiles">): Promise<DiscoveryProfileSignal | null> {
  if (!canReadProfile("public", profile)) return null;
  const shared = { id: profile._id, slug: profile.slug, displayName: profile.displayName, genres: publicProfileGenres(profile, "discovery") };
  if (profile.profileType === "person") return { ...shared, profileType: "person" };
  return { ...shared, profileType: "community", ...await getPublicProfileCompactImages(db, profile) };
}
export function discoveryBatch(ids: string[], maximum: number): string[] {
  const unique = [...new Set(ids)];
  if (unique.length > maximum) throw new Error("Too many discovery signal IDs");
  return unique;
}
