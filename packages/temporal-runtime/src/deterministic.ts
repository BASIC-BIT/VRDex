import { Temporal, Intl as TemporalIntl } from '@js-temporal/polyfill';
import * as chrono from 'chrono-node';
import Holidays from 'date-holidays';
import type { HolidaysTypes } from 'date-holidays';
import type {
  CalendarContext,
  Candidate,
  CandidateFacts,
  TemporalAgentContext,
  TemporalChronoCandidateContext,
  TemporalFeatureFlags,
  TemporalHolidayHint,
  TemporalPrecision,
  Weekday,
} from './types';
import type {
  CandidateFactsInput,
  FormatCandidateInput,
  ParseExpressionInput,
  ParseExpressionOutput,
  ResolveClockTimeInput,
  ResolveClockTimeOutput,
  ResolveCalendarQueryInput,
  ResolveCalendarQueryOutput,
  ResolveHolidayInput,
  ResolveHolidayOutput,
  ResolveTimeZoneInput,
  ResolveTimeZoneOutput,
  SetClockTimeInput,
  ShiftDateTimeInput,
  ValidateCandidateInput,
  ValidateCandidateOutput,
} from './tools';
import { resolveTimeZone as resolveTimeZoneFromText, stripResolvedTimeZoneText, timeZoneValidationForCandidate } from './timezones';

const WEEKDAY_LOOKUP: Record<Weekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const WEEKDAY_NAMES: Record<number, Weekday> = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
};

