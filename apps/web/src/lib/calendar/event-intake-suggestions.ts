import { EventIntakeFieldsSchema, EventIntakeLocalTimeSchema, selectEventLocalTime, type EventIntakeFields, type EventIntakeLocalTime, type EventIntakePatch } from "../../../../../packages/api-contracts/src/event-intake";
import { intakeLocalFromInstant, readIntakeInstant } from "./event-lineup-adapters";
import { projectEditorTime } from "./event-editor-time";
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
    start: backup ? rebaseIntakeTime(backup.start, backup.eventDate, fields.eventDate) : null,
    end: backup ? rebaseIntakeTime(backup.end, backup.eventDate, fields.eventDate) : null,
    doors: backup ? rebaseIntakeTime(backup.doors, backup.eventDate, fields.eventDate) : null,
    lineup: fields.lineup ? fields.lineup.map(row => {
      const remembered = backup?.lineup?.find(item => item.clientKey === row.clientKey);
      return { ...row, start: remembered ? rebaseIntakeTime(remembered.start, backup?.eventDate, fields.eventDate) : null, end: remembered ? rebaseIntakeTime(remembered.end, backup?.eventDate, fields.eventDate) : null };
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

/** Resolve source clocks before serializing into the accepted canonical context. */
function acceptSourceClock(fields: EventIntakePatch, local: EventIntakeLocalTime | null | undefined, proposalDate: EventIntakeFields["eventDate"], path: string) {
  if (!local) return local;
  const sourceZone = fields.tentative && Object.hasOwn(fields.tentative, "timezone") ? fields.tentative.timezone : fields.timezone;
  const sourceDate = proposalDate ?? (local.dayOffset !== undefined ? fields.eventDate : undefined);
  if (!sourceZone || !sourceDate || !fields.timezone || !fields.eventDate) throw new RangeError("Event date must be valid.");
  if (fields.questions?.some(question => question.startsWith(`${path}:`) && /date_timezone_required|start_date_required/.test(question))) throw new RangeError("Event date must be valid.");
  const instant = selectEventLocalTime(sourceDate, local, sourceZone);
  return intakeLocalFromInstant(fields, instant);
}

/** Accept atomically, retaining unknown source context and unrepresentable clocks. */
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
  try {
    if (key === "start" || key === "end" || key === "doors") return { ...fields, [key]: acceptSourceClock(fields, fields.tentative?.[key], proposalDate, `event.${key}`), tentative };
    if (key === "lineup") {
      const lineup = fields.tentative?.lineup?.map((row, index) => ({ ...row, personSlug: undefined, start: acceptSourceClock(fields, row.start, proposalDate, `lineup.${index}.start`), end: acceptSourceClock(fields, row.end, proposalDate, `lineup.${index}.end`) }));
      return { ...fields, lineup, tentative };
    }
    if (key === "timezone" && fields.timezone && fields.timezone !== value) {
      const sourceZone = fields.tentative?.timezone;
      if (!sourceZone) return null;
      const start = readIntakeInstant(fields, fields.start);
      const target = { ...fields, timezone: sourceZone, eventDate: start === undefined ? fields.eventDate : projectEditorTime({ instant: start, timezone: sourceZone }).value.slice(0, 10) };
      const convert = (local: EventIntakeLocalTime | null | undefined) => {
        if (!local) return local;
        const instant = readIntakeInstant(fields, local);
        if (instant === undefined) throw new RangeError("Event date must be valid.");
        return intakeLocalFromInstant(target, instant);
      };
      return rebaseIntakeSuggestions({ ...target, start: convert(fields.start), end: convert(fields.end), doors: convert(fields.doors), lineup: fields.lineup?.map(row => ({ ...row, start: convert(row.start), end: convert(row.end) })), tentative }, fields.eventDate);
    }
    return { ...fields, [key]: value, tentative };
  } catch { return null; }
}
