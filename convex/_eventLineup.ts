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
    preservePersonConfirmation?: boolean;
    retainedAssociations?: { participantIds: Id<"eventParticipants">[]; slotIds: Id<"eventSlots">[] };
  } = {},
): Promise<void> {
  const normalized = sanitizeEventLineupInput(entries);
  const [slots, untimed, participants] = await Promise.all([
    db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(),
    db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", event._id)).collect(),
    db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(),
  ]);
  // Stable participant keys are editor-only identities, authorized by the loaded
  // snapshot and scoped again to the event rows fetched above.
  const previousParticipant = (key: string) => participants.find(row => row._id === key && options.preserveParticipantAssociationIds?.includes(row._id));
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
        ? previousUntimed.personProfileId : previousParticipant(entry.clientKey)?.personProfileId;
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
  // A new explicit match confirms that person even if another unchanged row for
  // them appears first. Timing and order changes never count as match approval.
  const authoredMatches = new Set<Id<"profiles">>();
  for (const { entry, personProfileId } of resolved) {
    if (personProfileId === undefined || entry.personSlug === undefined) continue;
    const previous = slots.find(row => (row.clientKey ?? row._id) === entry.clientKey)
      ?? untimed.find(row => row.clientKey === entry.clientKey)
      ?? previousParticipant(entry.clientKey);
    if (previous?.personProfileId !== personProfileId) authoredMatches.add(personProfileId);
  }
  const personConfirmations = new Map(resolved.flatMap(({ personProfileId }) => {
    if (personProfileId === undefined) return [];
    const previous = participants.find(row => row.personProfileId === personProfileId);
    const confirmationState = options.confirmPersonLinks === false ? "unconfirmed" as const
      : options.preservePersonConfirmation && !authoredMatches.has(personProfileId)
        ? previous?.confirmationState ?? "confirmed" as const : "confirmed" as const;
    return [[personProfileId, { previous, confirmationState,
      confirmedAt: confirmationState === "confirmed" ? previous?.confirmedAt ?? now : undefined,
    }] as const];
  }));
  const keptParticipants = new Set(participants.filter(row => options.retainedAssociations?.participantIds.includes(row._id)).map(row => row._id));
  const keptSlots = new Set(slots.filter(row => options.retainedAssociations?.slotIds.includes(row._id)).map(row => row._id));
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
      const source = existing ?? untimed.find(row => row.clientKey === entry.clientKey) ?? previousParticipant(entry.clientKey);
      const fields = {
        selectedStreamId,
        eventId: event._id, clientKey: entry.clientKey, position: entry.position,
        eventStartAt: event.startAt, eventSortAt: eventSortAt(event),
        startAt: entry.startAt, endAt: entry.endAt, personProfileId,
        displayLabel: entry.performerLabel, roleLabel: entry.roleLabel ?? "",
        sourceType: source?.sourceType ?? event.sourceType, sourceLabel: source?.sourceLabel ?? event.sourceLabel,
        sourceUrl: source?.sourceUrl, notes: source?.notes,
        confidence: existing !== undefined && existing.personProfileId === personProfileId ? existing.confidence : 1, reviewState: existing !== undefined && existing.personProfileId === personProfileId ? existing.reviewState : "confirmed" as const, updatedAt: now,
      };
      if (existing !== undefined) {
        keptSlots.add(existing._id);
        await db.patch(existing._id, fields);
      } else await db.insert("eventSlots", { ...fields, createdAt: now });
    } else {
      const source = untimed.find(row => row.clientKey === entry.clientKey)
        ?? slots.find(row => (row.clientKey ?? row._id) === entry.clientKey)
        ?? previousParticipant(entry.clientKey);
      await db.insert("eventLineupEntries", {
        eventId: event._id, clientKey: entry.clientKey, position: entry.position,
        performerLabel: entry.performerLabel, personProfileId,
        roleLabel: entry.roleLabel, updatedAt: now,
        sourceType: source?.sourceType ?? event.sourceType, sourceLabel: source?.sourceLabel ?? event.sourceLabel,
        sourceUrl: source?.sourceUrl, notes: source?.notes,
      });
    }
    if (personProfileId !== undefined && !matchedPeople.has(personProfileId)) {
      matchedPeople.add(personProfileId);
      const { previous, confirmationState, confirmedAt } = personConfirmations.get(personProfileId)!;
      const fields = {
        eventId: event._id, personProfileId, roleLabel: entry.roleLabel ?? "",
        eventStartAt: event.startAt, eventEndAt: event.endAt ?? event.startAt,
        eventSortAt: eventSortAt(event), eventSortEndAt: eventSortEndAt(event),
        eventPublicationState: event.publicationState, eventStatus: event.eventStatus,
        confirmationState, confirmedAt, updatedAt: now,
      };
      if (previous !== undefined) {
        keptParticipants.add(previous._id);
        await db.patch(previous._id, fields);
      } else await db.insert("eventParticipants", {
        ...fields, sourceType: event.sourceType, sourceLabel: event.sourceLabel,
      });
    }
  }
  for (const row of [...slots.filter(slot => !keptSlots.has(slot._id)), ...untimed, ...participants.filter(row => !keptParticipants.has(row._id))]) await db.delete(row._id);
}