const WEEKDAY_PATTERN = /\b(?:(this|next|last)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const WEEKDAY_NAME_PATTERN = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const MONTH_NAME_PATTERN = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const WEEKDAY_AFTER_NEXT_PATTERN = new RegExp(`^\\s*(?:the\\s+)?(?:${WEEKDAY_NAME_PATTERN})\\s+after\\s+next\\s*$`, 'i');
const FIRST_OF_MONTH_PATTERN = /^\s*(?:the\s+)?(?:first|1st)\s+(?:of\s+)?(?:(?<relativeMonth>this|next|last)\s+)?(?:the\s+)?month\s*$/i;
const DAY_AFTER_TOMORROW_PATTERN = /^\s*(?:the\s+)?day\s+after\s+tomorrow(?:\s+(?:at\s+)?(?<timeText>.+?))?\s*$/i;
const ORDINAL_WEEKDAY_OF_MONTH_PATTERN = new RegExp(
  `^\\s*(?:(?:the\\s+)?day\\s+(?<dayShift>after|before)\\s+)?(?:the\\s+)?(?<ordinal>first|second|third|fourth|fifth|last)\\s+(?<weekday>${WEEKDAY_NAME_PATTERN})\\s+(?:of|in)\\s+(?:(?<relativeMonth>this|next)\\s+month|(?<monthName>${MONTH_NAME_PATTERN})(?:,?\\s+(?<year>\\d{4}))?)(?:\\s+at\\s+(?<timeText>.+?))?\\s*$`,
  'i',
);
const DISCORD_TIMESTAMP_PATTERN = /<t:(\d+)(?::[tTdDfFR])?>/;
const BARE_EPOCH_PATTERN = /^\d+$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const TWELVE_HOUR_TIME_PATTERN = /\b(\d{1,2})(?:(?::|\.)([0-5]\d))?\s*(am|pm)\b/i;
const COMPACT_MERIDIEM_TIME_PATTERN = /\b(\d{1,2})(?:(?::|\.)([0-5]\d))?\s*([ap])\b/i;
const TWENTY_FOUR_HOUR_TIME_PATTERN = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const AMBIGUOUS_BARE_COLON_CLOCK_PATTERN = /(?<![\d.])\b(0?[1-9]|1[0-2])[:.]([0-5]\d)\b(?!\s*(?:[ap](?:\.?m)?\b|:))/i;
const AMBIGUOUS_BARE_COMPACT_CLOCK_PATTERN = /\b(0?[1-9]|1[0-2])([0-5]\d)\b(?!\s*(?:[ap](?:\.?m)?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b)/i;
const NUMBER_TEXT_PATTERN = String.raw`(?:\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|fifty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?)`;
const RELATIVE_NOON_TIME_PATTERN = new RegExp(String.raw`\b(?:(?<hours>${NUMBER_TEXT_PATTERN})\s+hours?\s+)?(?:past|after)\s+noon(?:\s+and\s+(?<minutes>${NUMBER_TEXT_PATTERN})\s+minutes?)?\b`, 'i');
const RELATIVE_BOUNDARY_SNAP_PATTERN = new RegExp(String.raw`^\s*(?:in\s+)?(?<amount>${NUMBER_TEXT_PATTERN})\s+(?<unit>minutes?|hours?|days?|weeks?|months?|years?)(?:\s+(?<direction>from\s+now|ago))?\s+(?:(?:on|at)\s+(?:the\s+)?(?:(?:top\s+of\s+the\s+)?(?<onBoundary>hour)|(?<onQuarter>quarter\s+hour)|(?<onHalf>half\s+hour))|round(?:ed)?\s+to\s+(?:the\s+)?(?<roundMode>nearest|next|previous)\s+(?<roundBoundary>hour|quarter\s+hour|half\s+hour|15\s+minutes?)|(?<directMode>next|previous)\s+(?<directBoundary>hour|quarter\s+hour|half\s+hour|15\s+minutes?))\s*$`, 'i');
const DIRECT_BOUNDARY_SNAP_PATTERN = new RegExp(String.raw`^\s*(?:(?:on|at)\s+(?:the\s+)?(?:(?:top\s+of\s+the\s+)?(?<onBoundary>hour)|(?<onQuarter>quarter\s+hour)|(?<onHalf>half\s+hour))|round(?:ed)?\s+to\s+(?:the\s+)?(?<roundMode>nearest|next|previous)\s+(?<roundBoundary>hour|quarter\s+hour|half\s+hour|15\s+minutes?)|(?<directMode>next|previous)\s+(?<directBoundary>hour|quarter\s+hour|half\s+hour|15\s+minutes?))\s*$`, 'i');
const HOUR_AFTER_NEXT_PATTERN = /^\s*(?:the\s+)?hour\s+after\s+next\s*$/i;
const HOLIDAY_TYPES: HolidaysTypes.HolidayType[] = ['observance', 'optional', 'bank', 'public'];
const TEMPORAL_SIGNAL_PATTERN = /\b(?:today|tomorrow|yesterday|tonight|noon|midnight|morning|afternoon|evening|day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes|after|before|from|next|last|this|coming|upcoming|at|around|about|by|time|clock)\b|\b\d{1,2}\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/i;
const MONTH_DAY_AT_END_PATTERN = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\s*$/i;
const DATE_SIGNAL_PATTERN = /\b(?:today|tomorrow|yesterday|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|last|this|coming|upcoming)\b/i;
const IANA_TIME_ZONE_ALIASES: Record<string, string> = {
  'America/Indianapolis': 'America/Indiana/Indianapolis',
};
const ORDINAL_INDEX: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
};
const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

let candidateIdSequence = 0;
let supportedHolidayCountryCache: Set<string> | undefined;
const timeZoneCountryCache = new Map<string, string | null>();

interface HolidayMatch {
  name: string;
  isoDate: string;
  country: string;
  instant: Temporal.Instant;
}

export function parseCalendarContext(timeZone: string, referenceInstant = new Date().toISOString()): CalendarContext {
  return { referenceInstant: normalizeReferenceInstant(referenceInstant), timeZone };
}

function normalizeReferenceInstant(referenceInstant: string): string {
  return Temporal.Instant.from(referenceInstant)
    .round({ smallestUnit: 'second', roundingMode: 'trunc' })
    .toString();
}

export function collectTemporalAgentContext(input: { text: string; calendarContext: CalendarContext }): TemporalAgentContext {
  const reference = referenceZdt(input.calendarContext);
  return {
    reference: {
      instant: input.calendarContext.referenceInstant,
      timeZone: input.calendarContext.timeZone,
      localDate: reference.toPlainDate().toString(),
      localTime: reference.toPlainTime().toString({ smallestUnit: 'minute' }),
      localWeekday: weekdayFromTemporal(reference.dayOfWeek),
    },
    chrono: chronoContextFromText(input.text, input.calendarContext),
    holidays: holidayHintsFromText(input.text, input.calendarContext),
  };
}

export async function parseExpression(input: ParseExpressionInput): Promise<ParseExpressionOutput> {
  const explicit = parseExplicitTimestamp(input.text, input.calendarContext);
  if (explicit) {
    return { candidates: [explicit], parserNotes: ['Matched explicit timestamp.'] };
  }

  const timeZoneResolution = resolveTimeZoneFromText({ text: input.text, calendarContext: input.calendarContext });
  if (timeZoneResolution.status === 'ambiguous') {
    return { candidates: [], parserNotes: [timeZoneResolution.clarificationQuestion ?? 'Input contains an ambiguous timezone reference.', ...timeZoneResolution.notes] };
  }
  const timeZoneCandidate = timeZoneResolution.status === 'resolved' ? timeZoneResolution.candidates[0] : undefined;
  if (timeZoneCandidate !== undefined) {
    const strippedText = stripResolvedTimeZoneText(input.text, timeZoneCandidate);
    if (strippedText.length > 0 && strippedText !== input.text.trim()) {
      const parsed = await parseExpression({
        text: strippedText,
        calendarContext: { ...input.calendarContext, timeZone: timeZoneCandidate.timeZone },
        ...(input.features === undefined ? {} : { features: input.features }),
      });
      return {
        candidates: parsed.candidates.map((candidate) => ({
          ...candidate,
          assumptions: [...candidate.assumptions, ...timeZoneCandidate.assumptions],
        })),
        parserNotes: [...timeZoneResolution.notes, ...parsed.parserNotes],
      };
    }
  }

  if (hasTrailingBareNumericTimeSignal(input.text)) {
    return { candidates: [], parserNotes: ['Input contains a trailing bare number that looks like an unresolved time signal.'] };
  }

  if (WEEKDAY_AFTER_NEXT_PATTERN.test(input.text)) {
    return { candidates: [], parserNotes: ['Input contains ambiguous weekday-after-next phrase.'] };
  }

  const ordinalWeekday = featureEnabled(input.features, 'ordinalWeekdayGrammar')
    ? parseOrdinalWeekdayOfMonth(input.text, input.calendarContext)
    : null;
  if (ordinalWeekday) {
    return { candidates: [ordinalWeekday], parserNotes: ['Matched ordinal weekday-of-month expression.'] };
  }

  const dayAfterTomorrow = parseDayAfterTomorrow(input.text, input.calendarContext);
  if (dayAfterTomorrow) {
    return { candidates: [dayAfterTomorrow], parserNotes: ['Matched day-after-tomorrow expression.'] };
  }

  const monthBoundary = parseMonthBoundary(input.text, input.calendarContext);
  if (monthBoundary) {
    return { candidates: [monthBoundary], parserNotes: ['Matched month-boundary expression.'] };
  }

  const boundarySnap = parseBoundarySnap(input.text, input.calendarContext);
  if (boundarySnap) {
    return { candidates: [boundarySnap], parserNotes: ['Matched relative boundary snap expression.'] };
  }

  const bareTwentyFourHour = parseBareTwentyFourHour(input.text, input.calendarContext);
  if (bareTwentyFourHour) {
    return { candidates: [bareTwentyFourHour], parserNotes: ['Matched bare 24-hour clock expression.'] };
  }

  const chronoCandidate = parseWithChrono(input.text, input.calendarContext);
  if (chronoCandidate) {
    return { candidates: [chronoCandidate], parserNotes: ['Matched chrono-node parse.'] };
  }

  return { candidates: [], parserNotes: ['No deterministic parse candidate found.'] };
}

export async function resolveCalendarQuery(input: ResolveCalendarQueryInput): Promise<ResolveCalendarQueryOutput> {
  const parsed = await parseExpression({
    text: input.query,
    calendarContext: input.calendarContext,
    ...(input.features === undefined ? {} : { features: input.features }),
  });
  return {
    candidates: parsed.candidates,
    source: parsed.candidates[0]?.provenance ?? 'chrono',
    notes: parsed.parserNotes,
  };
}

export async function resolveHoliday(input: ResolveHolidayInput): Promise<ResolveHolidayOutput> {
  const time = input.time === undefined
    ? { hour: 12, minute: 0, explicit: false }
    : { hour: input.time.hour, minute: input.time.minute, explicit: true };
  const holiday = resolveHolidayByName({
    holidayName: input.holidayName,
    year: input.year ?? null,
    time,
    calendarContext: input.calendarContext,
  });
  if (!holiday) {
    return { candidates: [], source: 'holiday_library', notes: [`No holiday calendar match for ${input.holidayName}.`] };
  }

  return {
    candidates: [candidateFromHoliday(holiday, input.calendarContext, time)],
    source: 'holiday_library',
    notes: [`Matched ${holiday.name} in ${holiday.country} holiday calendar.`],
  };
}

export async function resolveClockTime(input: ResolveClockTimeInput): Promise<ResolveClockTimeOutput> {
  const candidates = resolveClockTimeCandidates(input.text);
  return {
    candidates,
    notes: candidates.length === 0
      ? ['No explicit clock time found.']
      : [`Found ${candidates.length} explicit clock time candidate(s).`],
  };
}

export async function resolveTimeZone(input: ResolveTimeZoneInput): Promise<ResolveTimeZoneOutput> {
  return resolveTimeZoneFromText(input);
}

export async function shiftDateTime(input: ShiftDateTimeInput): Promise<Candidate> {
  const base = getBaseZonedDateTime(input);
  let shifted = base.add(input.delta);
  const assumptions = ['Applied timezone-aware duration shift.'];
  if (input.time !== undefined) {
    shifted = requireZonedDateTimeFromPlain(shifted.toPlainDate(), shifted.timeZoneId, Temporal.PlainTime.from({ hour: input.time.hour, minute: input.time.minute }));
    assumptions.push(`Applied explicit clock time ${formatRequestedTime(input.time)} to shifted date.`);
  }
  return createCandidate(shifted, input.time === undefined && isDefaultDateOnlyNoon(base) ? 'relative' : 'datetime', assumptions, 'shift_math');
}

export async function setClockTime(input: SetClockTimeInput): Promise<Candidate> {
  const base = getBaseZonedDateTime(input);
  const zonedDateTime = requireZonedDateTimeFromPlain(base.toPlainDate(), base.timeZoneId, Temporal.PlainTime.from({ hour: input.time.hour, minute: input.time.minute }));
  return createCandidate(
    zonedDateTime,
    'datetime',
    [`Applied explicit clock time ${formatRequestedTime(input.time)} to candidate date.`],
    'shift_math',
  );
}

export async function formatCandidate(input: FormatCandidateInput): Promise<string> {
  const zdt = Temporal.ZonedDateTime.from(input.candidate.zonedDateTime).withTimeZone(input.candidate.timeZone);
  const locale = input.calendarContext.locale ?? 'en-US';

  if (input.style === 'discord-preview') {
    const epoch = Math.floor(Number(zdt.epochMilliseconds) / 1000);
    return `<t:${epoch}:f> / <t:${epoch}:R>`;
  }

  if (input.style === 'weekday-check') {
    return `${weekdayFromTemporal(zdt.dayOfWeek)}, ${zdt.toPlainDate().toString()} at ${zdt.toPlainTime().toString({ smallestUnit: 'minute' })} ${zdt.timeZoneId}`;
  }

  const formatter = new TemporalIntl.DateTimeFormat(locale, {
    dateStyle: input.style === 'full' ? 'full' : 'medium',
    timeStyle: input.candidate.precision === 'date' ? undefined : 'short',
    timeZone: input.candidate.timeZone,
  });

  return formatter.format(zdt.toInstant());
}

export async function candidateFacts(input: CandidateFactsInput): Promise<CandidateFacts> {
  const zdt = Temporal.ZonedDateTime.from(input.candidate.zonedDateTime).withTimeZone(input.candidate.timeZone);
  const facts: CandidateFacts = {
    weekday: weekdayFromTemporal(zdt.dayOfWeek),
    isoDate: zdt.toPlainDate().toString(),
    isoInstant: zdt.toInstant().toString(),
    dayOfWeek: zdt.dayOfWeek,
    month: zdt.month,
    year: zdt.year,
    timeZone: zdt.timeZoneId,
  };
  if (zdt.weekOfYear !== undefined) {
    facts.weekOfYear = zdt.weekOfYear;
  }
  return facts;
}

export async function validateCandidate(input: ValidateCandidateInput): Promise<ValidateCandidateOutput> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ambiguity: string[] = [];
  const facts = await candidateFacts({ candidate: input.candidate, calendarContext: input.calendarContext });
  const requestedWeekday = extractWeekday(input.originalText);
  const requestedHoliday = resolveHolidayFromText(input.originalText, input.calendarContext);
  const requestedTime = extractTimeOfDay(input.originalText);
  const timeZoneValidation = timeZoneValidationForCandidate(input.originalText, input.candidate);
  warnings.push(...timeZoneValidation.warnings);
  errors.push(...timeZoneValidation.errors);
  ambiguity.push(...timeZoneValidation.ambiguity);

  if (requestedWeekday && requestedWeekday !== facts.weekday) {
    const message = `Input mentioned ${requestedWeekday}, but candidate is ${facts.weekday}.`;
    if (input.candidate.provenance === 'shift_math') {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  }

  if (requestedHoliday && requestedHoliday.isoDate !== facts.isoDate) {
    errors.push(`Input mentioned ${requestedHoliday.name}, but candidate date is ${facts.isoDate} instead of ${requestedHoliday.isoDate}.`);
  }

  if (hasAmbiguousBareMeridiemTimeSignal(input.originalText)) {
    errors.push('Input contains a bare 1-12 clock without AM/PM; refusing to choose a meridiem silently.');
  } else if (requestedTime.explicit) {
    const candidateTime = Temporal.ZonedDateTime.from(input.candidate.zonedDateTime).withTimeZone(input.candidate.timeZone).toPlainTime();
    if (candidateTime.hour !== requestedTime.hour || candidateTime.minute !== requestedTime.minute) {
      errors.push(`Input mentioned ${formatRequestedTime(requestedTime)}, but candidate time is ${candidateTime.toString({ smallestUnit: 'minute' })}.`);
    }
  } else if (hasTrailingBareNumericTimeSignal(input.originalText)) {
    errors.push('Input contains a trailing bare number that looks like an unresolved time signal; refusing to treat it as date-only noon.');
  }

  if (input.candidate.precision === 'date') {
    warnings.push('Date-only input is represented at noon in the selected timezone for Discord timestamp compatibility.');
  }

  return {
    passed: errors.length === 0,
    warnings,
    errors,
    ambiguity,
    suggestedFormatIndex: suggestedFormatIndex(input.originalText, input.candidate.precision),
  };
}

export function candidateToEpoch(candidate: Candidate): number {
  return Math.floor(Number(Temporal.Instant.from(candidate.isoInstant).epochMilliseconds) / 1000);
}

export function candidateFromProposal(params: {
  isoInstant: string;
  timeZone: string;
  precision: TemporalPrecision;
  assumptions: string[];
}): Candidate {
  const instant = Temporal.Instant.from(params.isoInstant);
  return createCandidate(
    instant.toZonedDateTimeISO(params.timeZone),
    params.precision,
    params.assumptions,
    'explicit',
  );
}

function parseExplicitTimestamp(text: string, calendarContext: CalendarContext): Candidate | null {
  const discordMatch = DISCORD_TIMESTAMP_PATTERN.exec(text);
  if (discordMatch?.[1]) {
    try {
      return candidateFromExplicitInstant(
        Temporal.Instant.fromEpochNanoseconds(BigInt(discordMatch[1]) * 1_000_000_000n),
        calendarContext,
        'Used explicit Discord timestamp from input.',
      );
    } catch {
      return null;
    }
  }

  try {
    const trimmed = text.trim();
    const bareEpoch = parseBareEpochInstant(trimmed);
    if (bareEpoch !== null) {
      return candidateFromExplicitInstant(
        bareEpoch.instant,
        calendarContext,
        `Used explicit Unix epoch ${bareEpoch.unit} from input.`,
      );
    }

    if (!ISO_INSTANT_PATTERN.test(trimmed)) {
      return null;
    }

    const instant = Temporal.Instant.from(trimmed);
    return candidateFromExplicitInstant(instant, calendarContext, 'Used explicit ISO instant from input.');
  } catch {
    return null;
  }
}

function parseBareEpochInstant(text: string): { instant: Temporal.Instant; unit: string } | null {
  if (!BARE_EPOCH_PATTERN.test(text)) {
    return null;
  }
  const normalized = text.replace(/^0+(?=\d)/, '');
  const epoch = BigInt(normalized);
  if (normalized === '0' || normalized.length === 10) {
    return { instant: Temporal.Instant.fromEpochNanoseconds(epoch * 1_000_000_000n), unit: 'seconds' };
  }
  if (normalized.length === 13) {
    return { instant: Temporal.Instant.fromEpochNanoseconds(epoch * 1_000_000n), unit: 'milliseconds' };
  }
  if (normalized.length === 16) {
    return { instant: Temporal.Instant.fromEpochNanoseconds(epoch * 1_000n), unit: 'microseconds' };
  }
  if (normalized.length === 19) {
    return { instant: Temporal.Instant.fromEpochNanoseconds(epoch), unit: 'nanoseconds' };
  }
  return null;
}

function candidateFromExplicitInstant(instant: Temporal.Instant, calendarContext: CalendarContext, assumption: string): Candidate {
  return createCandidate(
    instant.toZonedDateTimeISO(calendarContext.timeZone),
    'datetime',
    [assumption],
    'explicit',
  );
}

function candidateFromHoliday(
  holiday: { name: string; isoDate: string; country: string },
  calendarContext: CalendarContext,
  time: { hour: number; minute: number; explicit: boolean },
): Candidate {
  const zonedDateTime = requireZonedDateTimeFromPlain(
    Temporal.PlainDate.from(holiday.isoDate),
    calendarContext.timeZone,
    Temporal.PlainTime.from({ hour: time.hour, minute: time.minute }),
  );
  const assumptions = [`Resolved ${holiday.name} using the ${holiday.country} holiday calendar.`];
  if (!time.explicit) {
    assumptions.push('Defaulted date-only expression to 12:00 PM local time.');
  }

  return createCandidate(zonedDateTime, time.explicit ? 'datetime' : 'date', assumptions, 'holiday_library');
}

function featureEnabled(features: TemporalFeatureFlags | undefined, key: keyof TemporalFeatureFlags): boolean {
  return features?.[key] !== false;
}

function parseOrdinalWeekdayOfMonth(text: string, calendarContext: CalendarContext): Candidate | null {
  const match = ORDINAL_WEEKDAY_OF_MONTH_PATTERN.exec(text);
  const groups = match?.groups;
  if (!groups) {
    return null;
  }

  const weekday = groups['weekday']?.toLowerCase() as Weekday | undefined;
  const ordinal = groups['ordinal']?.toLowerCase();
  const relativeMonth = groups['relativeMonth']?.toLowerCase();
  const monthName = groups['monthName']?.toLowerCase();
  if (!weekday || !isWeekday(weekday) || !ordinal || (relativeMonth === undefined && monthName === undefined)) {
    return null;
  }

  const reference = referenceZdt(calendarContext);
  const monthYear = ordinalWeekdayTargetMonth(reference, relativeMonth, monthName, groups['year']);
  if (monthYear === null) {
    return null;
  }
  const dayShift = groups['dayShift']?.toLowerCase();
  let targetDate = ordinalWeekdayDate(monthYear.year, monthYear.month, weekday, ordinal, dayShift);
  if (targetDate === null) {
    return null;
  }

  const time = groups['timeText'] === undefined
    ? { hour: 12, minute: 0, explicit: false }
    : extractTimeOfDay(groups['timeText']);
  if (groups['timeText'] !== undefined && !time.explicit) {
    return null;
  }

  const zonedDateTime = zonedDateTimeFromPlain(targetDate, calendarContext.timeZone, Temporal.PlainTime.from({ hour: time.hour, minute: time.minute }));
  if (zonedDateTime === null) {
    return null;
  }
  if (!monthYear.explicitYear && monthName !== undefined && Temporal.Instant.compare(zonedDateTime.toInstant(), reference.toInstant()) <= 0) {
    const rolledTargetDate = ordinalWeekdayDate(monthYear.year + 1, monthYear.month, weekday, ordinal, dayShift);
    if (rolledTargetDate === null) {
      return null;
    }
    targetDate = rolledTargetDate;
  }

  const finalZonedDateTime = zonedDateTimeFromPlain(targetDate, calendarContext.timeZone, Temporal.PlainTime.from({ hour: time.hour, minute: time.minute }));
  if (finalZonedDateTime === null) {
    return null;
  }
  const monthDescription = relativeMonth === undefined ? monthName : `${relativeMonth} month`;
  const assumptions = [`Resolved ${ordinal} ${weekday} of ${monthDescription} with calendar arithmetic.`];
  if (dayShift !== undefined) {
    assumptions.push(`Applied one day ${dayShift} the resolved date.`);
  }
  if (time.explicit) {
    assumptions.push(`Applied explicit clock time ${formatRequestedTime(time)}.`);
  } else {
    assumptions.push('Defaulted date-only expression to 12:00 PM local time.');
  }

  return createCandidate(finalZonedDateTime, time.explicit ? 'datetime' : 'date', assumptions, 'shift_math');
}

function parseDayAfterTomorrow(text: string, calendarContext: CalendarContext): Candidate | null {
  const match = DAY_AFTER_TOMORROW_PATTERN.exec(text);
  const groups = match?.groups;
  if (!match) {
    return null;
  }

  const time = groups?.['timeText'] === undefined
    ? { hour: 12, minute: 0, explicit: false }
    : extractTimeOfDay(groups['timeText']);
  if (groups?.['timeText'] !== undefined && !time.explicit) {
    return null;
  }

  const reference = referenceZdt(calendarContext);
  const targetDate = reference.toPlainDate().add({ days: 2 });
  const target = zonedDateTimeFromPlain(targetDate, calendarContext.timeZone, Temporal.PlainTime.from({ hour: time.hour, minute: time.minute }));
  if (target === null) {
    return null;
  }
  const assumptions = ['Resolved day after tomorrow as two calendar days after the reference date.'];
  if (time.explicit) {
    assumptions.push(`Applied explicit clock time ${formatRequestedTime(time)}.`);
  } else {
    assumptions.push('Defaulted date-only expression to 12:00 PM local time.');
  }

  return createCandidate(target, time.explicit ? 'datetime' : 'date', assumptions, 'shift_math');
}

function ordinalWeekdayDate(
  year: number,
  month: number,
  weekday: Weekday,
  ordinal: string,
  dayShift: string | undefined,
): Temporal.PlainDate | null {
  const targetDay = ordinal === 'last'
    ? lastWeekdayOfMonth(year, month, weekday)
    : nthWeekdayOfMonth(year, month, weekday, ORDINAL_INDEX[ordinal] ?? 0);
  if (targetDay === null) {
    return null;
  }

  let targetDate = Temporal.PlainDate.from({ year, month, day: targetDay });
  if (dayShift === 'after') {
    targetDate = targetDate.add({ days: 1 });
  } else if (dayShift === 'before') {
    targetDate = targetDate.subtract({ days: 1 });
  }
  return targetDate;
}

function ordinalWeekdayTargetMonth(
  reference: Temporal.ZonedDateTime,
  relativeMonth: string | undefined,
  monthName: string | undefined,
  yearText: string | undefined,
): { year: number; month: number; explicitYear: boolean } | null {
  if (relativeMonth !== undefined) {
    const targetMonth = reference.toPlainDate().with({ day: 1 }).add({ months: relativeMonth === 'next' ? 1 : 0 });
    return { year: targetMonth.year, month: targetMonth.month, explicitYear: false };
  }

  const month = monthName === undefined ? undefined : MONTH_INDEX[monthName];
  if (month === undefined) {
    return null;
  }
  const explicitYear = yearText !== undefined;
  const year = explicitYear ? Number(yearText) : reference.year;
  if (!Number.isInteger(year) || year < 1) {
    return null;
  }
  return { year, month, explicitYear };
}

type BoundarySnapMode = 'ceil' | 'ceil_strict' | 'floor' | 'floor_strict' | 'nearest';

interface BoundarySnapSpec {
  boundaryMinutes: number;
  mode: BoundarySnapMode;
  label: string;
}

function parseBoundarySnap(text: string, calendarContext: CalendarContext): Candidate | null {
  const reference = referenceZdt(calendarContext);
  if (HOUR_AFTER_NEXT_PATTERN.test(text)) {
    const nextHour = snapZonedDateTime(reference, { boundaryMinutes: 60, mode: 'ceil_strict', label: 'next whole-hour boundary' });
    const target = nextHour.add({ hours: 1 });
    return createCandidate(
      target,
      'datetime',
      ['Resolved hour after next as the whole-hour boundary after the next whole-hour boundary.'],
      'shift_math',
    );
  }

  const relativeMatch = RELATIVE_BOUNDARY_SNAP_PATTERN.exec(text);
  const relativeGroups = relativeMatch?.groups;
  if (relativeGroups) {
    const amount = relativeGroups['amount'] === undefined ? null : numberFromText(relativeGroups['amount']);
    const duration = amount === null || relativeGroups['unit'] === undefined
      ? null
      : relativeBoundaryDuration(relativeGroups['unit'], relativeGroups['direction']?.toLowerCase() === 'ago' ? -amount : amount);
    const snapSpec = boundarySnapSpecFromGroups(relativeGroups);
    if (duration === null || snapSpec === null) {
      return null;
    }

    const shifted = reference.add(duration);
    const target = snapZonedDateTime(shifted, snapSpec);
    return createCandidate(
      target,
      'datetime',
      [
        'Applied timezone-aware duration shift before boundary snap.',
        `Snapped shifted time to ${snapSpec.label}.`,
      ],
      'shift_math',
    );
  }

  const directMatch = DIRECT_BOUNDARY_SNAP_PATTERN.exec(text);
  const directGroups = directMatch?.groups;
  if (!directGroups) {
    return null;
  }

  const snapSpec = boundarySnapSpecFromGroups(directGroups);
  if (snapSpec === null) {
    return null;
  }

  return createCandidate(
    snapZonedDateTime(reference, snapSpec),
    'datetime',
    [`Snapped reference time to ${snapSpec.label}.`],
    'shift_math',
  );
}

function relativeBoundaryDuration(unitText: string, amount: number): Temporal.DurationLike | null {
  const unit = unitText.toLowerCase().replace(/s$/, '');
  switch (unit) {
    case 'minute':
      return { minutes: amount };
    case 'hour':
      return { hours: amount };
    case 'day':
      return { days: amount };
    case 'week':
      return { weeks: amount };
    case 'month':
      return { months: amount };
    case 'year':
      return { years: amount };
    default:
      return null;
  }
}

function boundarySnapSpecFromGroups(groups: Record<string, string | undefined>): BoundarySnapSpec | null {
  if (groups['onBoundary'] !== undefined) {
    return { boundaryMinutes: 60, mode: 'ceil', label: 'the hour' };
  }
  if (groups['onQuarter'] !== undefined) {
    return { boundaryMinutes: 15, mode: 'ceil', label: 'the next quarter hour' };
  }
  if (groups['onHalf'] !== undefined) {
    return { boundaryMinutes: 30, mode: 'ceil', label: 'the next half hour' };
  }

  const roundBoundary = groups['roundBoundary'];
  const roundMode = groups['roundMode']?.toLowerCase();
  if (roundBoundary !== undefined && roundMode !== undefined) {
    const boundaryMinutes = boundaryMinutesFromText(roundBoundary);
    const mode = snapModeFromText(roundMode);
    if (boundaryMinutes === null || mode === null) {
      return null;
    }
    return { boundaryMinutes, mode, label: `${roundMode} ${boundaryLabel(boundaryMinutes)}` };
  }

  const directBoundary = groups['directBoundary'];
  const directMode = groups['directMode']?.toLowerCase();
  if (directBoundary !== undefined && directMode !== undefined) {
    const boundaryMinutes = boundaryMinutesFromText(directBoundary);
    if (boundaryMinutes === null) {
      return null;
    }
    const mode = directMode === 'previous' ? 'floor_strict' : 'ceil_strict';
    return { boundaryMinutes, mode, label: `${directMode} ${boundaryLabel(boundaryMinutes)}` };
  }

  return null;
}

function snapModeFromText(mode: string): BoundarySnapMode | null {
  switch (mode) {
    case 'nearest':
      return 'nearest';
    case 'next':
      return 'ceil_strict';
    case 'previous':
      return 'floor_strict';
    default:
      return null;
  }
}

function boundaryMinutesFromText(text: string): number | null {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalized === 'hour') {
    return 60;
  }
  if (normalized === 'half hour') {
    return 30;
  }
  if (normalized === 'quarter hour' || /^15 minutes?$/.test(normalized)) {
    return 15;
  }
  return null;
}

