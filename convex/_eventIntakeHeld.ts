import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { messageRow, messageUrl } from "./_discordIntake";
import { evidenceKey, explicitUpdateKeys } from "./_eventCandidateApply";
import { canonicalIntakeValue, type ConnectorKind } from "./_eventConnectors";
import { intakeSchedule, type InventorySchedule } from "./_eventInventory";
import { eventPathForSlugs } from "./_eventPaths";
import { getEventBySlug } from "./_eventSlugs";
import { correctionFields } from "./eventCorrections";
import { EventIntakePatchSchema, selectEventLocalTime, type EventIntakeFields, type EventIntakePatch } from "../packages/api-contracts/src/event-intake";

const HELD_CHANGE_FIELDS = ["title", "eventDate", "timeTba", "timezone", "start", "end", "doors", "venueLabel", "worldSlug", "summary", "sourceUrl", "lineup"] as const;
export type HeldChangeField = (typeof HELD_CHANGE_FIELDS)[number];
/** start, end, doors carry instants (ms); lineup carries performer labels joined with ", "; timeTba carries "Time TBA" or null. */
export type HeldChange = { field: HeldChangeField; before: string | number | null; after: string | number | null };
type HeldUpdatePatch = Partial<Pick<EventIntakeFields, HeldChangeField>>;
type HeldOrigin = { community: { slug: string; displayName: string }; connectorKind: Doc<"eventConnectors">["kind"]; targetName: string | null; updatedAt: number };
type HeldDraftRow = { draftId: Id<"eventIntakeDrafts">; title: string | null; schedule: InventorySchedule; author: string | null; sourceUrl: string | null; openHref: string };
export type HeldImportRow = HeldOrigin & (
  | (HeldDraftRow & { kind: "new" })
  | (HeldDraftRow & { kind: "update"; target: { slug: string; title: string; href: string }; changes: HeldChange[] })
  | { kind: "flag"; eventId: Id<"events">; reason: "source_deleted" | "external_deleted"; title: string; href: string }
);
export const HELD_IMPORT_LIMIT = 50;

// What was extracted for one date does not carry over once a staffer re-dates the draft.
const DATE_BOUND_KEYS = new Set(["start", "end", "doors", "timeTba", "lineup"]);
const redated = (fields: EventIntakePatch) => Boolean(fields.eventDate) && fields.eventDate !== fields.tentative?.eventDate;

/** A held draft as it would publish: staff values over extracted ones, in the connector's community. */
export function promoteHeldFields(fields: EventIntakePatch, communitySlug: string): EventIntakePatch {
  const stale = redated(fields);
  const set = (values: object) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined));
  const { tentative, evidence: _evidence, questions: _questions, ...saved } = fields;
  const extracted = set(tentative ?? {});
  const promoted: EventIntakePatch = {
    ...(stale ? Object.fromEntries(Object.entries(extracted).filter(([key]) => !DATE_BOUND_KEYS.has(key))) : extracted),
    ...set(saved), communitySlug, tentative: null, evidence: null, questions: null,
  };
  // Tentative blocks never carry timeTba; applyEventCandidate derives it the same way.
  if (tentative && !stale) promoted.timeTba ??= !promoted.start;
  return promoted;
}

/** Rule 8 over a held draft: extracted values on explicit evidence, plus whatever a staffer saved. */
export function heldUpdatePatch(fields: EventIntakePatch, kind: ConnectorKind): HeldUpdatePatch {
  const promoted = promoteHeldFields(fields, "");
  const stale = redated(fields);
  const evidence = (fields.evidence ?? []).filter(entry => !stale || !DATE_BOUND_KEYS.has(evidenceKey(entry.fieldPath)));
  return Object.fromEntries(explicitUpdateKeys(evidence, kind, fields).map(key => [key, promoted[key] ?? null]));
}

function heldValue(field: HeldChangeField, fields: HeldUpdatePatch, eventDate: EventIntakePatch["eventDate"], timezone: EventIntakePatch["timezone"]): HeldChange["after"] {
  if (field === "timeTba") return fields.timeTba ? "Time TBA" : null;
  if (field === "lineup") return fields.lineup?.map(row => row.performerLabel).filter(Boolean).join(", ") || null;
  const value = fields[field];
  if (!value || typeof value === "string") return value || null;
  try { return selectEventLocalTime(eventDate!, value, timezone!); } catch { return null; }
}

export function heldChanges(current: EventIntakePatch, patch: HeldUpdatePatch): HeldChange[] {
  const compared = (field: HeldChangeField, fields: HeldUpdatePatch) => JSON.stringify(canonicalIntakeValue(field === "timeTba" ? fields.timeTba ?? false : fields[field]));
  return HELD_CHANGE_FIELDS.filter(field => field in patch && compared(field, patch) !== compared(field, current)).map(field => ({
    field, before: heldValue(field, current, current.eventDate, current.timezone),
    after: heldValue(field, patch, patch.eventDate ?? current.eventDate, patch.timezone ?? current.timezone),
  }));
}

