import type { Doc } from "./_generated/dataModel";

export function eventOperationSlot(slot: Doc<"eventSlots">) {
  return {
    slotId: slot._id,
    position: slot.position,
    startAt: slot.startAt,
    ...(slot.endAt === undefined ? {} : { endAt: slot.endAt }),
    displayLabel: slot.displayLabel,
    roleLabel: slot.roleLabel,
    reviewState: slot.reviewState,
  };
}

export function findEventOperationSlots(slots: Doc<"eventSlots">[], now: number) {
  const ordered = [...slots].sort((first, second) => first.startAt - second.startAt || first.position - second.position);
  let currentSlot: Doc<"eventSlots"> | undefined;
  let nextSlot: Doc<"eventSlots"> | undefined;

  for (let index = 0; index < ordered.length; index += 1) {
    const slot = ordered[index];

    if (slot === undefined) {
      continue;
    }

    if (nextSlot === undefined && slot.startAt > now) {
      nextSlot = slot;
    }

    const followingSlot = ordered[index + 1];
    const effectiveEndAt = slot.endAt ?? followingSlot?.startAt;

    if (slot.startAt <= now && (effectiveEndAt === undefined || effectiveEndAt > now)) {
      currentSlot = slot;
    }
  }

  return {
    ...(currentSlot === undefined ? {} : { currentSlot: eventOperationSlot(currentSlot) }),
    ...(nextSlot === undefined ? {} : { nextSlot: eventOperationSlot(nextSlot) }),
  };
}