function boundaryLabel(boundaryMinutes: number): string {
  switch (boundaryMinutes) {
    case 60:
      return 'hour';
    case 30:
      return 'half hour';
    case 15:
      return 'quarter hour';
    default:
      return `${boundaryMinutes}-minute boundary`;
  }
}

function snapZonedDateTime(zonedDateTime: Temporal.ZonedDateTime, spec: BoundarySnapSpec): Temporal.ZonedDateTime {
  const floor = floorZonedDateTimeToBoundary(zonedDateTime, spec.boundaryMinutes);
  const isExact = Temporal.Instant.compare(zonedDateTime.toInstant(), floor.toInstant()) === 0;

  if (spec.mode === 'floor') {
    return floor;
  }
  if (spec.mode === 'floor_strict') {
    return isExact ? floor.subtract({ minutes: spec.boundaryMinutes }) : floor;
  }

  const next = isExact ? floor.add({ minutes: spec.boundaryMinutes }) : floor.add({ minutes: spec.boundaryMinutes });
  if (spec.mode === 'ceil') {
    return isExact ? floor : next;
  }
  if (spec.mode === 'ceil_strict') {
    return next;
  }

  const previousDistanceMs = Number(zonedDateTime.epochMilliseconds) - Number(floor.epochMilliseconds);
  const nextDistanceMs = Number(next.epochMilliseconds) - Number(zonedDateTime.epochMilliseconds);
  return nextDistanceMs <= previousDistanceMs ? next : floor;
}

