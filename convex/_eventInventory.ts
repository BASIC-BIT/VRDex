import { ConvexError } from "convex/values";
import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { EventIntakePatchSchema, selectEventLocalTime, type EventIntakePatch } from "../packages/api-contracts/src/event-intake";
import { TemporalParseRequestSchema } from "../packages/api-contracts/src/temporal";
import { eventDateForInstant, normalizeEventSchedule, readEventSchedule } from "./_eventSchedule";
import { timedEventRuntimeEndAt } from "./_eventRuntime";
import { normalizeSearchQuery } from "./_searchDocuments";
import { safeHttpsUrl } from "./_publicFields";
import { canReadProfile } from "./_profilePermissions";
import { eventPathForSlugs } from "./_eventPaths";

export type InventoryView = "all" | "upcoming" | "drafts" | "past";
export type InventorySchedule =
  | { kind: "timed"; startAt: number; endAt: number | null; eventDate: string; timezone: string | null }
  | { kind: "date_only"; eventDate: string }
  | { kind: "incomplete"; eventDate: string | null };
export type InventoryContinuation =
  | { kind: "staff_editor"; href: string }
  | { kind: "intake_editor"; href: string }
  | { kind: "public_event"; href: string; canCorrect: boolean; canSuggest: boolean }
  | { kind: "unavailable" };
type EventIdentity = { id: Id<"events">; eventId: Id<"events">; state: "draft" | "published" | "cancelled" | "retracted" };
type InventorySummary = {
  title: string | null;
  community: { slug: string; displayName: string } | null;
  schedule: InventorySchedule;
  thumbnailUrl: string | null;
};
export type InventoryRow = InventorySummary & (
  | (EventIdentity & { kind: "managed_event"; continuation: Extract<InventoryContinuation, { kind: "staff_editor" | "unavailable" }> })
  | (EventIdentity & { kind: "own_contribution"; continuation: Extract<InventoryContinuation, { kind: "public_event" | "unavailable" }> })
  | { kind: "intake_draft"; id: Id<"eventIntakeDrafts">; draftId: Id<"eventIntakeDrafts">;
      state: "draft"; expiresAt: number; version: number;
      continuation: Extract<InventoryContinuation, { kind: "intake_editor" }> }
);
export type InventoryCriteria = { view: InventoryView; query: string; timeZone: string; asOf: number };

export function inventoryCriteria(args: InventoryCriteria): InventoryCriteria {
  if (args.query.length > 120) throw new Error("Invalid search query.");
  const timeZone = TemporalParseRequestSchema.shape.timeZone.unwrap().parse(args.timeZone);
  // The existing schedule validator rejects non-integral and out-of-range instants.
  if (!Number.isSafeInteger(args.asOf) || args.asOf < 0 || !Number.isFinite(new Date(args.asOf).getTime())) {
    throw new Error("Event start time must be a valid timestamp.");
  }
  normalizeEventSchedule({ kind: "timed", startAt: args.asOf, date: eventDateForInstant(args.asOf) });
  return { view: args.view, query: normalizeSearchQuery(args.query).toLowerCase(), timeZone, asOf: args.asOf };
}

export type InventorySource =
  | { kind: "intake"; key: "intake" }
  | { kind: "community"; key: string; profile: Doc<"profiles"> }
  | { kind: "contributions"; key: "contributions" };
type Position = { source: string; kind: "within" | "after"; nativeCursor: string };
function invalidCursor(): never {
  throw new ConvexError({ paginationError: "InvalidCursor" });
}
function readPosition(cursor: string | null | undefined, scope: string): Position | null {
  if (cursor === null || cursor === undefined) return null;
  try {
    const value: unknown = JSON.parse(cursor);
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 ||
      !("scope" in value) || value.scope !== scope || !("source" in value) || typeof value.source !== "string" ||
      !("kind" in value) || (value.kind !== "within" && value.kind !== "after") ||
      !("nativeCursor" in value) || typeof value.nativeCursor !== "string") return invalidCursor();
    return { source: value.source, kind: value.kind, nativeCursor: value.nativeCursor };
  } catch { return invalidCursor(); }
}
function writePosition(position: Position, scope: string): string {
  return JSON.stringify({ version: 1, scope, ...position });
}

