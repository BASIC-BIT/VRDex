type EventParticipant = {
  slug: string;
  roleLabel: string;
};

type EventSlot = {
  roleLabel: string;
  performer?: {
    slug: string;
  };
};

function participantRoleKey(slug: string, roleLabel: string): string {
  return `${slug.trim().toLowerCase()}\u0000${roleLabel.trim().toLowerCase()}`;
}

export function serializeOtherEventParticipants(event: {
  participants: EventParticipant[];
  slots: EventSlot[];
} | undefined): string {
  if (event === undefined) {
    return "";
  }

  const scheduledParticipantRoles = new Set(
    event.slots.flatMap((slot) => slot.performer === undefined
      ? []
      : [participantRoleKey(slot.performer.slug, slot.roleLabel)]),
  );

  return event.participants
    .filter((participant) => !scheduledParticipantRoles.has(
      participantRoleKey(participant.slug, participant.roleLabel),
    ))
    .map((participant) => `${participant.slug} | ${participant.roleLabel}`)
    .join("\n");
}