function floorZonedDateTimeToBoundary(zonedDateTime: Temporal.ZonedDateTime, boundaryMinutes: number): Temporal.ZonedDateTime {
  const totalMinutes = zonedDateTime.hour * 60 + zonedDateTime.minute;
  const floorTotalMinutes = Math.floor(totalMinutes / boundaryMinutes) * boundaryMinutes;
  return zonedDateTime.with({
    hour: Math.floor(floorTotalMinutes / 60),
    minute: floorTotalMinutes % 60,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });
}

function nthWeekdayOfMonth(year: number, month: number, weekday: Weekday, ordinal: number): number | null {
  if (ordinal < 1) {
    return null;
  }
  const firstOfMonth = Temporal.PlainDate.from({ year, month, day: 1 });
  const delta = (WEEKDAY_LOOKUP[weekday] - firstOfMonth.dayOfWeek + 7) % 7;
  const day = 1 + delta + (ordinal - 1) * 7;
  return day <= firstOfMonth.daysInMonth ? day : null;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: Weekday): number {
  const firstOfMonth = Temporal.PlainDate.from({ year, month, day: 1 });
  const lastOfMonth = firstOfMonth.with({ day: firstOfMonth.daysInMonth });
  const delta = (lastOfMonth.dayOfWeek - WEEKDAY_LOOKUP[weekday] + 7) % 7;
  return lastOfMonth.subtract({ days: delta }).day;
}

