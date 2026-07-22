export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type WeekdayQualifier = "bare" | "this" | "next" | "last";

export type TemporalPrecision = "date" | "time" | "datetime" | "relative";

export type TemporalMethod =
  | "deterministic"
  | "agent+plan"
  | "agent+tools"
  | "agent+tools+sandbox"
  | "agent+tools+web"
  | "fallback";

export type TemporalParseStatus = "resolved" | "ambiguous" | "needs_clarification" | "failed";

export type TemporalParseKind = "instant" | "time_range";

export interface CalendarContext {
  referenceInstant: string;
  timeZone: string;
  locale?: string;
  country?: string;
  subdivision?: string;
}

export interface Candidate {
  id: string;
  isoInstant: string;
  zonedDateTime: string;
  timeZone: string;
  precision: TemporalPrecision;
  assumptions: string[];
  provenance: "chrono" | "holiday_library" | "shift_math" | "sandbox" | "explicit";
}

export type TimeZoneResolutionStatus = "resolved" | "ambiguous" | "not_found" | "invalid";

export type TimeZoneResolutionKind = "iana" | "fixed_offset";

export interface TimeZoneResolutionCandidate {
  timeZone: string;
  label: string;
  kind: TimeZoneResolutionKind;
  matchedText: string;
  confidence: number;
  assumptions: string[];
  offsetMinutes?: number;
}

export interface TimeZoneResolutionOutput {
  status: TimeZoneResolutionStatus;
  candidates: TimeZoneResolutionCandidate[];
  notes: string[];
  clarificationQuestion?: string;
}

export interface CandidateFacts {
  weekday: Weekday;
  isoDate: string;
  isoInstant: string;
  dayOfWeek: number;
  weekOfYear?: number;
  month: number;
  year: number;
  timeZone: string;
}

export interface TemporalAgentContext {
  reference: {
    instant: string;
    timeZone: string;
    localDate: string;
    localTime: string;
    localWeekday: Weekday;
  };
  chrono: TemporalChronoContext;
  holidays: TemporalHolidayHint[];
}

export interface TemporalChronoContext {
  status: "matched" | "no_match";
  matchedText?: string;
  index?: number;
  coverage?: {
    matchedChars: number;
    inputChars: number;
  };
  unparsedText?: string;
  candidate?: TemporalChronoCandidateContext;
}

export interface TemporalChronoCandidateContext {
  isoInstant: string;
  zonedDateTime: string;
  timeZone: string;
  precision: TemporalPrecision;
}

export interface TemporalHolidayHint {
  name: string;
  isoDate: string;
  country: string;
  source: "date-holidays";
}

export interface CandidateFormat {
  style: "short" | "full" | "weekday-check" | "discord-preview";
  formatted: string;
}

export interface EnrichedCandidate {
  candidate: Candidate;
  facts?: CandidateFacts;
  formats: CandidateFormat[];
  validation?: TemporalValidation;
  finalizable: boolean;
}

export interface CandidateProposal {
  isoInstant: string;
  timeZone: string;
  precision: TemporalPrecision;
  assumptions: string[];
  rationale: string;
}

export interface TemporalValidation {
  passed: boolean;
  warnings: string[];
  checks: string[];
}

export interface TemporalAgentTraceStep {
  index: number;
  type: "llm" | "tool" | "final_validation" | "router";
  name: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
}

export interface TemporalFinalValidation {
  accepted: boolean;
  confidence: number;
  reason: string;
  missingOrContradictedSignals: string[];
}

export interface TemporalSemanticConsistencyGateResult {
  decision: "accept" | "reject" | "uncertain";
  confidence: number;
  reasonCodes: string[];
  explanation: string;
}

export interface TemporalFeatureFlags {
  deterministicPreflight?: boolean;
  ordinalWeekdayGrammar?: boolean;
  planIr?: boolean;
  semanticConsistencyGate?: boolean;
}

export type TemporalPlanIrInstructionPreset = 'detailed' | 'minimal';
export type TemporalPlanIrEndpointApi = 'completions' | 'chat';
export type TemporalPlanIrEndpointPromptFormat = 'custom' | 'chat';

export interface TemporalPlanIrEndpointConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  instructionPreset: TemporalPlanIrInstructionPreset;
  api: TemporalPlanIrEndpointApi;
  promptFormat: TemporalPlanIrEndpointPromptFormat;
  maxTokens: number;
  timeoutMs: number;
}

export interface TemporalParseRequest {
  text: string;
  calendarContext: CalendarContext;
}

export interface TemporalParseResponse {
  generationId?: string;
  kind?: TemporalParseKind;
  status: TemporalParseStatus;
  epoch?: number;
  suggestedFormatIndex?: number;
  range?: TemporalRangeResult;
  confidence: number;
  method: TemporalMethod;
  canonical?: {
    isoInstant: string;
    zonedDateTime: string;
    timeZone: string;
    precision: TemporalPrecision;
    weekday?: Weekday;
  };
  assumptions: string[];
  ambiguity: string[];
  validation: TemporalValidation;
  clarificationQuestion?: string;
  clarificationAlternatives?: TemporalClarificationAlternative[];
  debug?: {
    chosenCandidateId?: string;
    candidateCount?: number;
    agentAttempts?: number;
    toolPasses?: number;
    deterministicDurationMs?: number;
    ambiguityPolicyDurationMs?: number;
    agentDurationMs?: number;
    totalDurationMs?: number;
    firstLlmResponseMs?: number;
    firstCandidateMs?: number;
    finalResponseMs?: number;
    shortCircuitReason?: string;
    model?: string;
    reasoningEffort?: string;
    instructionPreset?: string;
    promptFormat?: string;
    featureFlags?: TemporalFeatureFlags;
    trace?: TemporalAgentTraceStep[];
    finalValidation?: TemporalFinalValidation;
    semanticConsistencyGate?: TemporalSemanticConsistencyGateResult;
    langfuseTraceId?: string;
  };
}

export interface TemporalRangeEndpoint {
  epoch: number;
  suggestedFormatIndex: number;
  canonical: {
    isoInstant: string;
    zonedDateTime: string;
    timeZone: string;
    precision: TemporalPrecision;
    weekday?: Weekday;
  };
}

export interface TemporalRangeResult {
  start: TemporalRangeEndpoint;
  end: TemporalRangeEndpoint;
  discord: string;
}

export interface TemporalClarificationAlternative {
  label: string;
  kind?: TemporalParseKind;
  epoch: number;
  suggestedFormatIndex: number;
  range?: TemporalRangeResult;
  confidence: number;
  method: TemporalMethod;
  canonical: {
    isoInstant: string;
    zonedDateTime: string;
    timeZone: string;
    precision: TemporalPrecision;
    weekday?: Weekday;
  };
  assumptions: string[];
}

export type AgentToolName =
  | "parse_expression"
  | "resolve_calendar_query"
  | "resolve_holiday"
  | "resolve_clock_time"
  | "resolve_timezone"
  | "shift_datetime"
  | "set_clock_time"
  | "propose_candidate"
  | "finalize_candidate"
  | "ask_clarification"
  | "sandbox_eval"
  | "web_lookup";

export interface AgentToolRequest {
  tool: AgentToolName;
  input: unknown;
}

export interface AgentDecision {
  action: "call_tools" | "propose_candidate" | "finalize_candidate" | "ask_clarification" | "fail";
  rationale: string;
  toolRequests?: AgentToolRequest[];
  candidateProposal?: CandidateProposal;
  selectedCandidateId?: string;
  clarificationQuestion?: string;
}
