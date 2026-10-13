import { EventIntakeFieldsSchema, EventIntakeLocalTimeSchema, type EventIntakeFields, type EventIntakeLocalTime, type EventIntakePatch } from "../../../../../packages/api-contracts/src/event-intake";
import { eventLocalDate } from "./event-intake-date-time";

export const intakeSuggestionKeys = EventIntakeFieldsSchema.keyof().options;
export type IntakeSuggestionAcceptance = {
  key: keyof EventIntakeFields;
  proposalDate: EventIntakeFields["eventDate"];
};

export function rebaseIntakeTime(local: EventIntakeLocalTime | null | undefined, previousDate: EventIntakeFields["eventDate"], nextDate: EventIntakeFields["eventDate"]) {
  if (!local || !previousDate || !nextDate || previousDate === nextDate) return local;
  const date = eventLocalDate(previousDate, local);
  if (!date || !eventLocalDate(nextDate)) return local;
  // Existing accepted dates stay visible even outside the permitted offset range.
  return { ...local, dayOffset: (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${nextDate}T00:00:00Z`)) / 86_400_000 };
}

export function rebaseIntakeTimes<T extends EventIntakeFields>(fields: T, previousDate: EventIntakeFields["eventDate"], nextDate: EventIntakeFields["eventDate"]): T {
  return { ...fields, eventDate: nextDate,
    start: rebaseIntakeTime(fields.start, previousDate, nextDate), end: rebaseIntakeTime(fields.end, previousDate, nextDate), doors: rebaseIntakeTime(fields.doors, previousDate, nextDate),
    lineup: fields.lineup ? fields.lineup.map(row => ({ ...row, start: rebaseIntakeTime(row.start, previousDate, nextDate), end: rebaseIntakeTime(row.end, previousDate, nextDate) })) : fields.lineup,
  };
}

export function restoreIntakeTiming(fields: EventIntakePatch, backup: EventIntakePatch | null): EventIntakePatch {
  return { ...fields,
    start: rebaseIntakeTime(backup?.start, backup?.eventDate, fields.eventDate) ?? null,
    end: rebaseIntakeTime(backup?.end, backup?.eventDate, fields.eventDate) ?? null,
    doors: rebaseIntakeTime(backup?.doors, backup?.eventDate, fields.eventDate) ?? null,
    lineup: fields.lineup ? fields.lineup.map(row => {
      const remembered = backup?.lineup?.find(item => item.clientKey === row.clientKey);
      return { ...row, start: rebaseIntakeTime(remembered?.start, backup?.eventDate, fields.eventDate) ?? null, end: rebaseIntakeTime(remembered?.end, backup?.eventDate, fields.eventDate) ?? null };
    }) : fields.lineup,
  };
}

function translateSuggestionTime(local: EventIntakeLocalTime | null | undefined, proposalDate: EventIntakeFields["eventDate"], acceptedDate: EventIntakeFields["eventDate"]) {
  if (!local) return local;
  // A normalized suggestion has an explicit offset. An undated source clock does not.
  const sourceDate = proposalDate ?? (local.dayOffset !== undefined ? acceptedDate : undefined);
  if (!sourceDate || !acceptedDate || !eventLocalDate(sourceDate) || !eventLocalDate(acceptedDate)) return false;
  const translated = rebaseIntakeTime({ ...local, dayOffset: local.dayOffset ?? 0 }, sourceDate, acceptedDate);
  return EventIntakeLocalTimeSchema.safeParse(translated).success ? translated : false;
}

function translateSuggestionTimes(fields: EventIntakeFields, proposalDate: EventIntakeFields["eventDate"], acceptedDate: EventIntakeFields["eventDate"]): EventIntakeFields | null {
  const start = translateSuggestionTime(fields.start, proposalDate, acceptedDate);
  const end = translateSuggestionTime(fields.end, proposalDate, acceptedDate);
  const doors = translateSuggestionTime(fields.doors, proposalDate, acceptedDate);
  if (start === false || end === false || doors === false) return null;
  let lineup = fields.lineup;
  if (lineup) {
    const translated: NonNullable<EventIntakeFields["lineup"]> = [];
    for (const row of lineup) {
      const rowStart = translateSuggestionTime(row.start, proposalDate, acceptedDate);
      const rowEnd = translateSuggestionTime(row.end, proposalDate, acceptedDate);
      if (rowStart === false || rowEnd === false) return null;
      translated.push({ ...row, start: rowStart, end: rowEnd });
    }
    lineup = translated;
  }
  return { ...fields, start, end, doors, lineup };
}

/** Rebase already normalized pending clocks when the editor's base moves. */
export function rebaseIntakeSuggestions(fields: EventIntakePatch, previousDate: EventIntakeFields["eventDate"]): EventIntakePatch {
  if (!fields.tentative || fields.tentative.eventDate || fields.eventDate === previousDate || !previousDate) return fields;
  const pendingClocks = [fields.tentative.start, fields.tentative.end, fields.tentative.doors, ...(fields.tentative.lineup ?? []).flatMap(row => [row.start, row.end])].filter(local => local != null);
  if (!fields.eventDate && pendingClocks.length && pendingClocks.every(local => local.dayOffset !== undefined)) {
    return { ...fields, tentative: { ...fields.tentative, eventDate: previousDate } };
  }
  // Translation needs the old base, but unknown source clocks must remain unknown.
  const rebaseKnown = (local: EventIntakeLocalTime | null | undefined) => local?.dayOffset === undefined ? local : rebaseIntakeTime(local, previousDate, fields.eventDate);
  const tentative = { ...fields.tentative,
    start: rebaseKnown(fields.tentative.start), end: rebaseKnown(fields.tentative.end), doors: rebaseKnown(fields.tentative.doors),
    lineup: fields.tentative.lineup ? fields.tentative.lineup.map(row => ({ ...row, start: rebaseKnown(row.start), end: rebaseKnown(row.end) })) : fields.tentative.lineup,
  };
  const clocks = [tentative.start, tentative.end, tentative.doors, ...(tentative.lineup ?? []).flatMap(row => [row.start, row.end])].filter(local => local != null);
  if (clocks.some(local => !EventIntakeLocalTimeSchema.safeParse(local).success)) {
    // Keep the previous reference date rather than persisting an invalid offset or clamping.
    return { ...fields, tentative: { ...fields.tentative, eventDate: previousDate } };
  }
  // Unknown clocks were deliberately not translated.
  return { ...fields, tentative };
}

/** Accept atomically, retaining the suggestion when its date cannot be placed safely. */
export function acceptIntakeSuggestion({ fields, acceptance }: { fields: EventIntakePatch; acceptance: IntakeSuggestionAcceptance }): EventIntakePatch | null {
  const { key, proposalDate } = acceptance;
  const value = fields.tentative?.[key];
  if (value == null) return null;
  const tentative = { ...fields.tentative };
  delete tentative[key];
  if (key === "eventDate") {
    const date = fields.tentative?.eventDate;
    if (!date || !eventLocalDate(date)) return null;
    const normalized = translateSuggestionTimes(tentative, proposalDate, date);
    if (!normalized) return null;
    return { ...rebaseIntakeTimes(fields, fields.eventDate, date), tentative: normalized };
  }
  if (key === "start" || key === "end" || key === "doors") {
    const local = translateSuggestionTime(fields.tentative?.[key], proposalDate, fields.eventDate);
    if (local === false) return null;
    return { ...fields, [key]: local, tentative };
  }
  if (key === "lineup") {
    const normalized = translateSuggestionTimes({ lineup: fields.tentative?.lineup }, proposalDate, fields.eventDate);
    if (!normalized) return null;
    return { ...fields, lineup: normalized.lineup, tentative };
  }
  return { ...fields, [key]: value, tentative };
}