function parseMonthBoundary(text: string, calendarContext: CalendarContext): Candidate | null {
  const match = FIRST_OF_MONTH_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const reference = referenceZdt(calendarContext);
  const relativeMonth = match.groups?.['relativeMonth']?.toLowerCase();
  let targetDate = reference.toPlainDate().with({ day: 1 });
  if (relativeMonth === 'next') {
    targetDate = targetDate.add({ months: 1 });
  } else if (relativeMonth === 'last') {
    targetDate = targetDate.subtract({ months: 1 });
  }
  let target = zonedDateTimeFromPlain(targetDate, calendarContext.timeZone, Temporal.PlainTime.from('12:00'));
  if (target === null) {
    return null;
  }
  if (relativeMonth === undefined && Temporal.Instant.compare(target.toInstant(), reference.toInstant()) <= 0) {
    targetDate = targetDate.add({ months: 1 });
    target = zonedDateTimeFromPlain(targetDate, calendarContext.timeZone, Temporal.PlainTime.from('12:00'));
    if (target === null) {
      return null;
    }
  }

  return createCandidate(
    target,
    'date',
    [relativeMonth === undefined
      ? 'Resolved first of the month to the next first-of-month at 12:00 PM local time.'
      : `Resolved first of ${relativeMonth} month at 12:00 PM local time.`],
    'shift_math',
  );
}

