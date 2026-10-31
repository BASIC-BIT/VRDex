import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import { messageRow, messageUrl } from "./_discordIntake";
import { evidenceKey, explicitUpdateKeys } from "./_eventCandidateApply";
import { canonicalIntakeValue, type ConnectorKind } from "./_eventConnectors";
import { DISCORD_MESSAGE_URL, EVENT_INTAKE_DRAFT_TTL_MS } from "./_eventIntake";
import { intakeSchedule, type InventorySchedule } from "./_eventInventory";
import { eventPathForSlugs } from "./_eventPaths";
import { getEventBySlug } from "./_eventSlugs";
import { enqueueEventSync } from "./_eventSync";
import { correctionFields } from "./eventCorrections";
import { EventIntakePatchSchema, heldImportRedated, heldImportTimeTba, selectEventLocalTime, type EventIntakeFields, type EventIntakePatch } from "../packages/api-contracts/src/event-intake";

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
const CLOCK_KEYS = new Set(["start", "end", "doors"]);
const DATE_BOUND_KEYS = new Set([...CLOCK_KEYS, "timeTba", "lineup"]);

/** A held draft as it would publish: staff values over extracted ones, in the connector's community. */
export function promoteHeldFields(fields: EventIntakePatch, communitySlug: string): EventIntakePatch {
  const stale = heldImportRedated(fields);
  const set = (values: object) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined));
  const { tentative, evidence: _evidence, questions: _questions, ...saved } = fields;
  // Publication refuses clocks alongside Time TBA, whether a staffer saved it or no start means it.
  const declined = stale ? DATE_BOUND_KEYS : heldImportTimeTba(fields) ? CLOCK_KEYS : new Set<string>();
  const promoted: EventIntakePatch = {
    ...Object.fromEntries(Object.entries(set(tentative ?? {})).filter(([key]) => !declined.has(key))),
    ...set(saved), communitySlug, tentative: null, evidence: null, questions: null,
  };
  // No start means Time TBA, as in applyEventCandidate, whatever an earlier save left behind.
  promoted.timeTba = promoted.start ? promoted.timeTba ?? false : true;
  // On a Discord draft the top-level URL is the post itself, which publication strips, so an extracted link wins.
  if (tentative?.sourceUrl && saved.sourceUrl && DISCORD_MESSAGE_URL.test(saved.sourceUrl)) promoted.sourceUrl = tentative.sourceUrl;
  return promoted;
}