/** Resolve starts and ends separately: an after-source end still bounds that source. */
export function inventoryPagination(options: PaginationOptions, scope: string, sources: InventorySource[]) {
  if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 100) throw new Error("Invalid contribution page.");
  for (const bound of [options.maximumRowsRead, options.maximumBytesRead]) {
    if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 1)) throw new Error("Invalid contribution page.");
  }
  const start = readPosition(options.cursor, scope);
  const end = readPosition(options.endCursor, scope);
  let index = start === null ? 0 : sources.findIndex(source => source.key === start.source);
  if (index < 0) return invalidCursor();
  const advance = start?.kind === "after" && index < sources.length - 1;
  if (advance) index++;
  const source = sources[index];
  if (!source || (end !== null && end.source !== source.key)) return invalidCursor();
  const native: PaginationOptions = {
    ...options,
    cursor: start === null || advance ? null : start.nativeCursor,
    maximumRowsRead: Math.min(options.maximumRowsRead ?? 100, 100),
    maximumBytesRead: Math.min(options.maximumBytesRead ?? 1_000_000, 1_000_000),
    ...(options.endCursor === undefined ? {} : { endCursor: end?.nativeCursor ?? null }),
  };
  return { source, native, wrap<T>(page: PaginationResult<T>): PaginationResult<T> {
    return { ...page, isDone: page.isDone && index === sources.length - 1,
      continueCursor: writePosition({ source: source.key, kind: page.isDone ? "after" : "within", nativeCursor: page.continueCursor }, scope),
      ...(page.splitCursor === undefined ? {} : { splitCursor: page.splitCursor === null ? null : writePosition({ source: source.key, kind: "within", nativeCursor: page.splitCursor }, scope) }),
    };
  } };
}

function calendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return normalizeEventSchedule({ kind: "date_only", date: value }).eventDate; } catch { return null; }
}
function canonicalSchedule(event: Doc<"events">): InventorySchedule {
  try {
    const schedule = readEventSchedule(event);
    if (schedule.scheduleKind === "date_only") return { kind: "date_only", eventDate: schedule.eventDate };
    if (schedule.startAt !== undefined) return { kind: "timed", startAt: schedule.startAt, endAt: event.endAt ?? null, eventDate: schedule.eventDate, timezone: event.timezone ?? null };
  } catch { /* Incomplete legacy records remain visible in All/Drafts. */ }
  return { kind: "incomplete", eventDate: calendarDate(event.eventDate) };
}
function intakeSchedule(fields: EventIntakePatch): InventorySchedule {
  const eventDate = calendarDate(fields.eventDate);
  const incomplete: InventorySchedule = { kind: "incomplete", eventDate };
  if (!eventDate) return incomplete;
  if (fields.timeTba) return fields.start || fields.end || fields.doors ? incomplete : { kind: "date_only", eventDate };
  if (!fields.start || !fields.timezone || (fields.start.dayOffset ?? 0) !== 0) return incomplete;
  try {
    const startAt = selectEventLocalTime(eventDate, fields.start, fields.timezone);
    const endAt = fields.end ? selectEventLocalTime(eventDate, fields.end, fields.timezone) : null;
    const doorsAt = fields.doors ? selectEventLocalTime(eventDate, fields.doors, fields.timezone) : null;
    if ((endAt !== null && endAt <= startAt) || (doorsAt !== null && doorsAt > startAt)) return incomplete;
    return { kind: "timed", startAt, endAt, eventDate, timezone: fields.timezone };
  } catch { return incomplete; }
}
export function matchesInventory(row: InventoryRow, criteria: InventoryCriteria): boolean {
  const matchesText = [row.title, row.community?.displayName].some(text => text?.toLowerCase().includes(criteria.query));
  if (criteria.query && !matchesText) return false;
  if (criteria.view === "all") return true;
  if (criteria.view === "drafts") return row.state === "draft";
  if (row.state === "cancelled" || row.state === "retracted" || row.schedule.kind === "incomplete") return false;
  const past = row.schedule.kind === "date_only"
    ? row.schedule.eventDate < eventDateForInstant(criteria.asOf, criteria.timeZone)
    : timedEventRuntimeEndAt(row.schedule) < criteria.asOf;
  return criteria.view === "past" ? past : !past;
}
export function intakeInventoryRow(draft: Doc<"eventIntakeDrafts">, community: Doc<"profiles"> | null): InventoryRow {
  const fields = EventIntakePatchSchema.parse(draft.fields);
  return { kind: "intake_draft", id: draft._id, draftId: draft._id, title: fields.title || null,
    community: community ? { slug: community.slug, displayName: community.displayName } : null,
    schedule: intakeSchedule(fields), state: "draft", thumbnailUrl: null,
    expiresAt: draft.expiresAt, version: draft.version,
    continuation: { kind: "intake_editor", href: `/events/new?draft=${draft._id}` } };
}