function parseWithChrono(text: string, calendarContext: CalendarContext): Candidate | null {
  const reference = referenceZdt(calendarContext);
  const referenceDate = chronoReferenceDate(reference);
  const results = chrono.parse(text, referenceDate, { forwardDate: true });
  const first = results[0];
  if (!first) {
    return null;
  }

  const start = first.start;
  if (isPartialChronoParse(text, first.text, start)) {
    return null;
  }

  const year = start.get('year');
  const month = start.get('month');
  const day = start.get('day');
  if (!year || !month || !day) {
    return null;
  }

  const time = chronoTimeFields(start, text);
  const zonedDateTime = zonedDateTimeFromPlain(
    Temporal.PlainDate.from({ year, month, day }),
    calendarContext.timeZone,
    Temporal.PlainTime.from({ hour: time.hour, minute: time.minute, second: time.second, millisecond: time.millisecond }),
  );
  if (zonedDateTime === null) {
    return null;
  }
  const assumptions = ['Parsed with chrono-node using user calendar context.'];
  if (!time.hasTime) {
    assumptions.push('Defaulted date-only expression to 12:00 PM local time.');
  }

  return createCandidate(zonedDateTime, time.hasTime ? 'datetime' : 'date', assumptions, 'chrono');
}

function chronoContextFromText(text: string, calendarContext: CalendarContext): TemporalAgentContext['chrono'] {
  const reference = referenceZdt(calendarContext);
  const first = chrono.parse(text, chronoReferenceDate(reference), { forwardDate: true })[0];
  if (!first) {
    return { status: 'no_match' };
  }

  const context: TemporalAgentContext['chrono'] = {
    status: 'matched',
    matchedText: first.text,
    index: first.index,
    coverage: {
      matchedChars: first.text.length,
      inputChars: text.trim().length,
    },
  };
  const unparsedText = removeParsedText(text, first.text).replace(/\s+/g, ' ').trim();
  if (unparsedText.length > 0) {
    context.unparsedText = unparsedText;
  }
  const candidate = chronoCandidateContext(first.start, text, calendarContext);
  if (candidate) {
    context.candidate = candidate;
  }

  return context;
}

function chronoCandidateContext(
  start: chrono.ParsedComponents,
  originalText: string,
  calendarContext: CalendarContext,
): TemporalChronoCandidateContext | null {
  const year = start.get('year');
  const month = start.get('month');
  const day = start.get('day');
  if (!year || !month || !day) {
    return null;
  }

  const time = chronoTimeFields(start, originalText);
  const zonedDateTime = zonedDateTimeFromPlain(
    Temporal.PlainDate.from({ year, month, day }),
    calendarContext.timeZone,
    Temporal.PlainTime.from({ hour: time.hour, minute: time.minute, second: time.second, millisecond: time.millisecond }),
  );
  if (zonedDateTime === null) {
    return null;
  }
  return {
    isoInstant: zonedDateTime.toInstant().toString(),
    zonedDateTime: zonedDateTime.toString(),
    timeZone: zonedDateTime.timeZoneId,
    precision: time.hasTime ? 'datetime' : 'date',
  };
}

function chronoTimeFields(start: chrono.ParsedComponents, originalText: string): {
  hasTime: boolean;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
} {
  const requestedTime = extractTimeOfDay(originalText);
  const hasTime = start.isCertain('hour') || requestedTime.explicit;
  if (!hasTime) {
    return { hasTime, hour: 12, minute: 0, second: 0, millisecond: 0 };
  }

  return {
    hasTime,
    hour: start.isCertain('hour') ? start.get('hour') ?? requestedTime.hour : requestedTime.hour,
    minute: start.isCertain('minute') ? start.get('minute') ?? 0 : requestedTime.minute,
    second: start.isCertain('second') ? start.get('second') ?? 0 : 0,
    millisecond: start.isCertain('millisecond') ? start.get('millisecond') ?? 0 : 0,
  };
}

function chronoReferenceDate(reference: Temporal.ZonedDateTime): Date {
  return new Date(
    reference.year,
    reference.month - 1,
    reference.day,
    reference.hour,
    reference.minute,
    reference.second,
    reference.millisecond,
  );
}

function getBaseZonedDateTime(input: ShiftDateTimeInput | SetClockTimeInput): Temporal.ZonedDateTime {
  if ('isoInstant' in input.base) {
    return Temporal.Instant.from(input.base.isoInstant).toZonedDateTimeISO(input.calendarContext.timeZone);
  }

  if ('plainDate' in input.base) {
    return requireZonedDateTimeFromPlain(Temporal.PlainDate.from(input.base.plainDate), input.base.timeZone, Temporal.PlainTime.from('12:00'));
  }

  return Temporal.ZonedDateTime.from(input.base.zonedDateTime);
}

function zonedDateTimeFromPlain(date: Temporal.PlainDate, timeZone: string, plainTime: Temporal.PlainTime): Temporal.ZonedDateTime | null {
  try {
    return date.toPlainDateTime(plainTime).toZonedDateTime(timeZone, { disambiguation: 'reject' });
  } catch {
    return null;
  }
}

function requireZonedDateTimeFromPlain(date: Temporal.PlainDate, timeZone: string, plainTime: Temporal.PlainTime): Temporal.ZonedDateTime {
  const zonedDateTime = zonedDateTimeFromPlain(date, timeZone, plainTime);
  if (zonedDateTime === null) {
    throw new Error(`Local time ${date.toString()} ${plainTime.toString({ smallestUnit: 'minute' })} is invalid or ambiguous in ${timeZone}.`);
  }
  return zonedDateTime;
}

function referenceZdt(calendarContext: CalendarContext): Temporal.ZonedDateTime {
  return Temporal.Instant.from(calendarContext.referenceInstant).toZonedDateTimeISO(calendarContext.timeZone);
}

function resolveHolidayFromText(text: string, calendarContext: CalendarContext): { name: string; isoDate: string; country: string } | null {
  const query = holidayQuery(text);
  if (!query) {
    return null;
  }

  const reference = referenceZdt(calendarContext);
  const time = extractTimeOfDay(text);
  const explicitYear = extractExplicitYear(text);
  return resolveHolidayByName({ holidayName: query, year: explicitYear, time, calendarContext, reference });
}

function resolveHolidayByName(input: {
  holidayName: string;
  year: number | null;
  time: { hour: number; minute: number; explicit: boolean };
  calendarContext: CalendarContext;
  reference?: Temporal.ZonedDateTime;
}): { name: string; isoDate: string; country: string } | null {
  return findHolidayMatches(input)[0] ?? null;
}

function holidayHintsFromText(text: string, calendarContext: CalendarContext): TemporalHolidayHint[] {
  const query = holidayQuery(text);
  if (!query) {
    return [];
  }

  const matches = findHolidayMatches({
    holidayName: query,
    year: extractExplicitYear(text),
    time: { hour: 12, minute: 0, explicit: false },
    calendarContext,
  });

  return matches.slice(0, 5).map((match) => ({
    name: match.name,
    isoDate: match.isoDate,
    country: match.country,
    source: 'date-holidays',
  }));
}