/** Rule 8 over a held draft: extracted values on explicit evidence, plus whatever a staffer saved. */
export function heldUpdatePatch(held: EventIntakePatch, kind: ConnectorKind): HeldUpdatePatch {
  // A false left behind with no start says nothing about the event's clock.
  const fields = held.timeTba === false && !held.start ? { ...held, timeTba: undefined } : held;
  const promoted = promoteHeldFields(fields, "");
  const stale = heldImportRedated(fields);
  const evidence = (fields.evidence ?? []).filter(entry => !stale || !DATE_BOUND_KEYS.has(evidenceKey(entry.fieldPath)));
  const keys = explicitUpdateKeys(evidence, kind, fields);
  // Promotion's Time TBA is the new-event reading: an end with no start still fits the event's own start.
  const extracted = keys.includes("start") || fields.timeTba === true ? {} : fields.tentative ?? {};
  return Object.fromEntries(keys.map(key => [key, promoted[key] ?? extracted[key] ?? null]));
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

/** Takes a draft off review. Its link stops blocking imports and exports, and the draft sweep removes the row after the usual TTL. */
export async function dismissHeldDraft(ctx: Pick<MutationCtx, "db" | "scheduler">, draft: Doc<"eventIntakeDrafts">, now: number) {
  const { db } = ctx;
  await db.patch(draft._id, { dismissedAt: now, resolvedAt: now, expiresAt: now + EVENT_INTAKE_DRAFT_TTL_MS });
  const links = await db.query("eventSyncLinks").withIndex("by_draftId", q => q.eq("draftId", draft._id)).collect();
  for (const link of links) await db.patch(link._id, { draftId: undefined, updatedAt: now });
  // While the draft was pending its exports closed as skipped; nothing else requeues them.
  for (const eventId of new Set(links.flatMap(link => link.eventId ? [link.eventId] : []))) await enqueueEventSync(db, ctx.scheduler, eventId, "upsert");
}

const targetName = ({ target }: Doc<"eventConnectors">) => target.channelName ? `#${target.channelName}`
  : target.calendarName ?? target.groupName ?? target.guildName ?? target.channelId ?? target.calendarId ?? target.groupId ?? target.guildId ?? null;

/** A connector's drafts awaiting review, newest first. A run's working draft has neither a source row nor a link until the run finishes. */
export async function pendingHeldDrafts(db: DatabaseReader, connectorId: Id<"eventConnectors">, now: number) {
  const drafts = await db.query("eventIntakeDrafts")
    .withIndex("by_connectorId_resolvedAt_expiresAt", q => q.eq("connectorId", connectorId).eq("resolvedAt", undefined).gt("expiresAt", now)).order("desc").take(HELD_IMPORT_LIMIT);
  const pending = [];
  for (const draft of drafts) {
    if (draft.publishedReceiptId) continue;
    const source = await db.query("discordIntakeSources").withIndex("by_draftId", q => q.eq("draftId", draft._id)).first();
    if (source || await db.query("eventSyncLinks").withIndex("by_draftId", q => q.eq("draftId", draft._id)).first()) pending.push({ draft, source });
  }
  return pending;
}

export async function heldImportRows(db: DatabaseReader, community: Doc<"profiles">, now: number): Promise<HeldImportRow[]> {
  const rows: HeldImportRow[] = [];
  const flagged = new Set<string>();
  const editHref = (slug: string) => `${eventPathForSlugs(community.slug, slug)}/edit`;
  // Removed connectors stay in: their drafts outlive them.
  for (const connector of await db.query("eventConnectors").withIndex("by_communityProfileId", q => q.eq("communityProfileId", community._id)).take(HELD_IMPORT_LIMIT)) {
    const origin = { community: { slug: community.slug, displayName: community.displayName }, connectorKind: connector.kind, targetName: targetName(connector) };
    for (const { draft, source } of await pendingHeldDrafts(db, connector._id, now)) {
      // One bad row must not cost every manager the list, which is the only place to act on the others.
      const parsed = EventIntakePatchSchema.safeParse(draft.fields);
      if (!parsed.success) {
        console.warn("held import row skipped", { draftId: draft._id });
        continue;
      }
      const fields = parsed.data;
      const message = source ? await messageRow(db, connector._id, source.messageId) : null;
      const promoted = promoteHeldFields(fields, community.slug);
      const row = { ...origin, updatedAt: draft.updatedAt, draftId: draft._id, title: promoted.title ?? null, schedule: intakeSchedule(promoted),
        author: message?.authorDisplayName ?? null, sourceUrl: message ? messageUrl(message) : null, openHref: `/events/new?draft=${draft._id}` };
      const target = await heldTarget(db, draft);
      if (!target) { rows.push({ ...row, kind: "new" }); continue; }
      const { event } = target;
      // A target too big to read (correctionFields caps its lineup) still lists, so staff can Open or Dismiss it.
      let diff: { schedule: InventorySchedule; changes: HeldChange[] } = { schedule: row.schedule, changes: [] };
      try {
        const [current, patch] = [await correctionFields(db, event), heldUpdatePatch(fields, connector.kind)];
        const applied = { ...current, ...patch };
        diff = { schedule: intakeSchedule(applied.timeTba ? { ...applied, start: undefined, end: undefined, doors: undefined } : applied), changes: heldChanges(current, patch) };
      } catch {
        // The row keeps the draft's own schedule and shows no diff.
        console.warn("held import diff skipped", { draftId: draft._id });
      }
      rows.push({ ...row, ...diff, kind: "update", target: { slug: event.slug!, title: event.title, href: editHref(event.slug!) } });
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
