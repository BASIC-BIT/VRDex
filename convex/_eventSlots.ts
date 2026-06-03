import { normalizeProfileInlineText, sanitizeProfileTextList } from "./_profileSubmissions";

export const EVENT_SLOT_MAX_COUNT = 80;
export const EVENT_SLOT_LABEL_MAX_LENGTH = 120;
export const EVENT_SLOT_ROLE_MAX_LENGTH = 48;
export const EVENT_SLOT_SOURCE_LABEL_MAX_LENGTH = 120;
export const EVENT_SLOT_NOTES_MAX_LENGTH = 1_200;
export const EVENT_SLOT_TEMPLATE_MAX_COUNT = 80;
export const EVENT_SLOT_TEMPLATE_MAX_DURATION_MINUTES = 24 * 60;

export type EventSlotInput = {
  personSlug?: string;
  displayLabel: string;
  roleLabel?: string;
  startAt: number;
  endAt?: number;
  sourceLabel?: string;
  sourceUrl?: string;
  notes?: string;
};

export type SanitizedEventSlotInput = {
  position: number;
  personSlug?: string;
  displayLabel: string;
  roleLabel: string;
  startAt: number;
  endAt?: number;
  sourceLabel: string;
  sourceUrl?: string;
  notes?: string;
};

export type SequentialEventSlotTemplateInput = {
  eventStartAt: number;
  slotCount: number;
  slotDurationMinutes: number;
  breakMinutes?: number;
};

export type SequentialEventSlotTemplateSlot = {
  position: number;
  startAt: number;
  endAt: number;
  startOffsetMinutes: number;
  durationMinutes: number;
};

type EventSlotTimeBounds = {
  startAt: number;
  endAt?: number;
};

function requireValidTimestamp(input: number, fieldName: string): number {
  if (!Number.isFinite(input)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }

  return input;
}

function requirePositiveInteger(input: number, fieldName: string, max: number): number {
  if (!Number.isInteger(input) || input <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  if (input > max) {
    throw new Error(`${fieldName} must be ${max} or less.`);
  }

  return input;
}

function requireNonNegativeInteger(input: number, fieldName: string, max: number): number {
  if (!Number.isInteger(input) || input < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }

  if (input > max) {
    throw new Error(`${fieldName} must be ${max} or less.`);
  }

  return input;
}

function requireBoundedText(
  input: string,
  fieldName: string,
  minLength: number,
  maxLength: number,
): string {
  const value = normalizeProfileInlineText(input);

  if (value.length < minLength) {
    throw new Error(`${fieldName} must be at least ${minLength} characters.`);
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function optionalBoundedText(
  input: string | undefined,
  fieldName: string,
  maxLength: number,
): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = normalizeProfileInlineText(input);

  if (value.length === 0) {
    return undefined;
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function optionalHttpsUrl(input: string | undefined, fieldName: string): string | undefined {
  const value = optionalBoundedText(input, fieldName, 2_048);

  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      throw new Error(`${fieldName} must use https.`);
    }

    return url.href;
  } catch (error) {
    if (error instanceof Error && error.message === `${fieldName} must use https.`) {
      throw error;
    }

    throw new Error(`${fieldName} must be a valid URL.`);
  }
}

export function sanitizeEventSlotInputs(
  input: EventSlotInput[] | undefined,
  fallbackSourceLabel: string,
  eventBounds?: EventSlotTimeBounds,
): SanitizedEventSlotInput[] {
  if ((input?.length ?? 0) > EVENT_SLOT_MAX_COUNT) {
    throw new Error(`Event slots can include at most ${EVENT_SLOT_MAX_COUNT} entries.`);
  }

  return (input ?? [])
    .map((slot, index) => {
      const personSlug = sanitizeProfileTextList([slot.personSlug ?? ""], "Slot person profile slugs", {
        maxItems: 1,
        maxLength: 64,
      })[0];
      const startAt = requireValidTimestamp(slot.startAt, "Slot start time");
      const endAt = slot.endAt === undefined ? undefined : requireValidTimestamp(slot.endAt, "Slot end time");

      if (endAt !== undefined && endAt <= startAt) {
        throw new Error("Slot end time must be after the start time.");
      }

      if (eventBounds !== undefined && startAt < eventBounds.startAt) {
        throw new Error("Slot start time must be at or after the event start time.");
      }

      if (eventBounds?.endAt !== undefined && (endAt ?? startAt) > eventBounds.endAt) {
        throw new Error("Slot end time must be at or before the event end time.");
      }

      return {
        position: index,
        ...(personSlug ? { personSlug } : {}),
        displayLabel: requireBoundedText(
          slot.displayLabel,
          "Slot display label",
          1,
          EVENT_SLOT_LABEL_MAX_LENGTH,
        ),
        roleLabel: optionalBoundedText(slot.roleLabel, "Slot role", EVENT_SLOT_ROLE_MAX_LENGTH) ?? "Performer",
        startAt,
        ...(endAt === undefined ? {} : { endAt }),
        sourceLabel:
          optionalBoundedText(slot.sourceLabel, "Slot source label", EVENT_SLOT_SOURCE_LABEL_MAX_LENGTH) ??
          fallbackSourceLabel,
        ...optionalObjectField("sourceUrl", optionalHttpsUrl(slot.sourceUrl, "Slot source URL")),
        ...optionalObjectField("notes", optionalBoundedText(slot.notes, "Slot notes", EVENT_SLOT_NOTES_MAX_LENGTH)),
      };
    })
    .sort((first, second) => first.startAt - second.startAt || first.position - second.position)
    .map((slot, position) => ({ ...slot, position }));
}

export function generateSequentialEventSlots(
  input: SequentialEventSlotTemplateInput,
): SequentialEventSlotTemplateSlot[] {
  const eventStartAt = requireValidTimestamp(input.eventStartAt, "Event start time");
  const slotCount = requirePositiveInteger(input.slotCount, "Slot count", EVENT_SLOT_TEMPLATE_MAX_COUNT);
  const slotDurationMinutes = requirePositiveInteger(
    input.slotDurationMinutes,
    "Slot duration minutes",
    EVENT_SLOT_TEMPLATE_MAX_DURATION_MINUTES,
  );
  const breakMinutes = requireNonNegativeInteger(
    input.breakMinutes ?? 0,
    "Break duration minutes",
    EVENT_SLOT_TEMPLATE_MAX_DURATION_MINUTES,
  );
  const strideMinutes = slotDurationMinutes + breakMinutes;

  return Array.from({ length: slotCount }, (_, position) => {
    const startOffsetMinutes = position * strideMinutes;
    const startAt = eventStartAt + startOffsetMinutes * 60_000;
    const endAt = startAt + slotDurationMinutes * 60_000;

    return {
      position,
      startAt,
      endAt,
      startOffsetMinutes,
      durationMinutes: slotDurationMinutes,
    };
  });
}

function optionalObjectField<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