function findHolidayMatches(input: {
  holidayName: string;
  year: number | null;
  time: { hour: number; minute: number; explicit: boolean };
  calendarContext: CalendarContext;
  reference?: Temporal.ZonedDateTime;
}): HolidayMatch[] {
  const query = normalizeHolidayText(input.holidayName);
  if (query.length < 3) {
    return [];
  }

  const reference = input.reference ?? referenceZdt(input.calendarContext);
  const country = holidayCountryFromContext(input.calendarContext);
  if (country === null) {
    return [];
  }
  const holidays = new Holidays(country, {
    timezone: input.calendarContext.timeZone,
    types: HOLIDAY_TYPES,
    languages: input.calendarContext.locale?.slice(0, 2) ?? 'en',
  });
  const years = input.year === null ? [reference.year, reference.year + 1] : [input.year];
  return years
    .flatMap((year) => holidays.getHolidays(year, 'en'))
    .filter((holiday) => holidayNameMatches(query, holiday.name))
    .map((holiday) => {
      const isoDate = holiday.date.slice(0, 10);
      const zonedDateTime = zonedDateTimeFromPlain(
        Temporal.PlainDate.from(isoDate),
        input.calendarContext.timeZone,
        Temporal.PlainTime.from({ hour: input.time.hour, minute: input.time.minute }),
      );
      if (zonedDateTime === null) {
        return null;
      }
      return { name: holiday.name, isoDate, instant: zonedDateTime.toInstant(), country };
    })
    .filter((holiday): holiday is HolidayMatch => holiday !== null)
    .filter((holiday) => input.year !== null || Temporal.Instant.compare(holiday.instant, reference.toInstant()) > 0)
    .sort((a, b) => Temporal.Instant.compare(a.instant, b.instant));
}

function holidayQuery(text: string): string | null {
  const withoutTimes = text
    .replace(TWELVE_HOUR_TIME_PATTERN, ' ')
    .replace(TWENTY_FOUR_HOUR_TIME_PATTERN, ' ')
    .replace(/\b\d{4}\b/g, ' ')
    .replace(/\b(?:midnight|noon|morning|afternoon|evening|tonight)\b/gi, ' ')
    .replace(/\b(?:at|on|the|a|an|this|next|last|coming|upcoming)\b/gi, ' ');
  const normalized = normalizeHolidayText(withoutTimes);
  if (isWeekday(normalized)) {
    return null;
  }
  return normalized.length >= 3 ? normalized : null;
}

function extractExplicitYear(text: string): number | null {
  const match = /\b(\d{4})\b/.exec(text);
  if (!match?.[1]) {
    return null;
  }

  const year = Number(match[1]);
  return year >= 1900 && year <= 2200 ? year : null;
}

function holidayNameMatches(query: string, holidayName: string): boolean {
  const normalizedName = normalizeHolidayText(holidayName);
  if (normalizedName.includes(query)) {
    return true;
  }

  const queryWords = query.split(' ').filter(Boolean);
  return queryWords.length > 0 && queryWords.every((word) => normalizedName.includes(word));
}

function normalizeHolidayText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function holidayCountryFromContext(calendarContext: CalendarContext): string | null {
  const explicitCountry = normalizeCountryCode(calendarContext.country);
  if (explicitCountry !== null && supportedHolidayCountries().has(explicitCountry)) {
    return explicitCountry;
  }

  const localeCountry = countryFromLocale(calendarContext.locale);
  if (localeCountry !== null && countryHasTimeZone(localeCountry, calendarContext.timeZone)) {
    return localeCountry;
  }

  return countryFromTimeZone(calendarContext.timeZone);
}

function countryFromTimeZone(timeZone: string): string | null {
  const cached = timeZoneCountryCache.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }

  const matches = [...supportedHolidayCountries()].filter((country) => countryHasTimeZone(country, timeZone));
  const country = matches.length === 1 ? matches[0]! : null;
  timeZoneCountryCache.set(timeZone, country);
  return country;
}

function countryHasTimeZone(country: string, timeZone: string): boolean {
  try {
    const zones = new Holidays(country).getTimezones();
    return candidateHolidayTimeZones(timeZone).some((candidate) => zones.includes(candidate));
  } catch {
    return false;
  }
}

function candidateHolidayTimeZones(timeZone: string): string[] {
  const alias = IANA_TIME_ZONE_ALIASES[timeZone];
  return alias === undefined || alias === timeZone ? [timeZone] : [timeZone, alias];
}

function supportedHolidayCountries(): Set<string> {
  if (supportedHolidayCountryCache === undefined) {
    supportedHolidayCountryCache = new Set(Object.keys(new Holidays().getCountries('en')));
  }
  return supportedHolidayCountryCache;
}

function countryFromLocale(locale: string | undefined): string | null {
  if (locale === undefined) {
    return null;
  }

  const parts = locale.split(/[-_]/);
  for (const part of parts.slice(1)) {
    const country = normalizeCountryCode(part);
    if (country !== null && supportedHolidayCountries().has(country)) {
      return country;
    }
  }

  return null;
}

function normalizeCountryCode(country: string | undefined): string | null {
  if (country === undefined) {
    return null;
  }

  const normalized = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function extractTimeOfDay(text: string): { hour: number; minute: number; explicit: boolean } {
  const resolved = resolveClockTimeCandidates(text)[0];
  if (resolved) {
    return { hour: resolved.hour, minute: resolved.minute, explicit: true };
  }

  return { hour: 12, minute: 0, explicit: false };
}

function formatRequestedTime(time: { hour: number; minute: number }): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

function isDefaultDateOnlyNoon(zonedDateTime: Temporal.ZonedDateTime): boolean {
  return zonedDateTime.hour === 12
    && zonedDateTime.minute === 0
    && zonedDateTime.second === 0
    && zonedDateTime.millisecond === 0
    && zonedDateTime.microsecond === 0
    && zonedDateTime.nanosecond === 0;
}

function resolveClockTimeCandidates(text: string): ResolveClockTimeOutput['candidates'] {
  const candidates = new Map<string, ResolveClockTimeOutput['candidates'][number]>();
  const addCandidate = (candidate: ResolveClockTimeOutput['candidates'][number]) => {
    const key = `${candidate.hour}:${candidate.minute}`;
    const existing = candidates.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      candidates.set(key, candidate);
    }
  };

  if (/\bmidnight\b/i.test(text)) {
    addCandidate({ hour: 0, minute: 0, normalized: '00:00', assumptions: ['Interpreted midnight as 00:00.'], confidence: 0.95 });
  }
  if (/\bnoon\b/i.test(text)) {
    addCandidate({ hour: 12, minute: 0, normalized: '12:00', assumptions: ['Interpreted noon as 12:00.'], confidence: 0.95 });
  }

  const relativeNoon = RELATIVE_NOON_TIME_PATTERN.exec(text);
  if (relativeNoon?.groups) {
    const hours = relativeNoon.groups['hours'] === undefined ? 0 : numberFromText(relativeNoon.groups['hours']);
    const minutes = relativeNoon.groups['minutes'] === undefined ? 0 : numberFromText(relativeNoon.groups['minutes']);
    if (hours !== null && minutes !== null && hours >= 0 && minutes >= 0 && minutes < 60) {
      const totalMinutes = 12 * 60 + hours * 60 + minutes;
      const hour = Math.floor(totalMinutes / 60) % 24;
      const minute = totalMinutes % 60;
      addCandidate({ hour, minute, normalized: formatRequestedTime({ hour, minute }), assumptions: [`Interpreted ${relativeNoon[0]} relative to noon.`], confidence: 0.98 });
    }
  }

  const twelveHour = TWELVE_HOUR_TIME_PATTERN.exec(text);
  if (twelveHour?.[1] && twelveHour[3]) {
    const suffix = twelveHour[3].toLowerCase();
    let hour = Number(twelveHour[1]) % 12;
    if (suffix === 'pm') {
      hour += 12;
    }
    const minute = Number(twelveHour[2] ?? 0);
    addCandidate({ hour, minute, normalized: formatRequestedTime({ hour, minute }), assumptions: [`Interpreted ${twelveHour[0]} as a 12-hour clock time.`], confidence: 0.95 });
  }

  const compactMeridiem = COMPACT_MERIDIEM_TIME_PATTERN.exec(text);
  if (compactMeridiem?.[1] && compactMeridiem[3]) {
    const suffix = compactMeridiem[3].toLowerCase();
    let hour = Number(compactMeridiem[1]) % 12;
    if (suffix === 'p') {
      hour += 12;
    }
    const minute = Number(compactMeridiem[2] ?? 0);
    addCandidate({ hour, minute, normalized: formatRequestedTime({ hour, minute }), assumptions: [`Interpreted ${compactMeridiem[0]} as compact AM/PM clock time.`], confidence: 0.94 });
  }

  const twentyFourHour = TWENTY_FOUR_HOUR_TIME_PATTERN.exec(text);
  if (twentyFourHour?.[1] && twentyFourHour[2]) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    addCandidate({ hour, minute, normalized: formatRequestedTime({ hour, minute }), assumptions: [`Interpreted ${twentyFourHour[0]} as a 24-hour clock time.`], confidence: 0.95 });
  }

  return [...candidates.values()].sort((a, b) => b.confidence - a.confidence);
}