async function inventoryThumbnail(db: DatabaseReader, event: Doc<"events">, publicRoute: boolean): Promise<string | null> {
  for (const value of [event.thumbnailImageUrl, event.posterImageUrl, event.bannerImageUrl]) {
    const external = safeHttpsUrl(value);
    if (external) return external;
    // Relative artwork is public only through the existing published artwork policy.
    const match = value?.match(/^\/api\/v0\/events\/([^/]+)\/artwork\/([^/]+)$/);
    if (!publicRoute || !match || match[1] !== event._id || value !== event.posterImageUrl) continue;
    const id = db.normalizeId("eventPosterArtwork", match[2]);
    const artwork = id ? await db.get(id) : null;
    if (artwork?.state === "published" && artwork.eventId === event._id) return value ?? null;
  }
  return null;
}
export async function canonicalInventoryRow(args: {
  db: DatabaseReader; event: Doc<"events">; community: Doc<"profiles"> | null; managed: boolean;
}): Promise<InventoryRow> {
  const { db, event, community, managed } = args;
  const publicRoute = Boolean(event.slug && community?.profileType === "community" && canReadProfile("public", community) && event.publicationState === "published" && event.moderationRemovedAt === undefined);
  const visibleCommunity = community && (managed || canReadProfile("public", community)) ? community : null;
  const summary: InventorySummary & EventIdentity = { id: event._id, eventId: event._id, title: event.title,
    community: visibleCommunity ? { slug: visibleCommunity.slug, displayName: visibleCommunity.displayName } : null,
    schedule: canonicalSchedule(event),
    state: event.sourceType === "contributor" && event.publicationState !== "published" ? "retracted" : event.eventStatus === "cancelled" ? "cancelled" : event.publicationState === "published" ? "published" : "draft",
    thumbnailUrl: managed || publicRoute ? await inventoryThumbnail(db, event, publicRoute) : null };
  if (managed) return { ...summary, kind: "managed_event", continuation: event.slug && community
    ? { kind: "staff_editor", href: `${eventPathForSlugs(community.slug, event.slug)}/edit` }
    : { kind: "unavailable" } };
  const canCorrect = event.contributorEditsClosedAt === undefined && event.eventStatus === "scheduled";
  return { ...summary, kind: "own_contribution", continuation: publicRoute && event.slug && community
    ? { kind: "public_event", href: eventPathForSlugs(community.slug, event.slug), canCorrect, canSuggest: !canCorrect }
    : { kind: "unavailable" } };
}
