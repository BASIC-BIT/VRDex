import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { sanitizeEventLineupInput, type EventLineupInput } from "./_eventInputs";
import { eventSortAt, eventSortEndAt } from "./_eventSchedule";
import { canReadProfile } from "./_profilePermissions";

export type { EventLineupInput } from "./_eventInputs";

/** Replaces the whole authored lineup. Call inside the authorized event mutation. */
export async function replaceEventLineup(
  db: DatabaseWriter, event: Doc<"events">, entries: EventLineupInput, now: number,
): Promise<void> {
  const normalized = sanitizeEventLineupInput(entries);
  const resolved = await Promise.all(normalized.map(async entry => {
    if (entry.startAt !== undefined) {
      if (event.scheduleKind === "date_only" || event.startAt === undefined) throw new Error("Timed sets require a timed event.");
      if (entry.startAt < event.startAt || (event.endAt !== undefined && (entry.endAt ?? entry.startAt) > event.endAt)) {
        throw new Error("Set times must be within the event schedule.");
      }
    }
    if (entry.personSlug === undefined) return { entry, profile: undefined };
    const profile = await db.query("profiles").withIndex("by_slug", q => q.eq("slug", entry.personSlug!)).unique();
    if (profile === null || profile.profileType !== "person" || !canReadProfile("public", profile)) {
      throw new Error("Lineup match must be a published public person.");
    }
    return { entry, profile };
  }));
  const [slots, untimed, participants] = await Promise.all([
    db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(),
    db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", event._id)).collect(),
    db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(),
  ]);
  const keptSlots = new Set<Id<"eventSlots">>();
  const matchedPeople = new Set<Id<"profiles">>();
  for (const { entry, profile } of resolved) {
    if (entry.startAt !== undefined) {
      const existing = slots.find(slot => !keptSlots.has(slot._id) && (
        slot.clientKey === entry.clientKey || (slot.clientKey === undefined && slot.startAt === entry.startAt
          && slot.personProfileId === profile?._id && (profile !== undefined || slot.displayLabel === entry.performerLabel))
      ));
      const fields = {
        eventId: event._id, clientKey: entry.clientKey, position: entry.position,
        eventStartAt: event.startAt, eventSortAt: eventSortAt(event),
        startAt: entry.startAt, endAt: entry.endAt, personProfileId: profile?._id,
        displayLabel: entry.performerLabel, roleLabel: entry.roleLabel ?? "",
        sourceType: event.sourceType, sourceLabel: event.sourceLabel,
        confidence: 1, reviewState: "confirmed" as const, updatedAt: now,
      };
      if (existing !== undefined) {
        keptSlots.add(existing._id);
        await db.patch(existing._id, { ...fields,
          selectedStreamId: existing.personProfileId === profile?._id ? existing.selectedStreamId : undefined,
        });
      } else await db.insert("eventSlots", { ...fields, createdAt: now });
    } else {
      await db.insert("eventLineupEntries", {
        eventId: event._id, clientKey: entry.clientKey, position: entry.position,
        performerLabel: entry.performerLabel, personProfileId: profile?._id,
        roleLabel: entry.roleLabel, updatedAt: now,
      });
    }
    if (profile !== undefined && !matchedPeople.has(profile._id)) {
      matchedPeople.add(profile._id);
      await db.insert("eventParticipants", {
        eventId: event._id, personProfileId: profile._id, roleLabel: entry.roleLabel ?? "",
        eventStartAt: event.startAt, eventEndAt: event.endAt ?? event.startAt,
        eventSortAt: eventSortAt(event), eventSortEndAt: eventSortEndAt(event),
        eventPublicationState: event.publicationState, eventStatus: event.eventStatus,
        sourceType: event.sourceType, sourceLabel: event.sourceLabel,
        confirmationState: "confirmed", confirmedAt: now, updatedAt: now,
      });
    }
  }
  for (const row of [...slots.filter(slot => !keptSlots.has(slot._id)), ...untimed, ...participants]) await db.delete(row._id);
}