function numberFromText(text: string): number | null {
  const normalized = text.toLowerCase().trim().replace(/-/g, ' ').replace(/\s+/g, ' ');
  if (/^\d{1,2}$/.test(normalized)) {
    return Number(normalized);
  }

  const direct = NUMBER_WORDS[normalized];
  if (direct !== undefined) {
    return direct;
  }

  const [tensWord, onesWord] = normalized.split(' ');
  const tens = tensWord === undefined ? undefined : NUMBER_WORDS[tensWord];
  const ones = onesWord === undefined ? undefined : NUMBER_WORDS[onesWord];
  if (tens !== undefined && tens >= 20 && ones !== undefined && ones > 0 && ones < 10) {
    return tens + ones;
  }

  return null;
}

function isPartialChronoParse(text: string, parsedText: string, start: chrono.ParsedComponents): boolean {
  if (isOnlyTimeWithExtraWords(text, parsedText, start)) {
    return true;
  }

  if (hasTrailingBareNumericTimeSignal(text)) {
    return true;
  }

  const remainder = removeParsedText(text, parsedText)
    .replace(/\b(?:please|pls|for|me|us|remind|reminder|meeting|event|schedule|set)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return TEMPORAL_SIGNAL_PATTERN.test(remainder);
}

function hasTrailingBareNumericTimeSignal(text: string): boolean {
  const trimmed = text.trim();
  if (/\b(?:UTC|GMT)\s*[+-]\s*\d{1,2}(?::?[0-5]\d)?\s*$/i.test(trimmed) || /(?:^|\s)[+-]\d{2}(?::?[0-5]\d)\s*$/i.test(trimmed)) {
    return false;
  }
  if (/\b(?:[01]?\d|2[0-3]):[0-5]\d\s*$/.test(trimmed)) {
    return false;
  }
  if (!/\b\d{1,2}\s*$/.test(trimmed)) {
    return false;
  }
  if (MONTH_DAY_AT_END_PATTERN.test(trimmed) || /\b\d{1,2}\/\d{1,2}\s*$/.test(trimmed)) {
    return false;
  }
  return DATE_SIGNAL_PATTERN.test(trimmed);
}

function hasAmbiguousBareMeridiemTimeSignal(text: string): boolean {
  return AMBIGUOUS_BARE_COLON_CLOCK_PATTERN.test(text)
    || AMBIGUOUS_BARE_COMPACT_CLOCK_PATTERN.test(text)
    || hasTrailingBareNumericTimeSignal(text);
}

function parseBareTwentyFourHour(text: string, calendarContext: CalendarContext): Candidate | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) {
    return null;
  }

  const hour = Number(trimmed);
  if (hour < 13 || hour > 23) {
    return null;
  }

  return parseWithChrono(`${String(hour).padStart(2, '0')}:00`, calendarContext);
}

function isOnlyTimeWithExtraWords(text: string, parsedText: string, start: chrono.ParsedComponents): boolean {
  const hasDateComponent = start.isCertain('day') || start.isCertain('weekday') || start.isCertain('month') || start.isCertain('year');
  if (hasDateComponent) {
    return false;
  }

  const remainder = removeParsedText(text, parsedText).replace(/\b(?:at|on|the|a|an)\b/gi, ' ').trim();
  return /[a-z]/i.test(remainder);
}

function removeParsedText(text: string, parsedText: string): string {
  const index = text.toLowerCase().indexOf(parsedText.toLowerCase());
  if (index < 0) {
    return text;
  }
  return `${text.slice(0, index)} ${text.slice(index + parsedText.length)}`;
}

function createCandidate(
  zonedDateTime: Temporal.ZonedDateTime,
  precision: TemporalPrecision,
  assumptions: string[],
  provenance: Candidate['provenance'],
): Candidate {
  return {
    id: `cand_${zonedDateTime.epochMilliseconds}_${provenance}_${nextCandidateIdSequence()}`,
    isoInstant: zonedDateTime.toInstant().toString(),
    zonedDateTime: zonedDateTime.toString(),
    timeZone: zonedDateTime.timeZoneId,
    precision,
    assumptions,
    provenance,
  };
}

function nextCandidateIdSequence(): number {
  candidateIdSequence = (candidateIdSequence + 1) % Number.MAX_SAFE_INTEGER;
  return candidateIdSequence;
}

function extractWeekday(text: string): Weekday | null {
  const match = WEEKDAY_PATTERN.exec(text);
  const weekday = match?.[2]?.toLowerCase() as Weekday | undefined;
  if (!weekday || !isWeekday(weekday)) {
    return null;
  }

  return weekday;
}

function isWeekday(value: string): value is Weekday {
  return Object.prototype.hasOwnProperty.call(WEEKDAY_LOOKUP, value);
}

function weekdayFromTemporal(dayOfWeek: number): Weekday {
  const weekday = WEEKDAY_NAMES[dayOfWeek];
  if (!weekday) {
    throw new Error(`Invalid Temporal dayOfWeek: ${dayOfWeek}`);
  }
  return weekday;
}

function suggestedFormatIndex(text: string, precision: TemporalPrecision): number {
  if (/\b(?:in|ago)\b|\bfrom\s+now\b/i.test(text)) {
    return 6;
  }
  if (precision === 'datetime' && extractWeekday(text) !== null) {
    return 5;
  }
  if (precision === 'date') {
    return 1;
  }
  if (precision === 'time') {
    return 2;
  }
  return 4;
}
