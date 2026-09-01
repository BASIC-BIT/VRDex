type EventParticipant = {
  slug: string;
  roleLabel: string;
};

type EventSlot = {
  performer?: {
    slug: string;
  };
};

export function serializeOtherEventParticipants(event: {
  participants: EventParticipant[];
  slots: EventSlot[];
} | undefined): string {
  if (event === undefined) {
    return "";
  }

  const scheduledParticipantSlugs = new Set(
    event.slots.flatMap((slot) => slot.performer === undefined ? [] : [slot.performer.slug]),
  );

  return event.participants
    .filter((participant) => !scheduledParticipantSlugs.has(participant.slug))
    .map((participant) => `${participant.slug} | ${participant.roleLabel}`)
    .join("\n");
}
