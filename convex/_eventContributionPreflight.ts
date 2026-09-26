import { ConvexError } from "convex/values";
import type { DatabaseReader } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { EventIntakePatchSchema, selectEventLocalTime, type EventIntakePatch } from "../packages/api-contracts/src/event-intake";
import { eventDateForInstant, normalizeEventSchedule } from "./_eventSchedule";
import { canReadProfile } from "./_profilePermissions";
import { eventPathForSlugs } from "./_eventPaths";
import type { EventLineupInput } from "./_eventLineup";

export const INTAKE_ACCOUNT_DAILY_LIMIT = 10;
export const INTAKE_TARGET_DAILY_LIMIT = 100;
const normalizedTitle = (title: string) => title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function similarTitle(a: string, b: string) {
  const first = new Set(normalizedTitle(a).split(" ").filter(Boolean));
  const second = new Set(normalizedTitle(b).split(" ").filter(Boolean));
  const common = [...first].filter(word => second.has(word)).length;
  return common > 0 && common / Math.min(first.size, second.size) >= 0.5;
}
export function eventContributionFingerprint(communityId: string, date: string, title: string) {
  return JSON.stringify([communityId, date, normalizedTitle(title)]);
}
export function normalizeIntakePublication(raw: EventIntakePatch) {
  const fields = EventIntakePatchSchema.parse(raw);
  if (!fields.communitySlug || !fields.title || fields.title.length < 2) throw new Error("A public community and identifying title are required.");
  if (!fields.eventDate) throw new Error("Event date is required.");
  const at = (local: NonNullable<EventIntakePatch["start"]>) => {
    if (!fields.timezone) throw new Error("Timed publication requires a timezone.");
    return selectEventLocalTime(fields.eventDate!, local, fields.timezone);
  };
  if (fields.timeTba && (fields.start || fields.end || fields.doors)) throw new Error("Time TBA cannot include event times.");
  if (!fields.start && fields.timeTba !== true) throw new Error("Choose a start time or time TBA.");
  if ((fields.start?.dayOffset ?? 0) !== 0) throw new Error("Event start must use the event date.");
  const schedule = fields.timeTba
    ? normalizeEventSchedule({ kind: "date_only", date: fields.eventDate })
    : normalizeEventSchedule({ kind: "timed", date: fields.eventDate, startAt: at(fields.start!), timeZone: fields.timezone! });
  const endAt = fields.end ? at(fields.end) : undefined;
  const doorsOpenAt = fields.doors ? at(fields.doors) : undefined;
  if (endAt !== undefined && endAt <= schedule.startAt!) throw new Error("End time must follow start; choose the next day explicitly when crossing midnight.");
  if (doorsOpenAt !== undefined && doorsOpenAt > schedule.startAt!) throw new Error("Doors must open before the start.");
  const lineup: EventLineupInput = (fields.lineup ?? []).map(entry => {
    if (!entry.performerLabel) throw new Error("Every published lineup entry needs a performer name.");
    return { clientKey: entry.clientKey, position: entry.position, performerLabel: entry.performerLabel,
      ...(entry.personSlug ? { personSlug: entry.personSlug } : {}), ...(entry.roleLabel ? { roleLabel: entry.roleLabel } : {}),
      ...(entry.start ? { startAt: at(entry.start) } : {}), ...(entry.end ? { endAt: at(entry.end) } : {}) };
  });
  return { fields, schedule, endAt, doorsOpenAt, lineup };
}

