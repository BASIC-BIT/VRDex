import type { CalendarContext, Candidate, CandidateFacts, CandidateProposal, TemporalFeatureFlags, TimeZoneResolutionOutput } from "./types";
import {
  candidateFacts,
  formatCandidate,
  parseExpression,
  resolveClockTime,
  resolveCalendarQuery,
  resolveHoliday,
  resolveTimeZone,
  shiftDateTime,
  setClockTime,
  validateCandidate,
} from "./deterministic";

export interface ParseExpressionInput {
  text: string;
  calendarContext: CalendarContext;
  features?: TemporalFeatureFlags;
}

export interface ParseExpressionOutput {
  candidates: Candidate[];
  parserNotes: string[];
}

export interface ResolveCalendarQueryInput {
  query: string;
  calendarContext: CalendarContext;
  features?: TemporalFeatureFlags;
}

export interface ResolveCalendarQueryOutput {
  candidates: Candidate[];
  source: "holiday_library" | "chrono" | "shift_math" | "sandbox" | "web" | "explicit";
  notes: string[];
}

export interface ResolveHolidayInput {
  holidayName: string;
  year?: number;
  time?: { hour: number; minute: number };
  calendarContext: CalendarContext;
}

export interface ResolveHolidayOutput {
  candidates: Candidate[];
  source: "holiday_library";
  notes: string[];
}

export interface ClockTimeCandidate {
  hour: number;
  minute: number;
  normalized: string;
  assumptions: string[];
  confidence: number;
}

export interface ResolveClockTimeInput {
  text: string;
  calendarContext: CalendarContext;
}

export interface ResolveClockTimeOutput {
  candidates: ClockTimeCandidate[];
  notes: string[];
}

export interface ResolveTimeZoneInput {
  text: string;
  calendarContext: CalendarContext;
}

export interface ResolveTimeZoneOutput extends TimeZoneResolutionOutput {}

export interface ShiftDateTimeInput {
  base: { isoInstant: string } | { plainDate: string; timeZone: string } | { zonedDateTime: string };
  delta: {
    years?: number;
    months?: number;
    weeks?: number;
    days?: number;
    hours?: number;
    minutes?: number;
  };
  time?: { hour: number; minute: number };
  calendarContext: CalendarContext;
}

export interface SetClockTimeInput {
  base: { isoInstant: string } | { plainDate: string; timeZone: string } | { zonedDateTime: string };
  time: { hour: number; minute: number };
  calendarContext: CalendarContext;
}

export interface FormatCandidateInput {
  candidate: Candidate;
  style: "short" | "full" | "weekday-check" | "discord-preview";
  calendarContext: CalendarContext;
}

export interface CandidateFactsInput {
  candidate: Candidate;
  calendarContext: CalendarContext;
}

export interface ValidateCandidateInput {
  originalText: string;
  candidate: Candidate;
  calendarContext: CalendarContext;
}

export interface ValidateCandidateOutput {
  passed: boolean;
  warnings: string[];
  errors: string[];
  ambiguity: string[];
  suggestedFormatIndex: number;
}

export interface ProposeCandidateInput extends CandidateProposal {}

export interface FinalizeCandidateInput {
  candidateId: string;
  rationale: string;
}

export interface TemporalToolImplementations {
  parseExpression(input: ParseExpressionInput): Promise<ParseExpressionOutput>;
  resolveCalendarQuery(input: ResolveCalendarQueryInput): Promise<ResolveCalendarQueryOutput>;
  resolveHoliday(input: ResolveHolidayInput): Promise<ResolveHolidayOutput>;
  resolveClockTime(input: ResolveClockTimeInput): Promise<ResolveClockTimeOutput>;
  resolveTimeZone(input: ResolveTimeZoneInput): Promise<ResolveTimeZoneOutput>;
  shiftDateTime(input: ShiftDateTimeInput): Promise<Candidate>;
  setClockTime(input: SetClockTimeInput): Promise<Candidate>;
  formatCandidate(input: FormatCandidateInput): Promise<string>;
  candidateFacts(input: CandidateFactsInput): Promise<CandidateFacts>;
  validateCandidate(input: ValidateCandidateInput): Promise<ValidateCandidateOutput>;
}

export const AGENT_FACING_TEMPORAL_TOOL_NAMES = [
  "parse_expression",
  "resolve_calendar_query",
  "resolve_holiday",
  "resolve_clock_time",
  "resolve_timezone",
  "shift_datetime",
  "set_clock_time",
  "propose_candidate",
  "finalize_candidate",
  "ask_clarification",
  "sandbox_eval",
  "web_lookup",
] as const;

export const INTERNAL_TEMPORAL_TOOL_NAMES = ["format_candidate", "candidate_facts", "validate_candidate"] as const;

export function createUnimplementedTemporalToolImplementations(): TemporalToolImplementations {
  return {
    async parseExpression(input) {
      void input;
      throw new Error("parseExpression is not implemented yet.");
    },
    async resolveCalendarQuery(input) {
      void input;
      throw new Error("resolveCalendarQuery is not implemented yet.");
    },
    async shiftDateTime(input) {
      void input;
      throw new Error("shiftDateTime is not implemented yet.");
    },
    async resolveHoliday(input) {
      void input;
      throw new Error("resolveHoliday is not implemented yet.");
    },
    async resolveClockTime(input) {
      void input;
      throw new Error("resolveClockTime is not implemented yet.");
    },
    async resolveTimeZone(input) {
      void input;
      throw new Error("resolveTimeZone is not implemented yet.");
    },
    async setClockTime(input) {
      void input;
      throw new Error("setClockTime is not implemented yet.");
    },
    async formatCandidate(input) {
      void input;
      throw new Error("formatCandidate is not implemented yet.");
    },
    async candidateFacts(input) {
      void input;
      throw new Error("candidateFacts is not implemented yet.");
    },
    async validateCandidate(input) {
      void input;
      throw new Error("validateCandidate is not implemented yet.");
    },
  };
}

export function createDeterministicTemporalToolImplementations(): TemporalToolImplementations {
  return {
    parseExpression,
    resolveCalendarQuery,
    resolveHoliday,
    resolveClockTime,
    resolveTimeZone,
    shiftDateTime,
    setClockTime,
    formatCandidate,
    candidateFacts,
    validateCandidate,
  };
}
