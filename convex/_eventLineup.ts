import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { sanitizeEventLineupInput, type EventLineupInput } from "./_eventInputs";
import { eventSortAt, eventSortEndAt } from "./_eventSchedule";
import { canReadProfile } from "./_profilePermissions";
import { eventProfileStreamChoices } from "./_eventPlayback";

export type { EventLineupInput } from "./_eventInputs";

/** Replaces the whole authored lineup. Call inside the authorized event mutation. */
export async function replaceEventLineup(
  db: DatabaseWriter, event: Doc<"events">, entries: EventLineupInput, now: number,
  options: {
    preserveSlotAssociationIds?: Id<"eventSlots">[];
    preserveParticipantAssociationIds?: Id<"eventParticipants">[];
    confirmPersonLinks?: boolean;
  } = {},
): Promise<void> {
  const normalized = sanitizeEventLineupInput(entries);
  const [slots, untimed, participants] = await Promise.all([
    db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(),
    db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", event._id)).collect(),
    db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(),
  ]);
  const resolved = await Promise.all(normalized.map(async entry => {
    if (entry.startAt !== undefined) {
      if (event.scheduleKind === "date_only" || event.startAt === undefined) throw new Error("Timed sets require a timed event.");
      if (entry.startAt < event.startAt || (event.endAt !== undefined && (entry.endAt ?? entry.startAt) > event.endAt)) {
        throw new Error("Set times must be within the event schedule.");
      }
    }
    // Editor projections omit private profiles. Only preserve a current event
    // association that was included in the editor's authorized readback.
    const previousSlot = slots.find(row => (row.clientKey ?? row._id) === entry.clientKey);
    const previousUntimed = untimed.find(row => row.clientKey === entry.clientKey);
    const preservedPersonId = previousSlot !== undefined && options.preserveSlotAssociationIds?.includes(previousSlot._id)
      ? previousSlot.personProfileId
      : previousUntimed?.personProfileId !== undefined && participants.some(row =>
        row.personProfileId === previousUntimed.personProfileId && options.preserveParticipantAssociationIds?.includes(row._id))
        ? previousUntimed.personProfileId : undefined;
    if (preservedPersonId !== undefined) {
      const previousProfile = await db.get(preservedPersonId);
      if ((previousProfile === null || !canReadProfile("public", previousProfile)) &&
          (entry.personSlug === undefined || entry.personSlug === previousProfile?.slug)) {
        return { entry, profile: previousProfile ?? undefined, personProfileId: preservedPersonId };
      }
    }
    if (entry.personSlug === undefined) return { entry, profile: undefined, personProfileId: undefined };
    const profile = await db.query("profiles").withIndex("by_slug", q => q.eq("slug", entry.personSlug!)).unique();
    if (profile === null || profile.profileType !== "person" || !canReadProfile("public", profile)) {
      throw new Error("Lineup match must be a published public person.");
    }
    return { entry, profile, personProfileId: profile._id };
  }));
  const keptSlots = new Set<Id<"eventSlots">>();
  const matchedPeople = new Set<Id<"profiles">>();
  for (const { entry, profile, personProfileId } of resolved) {
    if (entry.startAt !== undefined) {
      const existing = slots.find(slot => !keptSlots.has(slot._id) && (
        (slot.clientKey ?? slot._id) === entry.clientKey || (slot.clientKey === undefined && slot.startAt === entry.startAt
          && slot.personProfileId === personProfileId && (personProfileId !== undefined || slot.displayLabel === entry.performerLabel))
      ));
      const selectedStreamId = entry.selectedStreamId === undefined
        ? (existing?.personProfileId === personProfileId ? existing?.selectedStreamId : undefined)
        : entry.selectedStreamId ?? undefined;
      if (selectedStreamId !== undefined && !(existing?.personProfileId === personProfileId && existing?.selectedStreamId === selectedStreamId) &&
          (profile === undefined || !canReadProfile("public", profile) || !eventProfileStreamChoices(profile).some(choice => choice.streamId === selectedStreamId))) {
        throw new Error("Selected stream must belong to the performer's public streams.");
      }
      const fields = {
        selectedStreamId,
        eventId: event._id, clientKey: entry.clientKey, position: entry.position,
        eventStartAt: event.startAt, eventSortAt: eventSortAt(event),
        startAt: entry.startAt, endAt: entry.endAt, personProfileId,
        displayLabel: entry.performerLabel, roleLabel: entry.roleLabel ?? "",
        sourceType: event.sourceType, sourceLabel: event.sourceLabel,
        confidence: 1, reviewState: options.confirmPersonLinks === false ? "draft" as const : "confirmed" as const, updatedAt: now,
      };
      if (existing !== undefined) {
        keptSlots.add(existing._id);
        await db.patch(existing._id, fields);
      } else await db.insert("eventSlots", { ...fields, createdAt: now });
    } else {
      await db.insert("eventLineupEntries", {
        eventId: event._id, clientKey: entry.clientKey, position: entry.position,
        performerLabel: entry.performerLabel, personProfileId,
        roleLabel: entry.roleLabel, updatedAt: now,
      });
    }
    if (personProfileId !== undefined && !matchedPeople.has(personProfileId)) {
      matchedPeople.add(personProfileId);
      await db.insert("eventParticipants", {
        eventId: event._id, personProfileId, roleLabel: entry.roleLabel ?? "",
        eventStartAt: event.startAt, eventEndAt: event.endAt ?? event.startAt,
        eventSortAt: eventSortAt(event), eventSortEndAt: eventSortEndAt(event),
        eventPublicationState: event.publicationState, eventStatus: event.eventStatus,
        sourceType: event.sourceType, sourceLabel: event.sourceLabel,
        confirmationState: options.confirmPersonLinks === false ? "unconfirmed" : "confirmed",
        ...(options.confirmPersonLinks === false ? {} : { confirmedAt: now }), updatedAt: now,
      });
    }
  }
  for (const row of [...slots.filter(slot => !keptSlots.has(slot._id)), ...untimed, ...participants]) await db.delete(row._id);
}