/** All reads here run again inside the canonical publication transaction. */
export async function preflightEventContribution(db: DatabaseReader, actorUserId: Id<"users">, raw: EventIntakePatch, now: number) {
  if (await db.get(actorUserId) === null) throw new Error("A signed-in user is required.");
  const normalized = normalizeIntakePublication(raw);
  const { fields } = normalized;
  const community = await db.query("profiles").withIndex("by_slug", q => q.eq("slug", fields.communitySlug!)).unique();
  if (!community || community.profileType !== "community" || !canReadProfile("public", community)) throw new Error("A published public community is required.");
  const world = fields.worldSlug ? await db.query("worlds").withIndex("by_slug", q => q.eq("slug", fields.worldSlug!)).unique() : undefined;
  if (fields.worldSlug && (!world || world.publicationState !== "published")) throw new Error("World match must be published.");
  const fingerprint = eventContributionFingerprint(community._id, fields.eventDate!, fields.title!);
  const exact = await db.query("events").withIndex("by_contributionFingerprint", q => q.eq("contributionFingerprint", fingerprint)).first();
  if (exact && (exact.publicationState !== "published" || exact.eventStatus !== "scheduled")) throw new ConvexError({ code: "REPOST_BLOCKED" });
  if (exact) return { ...normalized, community, world: world ?? undefined, fingerprint, existing: exact };
  const dayStart = Date.parse(`${fields.eventDate}T00:00:00Z`);
  const [dated, legacyWindow] = await Promise.all([
    db.query("events").withIndex("by_communityProfileId_eventDate", q => q.eq("communityProfileId", community._id).eq("eventDate", fields.eventDate!)).take(101),
    // Old timed records have no eventDate until the schedule backfill runs.
    db.query("events").withIndex("by_communityProfileId_startAt", q => q.eq("communityProfileId", community._id).gte("startAt", dayStart - 14 * 3_600_000).lt("startAt", dayStart + 38 * 3_600_000)).take(101),
  ]);
  if (legacyWindow.length > 100) throw new ConvexError({ code: "TARGET_QUOTA" });
  const sameDay = [...dated, ...legacyWindow.filter(event => !event.eventDate && event.startAt !== undefined && eventDateForInstant(event.startAt, event.timezone) === fields.eventDate)];
  if (sameDay.length > 100) throw new ConvexError({ code: "TARGET_QUOTA" });
  // Include owner/import events, which predate contribution fingerprints.
  const legacyExact = sameDay.find(event => eventContributionFingerprint(community._id, fields.eventDate!, event.title) === fingerprint);
  if (legacyExact) {
    if (legacyExact.publicationState !== "published" || legacyExact.eventStatus !== "scheduled") throw new ConvexError({ code: "REPOST_BLOCKED" });
    return { ...normalized, community, world: world ?? undefined, fingerprint, existing: legacyExact };
  }
  const near = sameDay.filter(event => event.publicationState === "published" && event.eventStatus === "scheduled" && event.slug &&
    (similarTitle(event.title, fields.title!) || Boolean(fields.sourceUrl && event.sourceUrl === fields.sourceUrl)) &&
    !fields.duplicateAcknowledgements?.includes(event._id));
  if (near.length) throw new ConvexError({ code: "NEAR_DUPLICATE", choices: near.slice(0, 20).map(event => ({ eventId: event._id, title: event.title, eventPath: eventPathForSlugs(community.slug, event.slug!) })) });
  const since = now - 86_400_000;
  const actorRecent = await db.query("eventContributionReceipts").withIndex("by_actor_createdAt", q => q.eq("actorUserId", actorUserId).gte("createdAt", since)).take(INTAKE_ACCOUNT_DAILY_LIMIT);
  if (actorRecent.length >= INTAKE_ACCOUNT_DAILY_LIMIT) throw new ConvexError({ code: "ACCOUNT_QUOTA" });
  const targetRecent = await db.query("eventContributionReceipts").withIndex("by_community_createdAt", q => q.eq("communityProfileId", community._id).gte("createdAt", since)).take(INTAKE_TARGET_DAILY_LIMIT);
  if (targetRecent.length >= INTAKE_TARGET_DAILY_LIMIT) throw new ConvexError({ code: "TARGET_QUOTA" });
  return { ...normalized, community, world: world ?? undefined, fingerprint, existing: undefined };
}