/** The event a held draft proposes to update, from its link or else the newest run's decision. */
export async function heldTarget(db: DatabaseReader, draft: Doc<"eventIntakeDrafts">): Promise<{ event: Doc<"events">; links: Doc<"eventSyncLinks">[] } | null> {
  const connector = draft.connectorId ? await db.get(draft.connectorId) : null;
  if (!connector) return null;
  const links = await db.query("eventSyncLinks").withIndex("by_draftId", q => q.eq("draftId", draft._id)).collect();
  const linkedEventId = links.find(link => link.eventId)?.eventId;
  let event = linkedEventId ? await db.get(linkedEventId) : null;
  if (!linkedEventId) {
    const source = await db.query("discordIntakeSources").withIndex("by_draftId", q => q.eq("draftId", draft._id)).order("desc").first();
    const run = source ? await db.get(source.runId) : null;
    if (run?.decision?.kind === "update") event = await getEventBySlug(db, run.decision.slug);
  }
  return event?.slug && event.moderationRemovedAt === undefined && event.communityProfileId === connector.communityProfileId ? { event, links } : null;
}

const targetName = ({ target }: Doc<"eventConnectors">) => target.channelName ? `#${target.channelName}`
  : target.calendarName ?? target.groupName ?? target.guildName ?? target.channelId ?? target.calendarId ?? target.groupId ?? null;

export async function heldImportRows(db: DatabaseReader, community: Doc<"profiles">, now: number): Promise<HeldImportRow[]> {
  const rows: HeldImportRow[] = [];
  const flagged = new Set<string>();
  const editHref = (slug: string) => `${eventPathForSlugs(community.slug, slug)}/edit`;
  // Removed connectors stay in: their drafts outlive them.
  for (const connector of await db.query("eventConnectors").withIndex("by_communityProfileId", q => q.eq("communityProfileId", community._id)).take(HELD_IMPORT_LIMIT)) {
    const origin = { community: { slug: community.slug, displayName: community.displayName }, connectorKind: connector.kind, targetName: targetName(connector) };
    const drafts = await db.query("eventIntakeDrafts")
      .withIndex("by_connectorId_resolvedAt_expiresAt", q => q.eq("connectorId", connector._id).eq("resolvedAt", undefined).gt("expiresAt", now)).order("desc").take(HELD_IMPORT_LIMIT);
    for (const draft of drafts) {
      if (draft.publishedReceiptId) continue;
      const source = await db.query("discordIntakeSources").withIndex("by_draftId", q => q.eq("draftId", draft._id)).first();
      // A run's working draft has neither until the run finishes.
      if (!source && !await db.query("eventSyncLinks").withIndex("by_draftId", q => q.eq("draftId", draft._id)).first()) continue;
      const message = source ? await messageRow(db, connector._id, source.messageId) : null;
      const fields = EventIntakePatchSchema.parse(draft.fields);
      const promoted = promoteHeldFields(fields, community.slug);
      const row = { ...origin, updatedAt: draft.updatedAt, draftId: draft._id, title: promoted.title ?? null, schedule: intakeSchedule(promoted),
        author: message?.authorDisplayName ?? null, sourceUrl: message ? messageUrl(message) : null, openHref: `/events/new?draft=${draft._id}` };
      const target = await heldTarget(db, draft);
      if (!target) { rows.push({ ...row, kind: "new" }); continue; }
      const { event } = target;
      rows.push({ ...row, kind: "update", target: { slug: event.slug!, title: event.title, href: editHref(event.slug!) },
        changes: heldChanges(await correctionFields(db, event), heldUpdatePatch(fields, connector.kind)) });
    }
    const reason = connector.kind === "discord_announcements" ? "source_deleted" : "external_deleted";
    const links = await db.query("eventSyncLinks")
      .withIndex("by_connectorId_state_flagReviewedAt", q => q.eq("connectorId", connector._id).eq("state", "external_deleted").eq("flagReviewedAt", undefined)).take(HELD_IMPORT_LIMIT);
    for (const link of links) {
      const event = link.eventId ? await db.get(link.eventId) : null;
      if (!event?.slug || event.moderationRemovedAt !== undefined || flagged.has(`${event._id}:${reason}`)) continue;
      flagged.add(`${event._id}:${reason}`);
      rows.push({ ...origin, updatedAt: link.updatedAt, kind: "flag", eventId: event._id, reason, title: event.title, href: editHref(event.slug) });
    }
  }
  return rows;
}
