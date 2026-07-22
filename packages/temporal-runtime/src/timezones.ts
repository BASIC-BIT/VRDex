import { Temporal } from '@js-temporal/polyfill';
import type { CalendarContext, Candidate, TimeZoneResolutionCandidate, TimeZoneResolutionOutput } from './types';

type TimeZoneReference = {
  start: number;
  end: number;
  matchedText: string;
  candidates: TimeZoneResolutionCandidate[];
  note: string;
};

type NamedZoneRule = {
  pattern: RegExp;
  timeZone: string;
  label: string;
  assumption: string;
};

const OFFSET_ZONE_PATTERN = /\b(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?([0-5]\d))?\b/gi;
const STANDALONE_OFFSET_PATTERN = /(?:^|[\s(])([+-])(\d{2})(?::?([0-5]\d))(?=$|[\s),.;])/g;
const IANA_TIME_ZONE_PATTERN = /\b[A-Za-z]+\/[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)*\b/g;
const UTC_ZONE_PATTERN = /\b(?:UTC|GMT|Zulu)\b/gi;

const NAMED_ZONE_RULES: NamedZoneRule[] = [
  {
    pattern: /\b(?:eastern|east coast|new york|nyc|ny)\s+time\b/i,
    timeZone: 'America/New_York',
    label: 'Eastern time',
    assumption: 'Interpreted the timezone phrase as America/New_York and applied that zone\'s date-specific offset.',
  },
  {
    pattern: /\b(?:pacific|west coast|los angeles|la)\s+time\b/i,
    timeZone: 'America/Los_Angeles',
    label: 'Pacific time',
    assumption: 'Interpreted the timezone phrase as America/Los_Angeles and applied that zone\'s date-specific offset.',
  },
  {
    pattern: /\bmountain\s+time\b/i,
    timeZone: 'America/Denver',
    label: 'Mountain time',
    assumption: 'Interpreted the timezone phrase as America/Denver and applied that zone\'s date-specific offset.',
  },
  {
    pattern: /\bcentral\s+time\b/i,
    timeZone: 'America/Chicago',
    label: 'Central time',
    assumption: 'Interpreted the timezone phrase as America/Chicago and applied that zone\'s date-specific offset.',
  },
  {
    pattern: /\b(?:uk|u\.k\.|british|london)\s+time\b/i,
    timeZone: 'Europe/London',
    label: 'UK time',
    assumption: 'Interpreted the timezone phrase as Europe/London and applied that zone\'s date-specific offset.',
  },
  {
    pattern: /\b(?:japan|tokyo)\s+time\b/i,
    timeZone: 'Asia/Tokyo',
    label: 'Japan time',
    assumption: 'Interpreted the timezone phrase as Asia/Tokyo.',
  },
  {
    pattern: /\b(?:india|indian)\s+time\b/i,
    timeZone: 'Asia/Calcutta',
    label: 'India time',
    assumption: 'Interpreted the timezone phrase as Asia/Calcutta.',
  },
];

const UNIQUE_ABBREVIATIONS: Record<string, { timeZone: string; label: string; assumption: string }> = {
  ET: {
    timeZone: 'America/New_York',
    label: 'Eastern time',
    assumption: 'Interpreted ET as America/New_York and applied that zone\'s date-specific offset.',
  },
  EST: {
    timeZone: 'America/New_York',
    label: 'Eastern time',
    assumption: 'Interpreted EST as Eastern time in America/New_York; deterministic execution applies the event date\'s actual offset.',
  },
  EDT: {
    timeZone: 'America/New_York',
    label: 'Eastern time',
    assumption: 'Interpreted EDT as Eastern time in America/New_York; deterministic execution applies the event date\'s actual offset.',
  },
  PT: {
    timeZone: 'America/Los_Angeles',
    label: 'Pacific time',
    assumption: 'Interpreted PT as America/Los_Angeles and applied that zone\'s date-specific offset.',
  },
  PST: {
    timeZone: 'America/Los_Angeles',
    label: 'Pacific time',
    assumption: 'Interpreted PST as Pacific time in America/Los_Angeles; deterministic execution applies the event date\'s actual offset.',
  },
  PDT: {
    timeZone: 'America/Los_Angeles',
    label: 'Pacific time',
    assumption: 'Interpreted PDT as Pacific time in America/Los_Angeles; deterministic execution applies the event date\'s actual offset.',
  },
  MT: {
    timeZone: 'America/Denver',
    label: 'Mountain time',
    assumption: 'Interpreted MT as America/Denver and applied that zone\'s date-specific offset.',
  },
  MST: {
    timeZone: 'America/Denver',
    label: 'Mountain time',
    assumption: 'Interpreted MST as Mountain time in America/Denver; deterministic execution applies the event date\'s actual offset.',
  },
  MDT: {
    timeZone: 'America/Denver',
    label: 'Mountain time',
    assumption: 'Interpreted MDT as Mountain time in America/Denver; deterministic execution applies the event date\'s actual offset.',
  },
  CET: {
    timeZone: 'Europe/Paris',
    label: 'Central European time',
    assumption: 'Interpreted CET as Central European time in Europe/Paris; deterministic execution applies the event date\'s actual offset.',
  },
  CEST: {
    timeZone: 'Europe/Paris',
    label: 'Central European time',
    assumption: 'Interpreted CEST as Central European time in Europe/Paris; deterministic execution applies the event date\'s actual offset.',
  },
  JST: {
    timeZone: 'Asia/Tokyo',
    label: 'Japan Standard Time',
    assumption: 'Interpreted JST as Asia/Tokyo.',
  },
  AEST: {
    timeZone: 'Australia/Sydney',
    label: 'Australian Eastern time',
    assumption: 'Interpreted AEST as Australian Eastern time in Australia/Sydney; deterministic execution applies the event date\'s actual offset.',
  },
  AEDT: {
    timeZone: 'Australia/Sydney',
    label: 'Australian Eastern time',
    assumption: 'Interpreted AEDT as Australian Eastern time in Australia/Sydney; deterministic execution applies the event date\'s actual offset.',
  },
};

const AMBIGUOUS_ABBREVIATIONS: Record<string, Array<{ timeZone: string; label: string }>> = {
  CT: [
    { timeZone: 'America/Chicago', label: 'US Central time' },
    { timeZone: 'Asia/Shanghai', label: 'China time' },
  ],
  CST: [
    { timeZone: 'America/Chicago', label: 'US Central time' },
    { timeZone: 'Asia/Shanghai', label: 'China Standard Time' },
    { timeZone: 'America/Havana', label: 'Cuba Standard Time' },
  ],
  CDT: [
    { timeZone: 'America/Chicago', label: 'US Central time' },
    { timeZone: 'America/Havana', label: 'Cuba time' },
  ],
  IST: [
    { timeZone: 'Asia/Calcutta', label: 'India Standard Time' },
    { timeZone: 'Europe/Dublin', label: 'Irish Standard Time' },
    { timeZone: 'Asia/Jerusalem', label: 'Israel time' },
  ],
  BST: [
    { timeZone: 'Europe/London', label: 'British Summer Time' },
    { timeZone: 'Asia/Dhaka', label: 'Bangladesh Standard Time' },
  ],
};

const SEASONAL_ABBREVIATIONS = new Set(['EST', 'EDT', 'PST', 'PDT', 'MST', 'MDT', 'CET', 'CEST', 'AEST', 'AEDT']);
const VALIDATION_INSTANT = Temporal.Instant.from('2026-01-01T00:00:00Z');

export function resolveTimeZone(input: { text: string; calendarContext: CalendarContext }): TimeZoneResolutionOutput {
  const references = extractTimeZoneReferences(input.text);
  if (references.length === 0) {
    return { status: 'not_found', candidates: [], notes: ['No explicit timezone reference found.'] };
  }

  const candidates = uniqueTimeZoneCandidates(references.flatMap((reference) => reference.candidates));
  const ambiguousReference = references.find((reference) => reference.candidates.length > 1);
  if (ambiguousReference !== undefined) {
    return {
      status: 'ambiguous',
      candidates,
      notes: [`Timezone reference ${JSON.stringify(ambiguousReference.matchedText)} is ambiguous.`, ...references.map((reference) => reference.note)],
      clarificationQuestion: `Which timezone did you mean by ${ambiguousReference.matchedText}?`,
    };
  }

  const distinctZones = new Set(candidates.map((candidate) => candidate.timeZone));
  if (distinctZones.size > 1) {
    return {
      status: 'ambiguous',
      candidates,
      notes: ['Input contains multiple different timezone references.', ...references.map((reference) => reference.note)],
      clarificationQuestion: 'Which timezone should the timestamp use?',
    };
  }

  return {
    status: 'resolved',
    candidates,
    notes: references.map((reference) => reference.note),
  };
}

export function stripResolvedTimeZoneText(text: string, candidate: TimeZoneResolutionCandidate): string {
  const matchedText = candidate.matchedText.trim();
  if (matchedText.length === 0) {
    return text.trim();
  }
  const escaped = escapeRegExp(matchedText);
  return text
    .replace(new RegExp(String.raw`\s*(?:in|on|at|for)?\s*${escaped}\s*`, 'i'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function timeZoneValidationForCandidate(text: string, candidate: Candidate): { warnings: string[]; errors: string[]; ambiguity: string[] } {
  const resolution = resolveTimeZone({
    text,
    calendarContext: { referenceInstant: candidate.isoInstant, timeZone: candidate.timeZone },
  });
  if (resolution.status === 'not_found') {
    return { warnings: [], errors: [], ambiguity: [] };
  }
  if (resolution.status === 'ambiguous') {
    const message = resolution.clarificationQuestion ?? 'Input contains an ambiguous timezone reference.';
    return {
      warnings: [],
      errors: [message],
      ambiguity: [message],
    };
  }
  const resolved = resolution.candidates[0];
  if (resolution.status !== 'resolved' || resolved === undefined) {
    return { warnings: [], errors: ['Input contains an invalid timezone reference.'], ambiguity: [] };
  }

  const errors = resolved.timeZone === candidate.timeZone
    ? []
    : [`Input timezone resolved to ${resolved.timeZone}, but candidate uses ${candidate.timeZone}.`];
  const warnings = seasonalAbbreviationWarning(text, resolved, candidate);
  return { warnings, errors, ambiguity: [] };
}

function extractTimeZoneReferences(text: string): TimeZoneReference[] {
  const references: TimeZoneReference[] = [];
  addOffsetReferences(text, references);
  addIanaReferences(text, references);
  addUtcReferences(text, references);
  addNamedZoneReferences(text, references);
  addAbbreviationReferences(text, references);
  return references.sort((a, b) => a.start - b.start).filter((reference, index, sorted) => {
    return sorted.findIndex((other) => rangesOverlap(reference, other)) === index;
  });
}

function addOffsetReferences(text: string, references: TimeZoneReference[]): void {
  for (const match of text.matchAll(OFFSET_ZONE_PATTERN)) {
    const reference = offsetReferenceFromMatch(match, match.index ?? 0, match[0].length, 1, 2, 3);
    if (reference !== null) {
      references.push(reference);
    }
  }
  for (const match of text.matchAll(STANDALONE_OFFSET_PATTERN)) {
    const wholeMatch = match[0];
    const leading = /^\s|^\(/.test(wholeMatch) ? 1 : 0;
    const reference = offsetReferenceFromMatch(match, (match.index ?? 0) + leading, wholeMatch.length - leading, 1, 2, 3);
    if (reference !== null && !references.some((existing) => rangesOverlap(existing, reference))) {
      references.push(reference);
    }
  }
}

function offsetReferenceFromMatch(
  match: RegExpMatchArray,
  start: number,
  length: number,
  signIndex: number,
  hourIndex: number,
  minuteIndex: number,
): TimeZoneReference | null {
  const sign = match[signIndex];
  const hourText = match[hourIndex];
  if ((sign !== '+' && sign !== '-') || hourText === undefined) {
    return null;
  }
  const minuteText = match[minuteIndex] ?? '00';
  const offset = normalizeFixedOffset(sign, hourText, minuteText);
  if (offset === null) {
    return null;
  }
  const matchedText = match[0].slice(match[0].length - length).trim();
  return {
    start,
    end: start + matchedText.length,
    matchedText,
    candidates: [timeZoneCandidate({
      timeZone: offset.timeZone,
      label: `UTC${offset.timeZone}`,
      kind: 'fixed_offset',
      matchedText,
      confidence: 0.99,
      assumptions: [`Interpreted ${matchedText} as fixed offset ${offset.timeZone}.`],
      offsetMinutes: offset.offsetMinutes,
    })],
    note: `Resolved ${matchedText} to fixed offset ${offset.timeZone}.`,
  };
}

function addIanaReferences(text: string, references: TimeZoneReference[]): void {
  for (const match of text.matchAll(IANA_TIME_ZONE_PATTERN)) {
    const matchedText = match[0].replace(/[),.;]+$/g, '');
    const timeZone = canonicalTimeZoneId(matchedText);
    if (timeZone === null) {
      continue;
    }
    const start = match.index ?? 0;
    references.push({
      start,
      end: start + matchedText.length,
      matchedText,
      candidates: [timeZoneCandidate({
        timeZone,
        label: timeZone,
        kind: 'iana',
        matchedText,
        confidence: 1,
        assumptions: [`Used explicit IANA timezone ${timeZone}.`],
      })],
      note: `Resolved ${matchedText} to IANA timezone ${timeZone}.`,
    });
  }
}

function addUtcReferences(text: string, references: TimeZoneReference[]): void {
  for (const match of text.matchAll(UTC_ZONE_PATTERN)) {
    const matchedText = match[0];
    const start = match.index ?? 0;
    const candidateReference: TimeZoneReference = {
      start,
      end: start + matchedText.length,
      matchedText,
      candidates: [timeZoneCandidate({
        timeZone: 'UTC',
        label: 'UTC',
        kind: 'iana',
        matchedText,
        confidence: 0.99,
        assumptions: [`Interpreted ${matchedText} as UTC.`],
      })],
      note: `Resolved ${matchedText} to UTC.`,
    };
    if (!references.some((reference) => rangesOverlap(reference, candidateReference))) {
      references.push(candidateReference);
    }
  }
}

function addNamedZoneReferences(text: string, references: TimeZoneReference[]): void {
  for (const rule of NAMED_ZONE_RULES) {
    const match = rule.pattern.exec(text);
    if (match === null) {
      continue;
    }
    const matchedText = match[0];
    const start = match.index;
    references.push({
      start,
      end: start + matchedText.length,
      matchedText,
      candidates: [timeZoneCandidate({
        timeZone: rule.timeZone,
        label: rule.label,
        kind: 'iana',
        matchedText,
        confidence: 0.93,
        assumptions: [rule.assumption],
      })],
      note: `Resolved ${matchedText} to ${rule.timeZone}.`,
    });
  }
}

function addAbbreviationReferences(text: string, references: TimeZoneReference[]): void {
  const abbreviations = [...Object.keys(UNIQUE_ABBREVIATIONS), ...Object.keys(AMBIGUOUS_ABBREVIATIONS)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const pattern = new RegExp(String.raw`\b(${abbreviations})\b`, 'gi');
  for (const match of text.matchAll(pattern)) {
    const matchedText = match[1];
    if (matchedText === undefined) {
      continue;
    }
    const abbreviation = matchedText.toUpperCase();
    const start = match.index ?? 0;
    const end = start + matchedText.length;
    if (references.some((reference) => start >= reference.start && end <= reference.end)) {
      continue;
    }
    const ambiguous = AMBIGUOUS_ABBREVIATIONS[abbreviation];
    if (ambiguous !== undefined) {
      references.push({
        start,
        end,
        matchedText,
        candidates: ambiguous.map((entry) => timeZoneCandidate({
          timeZone: entry.timeZone,
          label: entry.label,
          kind: 'iana',
          matchedText,
          confidence: 0.55,
          assumptions: [`${abbreviation} can mean ${entry.label}; user clarification is required.`],
        })),
        note: `${abbreviation} is ambiguous across multiple timezones.`,
      });
      continue;
    }
    const unique = UNIQUE_ABBREVIATIONS[abbreviation];
    if (unique !== undefined) {
      references.push({
        start,
        end,
        matchedText,
        candidates: [timeZoneCandidate({
          timeZone: unique.timeZone,
          label: unique.label,
          kind: 'iana',
          matchedText,
          confidence: 0.9,
          assumptions: [unique.assumption],
        })],
        note: `Resolved ${abbreviation} to ${unique.timeZone}.`,
      });
    }
  }
}

function normalizeFixedOffset(sign: string, hourText: string, minuteText: string): { timeZone: string; offsetMinutes: number } | null {
  const hours = Number(hourText);
  const minutes = Number(minuteText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  const direction = sign === '-' ? -1 : 1;
  return {
    timeZone: `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    offsetMinutes: direction * (hours * 60 + minutes),
  };
}

function canonicalTimeZoneId(timeZone: string): string | null {
  try {
    return VALIDATION_INSTANT.toZonedDateTimeISO(timeZone).timeZoneId;
  } catch {
    return null;
  }
}

function timeZoneCandidate(params: TimeZoneResolutionCandidate): TimeZoneResolutionCandidate {
  if (params.offsetMinutes === undefined) {
    return {
      timeZone: params.timeZone,
      label: params.label,
      kind: params.kind,
      matchedText: params.matchedText,
      confidence: params.confidence,
      assumptions: params.assumptions,
    };
  }
  return params;
}

function uniqueTimeZoneCandidates(candidates: TimeZoneResolutionCandidate[]): TimeZoneResolutionCandidate[] {
  const byKey = new Map<string, TimeZoneResolutionCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.timeZone}:${candidate.label}`;
    const existing = byKey.get(key);
    if (existing === undefined || candidate.confidence > existing.confidence) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function seasonalAbbreviationWarning(text: string, resolved: TimeZoneResolutionCandidate, candidate: Candidate): string[] {
  const abbreviation = resolved.matchedText.toUpperCase();
  if (!SEASONAL_ABBREVIATIONS.has(abbreviation)) {
    return [];
  }
  const actual = shortTimeZoneName(candidate.isoInstant, candidate.timeZone);
  if (actual === null || actual.toUpperCase() === abbreviation || !new RegExp(String.raw`\b${escapeRegExp(abbreviation)}\b`, 'i').test(text)) {
    return [];
  }
  return [`Input said ${abbreviation}, but ${candidate.timeZone} is ${actual} at the candidate time; interpreted it as regional timezone intent rather than a fixed offset.`];
}

function shortTimeZoneName(isoInstant: string, timeZone: string): string | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      timeZone,
      timeZoneName: 'short',
    });
    return formatter.formatToParts(new Date(isoInstant)).find((part) => part.type === 'timeZoneName')?.value ?? null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
