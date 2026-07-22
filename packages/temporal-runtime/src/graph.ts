import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { END, MessagesAnnotation, StateGraph, START } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { Temporal } from '@js-temporal/polyfill';
import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import type { AgentDecision, CalendarContext, Candidate, EnrichedCandidate, TemporalAgentContext, TemporalClarificationAlternative, TemporalAgentTraceStep, TemporalFeatureFlags, TemporalFinalValidation, TemporalMethod, TemporalParseRequest, TemporalParseResponse, TemporalPlanIrEndpointConfig, TemporalPlanIrInstructionPreset, TemporalRangeEndpoint, TemporalRangeResult, TemporalSemanticConsistencyGateResult, TemporalValidation, TimeZoneResolutionCandidate } from './types';
import type { TemporalToolImplementations } from './tools';
import { candidateFromProposal, candidateToEpoch, collectTemporalAgentContext } from './deterministic';
import { parseTemporalPlanPlannerOutput, PLAN_MONTH_NAMES, PLAN_WEEKDAYS, PLAN_WEEKDAY_INDEX, TemporalPlanPlannerSchema, TimeOfDaySchema, type RawTemporalPlanStep, type TemporalPlan, type TemporalPlanPlannerOutput, type TemporalPlanStep } from './plan-ir';

const DEFAULT_OPENAI_MODEL = 'gpt-5.5';
const DEFAULT_OPENAI_REASONING_EFFORT = 'low';
const ENDPOINT_PLAN_INSTRUCTION_PRESETS: Record<TemporalPlanIrInstructionPreset, string> = {
  detailed: 'Translate the temporal user input into compact Temporal Plan-IR JSON. Return JSON only. For time ranges, set plan kind=time_range with startStep and endStep candidate steps; the end must be after the start, so explicitly shift overnight end times. For explicit timezone text, emit resolve_timezone and reference it with timeZoneStep, or put an exact IANA/fixed-offset timezone string in timeZone. Use IANA/regional timezone intent for names like Eastern time, UK time, or Japan time; use fixed offsets only for explicit UTC/GMT offsets. For ambiguous abbreviations such as CST, IST, or BST, return clarification instead of choosing silently. For explicit 24-hour clock text like 13:37, preserve that clock text exactly; do not append am or pm. For Discord timestamps or bare 10/13/16/19 digit epoch-like numbers, pass the timestamp text to resolve_calendar_query. For negative or unsupported-length bare epoch-like numbers, return no_plan. For up to five repeated day-after modifiers before tomorrow, resolve tomorrow and emit one shift_datetime days delta equal to the repetition count; for longer chains return no_plan.',
  minimal: 'Translate the temporal user input into compact Temporal Plan-IR JSON. Return JSON only.',
};

export const DEFAULT_TEMPORAL_GRAPH_LIMITS = {
  maxAgentAttempts: 3,
  // Counts individual ToolMessages, not LLM round trips. Parallel tool calls
  // consume one budget unit per tool result.
  maxToolCalls: 20,
} as const;

const CalendarContextSchema = z.object({
  referenceInstant: z.string(),
  timeZone: z.string(),
  locale: z.string().optional(),
  country: z.string().optional(),
  subdivision: z.string().optional(),
});

const WEEKDAY_TEXT_PATTERN = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const TOP_LEVEL_NEXT_WEEKDAY_PATTERN = new RegExp(`^\\s*next\\s+(?:${PLAN_WEEKDAYS.join('|')})(?:\\b[\\s\\S]*)?$`, 'i');
const MONTH_DATE_QUERY_PATTERN = /\b(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/i;
const AM_PM_CLOCK_MENTION_PATTERN = /\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/gi;
const AMBIGUOUS_BARE_COLON_CLOCK_PATTERN = /(?<![\d.])\b(0?[1-9]|1[0-2])[:.]([0-5]\d)\b(?!\s*(?:[ap](?:\.?m)?\b|:))/gi;
const AMBIGUOUS_BARE_COMPACT_CLOCK_PATTERN = /\b(0?[1-9]|1[0-2])([0-5]\d)\b(?!\s*(?:[ap](?:\.?m)?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b)/gi;
const DISCORD_TIMESTAMP_FORMAT_CODES = [':d', ':D', ':t', ':T', ':f', ':F', ':R'] as const;
const DISCORD_TIMESTAMP_RANGE_PATTERN = /^\s*<t:(\d+)(:[tTdDfFR])?>\s*(?:-|–|—|\bto\b)\s*<t:(\d+)(:[tTdDfFR])?>\s*$/i;
const EXPLICIT_RANGE_CLOCK_PATTERN = String.raw`(?:(?:[01]?\d|2[0-3]):[0-5]\d|(?:0?[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|a|p))`;
const EXPLICIT_DATED_TIME_RANGE_PATTERN = new RegExp(String.raw`^\s*(?<dateText>.+?)\s+(?<startText>${EXPLICIT_RANGE_CLOCK_PATTERN})\s*(?:-|–|—|\bto\b|\buntil\b)\s*(?<endText>${EXPLICIT_RANGE_CLOCK_PATTERN})(?<suffixText>.*)$`, 'i');
const EXPLICIT_BARE_TIME_RANGE_PATTERN = new RegExp(String.raw`^\s*(?<startText>${EXPLICIT_RANGE_CLOCK_PATTERN})\s*(?:-|–|—|\bto\b|\buntil\b)\s*(?<endText>${EXPLICIT_RANGE_CLOCK_PATTERN})(?<suffixText>.*)$`, 'i');
const EXPLICIT_RANGE_DATE_SIGNAL_PATTERN = new RegExp(String.raw`\b(?:${MONTH_DATE_QUERY_PATTERN.source}|\d{4}-\d{2}-\d{2}|today|tomorrow|tonight|(?:${PLAN_WEEKDAYS.join('|')}))\b`, 'i');

const AgentBaseDateTimeSchema = z.union([
  z.object({ candidateId: z.string() }),
  z.object({ isoInstant: z.string() }),
  z.object({ plainDate: z.string(), timeZone: z.string() }),
  z.object({ zonedDateTime: z.string() }),
]);

const FinalValidationSchema = z.object({
  accepted: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  missingOrContradictedSignals: z.array(z.string()).default([]),
});

const SemanticConsistencyGateSchema = z.object({
  decision: z.enum(['accept', 'reject', 'uncertain']),
  confidence: z.number().min(0).max(1),
  reasonCodes: z.array(z.string()).default([]),
  explanation: z.string(),
});

type LangfuseHandler = BaseCallbackHandler & { last_trace_id: string | null };
type RawTemporalPlan = {
  kind?: 'instant' | 'time_range' | undefined;
  label: string;
  rationale: string;
  assumptions?: string[] | undefined;
  confidence?: number | undefined;
  finalStep?: number | null | undefined;
  startStep?: number | null | undefined;
  endStep?: number | null | undefined;
  steps: RawTemporalPlanStep[];
};
type TemporalPlanStepOutput =
  | { kind: 'candidates'; candidates: PlanCandidateOutput[] }
  | { kind: 'time'; time: { hour: number; minute: number } }
  | { kind: 'timezone'; timeZone: TimeZoneResolutionCandidate };
type PlanCandidateOutput = { candidate: Candidate; label?: string | undefined };
type PlanCandidateResult = { enriched: EnrichedCandidate; label?: string | undefined };
type PlanRangeResult = {
  start: PlanCandidateResult;
  end: PlanCandidateResult;
  label?: string | undefined;
  validation: TemporalValidation;
  finalizable: boolean;
};
type UnindexedTraceStep = Omit<TemporalAgentTraceStep, 'index'>;
type AmbiguityPolicyResult = {
  name: string;
  question: string;
  alternatives: TemporalClarificationAlternative[];
};
type AmbiguousBareClockMention = {
  text: string;
  index: number;
  hour: number;
  minute: number;
  replacementBase: string;
};
type ExplicitDiscordTimestampRangeParts = {
  startEpochSeconds: string;
  startFormatCode: string;
  endEpochSeconds: string;
  endFormatCode: string;
};
type ExplicitClockMention = { text: string; index: number; label: string; time: { hour: number; minute: number } };
type LangfuseCallbackParams = {
  sessionId?: string;
  userId?: string;
  tags?: string[];
  traceMetadata?: Record<string, unknown>;
  baseUrl?: string;
};
type SemanticConsistencyGateContext = {
  solverStage: string;
  modelName?: string;
  planResult?: TemporalPlanPlannerOutput;
  endpointCompletion?: EndpointCompletion;
};
type ExplicitDatedTimeRangeParts = {
  dateText: string;
  startText: string;
  endText: string;
  suffixText: string;
};
type ExplicitBareTimeRangeParts = Omit<ExplicitDatedTimeRangeParts, 'dateText'>;

export interface TemporalGraphState {
  request: TemporalParseRequest;
  agentAttempts: number;
  toolPasses: number;
  candidates: EnrichedCandidate[];
  finalizableCandidateIds: string[];
  decisions: AgentDecision[];
  validationFeedback: string[];
}

export interface TemporalGraphOptions {
  maxAgentAttempts?: number;
  maxToolCalls?: number;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiReasoningEffort?: string;
  planIrEndpoint?: TemporalPlanIrEndpointConfig;
  features?: TemporalFeatureFlags;
  langfuse?: {
    enabled: boolean;
    sessionId?: string;
    userId?: string;
    baseUrl?: string;
    tags?: string[];
  };
  implementations: TemporalToolImplementations;
}

export function createInitialTemporalGraphState(request: TemporalParseRequest): TemporalGraphState {
  return {
    request,
    agentAttempts: 0,
    toolPasses: 0,
    candidates: [],
    finalizableCandidateIds: [],
    decisions: [],
    validationFeedback: [],
  };
}

export async function runTemporalCoalescingGraph(
  request: TemporalParseRequest,
  options: TemporalGraphOptions,
): Promise<TemporalParseResponse> {
  const totalStartedAt = nowMs();
  const hasAgentPath = options.openaiApiKey !== undefined || (planIrEnabled(options.features) && options.planIrEndpoint !== undefined);
  const useDeterministicPreflight = deterministicPreflightEnabled(options.features) || !hasAgentPath;
  let fallback: TemporalParseResponse;

  const ambiguityPolicyStartedAt = nowMs();
  const ambiguityPolicyResult = await runAmbiguityPolicy(request, options.implementations, options.features);
  if (ambiguityPolicyResult !== null) {
    const response = responseFromAmbiguityPolicy(ambiguityPolicyResult, elapsedMs(ambiguityPolicyStartedAt));
    attachTopLevelTiming(response, totalStartedAt, undefined, undefined, options.features);
    return response;
  }

  if (useDeterministicPreflight) {
    fallback = await deterministicParse(request, options.implementations, options.features);
    if (!hasAgentPath) {
      attachTopLevelTiming(fallback, totalStartedAt, undefined, undefined, options.features);
      return fallback;
    }

    const bypassReason = deterministicShortCircuitBypassReason(request, fallback);
    if (shouldShortCircuitDeterministic(fallback) && bypassReason === undefined) {
      fallback.debug = fallback.debug ?? {};
      fallback.debug.shortCircuitReason = fallback.status === 'needs_clarification'
        ? 'deterministic_clarification_ready'
        : 'deterministic_resolved_validation_passed';
      if (fallback.status === 'resolved' && options.openaiApiKey !== undefined) {
        const validationStartedAt = nowMs();
        const validated = await validateDeterministicResolvedResponse(request, fallback, options);
        attachTopLevelTiming(validated, totalStartedAt, fallback.debug.deterministicDurationMs, elapsedMs(validationStartedAt), options.features);
        return validated;
      }
      attachTopLevelTiming(fallback, totalStartedAt, fallback.debug.deterministicDurationMs, undefined, options.features);
      return fallback;
    }
    if (bypassReason !== undefined) {
      fallback.debug = fallback.debug ?? {};
      fallback.debug.shortCircuitReason = bypassReason;
    }
  } else {
    fallback = await deterministicParse(request, options.implementations, options.features);
    fallback.debug = fallback.debug ?? {};
    fallback.debug.shortCircuitReason = 'deterministic_preflight_disabled';
  }

  const maxToolCalls = options.maxToolCalls ?? DEFAULT_TEMPORAL_GRAPH_LIMITS.maxToolCalls;
  const agentStartedAt = nowMs();

  if (planIrEnabled(options.features)) {
    try {
      const planResult = options.planIrEndpoint === undefined
        ? await runPlanIrPath(request, options)
        : await runEndpointPlanIrPath(request, options);
      attachTopLevelTiming(planResult, totalStartedAt, fallback.debug?.deterministicDurationMs, elapsedMs(agentStartedAt), options.features);
      if (!shouldEscalateAfterSemanticConsistencyGate(planResult) || options.openaiApiKey === undefined) {
        return planResult;
      }
    } catch (error) {
      const response: TemporalParseResponse = {
        ...fallback,
        method: fallback.method === 'deterministic' ? 'fallback' : fallback.method,
        validation: {
          ...fallback.validation,
          warnings: [...fallback.validation.warnings, `Plan-IR path failed; used deterministic fallback: ${errorMessage(error)}`],
        },
      };
      attachTopLevelTiming(response, totalStartedAt, fallback.debug?.deterministicDurationMs, elapsedMs(agentStartedAt), options.features);
      return response;
    }
  }

  try {
    const agentResult = await runAgentGraph(request, options, maxToolCalls);
    if (agentResult) {
      attachTopLevelTiming(agentResult, totalStartedAt, fallback.debug?.deterministicDurationMs, elapsedMs(agentStartedAt), options.features);
      return agentResult;
    }
  } catch (error) {
    const response: TemporalParseResponse = {
      ...fallback,
      method: fallback.method === 'deterministic' ? 'fallback' : fallback.method,
      validation: {
        ...fallback.validation,
        warnings: [...fallback.validation.warnings, `Agent graph failed; used deterministic fallback: ${errorMessage(error)}`],
      },
    };
    attachTopLevelTiming(response, totalStartedAt, fallback.debug?.deterministicDurationMs, elapsedMs(agentStartedAt), options.features);
    return response;
  }

  attachTopLevelTiming(fallback, totalStartedAt, fallback.debug?.deterministicDurationMs, elapsedMs(agentStartedAt), options.features);
  return fallback;
}

export async function executeTemporalPlanPlannerOutput(
  planResult: TemporalPlanPlannerOutput,
  request: TemporalParseRequest,
  options: Pick<TemporalGraphOptions, 'features' | 'implementations' | 'openaiApiKey' | 'openaiModel' | 'openaiReasoningEffort' | 'langfuse'> & {
    method?: TemporalMethod;
    modelName?: string;
    planningDurationMs?: number;
  },
): Promise<TemporalParseResponse> {
  const startedAt = nowMs();
  const trace: TemporalAgentTraceStep[] = [];
  const method = options.method ?? 'agent+plan';
  const plans = (planResult.plans ?? []).map(normalizeTemporalPlan);

  if (planResult.outcome === 'clarification' && plans.length === 0 && planResult.clarificationQuestion !== null) {
    const response = responseFromQuestionOnlyPlanClarification(planResult.clarificationQuestion, planResult.reason, trace, method);
    attachPlanExecutionDebug(response, startedAt, options.modelName, options.planningDurationMs);
    return response;
  }

  if (planResult.outcome === 'no_plan' || plans.length === 0) {
    const response = responseFromFailedPlanIr(planResult.reason, trace, 0, 0, 0);
    attachPlanExecutionDebug(response, startedAt, options.modelName, options.planningDurationMs);
    return response;
  }

  const graphOptions: TemporalGraphOptions = {
    implementations: options.implementations,
  };
  if (options.features !== undefined) {
    graphOptions.features = options.features;
  }

  const ambiguityPolicyStartedAt = nowMs();
  const ambiguityPolicyResult = await runAmbiguityPolicy(request, options.implementations, options.features);
  if (ambiguityPolicyResult !== null) {
    const response = responseFromAmbiguityPolicy(ambiguityPolicyResult, elapsedMs(ambiguityPolicyStartedAt));
    attachPlanExecutionDebug(response, startedAt, options.modelName, options.planningDurationMs);
    return response;
  }

  const executions = await Promise.all(plans.map((plan, index) => executeTemporalPlan(plan, index, request, graphOptions)));
  for (const execution of executions) {
    appendTrace(trace, execution.trace);
  }

  const toolPasses = executions.reduce((total, execution) => total + execution.toolPasses, 0);
  const ranges = executions.flatMap((execution) => (execution.ranges ?? []).map((range) => ({
    plan: execution.plan,
    planIndex: execution.planIndex,
    range,
  })));
  const finalizableRanges = ranges.filter((execution) => execution.range.finalizable);
  if (ranges.length > 0 || plans.some(isTimeRangePlan)) {
    if (finalizableRanges.length === 0) {
      const errors = executions.map((execution) => execution.error).filter((error): error is string => error !== undefined);
      const response = responseFromFailedPlanIr([planResult.reason, ...errors].join(' '), trace, ranges.length, toolPasses, 0);
      attachPlanExecutionDebug(response, startedAt, options.modelName, options.planningDurationMs);
      return response;
    }

    const uniqueRangeKeys = [...new Set(finalizableRanges.map((execution) => rangeKey(execution.range)))];
    if (planResult.outcome === 'clarification' || uniqueRangeKeys.length > 1) {
      const response = responseFromRangePlanClarification(
        planResult.clarificationQuestion ?? 'Which time range did you mean?',
        finalizableRanges,
        trace,
        ranges.length,
        toolPasses,
        0,
        undefined,
        request.text,
      );
      attachPlanExecutionDebug(response, startedAt, options.modelName, options.planningDurationMs);
      return applySemanticConsistencyGateIfConfigured(request, response, {
        ...options,
      }, {
        solverStage: 'execute_plan_ir',
        ...(options.modelName === undefined ? {} : { modelName: options.modelName }),
        planResult,
      });
    }

    const selected = finalizableRanges[0]!;
    trace.push({
      index: trace.length + 1,
      type: 'router',
      name: 'plan_ir_select_range',
      output: { plan: selected.plan.label, range: compactRangeResult(selected.range, request.text) },
    });
    const response = responseFromEnrichedRange(
      selected.range,
      method,
      Math.min(0.9, Math.max(0.5, selected.plan.confidence)),
      selected.plan.rationale,
      ranges.length,
      toolPasses,
      0,
      trace,
      undefined,
      request.text,
    );
    attachPlanExecutionDebug(response, startedAt, options.modelName, options.planningDurationMs);
    return applySemanticConsistencyGateIfConfigured(request, response, {
      ...options,
    }, {
      solverStage: 'execute_plan_ir',
      ...(options.modelName === undefined ? {} : { modelName: options.modelName }),
      planResult,
    });
  }

  const candidates = executions.flatMap((execution) => (execution.candidates ?? []).map((candidate) => ({
    plan: execution.plan,
    planIndex: execution.planIndex,
    enriched: candidate.enriched,
    label: candidate.label,
  })));
  const finalizable = candidates.filter((execution) => execution.enriched.finalizable);
  const clarificationCandidates = planResult.outcome === 'clarification'
    ? candidates.filter((execution) => canUseForPlanClarification(execution.enriched))
    : finalizable;

  if (finalizable.length === 0 && clarificationCandidates.length <= 1) {
    const errors = executions.map((execution) => execution.error).filter((error): error is string => error !== undefined);
    const response = responseFromFailedPlanIr([planResult.reason, ...errors].join(' '), trace, candidates.length, toolPasses, 0);
    attachPlanExecutionDebug(response, startedAt, options.modelName, options.planningDurationMs);
    return response;
  }

  const uniqueEpochs = [...new Set(finalizable.map((execution) => String(candidateToEpoch(execution.enriched.candidate))))];
  if (planResult.outcome === 'clarification' || uniqueEpochs.length > 1) {
    const response = responseFromPlanClarification(
      planResult.clarificationQuestion ?? 'Which interpretation did you mean?',
      planResult.outcome === 'clarification' ? clarificationCandidates : finalizable,
      trace,
      candidates.length,
      toolPasses,
      0,
      undefined,
      request.text,
    );
    attachPlanExecutionDebug(response, startedAt, options.modelName, options.planningDurationMs);
    return applySemanticConsistencyGateIfConfigured(request, response, {
      ...options,
    }, {
      solverStage: 'execute_plan_ir',
      ...(options.modelName === undefined ? {} : { modelName: options.modelName }),
      planResult,
    });
  }

  const selected = finalizable[0]!;
  trace.push({
    index: trace.length + 1,
    type: 'router',
    name: 'plan_ir_select_candidate',
    output: { plan: selected.plan.label, candidate: compactEnrichedCandidate(selected.enriched) },
  });
  const response = responseFromEnrichedCandidate(
    selected.enriched,
    method,
    Math.min(0.9, Math.max(0.5, selected.plan.confidence)),
    selected.plan.rationale,
    candidates.length,
    toolPasses,
    0,
    trace,
    undefined,
    undefined,
    request.text,
  );
  attachPlanExecutionDebug(response, startedAt, options.modelName, options.planningDurationMs);
  return applySemanticConsistencyGateIfConfigured(request, response, {
    ...options,
  }, {
    solverStage: 'execute_plan_ir',
    ...(options.modelName === undefined ? {} : { modelName: options.modelName }),
    planResult,
  });
}

export async function verifyTemporalParseResponseWithSemanticConsistencyGate(
  request: TemporalParseRequest,
  response: TemporalParseResponse,
  options: Pick<TemporalGraphOptions, 'implementations' | 'openaiApiKey' | 'openaiModel' | 'openaiReasoningEffort' | 'langfuse'>,
): Promise<TemporalSemanticConsistencyGateResult> {
  if (options.openaiApiKey === undefined) {
    return {
      decision: 'uncertain',
      confidence: 0,
      reasonCodes: ['missing_openai_api_key'],
      explanation: 'Semantic Consistency Gate skipped because OPENAI_API_KEY is not configured.',
    };
  }

  const packet = await buildSemanticConsistencyGatePacket(request, response, options, {
    solverStage: 'post_display_verification',
    modelName: response.debug?.model ?? response.method,
  });
  return runSemanticConsistencyGate(request, options, packet);
}

async function runAgentGraph(
  request: TemporalParseRequest,
  options: TemporalGraphOptions,
  maxToolCalls: number,
): Promise<TemporalParseResponse | null> {
  if (!options.openaiApiKey) {
    return null;
  }

  const enrichedCandidates = new Map<string, EnrichedCandidate>();
  const agentProposedCandidateIds = new Set<string>();
  const agentGraphStartedAt = nowMs();
  const modelName = options.openaiModel ?? DEFAULT_OPENAI_MODEL;
  const reasoningEffort = options.openaiReasoningEffort ?? DEFAULT_OPENAI_REASONING_EFFORT;
  let firstLlmResponseMs: number | undefined;
  let firstCandidateMs: number | undefined;
  let finalizedCandidateId: string | null = null;
  let finalizedRationale = '';
  const clarificationResponseRef: { current: TemporalParseResponse | null } = { current: null };
  const trace: TemporalAgentTraceStep[] = [];
  const agentContext = collectTemporalAgentContext(request);
  const langfuseHandler = await createLangfuseHandler(options, request);
  const callbacks = langfuseHandler === null ? undefined : [langfuseHandler];

  const recordTool = (name: string, input: unknown, output: unknown, startedAt: number) => {
    trace.push({ index: trace.length + 1, type: 'tool', name, durationMs: elapsedMs(startedAt), input: summarizeValue(input), output: summarizeValue(output) });
  };
  const markCandidate = () => {
    firstCandidateMs ??= elapsedMs(agentGraphStartedAt);
  };
  const attachAgentDebug = (response: TemporalParseResponse) => {
    response.debug = response.debug ?? {};
    response.debug.model = modelName;
    response.debug.reasoningEffort = reasoningEffort;
    if (firstLlmResponseMs !== undefined) {
      response.debug.firstLlmResponseMs = firstLlmResponseMs;
    }
    if (firstCandidateMs !== undefined) {
      response.debug.firstCandidateMs = firstCandidateMs;
    }
    response.debug.finalResponseMs = elapsedMs(agentGraphStartedAt);
  };
  const autoFinalizeSoleCandidate = (rationale: string) => {
    const autoFinalized = onlyFinalizableCandidate(enrichedCandidates);
    if (autoFinalized === null || blocksAutoFinalize(autoFinalized, request.text)) {
      return false;
    }
    finalizedCandidateId = autoFinalized.candidate.id;
    finalizedRationale = rationale;
    trace.push({
      index: trace.length + 1,
      type: 'router',
      name: 'auto_finalize_candidate',
      output: compactEnrichedCandidate(autoFinalized),
    });
    return true;
  };

  const parseExpressionTool = tool(
    async (input) => {
      const startedAt = nowMs();
      const parsed = await options.implementations.parseExpression({
        text: input.text,
        calendarContext: toCalendarContext(input.calendarContext),
        ...(options.features === undefined ? {} : { features: options.features }),
      });
      const enriched = await Promise.all(parsed.candidates.map((candidate) => enrichCandidate(candidate, request, options.implementations)));
      if (enriched.length > 0) {
        markCandidate();
      }
      for (const candidate of enriched) {
        enrichedCandidates.set(candidate.candidate.id, candidate);
      }
      const output = { parserNotes: parsed.parserNotes, candidates: enriched.map(compactEnrichedCandidate) };
      recordTool('parse_expression', input, output, startedAt);
      return JSON.stringify(output);
    },
    {
      name: 'parse_expression',
      description: 'Generate, enrich, and validate candidate date/time interpretations from user text using deterministic parsing.',
      schema: z.object({ text: z.string(), calendarContext: CalendarContextSchema }),
    },
  );

  const resolveCalendarQueryTool = tool(
    async (input) => {
      const startedAt = nowMs();
      const resolved = await options.implementations.resolveCalendarQuery({
        query: input.query,
        calendarContext: toCalendarContext(input.calendarContext),
        ...(options.features === undefined ? {} : { features: options.features }),
      });
      const enriched = await Promise.all(resolved.candidates.map((candidate) => enrichCandidate(candidate, request, options.implementations)));
      if (enriched.length > 0) {
        markCandidate();
      }
      for (const candidate of enriched) {
        enrichedCandidates.set(candidate.candidate.id, candidate);
      }
      const output = { source: resolved.source, notes: resolved.notes, candidates: enriched.map(compactEnrichedCandidate) };
      recordTool('resolve_calendar_query', input, output, startedAt);
      return JSON.stringify(output);
    },
    {
      name: 'resolve_calendar_query',
      description: 'Resolve a broad calendar query, including weekday phrases or known calendar expressions, into candidates.',
      schema: z.object({ query: z.string(), calendarContext: CalendarContextSchema }),
    },
  );

  const resolveHolidayTool = tool(
    async (input) => {
      const startedAt = nowMs();
      const holidayInput: Parameters<TemporalToolImplementations['resolveHoliday']>[0] = {
        holidayName: input.holidayName,
        calendarContext: toCalendarContext(input.calendarContext),
      };
      if (input.year !== undefined) {
        holidayInput.year = input.year;
      }
      if (input.time !== undefined) {
        holidayInput.time = input.time;
      }

      const resolved = await options.implementations.resolveHoliday(holidayInput);
      const enriched = await Promise.all(resolved.candidates.map((candidate) => enrichCandidate(candidate, request, options.implementations)));
      if (enriched.length > 0) {
        markCandidate();
      }
      for (const candidate of enriched) {
        enrichedCandidates.set(candidate.candidate.id, candidate);
      }
      const output = { source: resolved.source, notes: resolved.notes, candidates: enriched.map(compactEnrichedCandidate) };
      recordTool('resolve_holiday', input, output, startedAt);
      return JSON.stringify(output);
    },
    {
      name: 'resolve_holiday',
      description: 'Resolve a named holiday from calendar data. Use this for holiday expressions; do not propose holiday dates from memory.',
      schema: z.object({
        holidayName: z.string(),
        year: z.number().int().min(1900).max(2200).optional(),
        time: TimeOfDaySchema.optional(),
        calendarContext: CalendarContextSchema,
      }),
    },
  );

  const resolveClockTimeTool = tool(
    async (input) => {
      const startedAt = nowMs();
      const output = await options.implementations.resolveClockTime({
        text: input.text,
        calendarContext: toCalendarContext(input.calendarContext),
      });
      recordTool('resolve_clock_time', input, output, startedAt);
      return JSON.stringify(output);
    },
    {
      name: 'resolve_clock_time',
      description: 'Parse explicit conventional clock-time text such as noon, midnight, 13:37, or 1:37pm into 24-hour time candidates.',
      schema: z.object({ text: z.string(), calendarContext: CalendarContextSchema }),
    },
  );

  const resolveTimeZoneTool = tool(
    async (input) => {
      const startedAt = nowMs();
      const output = await options.implementations.resolveTimeZone({
        text: input.text,
        calendarContext: toCalendarContext(input.calendarContext),
      });
      recordTool('resolve_timezone', input, output, startedAt);
      return JSON.stringify(output);
    },
    {
      name: 'resolve_timezone',
      description: 'Resolve explicit timezone text into validated IANA zones or fixed UTC/GMT offsets. Ambiguous abbreviations return clarification candidates instead of silently choosing.',
      schema: z.object({ text: z.string(), calendarContext: CalendarContextSchema }),
    },
  );

  const shiftDateTimeTool = tool(
    async (input) => {
      const startedAt = nowMs();
      const candidate = await options.implementations.shiftDateTime({
        base: resolveAgentBase(input.base, enrichedCandidates),
        delta: cleanDelta(input.delta),
        ...(input.time === undefined ? {} : { time: input.time }),
        calendarContext: toCalendarContext(input.calendarContext),
      });
      const enriched = await enrichCandidate(candidate, request, options.implementations);
      markCandidate();
      enrichedCandidates.set(enriched.candidate.id, enriched);
      const output = compactEnrichedCandidate(enriched);
      recordTool('shift_datetime', input, output, startedAt);
      return JSON.stringify(output);
    },
    {
      name: 'shift_datetime',
      description: 'Apply timezone-aware date/time arithmetic to a base instant, date, or zoned date-time. If a normalized clock time is already known, include time to set it on the shifted date in the same tool call.',
      schema: z.object({
        base: AgentBaseDateTimeSchema,
        delta: z.object({
          years: z.number().optional(),
          months: z.number().optional(),
          weeks: z.number().optional(),
          days: z.number().optional(),
          hours: z.number().optional(),
          minutes: z.number().optional(),
        }),
        time: TimeOfDaySchema.optional(),
        calendarContext: CalendarContextSchema,
      }),
    },
  );

  const setClockTimeTool = tool(
    async (input) => {
      const startedAt = nowMs();
      const candidate = await options.implementations.setClockTime({
        base: resolveAgentBase(input.base, enrichedCandidates),
        time: input.time,
        calendarContext: toCalendarContext(input.calendarContext),
      });
      const enriched = await enrichCandidate(candidate, request, options.implementations);
      markCandidate();
      enrichedCandidates.set(enriched.candidate.id, enriched);
      const output = compactEnrichedCandidate(enriched);
      recordTool('set_clock_time', input, output, startedAt);
      return JSON.stringify(output);
    },
    {
      name: 'set_clock_time',
      description: 'Apply a normalized 24-hour clock time to the date from a candidate, instant, plain date, or zoned date-time.',
      schema: z.object({
        base: AgentBaseDateTimeSchema,
        time: TimeOfDaySchema,
        calendarContext: CalendarContextSchema,
      }),
    },
  );

  const proposeCandidateTool = tool(
    async (input) => {
      const startedAt = nowMs();
      const isoInstant = input.isoInstant ?? epochSecondsToIso(input.epochSeconds);
      const candidate = candidateFromProposal({
        isoInstant,
        timeZone: input.timeZone ?? request.calendarContext.timeZone,
        precision: input.precision,
        assumptions: input.assumptions,
      });
      const enriched = await enrichCandidate(candidate, request, options.implementations);
      markCandidate();
      enrichedCandidates.set(enriched.candidate.id, enriched);
      agentProposedCandidateIds.add(enriched.candidate.id);
      const output = compactEnrichedCandidate(enriched);
      recordTool('propose_candidate', input, output, startedAt);
      return JSON.stringify(output);
    },
    {
      name: 'propose_candidate',
      description: 'Propose a candidate timestamp. The graph will enrich and validate it; this does not finalize the answer.',
      schema: z.object({
        isoInstant: z.string().optional(),
        epochSeconds: z.number().optional(),
        timeZone: z.string().optional(),
        precision: z.enum(['date', 'time', 'datetime', 'relative']),
        assumptions: z.array(z.string()).default([]),
        rationale: z.string(),
      }).refine((value) => value.isoInstant !== undefined || value.epochSeconds !== undefined, {
        message: 'Either isoInstant or epochSeconds is required.',
      }),
    },
  );

  const finalizeCandidateTool = tool(
    async (input) => {
      const startedAt = nowMs();
      const candidate = enrichedCandidates.get(input.candidateId);
      if (!candidate || !candidate.finalizable) {
        const output = { accepted: false, error: 'Candidate must be proposed or resolved by a tool, enriched, and validation-passing before finalization.' };
        recordTool('finalize_candidate', input, output, startedAt);
        return JSON.stringify(output);
      }
      finalizedCandidateId = input.candidateId;
      finalizedRationale = input.rationale;
      clarificationResponseRef.current = null;
      const output = { accepted: true, candidate: compactEnrichedCandidate(candidate) };
      recordTool('finalize_candidate', input, output, startedAt);
      return JSON.stringify(output);
    },
    {
      name: 'finalize_candidate',
      description: 'Finalize one candidate that was previously proposed or resolved by a tool and validated. Only use candidate IDs returned by tool output.',
      schema: z.object({ candidateId: z.string(), rationale: z.string() }),
    },
  );

  const askClarificationTool = tool(
    async (input) => {
      const startedAt = nowMs();
      if (finalizedCandidateId) {
        const output = { accepted: false, error: 'A candidate has already been finalized; not asking for clarification.' };
        recordTool('ask_clarification', input, output, startedAt);
        return JSON.stringify(output);
      }

      const requestedAlternatives = input.alternatives
        .map((alternative) => {
          const enriched = enrichedCandidates.get(alternative.candidateId);
          if (!enriched || !canUseForClarification(enriched)) {
            return null;
          }
          return alternativeFromEnrichedCandidate(
            conciseClarificationLabel(alternative.label, enriched),
            enriched,
            'agent+tools',
            0.8,
            request.text,
          );
        })
        .filter((alternative): alternative is TemporalClarificationAlternative => alternative !== null);
      const alternatives = uniqueAlternativesByEpoch(requestedAlternatives);
      const output = requestedAlternatives.length === input.alternatives.length
        ? { accepted: true, question: input.question, alternatives: alternatives.map(compactClarificationAlternative) }
        : { accepted: false, error: 'All clarification alternatives must reference existing usable candidate IDs.' };
      recordTool('ask_clarification', input, output, startedAt);
      if (output.accepted) {
        clarificationResponseRef.current = {
          status: 'needs_clarification',
          confidence: 0,
          method: 'agent+tools',
          assumptions: [],
          ambiguity: [input.rationale],
          validation: {
            passed: false,
            warnings: [input.rationale],
            checks: ['agent_clarification'],
          },
          clarificationQuestion: input.question,
          clarificationAlternatives: alternatives,
          debug: { candidateCount: enrichedCandidates.size, agentAttempts: 0, toolPasses: 0, trace },
        };
      }
      return JSON.stringify(output);
    },
    {
      name: 'ask_clarification',
      description: 'Ask the user to choose between one or more plausible timestamp candidates. Only use candidate IDs returned by previous candidate-producing tools. Labels should be short choice text, not full formatted dates. Candidates can be validation-passing or candidates whose only validation issue is the ambiguity being clarified.',
      schema: z.object({
        question: z.string(),
        rationale: z.string(),
        alternatives: z.array(z.object({
          label: z.string(),
          candidateId: z.string(),
        })).min(1),
      }),
    },
  );

  const tools = [
    parseExpressionTool,
    resolveCalendarQueryTool,
    resolveHolidayTool,
    resolveClockTimeTool,
    resolveTimeZoneTool,
    shiftDateTimeTool,
    setClockTimeTool,
    proposeCandidateTool,
    finalizeCandidateTool,
    askClarificationTool,
  ];
  const model = createChatModel(options.openaiApiKey, modelName, reasoningEffort);
  const modelWithTools = model.bindTools(tools, { parallel_tool_calls: true });

  const llmCall = async (state: typeof MessagesAnnotation.State) => {
    const startedAt = nowMs();
    const system = systemPrompt(request, agentContext);
    const messages = [new SystemMessage(system), ...state.messages];
    const result = await modelWithTools.invoke(messages, callbacks === undefined ? undefined : { callbacks });
    firstLlmResponseMs ??= elapsedMs(agentGraphStartedAt);
    trace.push({
      index: trace.length + 1,
      type: 'llm',
      name: 'agent',
      durationMs: elapsedMs(startedAt),
      input: {
        messageCount: messages.length,
        systemPromptChars: system.length,
        totalMessageChars: messageContentChars(messages),
      },
      output: summarizeAiMessage(result),
    });
    return { messages: [result] };
  };
  const toolNode = new ToolNode(tools);
  const shouldContinue = (state: typeof MessagesAnnotation.State) => {
    const lastMessage = state.messages[state.messages.length - 1];
    if (finalizedCandidateId || clarificationResponseRef.current) {
      return END;
    }
    if (countToolMessages(state.messages) >= maxToolCalls) {
      return END;
    }
    if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
      return 'toolNode';
    }
    return END;
  };
  const graph = new StateGraph(MessagesAnnotation)
    .addNode('llmCall', llmCall)
    .addNode('toolNode', toolNode)
    .addEdge(START, 'llmCall')
    .addConditionalEdges('llmCall', shouldContinue, ['toolNode', END])
    .addConditionalEdges('toolNode', () => {
      if (finalizedCandidateId || clarificationResponseRef.current) {
        return END;
      }
      if (autoFinalizeSoleCandidate('Auto-finalized the only validated candidate after a tool pass.')) {
        return END;
      }
      return 'llmCall';
    }, ['llmCall', END])
    .compile();

  const finalState = await graph.invoke(
    { messages: [new HumanMessage(userPrompt(request))] },
    callbacks === undefined
      ? undefined
      : {
          callbacks,
          runName: 'temporal-coalescing-graph',
          tags: ['temporal-parse'],
          metadata: {
            model: modelName,
            timeZone: request.calendarContext.timeZone,
          },
        },
  );
  const toolPasses = countToolMessages(finalState.messages);
  const agentAttempts = countAgentMessages(finalState.messages);

  if (!finalizedCandidateId) {
    if (!autoFinalizeSoleCandidate('Auto-finalized the only validated candidate after the agent stopped without calling finalize_candidate.')) {
      if (clarificationResponseRef.current) {
        const response = clarificationResponseRef.current;
        response.debug = response.debug ?? {};
        response.debug.candidateCount = enrichedCandidates.size;
        response.debug.agentAttempts = agentAttempts;
        response.debug.toolPasses = toolPasses;
        response.debug.trace = trace;
        attachAgentDebug(response);
        return response;
      }

      const response = responseFromUnfinalizedAgent(enrichedCandidates.size, toolPasses, agentAttempts, trace, getLangfuseTraceId(langfuseHandler));
      attachAgentDebug(response);
      return response;
    }
  }

  const finalizedId = finalizedCandidateId;
  if (finalizedId === null) {
    return null;
  }

  const finalized = enrichedCandidates.get(finalizedId);
  if (!finalized) {
    return null;
  }

  const finalValidationStartedAt = nowMs();
  const runFinalValidation = shouldRunFinalValidation(finalized, agentProposedCandidateIds);
  const finalValidation = runFinalValidation
    ? await validateFinalAnswer(model, request, finalized, finalizedRationale, trace, callbacks)
    : skippedFinalValidation(finalized);
  trace.push({
    index: trace.length + 1,
    type: 'final_validation',
    name: runFinalValidation ? 'llm_final_validation' : 'skipped_final_validation',
    durationMs: elapsedMs(finalValidationStartedAt),
    output: finalValidation,
  });
  if (!finalValidation.accepted) {
    const response = responseFromRejectedFinalValidation(
      finalized,
      finalValidation,
      enrichedCandidates.size,
      toolPasses,
      agentAttempts,
      trace,
      'agent+tools',
      getLangfuseTraceId(langfuseHandler),
    );
    attachAgentDebug(response);
    return response;
  }

  const response = responseFromEnrichedCandidate(
    finalized,
    'agent+tools',
    Math.min(0.9, Math.max(0.5, finalValidation.confidence)),
    finalizedRationale,
    enrichedCandidates.size,
    toolPasses,
    agentAttempts,
    trace,
    finalValidation,
    getLangfuseTraceId(langfuseHandler),
    request.text,
  );
  attachAgentDebug(response);
  return response;
}

async function runPlanIrPath(
  request: TemporalParseRequest,
  options: TemporalGraphOptions,
): Promise<TemporalParseResponse> {
  if (!options.openaiApiKey) {
    return responseFromFailedPlanIr('Plan IR requires an OpenAI API key.', [], 0, 0, 0);
  }

  const planStartedAt = nowMs();
  const modelName = options.openaiModel ?? DEFAULT_OPENAI_MODEL;
  const reasoningEffort = options.openaiReasoningEffort ?? DEFAULT_OPENAI_REASONING_EFFORT;
  const trace: TemporalAgentTraceStep[] = [];
  const agentContext = collectTemporalAgentContext(request);
  const langfuseHandler = await createLangfuseHandler(options, request);
  const callbacks = langfuseHandler === null ? undefined : [langfuseHandler];
  const model = createChatModel(options.openaiApiKey, modelName, reasoningEffort);
  const planner = model.withStructuredOutput(TemporalPlanPlannerSchema);
  const system = planIrSystemPrompt(request, agentContext);
  const human = JSON.stringify({ text: request.text, calendarContext: request.calendarContext });

  let firstLlmResponseMs: number | undefined;
  let firstCandidateMs: number | undefined;
  const attachPlanDebug = (response: TemporalParseResponse) => {
    response.debug = response.debug ?? {};
    response.debug.model = modelName;
    response.debug.reasoningEffort = reasoningEffort;
    response.debug.trace = response.debug.trace ?? trace;
    if (firstLlmResponseMs !== undefined) {
      response.debug.firstLlmResponseMs = firstLlmResponseMs;
    }
    if (firstCandidateMs !== undefined) {
      response.debug.firstCandidateMs = firstCandidateMs;
    }
    response.debug.finalResponseMs = elapsedMs(planStartedAt);
    const traceId = getLangfuseTraceId(langfuseHandler);
    if (traceId !== undefined) {
      response.debug.langfuseTraceId = traceId;
    }
  };

  const llmStartedAt = nowMs();
  const planResult = await planner.invoke([
    new SystemMessage(system),
    new HumanMessage(human),
  ], callbacks === undefined ? undefined : { callbacks, runName: 'temporal-plan-ir' });
  firstLlmResponseMs = elapsedMs(planStartedAt);
  trace.push({
    index: trace.length + 1,
    type: 'llm',
    name: 'plan_ir_planner',
    durationMs: elapsedMs(llmStartedAt),
    input: {
      messageCount: 2,
      systemPromptChars: system.length,
      totalMessageChars: system.length + human.length,
    },
    output: summarizeValue(planResult),
  });

  const plans = (planResult.plans ?? []).map(normalizeTemporalPlan);
  if (planResult.outcome === 'no_plan' || plans.length === 0) {
    const response = responseFromFailedPlanIr(planResult.reason, trace, 0, 0, 1, getLangfuseTraceId(langfuseHandler));
    attachPlanDebug(response);
    return response;
  }

  const executions = await Promise.all(plans.map((plan, index) => executeTemporalPlan(plan, index, request, options)));
  for (const execution of executions) {
    appendTrace(trace, execution.trace);
  }

  const toolPasses = executions.reduce((total, execution) => total + execution.toolPasses, 0);
  const ranges = executions.flatMap((execution) => (execution.ranges ?? []).map((range) => ({
    plan: execution.plan,
    planIndex: execution.planIndex,
    range,
  })));
  if (ranges.length > 0) {
    firstCandidateMs = executions.reduce((min, execution) => {
      if (execution.firstCandidateMs === undefined) {
        return min;
      }
      return min === undefined ? execution.firstCandidateMs : Math.min(min, execution.firstCandidateMs);
    }, undefined as number | undefined);
  }
  const finalizableRanges = ranges.filter((execution) => execution.range.finalizable);
  if (ranges.length > 0 || plans.some(isTimeRangePlan)) {
    if (finalizableRanges.length === 0) {
      const reason = planResult.reason || 'Plan IR did not produce a validation-passing range.';
      const errors = executions.map((execution) => execution.error).filter((error): error is string => error !== undefined);
      const response = responseFromFailedPlanIr([reason, ...errors].join(' '), trace, ranges.length, toolPasses, 1, getLangfuseTraceId(langfuseHandler));
      attachPlanDebug(response);
      return response;
    }

    const uniqueRangeKeys = [...new Set(finalizableRanges.map((execution) => rangeKey(execution.range)))];
    if (planResult.outcome === 'clarification' || uniqueRangeKeys.length > 1) {
      const response = responseFromRangePlanClarification(
        planResult.clarificationQuestion ?? 'Which time range did you mean?',
        finalizableRanges,
        trace,
        ranges.length,
        toolPasses,
        1,
        getLangfuseTraceId(langfuseHandler),
        request.text,
      );
      attachPlanDebug(response);
      return response;
    }

    const selected = finalizableRanges[0]!;
    trace.push({
      index: trace.length + 1,
      type: 'router',
      name: 'plan_ir_select_range',
      output: { plan: selected.plan.label, range: compactRangeResult(selected.range, request.text) },
    });
    const response = responseFromEnrichedRange(
      selected.range,
      'agent+plan',
      Math.min(0.9, Math.max(0.5, selected.plan.confidence)),
      selected.plan.rationale,
      ranges.length,
      toolPasses,
      1,
      trace,
      getLangfuseTraceId(langfuseHandler),
      request.text,
    );
    attachPlanDebug(response);
    return response;
  }

  const candidates = executions.flatMap((execution) => (execution.candidates ?? []).map((candidate) => ({
    plan: execution.plan,
    planIndex: execution.planIndex,
    enriched: candidate.enriched,
    label: candidate.label,
  })));
  if (candidates.length > 0) {
    firstCandidateMs = executions.reduce((min, execution) => {
      if (execution.firstCandidateMs === undefined) {
        return min;
      }
      return min === undefined ? execution.firstCandidateMs : Math.min(min, execution.firstCandidateMs);
    }, undefined as number | undefined);
  }

  const finalizable = candidates.filter((execution) => execution.enriched.finalizable);
  const clarificationCandidates = planResult.outcome === 'clarification'
    ? candidates.filter((execution) => canUseForPlanClarification(execution.enriched))
    : finalizable;
  if (finalizable.length === 0 && clarificationCandidates.length <= 1) {
    const reason = planResult.reason || 'Plan IR did not produce a validation-passing candidate.';
    const errors = executions.map((execution) => execution.error).filter((error): error is string => error !== undefined);
    const response = responseFromFailedPlanIr([reason, ...errors].join(' '), trace, candidates.length, toolPasses, 1, getLangfuseTraceId(langfuseHandler));
    attachPlanDebug(response);
    return response;
  }

  const uniqueEpochs = [...new Set(finalizable.map((execution) => String(candidateToEpoch(execution.enriched.candidate))))];
  if (planResult.outcome === 'clarification' || uniqueEpochs.length > 1) {
    const response = responseFromPlanClarification(
      planResult.clarificationQuestion ?? 'Which interpretation did you mean?',
      planResult.outcome === 'clarification' ? clarificationCandidates : finalizable,
      trace,
      candidates.length,
      toolPasses,
      1,
      getLangfuseTraceId(langfuseHandler),
      request.text,
    );
    attachPlanDebug(response);
    return response;
  }

  const selected = finalizable[0]!;
  trace.push({
    index: trace.length + 1,
    type: 'router',
    name: 'plan_ir_select_candidate',
    output: { plan: selected.plan.label, candidate: compactEnrichedCandidate(selected.enriched) },
  });

  const finalValidationStartedAt = nowMs();
  const finalValidation = await validateFinalAnswer(model, request, selected.enriched, selected.plan.rationale, trace, callbacks);
  trace.push({
    index: trace.length + 1,
    type: 'final_validation',
    name: 'plan_ir_final_validation',
    durationMs: elapsedMs(finalValidationStartedAt),
    output: finalValidation,
  });
  if (!finalValidation.accepted) {
    const response = responseFromRejectedFinalValidation(
      selected.enriched,
      finalValidation,
      candidates.length,
      toolPasses,
      1,
      trace,
      'agent+plan',
      getLangfuseTraceId(langfuseHandler),
    );
    attachPlanDebug(response);
    return response;
  }

  const response = responseFromEnrichedCandidate(
    selected.enriched,
    'agent+plan',
    Math.min(0.9, Math.max(0.5, finalValidation.confidence, selected.plan.confidence)),
    selected.plan.rationale,
    candidates.length,
    toolPasses,
    1,
    trace,
    finalValidation,
    getLangfuseTraceId(langfuseHandler),
    request.text,
  );
  attachPlanDebug(response);
  return response;
}

async function runEndpointPlanIrPath(
  request: TemporalParseRequest,
  options: TemporalGraphOptions,
): Promise<TemporalParseResponse> {
  const endpoint = options.planIrEndpoint;
  if (endpoint === undefined) {
    return responseFromFailedPlanIr('Plan IR endpoint is not configured.', [], 0, 0, 0);
  }

  const prompt = formatEndpointPlanPrompt(request, endpoint.instructionPreset, endpoint.promptFormat);
  const planningStartedAt = nowMs();
  const completion = await invokePlanIrEndpoint(endpoint, prompt);
  const planningDurationMs = elapsedMs(planningStartedAt);
  let planResult: TemporalPlanPlannerOutput;
  try {
    planResult = parsePredictedPlanIr(completion.content);
  } catch (error) {
    throw new Error(`Endpoint Plan-IR parse failed: ${errorMessage(error)}. Content preview: ${completion.content.slice(0, 1000)}`);
  }

  const executionOptions: Pick<TemporalGraphOptions, 'features' | 'implementations'> & {
    method?: TemporalMethod;
    modelName?: string;
    planningDurationMs?: number;
  } = {
    implementations: options.implementations,
    method: 'agent+plan',
    modelName: endpoint.model,
    planningDurationMs,
  };
  if (options.features !== undefined) {
    executionOptions.features = options.features;
  }
  const response = await executeTemporalPlanPlannerOutput(
    planResult,
    request,
    executionOptions,
  );
  const llmTrace: TemporalAgentTraceStep = {
    index: 1,
    type: 'llm',
    name: 'local_endpoint_plan',
    durationMs: planningDurationMs,
    input: {
      endpoint: planIrEndpointUrl(endpoint),
      totalMessageChars: prompt.length,
      instructionPreset: endpoint.instructionPreset,
      api: endpoint.api,
      promptFormat: endpoint.promptFormat,
    },
    output: summarizeValue({ content: completion.content, finishReason: completion.finishReason, usage: completion.usage }),
  };
  response.debug = response.debug ?? {};
  response.debug.instructionPreset = endpoint.instructionPreset;
  response.debug.promptFormat = endpoint.promptFormat;
  response.debug.firstLlmResponseMs = planningDurationMs;
  response.debug.trace = reindexTrace([llmTrace, ...(response.debug.trace ?? [])]);
  return applySemanticConsistencyGateIfConfigured(request, response, options, {
    solverStage: 'local_endpoint_plan_ir',
    modelName: endpoint.model,
    planResult,
    endpointCompletion: completion,
  });
}

type EndpointCompletion = {
  content: string;
  finishReason?: string;
  usage?: unknown;
};

type OpenAiCompatibleCompletionResponse = {
  choices?: Array<{
    text?: unknown;
    finish_reason?: unknown;
    message?: {
      content?: unknown;
    };
  }>;
  usage?: unknown;
};

async function invokePlanIrEndpoint(endpoint: TemporalPlanIrEndpointConfig, prompt: string): Promise<EndpointCompletion> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), endpoint.timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (endpoint.apiKey !== undefined) {
      headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
    }
    const payload: Record<string, unknown> = {
      model: endpoint.model,
      max_tokens: endpoint.maxTokens,
      temperature: 0,
    };
    if (endpoint.api === 'chat') {
      payload['messages'] = [{ role: 'user', content: prompt }];
    } else {
      payload['prompt'] = prompt;
    }
    const response = await fetch(planIrEndpointUrl(endpoint), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Endpoint returned HTTP ${response.status}: ${bodyText.slice(0, 1000)}`);
    }
    const body = JSON.parse(bodyText) as OpenAiCompatibleCompletionResponse;
    const choice = body.choices?.[0];
    const content = endpoint.api === 'chat' ? choice?.message?.content : choice?.text;
    if (typeof content !== 'string') {
      throw new Error(`Endpoint response did not include ${endpoint.api === 'chat' ? 'choices[0].message.content' : 'choices[0].text'}: ${bodyText.slice(0, 1000)}`);
    }
    const completion: EndpointCompletion = {
      content: content.trim(),
    };
    if (choice !== undefined && typeof choice.finish_reason === 'string') {
      completion.finishReason = choice.finish_reason;
    }
    if (body.usage !== undefined) {
      completion.usage = body.usage;
    }
    return completion;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Endpoint request timed out after ${endpoint.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function planIrEndpointUrl(endpoint: TemporalPlanIrEndpointConfig): string {
  const baseUrl = endpoint.baseUrl.replace(/\/+$/, '');
  const versionedBaseUrl = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
  return `${versionedBaseUrl}/${endpoint.api === 'chat' ? 'chat/completions' : 'completions'}`;
}

function formatEndpointPlanPrompt(request: TemporalParseRequest, instructionPreset: TemporalPlanIrInstructionPreset, promptFormat: TemporalPlanIrEndpointConfig['promptFormat']): string {
  const input = {
    referenceInstant: request.calendarContext.referenceInstant,
    text: request.text,
    timeZone: request.calendarContext.timeZone,
  };
  const instruction = ENDPOINT_PLAN_INSTRUCTION_PRESETS[instructionPreset];
  if (promptFormat === 'chat') {
    return `${instruction}\n\nInput:\n${formatEndpointInputJson(input)}`;
  }
  return `### Instruction:\n${instruction}\n\n### Input:\n${formatEndpointInputJson(input)}\n\n### Response:\n`;
}

function formatEndpointInputJson(input: { referenceInstant: string; text: string; timeZone: string }): string {
  const entries = [
    ['referenceInstant', input.referenceInstant],
    ['text', input.text],
    ['timeZone', input.timeZone],
  ];
  return `{${entries.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')}}`;
}

function parsePredictedPlanIr(value: unknown): TemporalPlanPlannerOutput {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    try {
      return parseTemporalPlanPlannerOutput(JSON.parse(trimmed));
    } catch {
      return parseTemporalPlanPlannerOutput(JSON.parse(extractFirstJsonObject(trimmed)));
    }
  }
  return parseTemporalPlanPlannerOutput(value);
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) {
    throw new Error('Prediction did not contain a JSON object.');
  }
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  throw new Error('Prediction JSON object was not balanced.');
}

function reindexTrace(trace: TemporalAgentTraceStep[]): TemporalAgentTraceStep[] {
  return trace.map((step, index) => ({ ...step, index: index + 1 }));
}

type PlanExecution = {
  plan: TemporalPlan;
  planIndex: number;
  candidates?: PlanCandidateResult[];
  ranges?: PlanRangeResult[];
  error?: string;
  trace: UnindexedTraceStep[];
  toolPasses: number;
  firstCandidateMs?: number;
};

async function executeTemporalPlan(
  plan: TemporalPlan,
  planIndex: number,
  request: TemporalParseRequest,
  options: TemporalGraphOptions,
): Promise<PlanExecution> {
  const startedAt = nowMs();
  const trace: UnindexedTraceStep[] = [];
  const executions = new Map<number, Promise<TemporalPlanStepOutput>>();

  const recordTool = (stepIndex: number, step: TemporalPlanStep, output: unknown, stepStartedAt: number) => {
    trace.push({
      type: 'tool',
      name: step.operation,
      durationMs: elapsedMs(stepStartedAt),
      input: summarizeValue({ planIndex, plan: plan.label, stepIndex, step }),
      output: summarizeValue(output),
    });
  };

  const executeStep = (stepIndex: number): Promise<TemporalPlanStepOutput> => {
    const existing = executions.get(stepIndex);
    if (existing !== undefined) {
      return existing;
    }
    const step = plan.steps[stepIndex];
    if (step === undefined) {
      throw new Error(`Plan ${plan.label} references missing step ${stepIndex}.`);
    }
    const execution = executePlanStep(step, stepIndex, executeStep, request, options, recordTool);
    executions.set(stepIndex, execution);
    return execution;
  };

  try {
    const outputs = await Promise.all(plan.steps.map((_, stepIndex) => executeStep(stepIndex)));
    if (isTimeRangePlan(plan)) {
      const ranges = await enrichedRangesFromPlanOutput(plan, outputs, request, options.implementations);
      trace.push({
        type: 'router',
        name: 'plan_ir_final_range',
        output: { planIndex, plan: plan.label, ranges: ranges.map((range) => compactRangeResult(range, request.text)) },
      });
      return {
        plan,
        planIndex,
        ranges,
        trace,
        toolPasses: trace.filter((step) => step.type === 'tool').length,
        firstCandidateMs: elapsedMs(startedAt),
      };
    }

    const finalOutput = finalPlanOutput(plan, outputs);
    if (finalOutput.kind !== 'candidates') {
      throw new Error(`Plan ${plan.label} final output was ${finalOutput.kind}, not candidates.`);
    }

    const candidates = await Promise.all(finalOutput.candidates.map(async (candidate) => ({
      label: candidate.label,
      enriched: await enrichCandidate(candidate.candidate, request, options.implementations),
    })));
    trace.push({
      type: 'router',
      name: 'plan_ir_final_step',
      output: { planIndex, plan: plan.label, candidates: candidates.map((candidate) => ({ label: candidate.label, candidate: compactEnrichedCandidate(candidate.enriched) })) },
    });
    return {
      plan,
      planIndex,
      candidates,
      trace,
      toolPasses: trace.filter((step) => step.type === 'tool').length,
      firstCandidateMs: elapsedMs(startedAt),
    };
  } catch (error) {
    trace.push({
      type: 'router',
      name: 'plan_ir_plan_failed',
      output: { planIndex, plan: plan.label, error: errorMessage(error) },
    });
    return {
      plan,
      planIndex,
      error: errorMessage(error),
      trace,
      toolPasses: trace.filter((step) => step.type === 'tool').length,
    };
  }
}

async function executePlanStep(
  step: TemporalPlanStep,
  stepIndex: number,
  executeStep: (stepIndex: number) => Promise<TemporalPlanStepOutput>,
  request: TemporalParseRequest,
  options: TemporalGraphOptions,
  recordTool: (stepIndex: number, step: TemporalPlanStep, output: unknown, startedAt: number) => void,
): Promise<TemporalPlanStepOutput> {
  const startedAt = nowMs();
  switch (step.operation) {
    case 'resolve_calendar_query': {
      const query = requirePlanString(step.query, step, 'query');
      const calendarContext = await calendarContextForPlanStep(step, executeStep, request, options.implementations);
      const resolved = await options.implementations.resolveCalendarQuery({
        query,
        calendarContext,
        ...(options.features === undefined ? {} : { features: options.features }),
      });
      const candidate = resolved.candidates[0];
      recordTool(stepIndex, step, resolved, startedAt);
      if (candidate === undefined) {
        throw new Error(`resolve_calendar_query returned no candidates for ${query}.`);
      }
      return { kind: 'candidates', candidates: [{ candidate }] };
    }
    case 'resolve_weekday_anchor': {
      const calendarContext = await calendarContextForPlanStep(step, executeStep, request, options.implementations);
      const resolved = resolveWeekdayAnchor(step, calendarContext);
      recordTool(stepIndex, step, resolved, startedAt);
      return { kind: 'candidates', candidates: resolved };
    }
    case 'resolve_holiday': {
      const holidayName = requirePlanString(step.holidayName, step, 'holidayName');
      const calendarContext = await calendarContextForPlanStep(step, executeStep, request, options.implementations);
      const holidayInput: Parameters<TemporalToolImplementations['resolveHoliday']>[0] = {
        holidayName,
        calendarContext,
      };
      if (step.year !== null) {
        holidayInput.year = step.year;
      }
      if (step.time !== null) {
        holidayInput.time = step.time;
      }
      const resolved = await options.implementations.resolveHoliday(holidayInput);
      const candidate = resolved.candidates[0];
      recordTool(stepIndex, step, resolved, startedAt);
      if (candidate === undefined) {
        throw new Error(`resolve_holiday returned no candidates for ${holidayName}.`);
      }
      return { kind: 'candidates', candidates: [{ candidate }] };
    }
    case 'resolve_timezone': {
      const text = requirePlanString(step.text ?? step.query ?? step.timeZone, step, 'text');
      const resolved = await options.implementations.resolveTimeZone({ text, calendarContext: request.calendarContext });
      recordTool(stepIndex, step, resolved, startedAt);
      if (resolved.status === 'ambiguous') {
        throw new Error(resolved.clarificationQuestion ?? `resolve_timezone found ambiguous timezone text ${text}.`);
      }
      const timeZone = resolved.candidates[0];
      if (resolved.status !== 'resolved' || timeZone === undefined) {
        throw new Error(`resolve_timezone returned no timezone for ${text}.`);
      }
      return { kind: 'timezone', timeZone };
    }
    case 'resolve_clock_time': {
      const text = requirePlanString(step.text ?? step.query, step, 'text');
      const resolved = await options.implementations.resolveClockTime({ text, calendarContext: request.calendarContext });
      const clock = resolved.candidates[0];
      recordTool(stepIndex, step, resolved, startedAt);
      if (clock === undefined) {
        throw new Error(`resolve_clock_time returned no candidates for ${text}.`);
      }
      return { kind: 'time', time: { hour: clock.hour, minute: clock.minute } };
    }
    case 'interpret_clock_phrase': {
      const time = requirePlanTime(step.time, step);
      const output = { time, phrase: step.text ?? step.query, assumptions: step.assumptions };
      recordTool(stepIndex, step, output, startedAt);
      return { kind: 'time', time };
    }
    case 'shift_datetime': {
      const baseStep = requirePlanNumber(step.baseStep, step, 'baseStep');
      const calendarContext = await calendarContextForPlanStep(step, executeStep, request, options.implementations);
      const [base, time] = await Promise.all([
        candidateOutputsFromPlanStep(baseStep, executeStep),
        timeFromPlanStep(step, executeStep),
      ]);
      const candidates = await Promise.all(base.map(async (baseCandidate) => {
        const shiftInput: Parameters<TemporalToolImplementations['shiftDateTime']>[0] = {
          base: baseForPlanCandidate(baseCandidate.candidate, calendarContext),
          delta: cleanDelta(step.delta),
          calendarContext,
        };
        if (time !== undefined) {
          shiftInput.time = time;
        }
        return {
          label: baseCandidate.label,
          candidate: await options.implementations.shiftDateTime(shiftInput),
        };
      }));
      recordTool(stepIndex, step, candidates, startedAt);
      return { kind: 'candidates', candidates };
    }
    case 'set_clock_time': {
      const baseStep = requirePlanNumber(step.baseStep, step, 'baseStep');
      const calendarContext = await calendarContextForPlanStep(step, executeStep, request, options.implementations);
      const [base, time] = await Promise.all([
        candidateOutputsFromPlanStep(baseStep, executeStep),
        timeFromPlanStep(step, executeStep),
      ]);
      if (time === undefined) {
        throw new Error('set_clock_time requires either time or timeStep.');
      }
      const candidates = await Promise.all(base.map(async (baseCandidate) => ({
        label: baseCandidate.label,
        candidate: await options.implementations.setClockTime({
          base: baseForPlanCandidate(baseCandidate.candidate, calendarContext),
          time,
          calendarContext,
        }),
      })));
      recordTool(stepIndex, step, candidates, startedAt);
      return { kind: 'candidates', candidates };
    }
    case 'combine_date_time': {
      const baseStep = requirePlanNumber(step.baseStep, step, 'baseStep');
      const calendarContext = await calendarContextForPlanStep(step, executeStep, request, options.implementations);
      const [base, time] = await Promise.all([
        candidateOutputsFromPlanStep(baseStep, executeStep),
        timeFromPlanStep(step, executeStep),
      ]);
      if (time === undefined) {
        throw new Error('combine_date_time requires either time or timeStep.');
      }
      const candidates = await Promise.all(base.map(async (baseCandidate) => ({
        label: baseCandidate.label,
        candidate: await options.implementations.setClockTime({
          base: baseForPlanCandidate(baseCandidate.candidate, calendarContext),
          time,
          calendarContext,
        }),
      })));
      recordTool(stepIndex, step, candidates, startedAt);
      return { kind: 'candidates', candidates };
    }
    case 'propose_candidate': {
      const calendarContext = await calendarContextForPlanStep(step, executeStep, request, options.implementations);
      const isoInstant = step.isoInstant ?? epochSecondsToIso(step.epochSeconds);
      const candidate = candidateFromProposal({
        isoInstant,
        timeZone: calendarContext.timeZone,
        precision: requirePlanPrecision(step.precision, step),
        assumptions: [...planStepAssumptions(step)],
      });
      recordTool(stepIndex, step, candidate, startedAt);
      return { kind: 'candidates', candidates: [{ candidate }] };
    }
  }
}

async function candidateOutputsFromPlanStep(
  stepIndex: number,
  executeStep: (stepIndex: number) => Promise<TemporalPlanStepOutput>,
): Promise<PlanCandidateOutput[]> {
  const output = await executeStep(stepIndex);
  if (output.kind !== 'candidates') {
    throw new Error(`Step ${stepIndex} produced ${output.kind}, not candidates.`);
  }
  return output.candidates;
}

async function timeFromPlanStep(
  step: TemporalPlanStep,
  executeStep: (stepIndex: number) => Promise<TemporalPlanStepOutput>,
): Promise<{ hour: number; minute: number } | undefined> {
  if (step.time !== null) {
    return step.time;
  }
  if (step.timeStep === null) {
    return undefined;
  }
  const output = await executeStep(step.timeStep);
  if (output.kind !== 'time') {
    throw new Error(`Step ${step.timeStep} produced ${output.kind}, not a time.`);
  }
  return output.time;
}

async function calendarContextForPlanStep(
  step: TemporalPlanStep,
  executeStep: (stepIndex: number) => Promise<TemporalPlanStepOutput>,
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
): Promise<CalendarContext> {
  const timeZone = await timeZoneFromPlanStep(step, executeStep, request, implementations);
  if (timeZone === undefined) {
    return request.calendarContext;
  }
  return { ...request.calendarContext, timeZone: timeZone.timeZone };
}

async function timeZoneFromPlanStep(
  step: TemporalPlanStep,
  executeStep: (stepIndex: number) => Promise<TemporalPlanStepOutput>,
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
): Promise<TimeZoneResolutionCandidate | undefined> {
  if (step.timeZoneStep !== null) {
    const output = await executeStep(step.timeZoneStep);
    if (output.kind !== 'timezone') {
      throw new Error(`Step ${step.timeZoneStep} produced ${output.kind}, not a timezone.`);
    }
    return output.timeZone;
  }
  if (step.timeZone === null) {
    return undefined;
  }

  const resolved = await implementations.resolveTimeZone({ text: step.timeZone, calendarContext: request.calendarContext });
  if (resolved.status === 'ambiguous') {
    throw new Error(resolved.clarificationQuestion ?? `Plan timezone ${step.timeZone} is ambiguous.`);
  }
  const timeZone = resolved.candidates[0];
  if (resolved.status !== 'resolved' || timeZone === undefined) {
    throw new Error(`Plan timezone ${step.timeZone} could not be resolved.`);
  }
  return timeZone;
}

function baseForPlanCandidate(candidate: Candidate, calendarContext: CalendarContext): Parameters<TemporalToolImplementations['shiftDateTime']>[0]['base'] {
  if (candidate.timeZone === calendarContext.timeZone) {
    return { zonedDateTime: candidate.zonedDateTime };
  }
  const zonedDateTime = Temporal.ZonedDateTime.from(candidate.zonedDateTime);
  if (candidate.precision === 'date') {
    return { plainDate: zonedDateTime.toPlainDate().toString(), timeZone: calendarContext.timeZone };
  }
  return { zonedDateTime: zonedDateTime.withTimeZone(calendarContext.timeZone).toString() };
}

function finalPlanOutput(plan: TemporalPlan, outputs: TemporalPlanStepOutput[]): TemporalPlanStepOutput {
  if (plan.finalStep !== null) {
    const output = outputs[plan.finalStep];
    if (output?.kind === 'candidates') {
      return output;
    }
  }

  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    const output = outputs[index];
    if (output?.kind === 'candidates') {
      return output;
    }
  }
  throw new Error(`Plan ${plan.label} did not produce a candidate.`);
}

function isTimeRangePlan(plan: TemporalPlan): boolean {
  return plan.kind === 'time_range' || plan.startStep !== undefined && plan.startStep !== null || plan.endStep !== undefined && plan.endStep !== null;
}

async function enrichedRangesFromPlanOutput(
  plan: TemporalPlan,
  outputs: TemporalPlanStepOutput[],
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
): Promise<PlanRangeResult[]> {
  const startStep = requireRangeStep(plan.startStep ?? null, plan, 'startStep');
  const endStep = requireRangeStep(plan.endStep ?? null, plan, 'endStep');
  const startOutput = outputs[startStep];
  const endOutput = outputs[endStep];
  if (startOutput?.kind !== 'candidates') {
    throw new Error(`Range plan ${plan.label} startStep ${startStep} did not produce candidates.`);
  }
  if (endOutput?.kind !== 'candidates') {
    throw new Error(`Range plan ${plan.label} endStep ${endStep} did not produce candidates.`);
  }

  const pairs = pairRangeCandidateOutputs(startOutput.candidates, endOutput.candidates);
  const startValidationText = rangeEndpointValidationText(plan, startStep, request.text);
  const endValidationText = rangeEndpointValidationText(plan, endStep, request.text);
  return Promise.all(pairs.map(async (pair) => {
    const [start, end] = await Promise.all([
      enrichCandidate(pair.start.candidate, request, implementations, startValidationText),
      enrichCandidate(pair.end.candidate, request, implementations, endValidationText),
    ]);
    const range: PlanRangeResult = {
      start: { enriched: start, label: pair.start.label },
      end: { enriched: end, label: pair.end.label },
      label: pair.label ?? plan.label,
      validation: validateRange(start, end),
      finalizable: false,
    };
    range.finalizable = range.validation.passed;
    return range;
  }));
}

function rangeEndpointValidationText(plan: TemporalPlan, stepIndex: number, fallback: string): string {
  return planStepValidationText(plan, stepIndex, new Set()) ?? fallback;
}

function planStepValidationText(plan: TemporalPlan, stepIndex: number, seen: Set<number>): string | null {
  if (seen.has(stepIndex)) {
    return null;
  }
  seen.add(stepIndex);
  const step = plan.steps[stepIndex];
  if (step === undefined) {
    return null;
  }

  const parts: string[] = [];
  if (step.baseStep !== null) {
    const baseText = planStepValidationText(plan, step.baseStep, seen);
    if (baseText !== null) {
      parts.push(baseText);
    }
  }
  if (step.timeStep !== null) {
    const timeText = planStepValidationText(plan, step.timeStep, seen);
    if (timeText !== null) {
      parts.push(timeText);
    }
  }
  if (step.timeZoneStep !== null) {
    const timeZoneText = planStepValidationText(plan, step.timeZoneStep, seen);
    if (timeZoneText !== null) {
      parts.push(timeZoneText);
    }
  }

  switch (step.operation) {
    case 'resolve_calendar_query':
      parts.push(...optionalPlanText(step.query));
      break;
    case 'resolve_clock_time':
    case 'interpret_clock_phrase':
    case 'resolve_timezone':
      parts.push(...optionalPlanText(step.text));
      break;
    case 'resolve_holiday':
      parts.push(...optionalPlanText(step.holidayName));
      break;
    case 'resolve_weekday_anchor':
      parts.push(...optionalPlanText([step.weekdayAnchor, step.weekday].filter((value) => value !== null).join(' ')));
      break;
    case 'set_clock_time':
    case 'combine_date_time':
      if (step.time !== null) {
        parts.push(formatPlanTimeForValidation(step.time));
      }
      break;
    case 'shift_datetime':
      break;
    case 'propose_candidate':
      if (step.time !== null) {
        parts.push(formatPlanTimeForValidation(step.time));
      }
      break;
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function optionalPlanText(value: string | null): string[] {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? [] : [trimmed];
}

function formatPlanTimeForValidation(time: { hour: number; minute: number }): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

function requireRangeStep(value: number | null, plan: TemporalPlan, field: 'startStep' | 'endStep'): number {
  if (value === null) {
    throw new Error(`Range plan ${plan.label} requires ${field}.`);
  }
  return value;
}

function pairRangeCandidateOutputs(
  starts: PlanCandidateOutput[],
  ends: PlanCandidateOutput[],
): Array<{ start: PlanCandidateOutput; end: PlanCandidateOutput; label?: string | undefined }> {
  if (starts.length === 0 || ends.length === 0) {
    return [];
  }
  if (starts.length === ends.length) {
    return starts.map((start, index) => ({ start, end: ends[index]!, label: start.label ?? ends[index]?.label }));
  }
  if (starts.length === 1) {
    return ends.map((end) => ({ start: starts[0]!, end, label: end.label ?? starts[0]!.label }));
  }
  if (ends.length === 1) {
    return starts.map((start) => ({ start, end: ends[0]!, label: start.label ?? ends[0]!.label }));
  }
  throw new Error(`Cannot pair ${starts.length} range starts with ${ends.length} range ends.`);
}

function validateRange(start: EnrichedCandidate, end: EnrichedCandidate): TemporalValidation {
  const warnings: string[] = [];
  if (!start.finalizable) {
    warnings.push(...(start.validation?.warnings ?? ['Range start is not finalizable.']).map((warning) => `Range start: ${warning}`));
  }
  if (!end.finalizable) {
    warnings.push(...(end.validation?.warnings ?? ['Range end is not finalizable.']).map((warning) => `Range end: ${warning}`));
  }
  const startEpoch = candidateToEpoch(start.candidate);
  const endEpoch = candidateToEpoch(end.candidate);
  if (endEpoch <= startEpoch) {
    warnings.push('Range end must be after range start; overnight ranges must explicitly shift the end date.');
  }
  return {
    passed: warnings.length === 0,
    warnings,
    checks: ['range_endpoint_validation', 'range_order_validation'],
  };
}

function planStepAssumptions(step: TemporalPlanStep): string[] {
  const assumptions = step.assumptions ?? [];
  return assumptions.length > 0 ? assumptions : ['Plan IR proposed an explicit candidate.'];
}

function normalizeTemporalPlan(plan: RawTemporalPlan): TemporalPlan {
  const normalized: TemporalPlan = {
    kind: plan.kind ?? 'instant',
    label: plan.label,
    rationale: plan.rationale,
    assumptions: plan.assumptions ?? [],
    confidence: plan.confidence ?? 0.7,
    finalStep: plan.finalStep ?? null,
    startStep: plan.startStep ?? null,
    endStep: plan.endStep ?? null,
    steps: plan.steps.map(normalizeTemporalPlanStep),
  };
  return normalized;
}

function normalizeTemporalPlanStep(step: RawTemporalPlanStep): TemporalPlanStep {
  return {
    ...step,
    assumptions: step.assumptions ?? [],
  };
}

function requirePlanString(value: string | null, step: TemporalPlanStep, field: string): string {
  if (value === null || value.trim() === '') {
    throw new Error(`${step.operation} requires ${field}.`);
  }
  return value;
}

function requirePlanNumber(value: number | null, step: TemporalPlanStep, field: string): number {
  if (value === null) {
    throw new Error(`${step.operation} requires ${field}.`);
  }
  return value;
}

function requirePlanTime(value: { hour: number; minute: number } | null, step: TemporalPlanStep): { hour: number; minute: number } {
  if (value === null) {
    throw new Error(`${step.operation} requires time.`);
  }
  return value;
}

function requirePlanPrecision(value: Candidate['precision'] | null, step: TemporalPlanStep): Candidate['precision'] {
  if (value === null) {
    throw new Error(`${step.operation} requires precision.`);
  }
  return value;
}

function resolveWeekdayAnchor(step: TemporalPlanStep, calendarContext: CalendarContext): PlanCandidateOutput[] {
  const weekday = requirePlanWeekday(step.weekday, step);
  const anchor = step.weekdayAnchor ?? 'upcoming';
  const reference = Temporal.Instant.from(calendarContext.referenceInstant).toZonedDateTimeISO(calendarContext.timeZone);
  const targetDay = PLAN_WEEKDAY_INDEX[weekday];
  const rawDaysUntilUpcoming = (targetDay - reference.dayOfWeek + 7) % 7;
  const daysUntilUpcoming = anchor === 'after_next_ambiguous' && rawDaysUntilUpcoming === 0
    ? 7
    : rawDaysUntilUpcoming;
  const upcomingDate = reference.toPlainDate().add({ days: daysUntilUpcoming });
  const candidates = weekdayAnchorOffsets(anchor).map((weeksAfterUpcoming) => {
    const targetDate = upcomingDate.add({ weeks: weeksAfterUpcoming });
    const zonedDateTime = targetDate.toZonedDateTime({
      timeZone: calendarContext.timeZone,
      plainTime: Temporal.PlainTime.from('12:00'),
    });
    const label = weekdayAnchorLabel(weekday, anchor, weeksAfterUpcoming, targetDate);
    return {
      label,
      candidate: candidateFromProposal({
        isoInstant: zonedDateTime.toInstant().toString(),
        timeZone: calendarContext.timeZone,
        precision: 'date',
        assumptions: [`Resolved ${label} with explicit weekday-anchor calendar arithmetic.`],
      }),
    };
  });
  if (candidates.length === 0) {
    throw new Error(`resolve_weekday_anchor produced no candidates for ${weekday}.`);
  }
  return candidates;
}

function requirePlanWeekday(value: typeof PLAN_WEEKDAYS[number] | null, step: TemporalPlanStep): typeof PLAN_WEEKDAYS[number] {
  if (value === null) {
    throw new Error(`${step.operation} requires weekday.`);
  }
  return value;
}

function weekdayAnchorOffsets(anchor: NonNullable<TemporalPlanStep['weekdayAnchor']>): number[] {
  switch (anchor) {
    case 'last':
      return [-1];
    case 'this':
    case 'upcoming':
      return [0];
    case 'next':
      return [1];
    case 'next_ambiguous':
      return [0, 1];
    case 'after_next_ambiguous':
      return [1, 2];
  }
}

function weekdayAnchorLabel(weekday: typeof PLAN_WEEKDAYS[number], anchor: NonNullable<TemporalPlanStep['weekdayAnchor']>, weeksAfterUpcoming: number, date: Temporal.PlainDate): string {
  const titledWeekday = titleCase(weekday);
  if (anchor === 'next_ambiguous') {
    return weeksAfterUpcoming === 0 ? `This ${titledWeekday}` : `Next ${titledWeekday}`;
  }
  if (anchor === 'after_next_ambiguous') {
    return weeksAfterUpcoming === 1 ? `${titledWeekday} after next` : `${titledWeekday} two weeks after next`;
  }
  if (anchor === 'last') {
    return `Last ${titledWeekday}`;
  }
  if (anchor === 'next') {
    return `Next ${titledWeekday}`;
  }
  return `${titleCase(anchor)} ${titledWeekday} (${PLAN_MONTH_NAMES[date.month - 1]} ${date.day})`;
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function appendTrace(trace: TemporalAgentTraceStep[], entries: UnindexedTraceStep[]): void {
  for (const entry of entries) {
    trace.push({ index: trace.length + 1, ...entry });
  }
}

function responseFromPlanClarification(
  question: string,
  executions: Array<{ plan: TemporalPlan; enriched: EnrichedCandidate; label?: string | undefined }>,
  trace: TemporalAgentTraceStep[],
  candidateCount: number,
  toolPasses: number,
  agentAttempts: number,
  langfuseTraceId: string | undefined,
  originalText: string,
): TemporalParseResponse {
  const alternatives = uniqueAlternativesByEpoch(executions
    .map((execution) => alternativeFromEnrichedCandidate(execution.label ?? execution.plan.label, execution.enriched, 'agent+plan', 0.75, originalText))
  ).sort((a, b) => a.epoch - b.epoch);
  const debug: NonNullable<TemporalParseResponse['debug']> = { candidateCount, agentAttempts, toolPasses, trace };
  if (langfuseTraceId !== undefined) {
    debug.langfuseTraceId = langfuseTraceId;
  }
  const response: TemporalParseResponse = {
    status: alternatives.length > 1 ? 'needs_clarification' : 'failed',
    confidence: 0,
    method: 'agent+plan',
    assumptions: [],
    ambiguity: alternatives.length > 1 ? [question] : ['Plan IR produced multiple candidates but not enough usable clarification alternatives.'],
    validation: {
      passed: false,
      warnings: alternatives.length > 1 ? [question] : ['Plan IR clarification failed.'],
      checks: ['plan_ir_clarification'],
    },
    debug,
  };
  if (alternatives.length > 1) {
    response.clarificationQuestion = question;
    response.clarificationAlternatives = alternatives;
  }
  return response;
}

function responseFromRangePlanClarification(
  question: string,
  executions: Array<{ plan: TemporalPlan; range: PlanRangeResult }>,
  trace: TemporalAgentTraceStep[],
  candidateCount: number,
  toolPasses: number,
  agentAttempts: number,
  langfuseTraceId: string | undefined,
  originalText: string,
): TemporalParseResponse {
  const alternatives = uniqueAlternativesByEpoch(executions
    .map((execution) => alternativeFromEnrichedRange(execution.range.label ?? execution.plan.label, execution.range, 'agent+plan', 0.75, originalText))
  ).sort((a, b) => rangeAlternativeSortKey(a) - rangeAlternativeSortKey(b));
  const debug: NonNullable<TemporalParseResponse['debug']> = { candidateCount, agentAttempts, toolPasses, trace };
  if (langfuseTraceId !== undefined) {
    debug.langfuseTraceId = langfuseTraceId;
  }
  const response: TemporalParseResponse = {
    status: alternatives.length > 1 ? 'needs_clarification' : 'failed',
    confidence: 0,
    method: 'agent+plan',
    assumptions: [],
    ambiguity: alternatives.length > 1 ? [question] : ['Plan IR produced multiple ranges but not enough usable clarification alternatives.'],
    validation: {
      passed: false,
      warnings: alternatives.length > 1 ? [question] : ['Plan IR range clarification failed.'],
      checks: ['plan_ir_range_clarification'],
    },
    debug,
  };
  if (alternatives.length > 1) {
    response.clarificationQuestion = question;
    response.clarificationAlternatives = alternatives;
  }
  return response;
}

function responseFromQuestionOnlyPlanClarification(
  question: string,
  reason: string,
  trace: TemporalAgentTraceStep[],
  method: TemporalMethod,
): TemporalParseResponse {
  return {
    status: 'needs_clarification',
    confidence: 0,
    method,
    assumptions: [],
    ambiguity: [reason],
    validation: {
      passed: false,
      warnings: [reason],
      checks: ['plan_ir_clarification'],
    },
    clarificationQuestion: question,
    debug: { candidateCount: 0, agentAttempts: 0, toolPasses: 0, trace },
  };
}

function responseFromFailedPlanIr(
  reason: string,
  trace: TemporalAgentTraceStep[],
  candidateCount: number,
  toolPasses: number,
  agentAttempts: number,
  langfuseTraceId?: string,
): TemporalParseResponse {
  const debug: NonNullable<TemporalParseResponse['debug']> = { candidateCount, agentAttempts, toolPasses, trace };
  if (langfuseTraceId !== undefined) {
    debug.langfuseTraceId = langfuseTraceId;
  }
  return {
    status: 'failed',
    confidence: 0,
    method: 'agent+plan',
    assumptions: [],
    ambiguity: [reason],
    validation: {
      passed: false,
      warnings: [reason],
      checks: ['plan_ir'],
    },
    debug,
  };
}

async function deterministicParse(
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<TemporalParseResponse> {
  const startedAt = nowMs();
  const explicitRange = await deterministicExplicitRangeParse(request, implementations, features);
  if (explicitRange !== null) {
    explicitRange.debug = explicitRange.debug ?? {};
    explicitRange.debug.deterministicDurationMs = elapsedMs(startedAt);
    return explicitRange;
  }

  const parsed = await implementations.parseExpression({
    text: request.text,
    calendarContext: request.calendarContext,
    ...(features === undefined ? {} : { features }),
  });
  const candidate = parsed.candidates[0];
  if (!candidate) {
    const needsTimeClarification = parsed.parserNotes.some((note) => note.includes('unresolved time signal'));
    const needsTimeZoneClarification = parsed.parserNotes.some((note) => note.toLowerCase().includes('ambiguous timezone') || note.startsWith('Which timezone'));
    const needsClarification = needsTimeClarification || needsTimeZoneClarification;
    const warning = parsed.parserNotes[0] ?? 'No deterministic parse candidate found.';
    const clarificationAlternatives = needsTimeClarification ? await bareHourAlternatives(request, implementations, features) : [];
    const response: TemporalParseResponse = {
      status: needsClarification ? 'needs_clarification' : 'failed',
      confidence: 0,
      method: 'fallback',
      assumptions: [],
      ambiguity: needsClarification ? [warning] : [],
      validation: { passed: false, warnings: parsed.parserNotes, checks: needsClarification ? ['deterministic_preflight'] : [] },
      debug: { candidateCount: 0, deterministicDurationMs: elapsedMs(startedAt) },
    };
    if (needsClarification) {
      response.clarificationQuestion = needsTimeZoneClarification
        ? warning
        : clarificationAlternatives.length > 0
        ? 'Which time did you mean?'
        : 'Please include AM or PM, or use 24-hour time like 13:00.';
      if (clarificationAlternatives.length > 0) {
        response.clarificationAlternatives = clarificationAlternatives;
      }
    }
    return response;
  }

  const enriched = await enrichCandidate(candidate, request, implementations);
  const response = responseFromEnrichedCandidate(
    enriched,
    'deterministic',
    0.75,
    'Deterministic temporal parse.',
    1,
    0,
    0,
    undefined,
    undefined,
    undefined,
    request.text,
  );
  response.debug = response.debug ?? {};
  response.debug.deterministicDurationMs = elapsedMs(startedAt);
  return response;
}

async function deterministicExplicitRangeParse(
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<TemporalParseResponse | null> {
  const discordParts = parseExplicitDiscordTimestampRangeParts(request.text);
  if (discordParts !== null) {
    return deterministicDiscordTimestampRangeParse(discordParts, request, implementations);
  }

  const parts = parseExplicitDatedTimeRangeParts(request.text);
  if (parts !== null) {
    return deterministicDatedTimeRangeParse(parts, request, implementations, features);
  }

  const bareParts = parseExplicitBareTimeRangeParts(request.text);
  if (bareParts !== null) {
    return deterministicBareTimeRangeParse(bareParts, request, implementations, features);
  }

  return null;
}

async function deterministicDiscordTimestampRangeParse(
  parts: ExplicitDiscordTimestampRangeParts,
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
): Promise<TemporalParseResponse | null> {
  const startCandidate = candidateFromDiscordTimestampRangePart(parts.startEpochSeconds, request, 'Used explicit Discord timestamp range start from input.');
  const endCandidate = candidateFromDiscordTimestampRangePart(parts.endEpochSeconds, request, 'Used explicit Discord timestamp range end from input.');
  if (startCandidate === null || endCandidate === null) {
    return null;
  }

  const [start, end] = await Promise.all([
    enrichCandidate(startCandidate, request, implementations, `<t:${parts.startEpochSeconds}${parts.startFormatCode}>`),
    enrichCandidate(endCandidate, request, implementations, `<t:${parts.endEpochSeconds}${parts.endFormatCode}>`),
  ]);
  const range: PlanRangeResult = {
    start: { enriched: start, label: 'Start' },
    end: { enriched: end, label: 'End' },
    label: 'Discord timestamp range',
    validation: validateRange(start, end),
    finalizable: false,
  };
  range.finalizable = range.validation.passed;

  const startFormatIndex = discordTimestampFormatIndex(parts.startFormatCode);
  const endFormatIndex = discordTimestampFormatIndex(parts.endFormatCode);
  const response = responseFromEnrichedRange(
    range,
    'deterministic',
    0.95,
    'Deterministic Discord timestamp range parse.',
    2,
    0,
    0,
    undefined,
    undefined,
    request.text,
  );
  if (response.range !== undefined) {
    response.suggestedFormatIndex = startFormatIndex;
    response.range.start.suggestedFormatIndex = startFormatIndex;
    response.range.end.suggestedFormatIndex = endFormatIndex;
    response.range.discord = `${discordTimestamp(response.range.start.epoch, startFormatIndex)} - ${discordTimestamp(response.range.end.epoch, endFormatIndex)}`;
  }
  return response;
}

function parseExplicitDiscordTimestampRangeParts(text: string): ExplicitDiscordTimestampRangeParts | null {
  const match = DISCORD_TIMESTAMP_RANGE_PATTERN.exec(text);
  if (!match?.[1] || !match[3]) {
    return null;
  }
  return {
    startEpochSeconds: match[1],
    startFormatCode: match[2] ?? ':f',
    endEpochSeconds: match[3],
    endFormatCode: match[4] ?? ':f',
  };
}

function candidateFromDiscordTimestampRangePart(epochSeconds: string, request: TemporalParseRequest, assumption: string): Candidate | null {
  try {
    const instant = Temporal.Instant.fromEpochNanoseconds(BigInt(epochSeconds) * 1_000_000_000n);
    return candidateFromProposal({
      isoInstant: instant.toString(),
      timeZone: request.calendarContext.timeZone,
      precision: 'datetime',
      assumptions: [assumption],
    });
  } catch {
    return null;
  }
}

function discordTimestampFormatIndex(formatCode: string): number {
  const normalized = formatCode === ':r' ? ':R' : formatCode;
  const formatIndex = DISCORD_TIMESTAMP_FORMAT_CODES.findIndex((code) => code === normalized);
  return formatIndex >= 0 ? formatIndex : 4;
}

async function deterministicDatedTimeRangeParse(
  parts: ExplicitDatedTimeRangeParts,
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<TemporalParseResponse | null> {

  const timeZoneResolution = await implementations.resolveTimeZone({ text: request.text, calendarContext: request.calendarContext });
  if (timeZoneResolution.status === 'ambiguous') {
    return null;
  }
  const resolvedTimeZone = timeZoneResolution.status === 'resolved' ? timeZoneResolution.candidates[0] : undefined;
  if (parts.suffixText.length > 0 && resolvedTimeZone === undefined) {
    return null;
  }

  const calendarContext: CalendarContext = {
    ...request.calendarContext,
    timeZone: resolvedTimeZone?.timeZone ?? request.calendarContext.timeZone,
  };
  const dateResolved = await implementations.resolveCalendarQuery({
    query: parts.dateText,
    calendarContext,
    ...(features === undefined ? {} : { features }),
  });
  const dateCandidate = dateResolved.candidates[0];
  if (dateCandidate === undefined) {
    return null;
  }

  const [startClockResolved, endClockResolved] = await Promise.all([
    implementations.resolveClockTime({ text: parts.startText, calendarContext }),
    implementations.resolveClockTime({ text: parts.endText, calendarContext }),
  ]);
  const startClock = startClockResolved.candidates[0];
  const endClock = endClockResolved.candidates[0];
  if (startClock === undefined || endClock === undefined) {
    return null;
  }

  const date = Temporal.ZonedDateTime.from(dateCandidate.zonedDateTime)
    .withTimeZone(calendarContext.timeZone)
    .toPlainDate()
    .toString();
  const [startCandidate, endCandidate] = await Promise.all([
    implementations.setClockTime({ base: { plainDate: date, timeZone: calendarContext.timeZone }, time: { hour: startClock.hour, minute: startClock.minute }, calendarContext }),
    implementations.setClockTime({ base: { plainDate: date, timeZone: calendarContext.timeZone }, time: { hour: endClock.hour, minute: endClock.minute }, calendarContext }),
  ]);
  const timeZoneText = resolvedTimeZone?.matchedText ?? '';
  const [start, end] = await Promise.all([
    enrichCandidate(startCandidate, request, implementations, explicitRangeEndpointValidationText(parts, parts.startText, timeZoneText)),
    enrichCandidate(endCandidate, request, implementations, explicitRangeEndpointValidationText(parts, parts.endText, timeZoneText)),
  ]);
  const range: PlanRangeResult = {
    start: { enriched: start, label: parts.startText },
    end: { enriched: end, label: parts.endText },
    label: `${parts.dateText} ${parts.startText}-${parts.endText}`,
    validation: validateRange(start, end),
    finalizable: false,
  };
  range.finalizable = range.validation.passed;
  return responseFromEnrichedRange(
    range,
    'deterministic',
    0.82,
    'Deterministic explicit time range parse.',
    2,
    0,
    0,
    undefined,
    undefined,
    request.text,
  );
}

async function deterministicBareTimeRangeParse(
  parts: ExplicitBareTimeRangeParts,
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<TemporalParseResponse | null> {
  const timeZoneResolution = await implementations.resolveTimeZone({ text: request.text, calendarContext: request.calendarContext });
  if (timeZoneResolution.status === 'ambiguous') {
    return null;
  }
  const resolvedTimeZone = timeZoneResolution.status === 'resolved' ? timeZoneResolution.candidates[0] : undefined;
  if (parts.suffixText.length > 0 && resolvedTimeZone === undefined) {
    return null;
  }

  const calendarContext: CalendarContext = {
    ...request.calendarContext,
    timeZone: resolvedTimeZone?.timeZone ?? request.calendarContext.timeZone,
  };
  const startResolved = await implementations.parseExpression({
    text: parts.startText,
    calendarContext,
    ...(features === undefined ? {} : { features }),
  });
  const startCandidate = startResolved.candidates[0];
  if (startCandidate === undefined) {
    return null;
  }

  const endClockResolved = await implementations.resolveClockTime({ text: parts.endText, calendarContext });
  const endClock = endClockResolved.candidates[0];
  if (endClock === undefined) {
    return null;
  }

  const startDate = Temporal.ZonedDateTime.from(startCandidate.zonedDateTime)
    .withTimeZone(calendarContext.timeZone)
    .toPlainDate()
    .toString();
  let endCandidate = await implementations.setClockTime({
    base: { plainDate: startDate, timeZone: calendarContext.timeZone },
    time: { hour: endClock.hour, minute: endClock.minute },
    calendarContext,
  });
  if (candidateToEpoch(endCandidate) <= candidateToEpoch(startCandidate)) {
    endCandidate = await implementations.shiftDateTime({
      base: { zonedDateTime: endCandidate.zonedDateTime },
      delta: { days: 1 },
      calendarContext,
    });
  }

  const timeZoneText = resolvedTimeZone?.matchedText ?? '';
  const [start, end] = await Promise.all([
    enrichCandidate(startCandidate, request, implementations, explicitBareRangeEndpointValidationText(parts.startText, timeZoneText)),
    enrichCandidate(endCandidate, request, implementations, explicitBareRangeEndpointValidationText(parts.endText, timeZoneText)),
  ]);
  const range: PlanRangeResult = {
    start: { enriched: start, label: parts.startText },
    end: { enriched: end, label: parts.endText },
    label: `${parts.startText}-${parts.endText}`,
    validation: validateRange(start, end),
    finalizable: false,
  };
  range.finalizable = range.validation.passed;
  return responseFromEnrichedRange(
    range,
    'deterministic',
    0.82,
    'Deterministic explicit time range parse.',
    2,
    0,
    0,
    undefined,
    undefined,
    request.text,
  );
}

function parseExplicitDatedTimeRangeParts(text: string): ExplicitDatedTimeRangeParts | null {
  const match = EXPLICIT_DATED_TIME_RANGE_PATTERN.exec(text);
  const groups = match?.groups as Partial<ExplicitDatedTimeRangeParts> | undefined;
  if (groups?.dateText === undefined || groups.startText === undefined || groups.endText === undefined) {
    return null;
  }
  const dateText = groups.dateText.trim();
  if (!EXPLICIT_RANGE_DATE_SIGNAL_PATTERN.test(dateText)) {
    return null;
  }
  return {
    dateText,
    startText: groups.startText.trim(),
    endText: groups.endText.trim(),
    suffixText: groups.suffixText?.trim() ?? '',
  };
}

function parseExplicitBareTimeRangeParts(text: string): ExplicitBareTimeRangeParts | null {
  const match = EXPLICIT_BARE_TIME_RANGE_PATTERN.exec(text);
  const groups = match?.groups as Partial<ExplicitBareTimeRangeParts> | undefined;
  if (groups?.startText === undefined || groups.endText === undefined) {
    return null;
  }
  return {
    startText: groups.startText.trim(),
    endText: groups.endText.trim(),
    suffixText: groups.suffixText?.trim() ?? '',
  };
}

function explicitRangeEndpointValidationText(parts: ExplicitDatedTimeRangeParts, clockText: string, timeZoneText: string): string {
  return [parts.dateText, clockText, timeZoneText].filter((part) => part.length > 0).join(' ');
}

function explicitBareRangeEndpointValidationText(clockText: string, timeZoneText: string): string {
  return [clockText, timeZoneText].filter((part) => part.length > 0).join(' ');
}

async function validateDeterministicResolvedResponse(
  request: TemporalParseRequest,
  response: TemporalParseResponse,
  options: TemporalGraphOptions,
): Promise<TemporalParseResponse> {
  if (response.kind === 'time_range') {
    return response;
  }
  if (response.status !== 'resolved' || response.canonical === undefined || response.epoch === undefined || options.openaiApiKey === undefined) {
    return response;
  }

  const modelName = options.openaiModel ?? DEFAULT_OPENAI_MODEL;
  const reasoningEffort = options.openaiReasoningEffort ?? DEFAULT_OPENAI_REASONING_EFFORT;
  const model = createChatModel(options.openaiApiKey, modelName, reasoningEffort);
  const trace: TemporalAgentTraceStep[] = [];
  const langfuseHandler = await createLangfuseHandler(options, request);
  const callbacks = langfuseHandler === null ? undefined : [langfuseHandler];
  const candidate = candidateFromResponse(response);
  const enriched = await enrichCandidate(candidate, request, options.implementations);

  try {
    const finalValidationStartedAt = nowMs();
    const finalValidation = await validateFinalAnswer(model, request, enriched, 'Deterministic temporal parse.', trace, callbacks);
    trace.push({
      index: trace.length + 1,
      type: 'final_validation',
      name: 'deterministic_final_validation',
      durationMs: elapsedMs(finalValidationStartedAt),
      output: finalValidation,
    });
    if (!finalValidation.accepted) {
      return responseFromRejectedFinalValidation(
        enriched,
        finalValidation,
        1,
        0,
        0,
        trace,
        'deterministic',
        getLangfuseTraceId(langfuseHandler),
      );
    }

    const validated: TemporalParseResponse = {
      ...response,
      confidence: Math.min(0.9, Math.max(response.confidence, finalValidation.confidence)),
      validation: {
        ...response.validation,
        checks: uniqueStrings([...response.validation.checks, 'llm_final_validation']),
      },
      debug: {
        ...response.debug,
        model: modelName,
        reasoningEffort,
        trace,
        finalValidation,
      },
    };
    const traceId = getLangfuseTraceId(langfuseHandler);
    if (traceId !== undefined) {
      validated.debug = validated.debug ?? {};
      validated.debug.langfuseTraceId = traceId;
    }
    return validated;
  } catch (error) {
    return {
      ...response,
      validation: {
        ...response.validation,
        warnings: [...response.validation.warnings, `LLM validation failed after deterministic parse: ${errorMessage(error)}`],
      },
      debug: {
        ...response.debug,
        model: modelName,
        reasoningEffort,
        trace,
      },
    };
  }
}

function candidateFromResponse(response: TemporalParseResponse): Candidate {
  if (response.canonical === undefined) {
    throw new Error('Cannot reconstruct deterministic candidate without canonical response.');
  }
  return {
    id: response.debug?.chosenCandidateId ?? `deterministic_${response.epoch ?? 'unknown'}`,
    isoInstant: response.canonical.isoInstant,
    zonedDateTime: response.canonical.zonedDateTime,
    timeZone: response.canonical.timeZone,
    precision: response.canonical.precision,
    assumptions: response.assumptions,
    provenance: 'explicit',
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

async function runAmbiguityPolicy(
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<AmbiguityPolicyResult | null> {
  const bareClock = await bareMeridiemClockAmbiguityPolicy(request, implementations, features);
  if (bareClock !== null) {
    return bareClock;
  }

  const multiClock = await multiClockDateAmbiguityPolicy(request, implementations, features);
  if (multiClock !== null) {
    return multiClock;
  }
  return null;
}

function responseFromAmbiguityPolicy(policy: AmbiguityPolicyResult, durationMs: number): TemporalParseResponse {
  return {
    status: 'needs_clarification',
    confidence: 0,
    method: 'fallback',
    assumptions: [],
    ambiguity: [policy.question],
    validation: { passed: false, warnings: [policy.question], checks: ['ambiguity_policy'] },
    clarificationQuestion: policy.question,
    clarificationAlternatives: policy.alternatives,
    debug: {
      candidateCount: policy.alternatives.length,
      ambiguityPolicyDurationMs: durationMs,
      trace: [{
        index: 1,
        type: 'router',
        name: 'ambiguity_policy',
        durationMs,
        output: {
          policy: policy.name,
          alternatives: policy.alternatives.map(compactClarificationAlternative),
        },
      }],
    },
  };
}

async function multiClockDateAmbiguityPolicy(
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<AmbiguityPolicyResult | null> {
  if (parseExplicitDatedTimeRangeParts(request.text) !== null) {
    return null;
  }

  const dateText = MONTH_DATE_QUERY_PATTERN.exec(request.text)?.[0];
  if (dateText === undefined) {
    return null;
  }

  const clocks = explicitAmPmClockMentions(request.text);
  if (clocks.length < 2) {
    return null;
  }
  if (hasExplicitRangeConnectorBetweenClocks(request.text, clocks)) {
    return null;
  }

  const dateResolved = await implementations.resolveCalendarQuery({
    query: dateText,
    calendarContext: request.calendarContext,
    ...(features === undefined ? {} : { features }),
  });
  const dateCandidate = dateResolved.candidates[0];
  if (dateCandidate === undefined) {
    return null;
  }

  const alternatives = await Promise.all(clocks.map(async (clock) => {
    const candidate = await implementations.setClockTime({
      base: { zonedDateTime: dateCandidate.zonedDateTime },
      time: clock.time,
      calendarContext: request.calendarContext,
    });
    const enriched = await enrichCandidate(candidate, { ...request, text: `${dateText} at ${clock.text}` }, implementations);
    return alternativeFromEnrichedCandidate(clock.label, enriched, 'deterministic', 0.85, request.text);
  }));

  return {
    name: 'multi_clock_date',
    question: 'Which event time should the Discord timestamp use?',
    alternatives: alternatives.sort((a, b) => a.epoch - b.epoch),
  };
}

function hasExplicitRangeConnectorBetweenClocks(text: string, clocks: ExplicitClockMention[]): boolean {
  for (let index = 0; index < clocks.length - 1; index += 1) {
    const left = clocks[index]!;
    const right = clocks[index + 1]!;
    const connector = text.slice(left.index + left.text.length, right.index);
    if (/^\s*(?:[-\u2013\u2014]|to\b|through\b|thru\b|until\b|til\b|till\b)\s*$/i.test(connector)) {
      return true;
    }
  }
  return false;
}

async function bareMeridiemClockAmbiguityPolicy(
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<AmbiguityPolicyResult | null> {
  if (TOP_LEVEL_NEXT_WEEKDAY_PATTERN.test(request.text)) {
    return null;
  }

  const mentions = ambiguousBareClockMentions(request.text);
  if (mentions.length !== 1) {
    return null;
  }

  const mention = mentions[0]!;
  const alternatives = await Promise.all([
    meridiemClarificationAlternative(mention, 'am', request, implementations, features),
    meridiemClarificationAlternative(mention, 'pm', request, implementations, features),
  ]);
  const distinctAlternatives = distinctEpochAlternatives(
    alternatives.filter((alternative): alternative is TemporalClarificationAlternative => alternative !== null),
  );

  if (distinctAlternatives.length <= 1) {
    return null;
  }

  return {
    name: 'bare_meridiem_clock',
    question: 'Did you mean AM or PM?',
    alternatives: distinctAlternatives.sort((a, b) => a.epoch - b.epoch),
  };
}

function ambiguousBareClockMentions(text: string): AmbiguousBareClockMention[] {
  const mentions: AmbiguousBareClockMention[] = [];
  for (const match of text.matchAll(AMBIGUOUS_BARE_COLON_CLOCK_PATTERN)) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (match.index !== undefined) {
      mentions.push({ text: match[0], index: match.index, hour, minute, replacementBase: `${hour}:${String(minute).padStart(2, '0')}` });
    }
  }

  for (const match of text.matchAll(AMBIGUOUS_BARE_COMPACT_CLOCK_PATTERN)) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (match.index !== undefined && !mentions.some((mention) => rangesOverlap(mention.index, mention.text.length, match.index!, match[0].length))) {
      mentions.push({ text: match[0], index: match.index, hour, minute, replacementBase: `${hour}:${String(minute).padStart(2, '0')}` });
    }
  }

  const trailingHour = trailingBareHourMention(text);
  if (trailingHour !== null && !mentions.some((mention) => rangesOverlap(mention.index, mention.text.length, trailingHour.index, trailingHour.text.length))) {
    mentions.push(trailingHour);
  }

  return mentions.sort((a, b) => a.index - b.index);
}

function rangesOverlap(leftIndex: number, leftLength: number, rightIndex: number, rightLength: number): boolean {
  return leftIndex < rightIndex + rightLength && rightIndex < leftIndex + leftLength;
}

function trailingBareHourMention(text: string): AmbiguousBareClockMention | null {
  const match = /\b(\d{1,2})\s*$/.exec(text.trimEnd());
  if (!match?.[1] || match.index === undefined) {
    return null;
  }

  const hour = Number(match[1]);
  if (hour < 1 || hour > 12) {
    return null;
  }
  return { text: match[1], index: match.index, hour, minute: 0, replacementBase: String(hour) };
}

async function meridiemClarificationAlternative(
  mention: AmbiguousBareClockMention,
  meridiem: 'am' | 'pm',
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<TemporalClarificationAlternative | null> {
  const replacement = `${mention.replacementBase}${meridiem}`;
  const text = `${request.text.slice(0, mention.index)}${replacement}${request.text.slice(mention.index + mention.text.length)}`;
  return clarificationAlternative(text, formatBareMeridiemLabel(mention, meridiem), request, implementations, features);
}

function formatBareMeridiemLabel(mention: AmbiguousBareClockMention, meridiem: 'am' | 'pm'): string {
  const suffix = meridiem.toUpperCase();
  return mention.minute === 0
    ? `${mention.hour} ${suffix}`
    : `${mention.hour}:${String(mention.minute).padStart(2, '0')} ${suffix}`;
}

function distinctEpochAlternatives(alternatives: TemporalClarificationAlternative[]): TemporalClarificationAlternative[] {
  const seen = new Set<number>();
  const distinct: TemporalClarificationAlternative[] = [];
  for (const alternative of alternatives) {
    if (!seen.has(alternative.epoch)) {
      seen.add(alternative.epoch);
      distinct.push(alternative);
    }
  }
  return distinct;
}

function explicitAmPmClockMentions(text: string): ExplicitClockMention[] {
  return [...text.matchAll(AM_PM_CLOCK_MENTION_PATTERN)].map((match) => {
    const hourText = match[1]!;
    const suffix = match[3]!.toLowerCase();
    let hour = Number(hourText) % 12;
    if (suffix === 'pm') {
      hour += 12;
    }
    const minute = Number(match[2] ?? 0);
    return {
      text: match[0],
      index: match.index ?? 0,
      label: formatClockMentionLabel(hour, minute),
      time: { hour, minute },
    };
  });
}

function formatClockMentionLabel(hour: number, minute: number): string {
  const hour12 = hour % 12 || 12;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return minute === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

async function bareHourAlternatives(
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<TemporalClarificationAlternative[]> {
  const trailingHour = trailingBareHour(request.text);
  if (trailingHour === null || trailingHour < 1 || trailingHour > 12) {
    return [];
  }

  const prefix = request.text.trim().replace(/\b\d{1,2}\s*$/, '').trimEnd();
  const alternatives = await Promise.all([
    clarificationAlternative(`${prefix} ${trailingHour}am`, `${trailingHour} AM`, request, implementations, features),
    clarificationAlternative(`${prefix} ${trailingHour}pm`, `${trailingHour} PM`, request, implementations, features),
  ]);
  return alternatives.filter((alternative): alternative is TemporalClarificationAlternative => alternative !== null);
}

async function clarificationAlternative(
  text: string,
  label: string,
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  features?: TemporalFeatureFlags,
): Promise<TemporalClarificationAlternative | null> {
  const parsed = await implementations.parseExpression({
    text,
    calendarContext: request.calendarContext,
    ...(features === undefined ? {} : { features }),
  });
  const candidate = parsed.candidates[0];
  if (!candidate) {
    return null;
  }

  const enriched = await enrichCandidate(candidate, { ...request, text }, implementations);
  if (!enriched.finalizable) {
    return null;
  }

  return alternativeFromEnrichedCandidate(label, enriched, 'deterministic', 0.85, text);
}

function alternativeFromEnrichedCandidate(
  label: string,
  enriched: EnrichedCandidate,
  method: TemporalClarificationAlternative['method'],
  confidence: number,
  originalText: string,
): TemporalClarificationAlternative {
  const canonical: TemporalClarificationAlternative['canonical'] = {
    isoInstant: enriched.candidate.isoInstant,
    zonedDateTime: enriched.candidate.zonedDateTime,
    timeZone: enriched.candidate.timeZone,
    precision: enriched.candidate.precision,
  };
  if (enriched.facts !== undefined) {
    canonical.weekday = enriched.facts.weekday;
  }

  return {
    label,
    epoch: candidateToEpoch(enriched.candidate),
    suggestedFormatIndex: suggestedFormatIndex(originalText, enriched.candidate.precision),
    confidence,
    method,
    canonical,
    assumptions: enriched.candidate.assumptions,
  };
}

function alternativeFromEnrichedRange(
  label: string,
  range: PlanRangeResult,
  method: TemporalClarificationAlternative['method'],
  confidence: number,
  originalText: string,
): TemporalClarificationAlternative {
  const rangeResult = temporalRangeResultFromPlanRange(range, originalText);
  return {
    label,
    kind: 'time_range',
    epoch: rangeResult.start.epoch,
    suggestedFormatIndex: rangeResult.start.suggestedFormatIndex,
    range: rangeResult,
    confidence,
    method,
    canonical: rangeResult.start.canonical,
    assumptions: rangeAssumptions(range),
  };
}

function temporalRangeResultFromPlanRange(range: PlanRangeResult, originalText: string): TemporalRangeResult {
  const formats = rangeDisplayFormatIndexes(range.start.enriched, range.end.enriched, originalText);
  const start = temporalRangeEndpointFromEnriched(range.start.enriched, formats.startFormatIndex);
  const end = temporalRangeEndpointFromEnriched(range.end.enriched, formats.endFormatIndex);
  return {
    start,
    end,
    discord: `${discordTimestamp(start.epoch, start.suggestedFormatIndex)} - ${discordTimestamp(end.epoch, end.suggestedFormatIndex)}`,
  };
}

function temporalRangeEndpointFromEnriched(enriched: EnrichedCandidate, suggestedFormatIndexValue: number): TemporalRangeEndpoint {
  const canonical: TemporalRangeEndpoint['canonical'] = {
    isoInstant: enriched.candidate.isoInstant,
    zonedDateTime: enriched.candidate.zonedDateTime,
    timeZone: enriched.candidate.timeZone,
    precision: enriched.candidate.precision,
  };
  if (enriched.facts !== undefined) {
    canonical.weekday = enriched.facts.weekday;
  }
  return {
    epoch: candidateToEpoch(enriched.candidate),
    suggestedFormatIndex: suggestedFormatIndexValue,
    canonical,
  };
}

function rangeDisplayFormatIndexes(start: EnrichedCandidate, end: EnrichedCandidate, originalText: string): { startFormatIndex: number; endFormatIndex: number } {
  const startFormatIndex = suggestedFormatIndex(originalText, start.candidate.precision);
  const startZdt = Temporal.ZonedDateTime.from(start.candidate.zonedDateTime).withTimeZone(start.candidate.timeZone);
  const endZdt = Temporal.ZonedDateTime.from(end.candidate.zonedDateTime).withTimeZone(end.candidate.timeZone);
  const sameDate = start.candidate.timeZone === end.candidate.timeZone && Temporal.PlainDate.compare(startZdt.toPlainDate(), endZdt.toPlainDate()) === 0;
  const endFormatIndex = sameDate && start.candidate.precision !== 'date' && end.candidate.precision !== 'date'
    ? 2
    : suggestedFormatIndex(originalText, end.candidate.precision);
  return { startFormatIndex, endFormatIndex };
}

function discordTimestamp(epoch: number, formatIndex: number): string {
  return `<t:${epoch}${DISCORD_TIMESTAMP_FORMAT_CODES[formatIndex] ?? ':f'}>`;
}

function rangeAssumptions(range: PlanRangeResult): string[] {
  return [...range.start.enriched.candidate.assumptions, ...range.end.enriched.candidate.assumptions];
}

function canUseForClarification(enriched: EnrichedCandidate): boolean {
  if (enriched.finalizable) {
    return true;
  }

  const warnings = enriched.validation?.warnings ?? [];
  return enriched.candidate.precision === 'datetime'
    && warnings.length > 0
    && warnings.every((warning) => /trailing bare number|unresolved time signal/i.test(warning));
}

function canUseForPlanClarification(enriched: EnrichedCandidate): boolean {
  if (canUseForClarification(enriched)) {
    return true;
  }

  return enriched.candidate.precision === 'date' || enriched.candidate.precision === 'datetime';
}

function conciseClarificationLabel(label: string, enriched: EnrichedCandidate): string {
  const trimmed = label.trim();
  if (trimmed.length > 0 && trimmed.length <= 24 && !/[,-]/.test(trimmed)) {
    return trimmed;
  }

  const zdt = Temporal.ZonedDateTime.from(enriched.candidate.zonedDateTime);
  if (enriched.candidate.precision === 'datetime' || enriched.candidate.precision === 'time') {
    return formatClockLabel(zdt);
  }
  if (enriched.candidate.precision === 'date') {
    return `${zdt.month}/${zdt.day}`;
  }
  return trimmed.length > 0 ? trimmed.slice(0, 24) : 'Use this time';
}

function formatClockLabel(zdt: Temporal.ZonedDateTime): string {
  const hour12 = zdt.hour % 12 || 12;
  const suffix = zdt.hour < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(zdt.minute).padStart(2, '0')} ${suffix}`;
}

function trailingBareHour(text: string): number | null {
  const match = /\b(\d{1,2})\s*$/.exec(text.trim());
  if (!match?.[1]) {
    return null;
  }
  return Number(match[1]);
}

async function enrichCandidate(
  candidate: Candidate,
  request: TemporalParseRequest,
  implementations: TemporalToolImplementations,
  validationText = request.text,
): Promise<EnrichedCandidate> {
  const [facts, shortFormat, fullFormat, weekdayFormat, discordFormat, validation] = await Promise.all([
    implementations.candidateFacts({ candidate, calendarContext: request.calendarContext }),
    implementations.formatCandidate({ candidate, calendarContext: request.calendarContext, style: 'short' }),
    implementations.formatCandidate({ candidate, calendarContext: request.calendarContext, style: 'full' }),
    implementations.formatCandidate({ candidate, calendarContext: request.calendarContext, style: 'weekday-check' }),
    implementations.formatCandidate({ candidate, calendarContext: request.calendarContext, style: 'discord-preview' }),
    implementations.validateCandidate({ originalText: validationText, candidate, calendarContext: request.calendarContext }),
  ]);

  return {
    candidate,
    facts,
    formats: [
      { style: 'short', formatted: shortFormat },
      { style: 'full', formatted: fullFormat },
      { style: 'weekday-check', formatted: weekdayFormat },
      { style: 'discord-preview', formatted: discordFormat },
    ],
    validation: {
      passed: validation.passed,
      warnings: [...validation.warnings, ...validation.errors, ...validation.ambiguity],
      checks: ['candidate_facts', 'format_candidate', 'validate_candidate'],
    },
    finalizable: validation.passed,
  };
}

function responseFromEnrichedCandidate(
  enriched: EnrichedCandidate,
  method: TemporalParseResponse['method'],
  confidence: number,
  rationale: string,
  candidateCount: number,
  toolPasses: number,
  agentAttempts: number,
  trace?: TemporalAgentTraceStep[],
  finalValidation?: TemporalFinalValidation,
  langfuseTraceId?: string,
  originalText = '',
): TemporalParseResponse {
  const validation = enriched.validation ?? { passed: false, warnings: ['Candidate was not validated.'], checks: [] };
  const canonical: NonNullable<TemporalParseResponse['canonical']> = {
    isoInstant: enriched.candidate.isoInstant,
    zonedDateTime: enriched.candidate.zonedDateTime,
    timeZone: enriched.candidate.timeZone,
    precision: enriched.candidate.precision,
  };
  if (enriched.facts !== undefined) {
    canonical.weekday = enriched.facts.weekday;
  }
  const debug: NonNullable<TemporalParseResponse['debug']> = { chosenCandidateId: enriched.candidate.id, candidateCount, agentAttempts, toolPasses };
  if (trace !== undefined) {
    debug.trace = trace;
  }
  if (finalValidation !== undefined) {
    debug.finalValidation = finalValidation;
  }
  if (langfuseTraceId !== undefined) {
    debug.langfuseTraceId = langfuseTraceId;
  }
  const response: TemporalParseResponse = {
    kind: 'instant',
    status: validation.passed ? 'resolved' : 'ambiguous',
    epoch: candidateToEpoch(enriched.candidate),
    suggestedFormatIndex: suggestedFormatIndex(originalText, enriched.candidate.precision),
    confidence: validation.passed ? confidence : Math.min(confidence, 0.4),
    method,
    canonical,
    assumptions: rationale ? [...enriched.candidate.assumptions, rationale] : enriched.candidate.assumptions,
    ambiguity: validation.passed ? [] : validation.warnings,
    validation,
    debug,
  };

  return response;
}

function responseFromEnrichedRange(
  range: PlanRangeResult,
  method: TemporalParseResponse['method'],
  confidence: number,
  rationale: string,
  candidateCount: number,
  toolPasses: number,
  agentAttempts: number,
  trace: TemporalAgentTraceStep[] | undefined,
  langfuseTraceId: string | undefined,
  originalText: string,
): TemporalParseResponse {
  const rangeResult = temporalRangeResultFromPlanRange(range, originalText);
  const debug: NonNullable<TemporalParseResponse['debug']> = { chosenCandidateId: `${range.start.enriched.candidate.id}:${range.end.enriched.candidate.id}`, candidateCount, agentAttempts, toolPasses };
  if (trace !== undefined) {
    debug.trace = trace;
  }
  if (langfuseTraceId !== undefined) {
    debug.langfuseTraceId = langfuseTraceId;
  }
  return {
    kind: 'time_range',
    status: range.validation.passed ? 'resolved' : 'ambiguous',
    epoch: rangeResult.start.epoch,
    suggestedFormatIndex: rangeResult.start.suggestedFormatIndex,
    range: rangeResult,
    confidence: range.validation.passed ? confidence : Math.min(confidence, 0.4),
    method,
    canonical: rangeResult.start.canonical,
    assumptions: rationale ? [...rangeAssumptions(range), rationale] : rangeAssumptions(range),
    ambiguity: range.validation.passed ? [] : range.validation.warnings,
    validation: range.validation,
    debug,
  };
}

function compactEnrichedCandidate(enriched: EnrichedCandidate): Record<string, unknown> {
  return cleanUndefined({
    candidate: {
      id: enriched.candidate.id,
      isoInstant: enriched.candidate.isoInstant,
      zonedDateTime: enriched.candidate.zonedDateTime,
      timeZone: enriched.candidate.timeZone,
      precision: enriched.candidate.precision,
      provenance: enriched.candidate.provenance,
      assumptions: enriched.candidate.assumptions,
    },
    facts: compactCandidateFacts(enriched.facts),
    validation: enriched.validation,
    finalizable: enriched.finalizable,
  });
}

function compactRangeResult(range: PlanRangeResult, originalText: string): Record<string, unknown> {
  return {
    start: compactEnrichedCandidate(range.start.enriched),
    end: compactEnrichedCandidate(range.end.enriched),
    validation: range.validation,
    finalizable: range.finalizable,
    display: temporalRangeResultFromPlanRange(range, originalText),
  };
}

function compactCandidateFacts(facts: EnrichedCandidate['facts']): Record<string, unknown> | undefined {
  if (facts === undefined) {
    return undefined;
  }
  return cleanUndefined({
    weekday: facts.weekday,
    isoDate: facts.isoDate,
    isoInstant: facts.isoInstant,
    dayOfWeek: facts.dayOfWeek,
    weekOfYear: facts.weekOfYear,
    month: facts.month,
    year: facts.year,
    timeZone: facts.timeZone,
  });
}

function compactClarificationAlternative(alternative: TemporalClarificationAlternative): Record<string, unknown> {
  return {
    label: alternative.label,
    kind: alternative.kind,
    epoch: alternative.epoch,
    suggestedFormatIndex: alternative.suggestedFormatIndex,
    range: alternative.range,
    confidence: alternative.confidence,
    method: alternative.method,
  };
}

function uniqueAlternativesByEpoch(alternatives: TemporalClarificationAlternative[]): TemporalClarificationAlternative[] {
  const seen = new Map<string, TemporalClarificationAlternative>();
  for (const alternative of alternatives) {
    const key = alternativeKey(alternative);
    if (!seen.has(key)) {
      seen.set(key, alternative);
    }
  }
  return [...seen.values()];
}

function alternativeKey(alternative: TemporalClarificationAlternative): string {
  if (alternative.range !== undefined) {
    return `${alternative.range.start.epoch}:${alternative.range.end.epoch}`;
  }
  return String(alternative.epoch);
}

function rangeAlternativeSortKey(alternative: TemporalClarificationAlternative): number {
  return alternative.range?.start.epoch ?? alternative.epoch;
}

function rangeKey(range: PlanRangeResult): string {
  return `${candidateToEpoch(range.start.enriched.candidate)}:${candidateToEpoch(range.end.enriched.candidate)}`;
}

function onlyFinalizableCandidate(enrichedCandidates: Map<string, EnrichedCandidate>): EnrichedCandidate | null {
  const finalizable = [...enrichedCandidates.values()].filter((candidate) => candidate.finalizable);
  return finalizable.length === 1 ? finalizable[0]! : null;
}

function blocksAutoFinalize(enriched: EnrichedCandidate, originalText: string): boolean {
  return enriched.candidate.precision === 'date' && hasTrailingNonYearNumber(originalText);
}

function hasTrailingNonYearNumber(text: string): boolean {
  const match = /\b(\d{1,4})\s*$/.exec(text.trim());
  if (!match?.[1]) {
    return false;
  }
  const value = Number(match[1]);
  return !(match[1].length === 4 && value >= 1900 && value <= 2200);
}

function responseFromRejectedFinalValidation(
  enriched: EnrichedCandidate,
  finalValidation: TemporalFinalValidation,
  candidateCount: number,
  toolPasses: number,
  agentAttempts: number,
  trace: TemporalAgentTraceStep[],
  method: TemporalParseResponse['method'],
  langfuseTraceId?: string,
): TemporalParseResponse {
  const warning = `Final LLM validation rejected candidate: ${finalValidation.reason}`;
  const debug: NonNullable<TemporalParseResponse['debug']> = {
    chosenCandidateId: enriched.candidate.id,
    candidateCount,
    agentAttempts,
    toolPasses,
    trace,
    finalValidation,
  };
  if (langfuseTraceId !== undefined) {
    debug.langfuseTraceId = langfuseTraceId;
  }
  return {
    status: 'needs_clarification',
    confidence: Math.min(finalValidation.confidence, 0.3),
    method,
    assumptions: enriched.candidate.assumptions,
    ambiguity: [warning, ...finalValidation.missingOrContradictedSignals],
    validation: {
      passed: false,
      warnings: [warning, ...finalValidation.missingOrContradictedSignals],
      checks: [...(enriched.validation?.checks ?? []), 'llm_final_validation'],
    },
    debug,
  };
}

function responseFromUnfinalizedAgent(
  candidateCount: number,
  toolPasses: number,
  agentAttempts: number,
  trace: TemporalAgentTraceStep[],
  langfuseTraceId?: string,
): TemporalParseResponse {
  const warning = 'Agent did not produce a validated final candidate.';
  const debug: NonNullable<TemporalParseResponse['debug']> = { candidateCount, agentAttempts, toolPasses, trace };
  if (langfuseTraceId !== undefined) {
    debug.langfuseTraceId = langfuseTraceId;
  }
  return {
    status: 'failed',
    confidence: 0,
    method: 'agent+tools',
    assumptions: [],
    ambiguity: [warning],
    validation: {
      passed: false,
      warnings: [warning],
      checks: ['agent_tool_chain'],
    },
    debug,
  };
}

function shouldRunFinalValidation(finalized: EnrichedCandidate, agentProposedCandidateIds: Set<string>): boolean {
  if (agentProposedCandidateIds.has(finalized.candidate.id)) {
    return true;
  }
  return finalized.candidate.provenance === 'shift_math' || finalized.candidate.provenance === 'sandbox';
}

function skippedFinalValidation(finalized: EnrichedCandidate): TemporalFinalValidation {
  return {
    accepted: true,
    confidence: 0.9,
    reason: `Skipped independent LLM validation because ${finalized.candidate.provenance} produced a deterministic candidate that passed built-in validation.`,
    missingOrContradictedSignals: [],
  };
}

async function validateFinalAnswer(
  model: ChatOpenAI,
  request: TemporalParseRequest,
  finalized: EnrichedCandidate,
  rationale: string,
  trace: TemporalAgentTraceStep[],
  callbacks: BaseCallbackHandler[] | undefined,
): Promise<TemporalFinalValidation> {
  const validator = model.withStructuredOutput(FinalValidationSchema);
  const result = await validator.invoke([
    new SystemMessage(`You are an independent final validation pass for a temporal parser.

Your job is not to be generous. Reject candidates that dropped, contradicted, or guessed around temporal signals in the original input.

Validation rules:
- Accept only if the candidate preserves every date and time signal in the input or states a reasonable ambiguity/assumption.
- Reject if a date-only noon default is used while the input contains a possible time signal, including an unconsumed bare number like "1" after a date phrase.
- Reject if the candidate's displayed date, weekday, timezone, or clock time conflicts with the user's text.
- Do not reject solely because the final weekday differs from a mentioned weekday when the input uses that weekday as an anchor for a relative offset, such as "day after next Saturday" or "two days before Friday". In those cases, validate the full phrase semantics instead of requiring the anchor weekday to equal the final weekday.
- Reject when AM/PM ambiguity, fuzzy shorthand, or trailing tokens materially affect the timestamp and were not handled by the agent.
- Do not reject solely because a weekday qualifier like "next Saturday" has multiple colloquial interpretations when the deterministic tool chain resolved it and the candidate weekday is correct.
- Do not reject solely because leetspeak is obfuscated. If the input uses a leet/l33t/133t time phrase and the agent explicitly interprets it as the cultural clock phrase 13:37, treat that interpretation as supported.
- Do not return a corrected timestamp; only accept or reject this exact candidate.`),
    new HumanMessage(JSON.stringify({
      originalText: request.text,
      calendarContext: request.calendarContext,
      candidate: finalized.candidate,
      facts: finalized.facts,
      formats: finalized.formats,
      deterministicValidation: finalized.validation,
      agentRationale: rationale,
      agentTrace: trace,
    })),
  ], callbacks === undefined ? undefined : { callbacks, runName: 'temporal-final-validation' });
  return {
    accepted: result.accepted,
    confidence: result.confidence,
    reason: result.reason,
    missingOrContradictedSignals: result.missingOrContradictedSignals ?? [],
  };
}

async function applySemanticConsistencyGateIfConfigured(
  request: TemporalParseRequest,
  response: TemporalParseResponse,
  options: TemporalGraphOptions,
  context: SemanticConsistencyGateContext,
): Promise<TemporalParseResponse> {
  if (!semanticConsistencyGateEnabled(options.features) || response.status === 'failed') {
    return response;
  }

  if (options.openaiApiKey === undefined) {
    response.debug = response.debug ?? {};
    response.debug.semanticConsistencyGate = {
      decision: 'uncertain',
      confidence: 0,
      reasonCodes: ['missing_openai_api_key'],
      explanation: 'Semantic Consistency Gate skipped because OPENAI_API_KEY is not configured.',
    };
    response.validation = {
      ...response.validation,
      warnings: uniqueStrings([...response.validation.warnings, 'Semantic Consistency Gate skipped because OPENAI_API_KEY is not configured.']),
    };
    return response;
  }

  const startedAt = nowMs();
  const packet = await buildSemanticConsistencyGatePacket(request, response, options, context);
  try {
    const gate = await runSemanticConsistencyGate(request, options, packet);
    appendSemanticConsistencyGateTrace(response, gate, packet, elapsedMs(startedAt));
    if (gate.decision === 'accept') {
      response.validation = {
        ...response.validation,
        checks: uniqueStrings([...response.validation.checks, 'semantic_consistency_gate']),
      };
      return response;
    }
    return responseFromSemanticConsistencyGateRejection(response, gate);
  } catch (error) {
    const gate: TemporalSemanticConsistencyGateResult = {
      decision: 'uncertain',
      confidence: 0,
      reasonCodes: ['gate_error'],
      explanation: `Semantic Consistency Gate failed: ${errorMessage(error)}`,
    };
    appendSemanticConsistencyGateTrace(response, gate, packet, elapsedMs(startedAt));
    return responseFromSemanticConsistencyGateRejection(response, gate);
  }
}

async function runSemanticConsistencyGate(
  request: TemporalParseRequest,
  options: TemporalGraphOptions,
  packet: Record<string, unknown>,
): Promise<TemporalSemanticConsistencyGateResult> {
  if (options.openaiApiKey === undefined) {
    throw new Error('OPENAI_API_KEY is required for the Semantic Consistency Gate.');
  }
  const modelName = options.openaiModel ?? DEFAULT_OPENAI_MODEL;
  const reasoningEffort = options.openaiReasoningEffort ?? DEFAULT_OPENAI_REASONING_EFFORT;
  const model = createChatModel(options.openaiApiKey, modelName, reasoningEffort);
  const validator = model.withStructuredOutput(SemanticConsistencyGateSchema);
  const langfuseHandler = await createLangfuseHandler(options, request);
  const callbacks = langfuseHandler === null ? undefined : [langfuseHandler];
  const result = await validator.invoke([
    new SystemMessage(`You are the Semantic Consistency Gate for a temporal parser.

Your job is to decide whether the solver output is semantically consistent with the original input and supplied deterministic facts.

Rules:
- Return accept only when the candidate or clarification alternatives preserve every material temporal signal in the original input.
- Return reject when the solver dropped, contradicted, guessed around, or overfit a date, weekday, clock, timezone, relative offset, or ambiguity signal.
- Return uncertain when the packet is insufficient to decide safely.
- Clarification alternatives can be accepted when they represent the materially plausible interpretations instead of choosing one silently.
- Respect documented deterministic executor conventions included in candidate assumptions and validation evidence. In particular, unqualified "first of the month" resolves to the next first-of-month when the current month's first at local noon is not in the future; do not reject that as dropped ambiguity.
- For date-like relative offsets using days, weeks, months, or years with no explicit clock time, the documented product convention is date precision at 12:00 PM local time. Do not reject those candidates solely because they do not preserve the reference clock time. Relative offsets using hours or minutes should preserve exact time arithmetic.
- A bare integer from 13 through 23 with no other meaningful tokens is a supported 24-hour clock shorthand in this product. It resolves to the next occurrence of that local hour, rolling forward to the next day if today's occurrence has passed. Do not reject that as generic day-of-month ambiguity. Bare 1 through 12 remains meridiem-ambiguous unless another explicit signal resolves it.
- Bare numeric "0" is a supported explicit Unix epoch-zero input when deterministic evidence shows epoch parsing. Do not reject it as an unsupported bare-number guess.
- Stable cultural clock phrases for leet time are supported. When the plan explicitly uses interpret_clock_phrase for leet/l33t/133t/1337 time, 13:37 is the intended clock and should not be rejected as unsupported inference.
- Do not repair the result, produce a new timestamp, rewrite Plan-IR, or suggest a better answer.
- Be stricter for a singular resolved timestamp than for a clarification response.`),
    new HumanMessage(JSON.stringify(packet)),
  ], callbacks === undefined ? undefined : { callbacks, runName: 'semantic-consistency-gate' });
  return {
    decision: result.decision,
    confidence: result.confidence,
    reasonCodes: result.reasonCodes ?? [],
    explanation: result.explanation,
  };
}

async function buildSemanticConsistencyGatePacket(
  request: TemporalParseRequest,
  response: TemporalParseResponse,
  options: TemporalGraphOptions,
  context: SemanticConsistencyGateContext,
): Promise<Record<string, unknown>> {
  const candidate = response.status === 'resolved' && response.canonical !== undefined
    ? await enrichCandidate(candidateFromResponse(response), request, options.implementations)
    : undefined;
  const alternatives = await Promise.all((response.clarificationAlternatives ?? []).map(async (alternative) => {
    const enriched = await enrichCandidate(candidateFromAlternative(alternative), request, options.implementations);
    return cleanUndefined({
      label: alternative.label,
      epoch: alternative.epoch,
      suggestedFormatIndex: alternative.suggestedFormatIndex,
      confidence: alternative.confidence,
      method: alternative.method,
      canonical: alternative.canonical,
      assumptions: alternative.assumptions,
      facts: enriched.facts,
      formats: enriched.formats,
      deterministicValidation: enriched.validation,
    });
  }));

  return cleanUndefined({
    originalText: request.text,
    calendarContext: request.calendarContext,
    solver: cleanUndefined({
      stage: context.solverStage,
      model: context.modelName,
      method: response.method,
    }),
    planIr: context.planResult === undefined ? undefined : summarizeValue(context.planResult),
    endpointCompletion: context.endpointCompletion === undefined ? undefined : summarizeValue({ finishReason: context.endpointCompletion.finishReason, usage: context.endpointCompletion.usage }),
    result: cleanUndefined({
      status: response.status,
      epoch: response.epoch,
      suggestedFormatIndex: response.suggestedFormatIndex,
      confidence: response.confidence,
      canonical: response.canonical,
      assumptions: response.assumptions,
      ambiguity: response.ambiguity,
      validation: response.validation,
    }),
    candidate: candidate === undefined ? undefined : compactEnrichedCandidate(candidate),
    clarificationQuestion: response.clarificationQuestion,
    clarificationAlternatives: alternatives.length === 0 ? undefined : alternatives,
    trace: summarizeValue(response.debug?.trace ?? []),
  });
}

function candidateFromAlternative(alternative: TemporalClarificationAlternative): Candidate {
  return {
    id: `clarification_${alternative.epoch}`,
    isoInstant: alternative.canonical.isoInstant,
    zonedDateTime: alternative.canonical.zonedDateTime,
    timeZone: alternative.canonical.timeZone,
    precision: alternative.canonical.precision,
    assumptions: alternative.assumptions,
    provenance: 'explicit',
  };
}

function appendSemanticConsistencyGateTrace(
  response: TemporalParseResponse,
  gate: TemporalSemanticConsistencyGateResult,
  packet: Record<string, unknown>,
  durationMs: number,
): void {
  response.debug = response.debug ?? {};
  response.debug.semanticConsistencyGate = gate;
  response.debug.trace = reindexTrace([...(response.debug.trace ?? []), {
    index: 0,
    type: 'final_validation',
    name: 'semantic_consistency_gate',
    durationMs,
    input: summarizeValue(packet),
    output: gate,
  }]);
}

function responseFromSemanticConsistencyGateRejection(
  response: TemporalParseResponse,
  gate: TemporalSemanticConsistencyGateResult,
): TemporalParseResponse {
  const warning = `Semantic Consistency Gate ${gate.decision}: ${gate.explanation}`;
  const warnings = uniqueStrings([warning, ...gate.reasonCodes, ...response.validation.warnings]);
  const { epoch: _epoch, suggestedFormatIndex: _suggestedFormatIndex, canonical: _canonical, range: _range, kind: _kind, ...safeResponse } = response;
  return {
    ...safeResponse,
    status: response.clarificationAlternatives !== undefined && response.clarificationAlternatives.length > 1 ? 'needs_clarification' : 'failed',
    confidence: Math.min(response.confidence, gate.confidence, 0.3),
    ambiguity: uniqueStrings([warning, ...gate.reasonCodes, ...response.ambiguity]),
    validation: {
      passed: false,
      warnings,
      checks: uniqueStrings([...response.validation.checks, 'semantic_consistency_gate']),
    },
  };
}

function systemPrompt(request: TemporalParseRequest, agentContext: TemporalAgentContext): string {
  return `You are a precise temporal coalescing agent. Your job is to convert fuzzy user time text into one correct timestamp.

Rules:
- Use tools for calendar facts and parsing; do not rely on memory for weekday math.
- The tool executor supports multiple independent tool calls in one assistant turn. On the first tool pass, call all independent tools that are useful instead of discovering one fact per turn.
- Do not call finalize_candidate in the same assistant turn as a candidate-producing tool; wait for candidate IDs from tool output.
- Do not call a dependent tool in parallel with the tool that produces its base candidate ID. For example, shift_datetime must wait for the candidate it shifts unless you provide an explicit base instant/date.
- Use factual context as a hint, not as a final answer. Candidate IDs still must come from tools before finalization.
- If chrono context has unparsedText, treat the chrono candidate as incomplete until the remaining text has been accounted for.
- If factual context has chrono.candidate plus unparsedText that is a relative modifier, use shift_datetime directly with base.zonedDateTime from chrono.candidate and the modifier's delta. Do not rediscover the same chrono candidate through parse_expression first.
- For holidays, call resolve_holiday and trust holiday_library candidates; do not propose holiday dates from memory.
- If factual context contains holiday hints, use them to choose resolve_holiday arguments instead of guessing holiday names or dates.
- If full-expression parsing fails or returns a rejected partial candidate, decompose the expression with tools.
- If the input has an obvious typo in a temporal word, interpret the intended temporal word yourself, state it as an assumption, and call candidate-producing tools directly. Do not spend a tool call asking deterministic parsers to parse the misspelled raw text.
- For relative compositions, resolve or choose an anchor, then apply shift_datetime. If the intended normalized clock time is already known, pass time to shift_datetime instead of calling set_clock_time afterward.
- Use resolve_clock_time only for conventional explicit clock syntax. For fuzzy clock wording, you may infer the intended normalized 24-hour time yourself, pass it to shift_datetime or set_clock_time, and state that assumption.
- Use resolve_timezone for explicit timezone text. Prefer regional/IANA timezone intent for names like Eastern time, UK time, and Japan time; use fixed offsets only for explicit UTC/GMT offset text.
- If a timezone abbreviation is ambiguous, such as CST, IST, or BST, ask for clarification rather than choosing silently.
- When inferring a fuzzy clock token, first decide whether the token is wordplay, slang, or a cultural time phrase rather than a literal clock string.
- Preserve all available signal. Do not silently discard trailing characters or default minutes to :00 when the token appears to include minute information.
- For obfuscated cultural clock phrases, preserve the intended phrase meaning. For example, leetspeak references to "leet time" mean 13:37, not a literal parse of the visible digits.
- For example, "day after a week from tomorrow" means anchor "tomorrow" plus weeks: 1 and days: 1.
- Tool outputs contain validated candidates under candidate; use candidate.id for follow-up tool base references or finalization.
- You must call propose_candidate or a candidate-resolving tool before finalize_candidate.
- If there are multiple materially plausible timestamps, propose or resolve each plausible candidate first, then call ask_clarification with those candidate IDs instead of finalizing one.
- Do not call ask_clarification in the same assistant turn as candidate-producing tools; wait for candidate IDs from tool output.
- Clarification alternative labels should be concise choices like "4:30 AM" or "Tuesday". Do not include full formatted dates in labels because the UI displays candidate previews separately.
- For ambiguous bare, shorthand, or compact clock text without AM/PM, do not choose AM or PM silently. Offer clarification choices when the meridiem materially changes the timestamp.
- For holiday expressions, call resolve_holiday and finalize the returned validated candidate.
- Only finalize candidate IDs returned by propose_candidate, parse_expression, resolve_calendar_query, resolve_holiday, shift_datetime, or set_clock_time.
- If the user mentions a weekday, use tool output and formatted candidate facts to verify the proposed timestamp actually lands on that weekday.
- If validation rejects a candidate, try another candidate or stop.
- Keep assumptions explicit.

Calendar context:
${JSON.stringify(request.calendarContext)}

Factual context:
${JSON.stringify(agentContext)}

Original input:
${request.text}`;
}

function userPrompt(request: TemporalParseRequest): string {
  return `Resolve this time expression into one timestamp: ${request.text}`;
}

function planIrSystemPrompt(request: TemporalParseRequest, agentContext: TemporalAgentContext): string {
  return `You convert fuzzy temporal text into small executable plans for a deterministic calendar executor.

Return only structured output matching the schema. Do not answer with prose.
Every plan step must include every schema field. Set fields that do not apply to null. For delta, set unused units to null.

Available plan operations:
- resolve_calendar_query: use for corrected or explicit anchor phrases the deterministic parser can parse, such as "tomorrow", "next saturday", "May 24 at 13:37", Discord timestamps, and bare 10/13/16/19 digit epochs.
- resolve_weekday_anchor: use for weekday-only anchoring when wording ambiguity must produce alternatives. For "sunday after next", use weekdayAnchor=after_next_ambiguous. For a raw "next <weekday>" ambiguity only when you intentionally need alternatives, use weekdayAnchor=next_ambiguous. This operation can return multiple date candidates.
- resolve_holiday: use for holiday names; include year and normalized time when the user specified them.
- resolve_clock_time: use for conventional explicit clock text like "13:37", "1pm", "noon", or "one hour past noon and 10 minutes".
- resolve_timezone: use for explicit timezone text. Reference it from date/time operations with timeZoneStep, or put exact IANA/fixed-offset text directly in timeZone.
- interpret_clock_phrase: use when the clock phrase is semantic/fuzzy rather than conventional syntax, such as "leet time" or "133t time". You must set time to the interpreted 24-hour clock.
- shift_datetime: apply calendar arithmetic to a prior candidate step. Use baseStep for the anchor. Use time or timeStep when the final clock is known.
- set_clock_time: apply a normalized clock time to a prior candidate step.
- combine_date_time: same semantics as set_clock_time, preferred when combining a date anchor or weekday-anchor candidate set with a separate clock step.
- propose_candidate: last resort for explicit epoch/ISO timestamps only; do not guess remembered holiday dates or weekday math.

Planning rules:
- Emit up to four independent plans. The executor evaluates plans in parallel and also runs independent step dependencies in parallel.
- Prefer one clear plan when the input has one intended meaning.
- For a time range like "tomorrow 3pm-5pm", emit one plan with kind="time_range", startStep pointing to the start candidate, and endStep pointing to the end candidate. The start and end candidates should both preserve date, clock, and timezone evidence.
- For same-day ranges, resolve the shared date once, resolve each endpoint clock separately, then combine both clocks with the same date. For overnight ranges like "Friday 11pm-1am", explicitly shift the end candidate by one day so the final end is after the start.
- For date-span or schedule-block wording like "Tuesday through Thursday" or "Tuesday through Thursday 3-5pm", use outcome "no_plan" unless the request clearly means one continuous event range with exact start and end timestamps.
- Use outcome "clarification" with alternative plans when AM/PM, "next weekday", or shorthand ambiguity materially changes the timestamp.
- For a top-level request that begins "next <weekday>", including bare dates, conventional clocks, and fuzzy clocks such as "next saturday", "next saturday at 5pm", or "next saturday at l33t time", treat the weekday convention as materially ambiguous unless surrounding wording explicitly says "upcoming", "this", or "the week after". Use resolve_weekday_anchor with weekdayAnchor=next_ambiguous, combine any clock separately, and return clarification.
- If "next <weekday>" is only an internal anchor inside a larger offset expression such as "day after next saturday", prefer resolve_calendar_query and the deterministic parser's calendar convention.
- For fuzzy cultural clock cases, resolve the semantic clock, but keep any independent date ambiguity as clarification alternatives.
- For explicit timezone names or abbreviations, preserve timezone intent. Use IANA/regional timezones for named regions so DST is date-specific. Use fixed offsets only for explicit UTC/GMT offsets. For ambiguous abbreviations such as CST, IST, or BST, use outcome "clarification" rather than choosing.
- Phrases like "sunday after next" are ambiguous. Do not choose one silently; use resolve_weekday_anchor with weekdayAnchor=after_next_ambiguous and outcome "clarification".
- For dependent compositions, resolve the anchor and clock independently when possible, then combine with shift_datetime or set_clock_time.
- For typos in temporal words, correct the phrase in resolve_calendar_query and include the correction in the plan rationale.
- For fuzzy cultural clock text, infer the semantic clock only when the phrase is stable. For leet/l33t/133t time, use interpret_clock_phrase with time 13:37.
- For negative or unsupported-length bare epoch-like numbers, use outcome "no_plan" rather than guessing.
- For bounded repeated "day after ... tomorrow" chains up to five repetitions, resolve "tomorrow" and emit one shift_datetime step whose days delta equals the repetition count. If the chain is longer or uncertain, use outcome "no_plan" rather than guessing.
- Preserve every date, time, holiday, weekday, offset, and timezone signal. If you cannot express the full meaning with the operations, use outcome "no_plan".
- finalStep should be a zero-based index pointing to the candidate-producing step that represents an instant answer. For time_range plans, set finalStep to null and set startStep/endStep to the candidate-producing endpoint steps.

Calendar context:
${JSON.stringify(request.calendarContext)}

Factual context:
${JSON.stringify(agentContext)}

Original input:
${request.text}`;
}

function countToolMessages(messages: BaseMessage[]): number {
  return messages.filter((message) => message.getType() === 'tool').length;
}

function countAgentMessages(messages: BaseMessage[]): number {
  return messages.filter((message) => message.getType() === 'ai').length;
}

function messageContentChars(messages: BaseMessage[]): number {
  return messages.reduce((total, message) => total + contentChars(message.content), 0);
}

function contentChars(content: unknown): number {
  if (typeof content === 'string') {
    return content.length;
  }
  if (Array.isArray(content)) {
    return content.reduce((total, part) => total + contentChars(part), 0);
  }
  if (content === undefined || content === null) {
    return 0;
  }
  return JSON.stringify(content).length;
}

function suggestedFormatIndex(text: string, precision: Candidate['precision']): number {
  if (/\b(?:in|ago)\b|\bfrom\s+now\b/i.test(text)) {
    return 6;
  }
  if (precision === 'datetime' && WEEKDAY_TEXT_PATTERN.test(text)) {
    return 5;
  }
  if (precision === 'date') {
    return 1;
  }
  if (precision === 'time') {
    return 2;
  }
  if (precision === 'relative') {
    return 6;
  }
  return 4;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldShortCircuitDeterministic(response: TemporalParseResponse): boolean {
  if (response.status === 'needs_clarification' && (response.clarificationAlternatives?.length ?? 0) > 0) {
    return true;
  }

  return response.status === 'resolved'
    && response.epoch !== undefined
    && response.method === 'deterministic'
    && response.validation.passed
    && response.ambiguity.length === 0;
}

function deterministicShortCircuitBypassReason(request: TemporalParseRequest, response: TemporalParseResponse): string | undefined {
  if (response.status !== 'resolved' || response.method !== 'deterministic') {
    return undefined;
  }
  if (!TOP_LEVEL_NEXT_WEEKDAY_PATTERN.test(request.text)) {
    return undefined;
  }
  return 'bypass_deterministic_for_next_weekday_interpretation';
}

function nowMs(): number {
  return Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, nowMs() - startedAt);
}

function attachTopLevelTiming(
  response: TemporalParseResponse,
  totalStartedAt: number,
  deterministicDurationMs?: number,
  agentDurationMs?: number,
  features?: TemporalFeatureFlags,
): void {
  ensureGenerationId(response);
  response.debug = response.debug ?? {};
  if (features !== undefined) {
    response.debug.featureFlags = compactFeatureFlags(features);
  }
  if (deterministicDurationMs !== undefined) {
    response.debug.deterministicDurationMs = deterministicDurationMs;
  }
  if (agentDurationMs !== undefined) {
    response.debug.agentDurationMs = agentDurationMs;
  }
  response.debug.totalDurationMs = elapsedMs(totalStartedAt);
}

function attachPlanExecutionDebug(
  response: TemporalParseResponse,
  executionStartedAt: number,
  modelName?: string,
  planningDurationMs?: number,
): void {
  ensureGenerationId(response);
  response.debug = response.debug ?? {};
  if (modelName !== undefined) {
    response.debug.model = modelName;
  }
  const executionDurationMs = elapsedMs(executionStartedAt);
  response.debug.firstCandidateMs = planningDurationMs === undefined ? executionDurationMs : planningDurationMs + executionDurationMs;
  response.debug.finalResponseMs = planningDurationMs === undefined ? executionDurationMs : planningDurationMs + executionDurationMs;
  response.debug.agentDurationMs = response.debug.finalResponseMs;
  response.debug.totalDurationMs = response.debug.finalResponseMs;
}

function compactFeatureFlags(features: TemporalFeatureFlags): TemporalFeatureFlags {
  const compact: TemporalFeatureFlags = {};
  if (features.deterministicPreflight !== undefined) {
    compact.deterministicPreflight = features.deterministicPreflight;
  }
  if (features.ordinalWeekdayGrammar !== undefined) {
    compact.ordinalWeekdayGrammar = features.ordinalWeekdayGrammar;
  }
  if (features.planIr !== undefined) {
    compact.planIr = features.planIr;
  }
  if (features.semanticConsistencyGate !== undefined) {
    compact.semanticConsistencyGate = features.semanticConsistencyGate;
  }
  return compact;
}

function planIrEnabled(features: TemporalFeatureFlags | undefined): boolean {
  return features?.planIr === true;
}

function deterministicPreflightEnabled(features: TemporalFeatureFlags | undefined): boolean {
  return features?.deterministicPreflight !== false;
}

function semanticConsistencyGateEnabled(features: TemporalFeatureFlags | undefined): boolean {
  return features?.semanticConsistencyGate === true;
}

function shouldEscalateAfterSemanticConsistencyGate(response: TemporalParseResponse): boolean {
  const gate = response.debug?.semanticConsistencyGate;
  return gate !== undefined && gate.decision !== 'accept';
}

function ensureGenerationId(response: TemporalParseResponse): void {
  response.generationId ??= `tp_${randomUUID()}`;
}

function createChatModel(apiKey: string, model: string, reasoningEffort: string): ChatOpenAI {
  if (model.startsWith('gpt-5')) {
    return new ChatOpenAI({ apiKey, model, reasoning: { effort: normalizeReasoningEffort(reasoningEffort), summary: 'auto' }, useResponsesApi: true });
  }
  return new ChatOpenAI({ apiKey, model, temperature: 0 });
}

async function createLangfuseHandler(options: TemporalGraphOptions, request: TemporalParseRequest): Promise<LangfuseHandler | null> {
  if (options.langfuse?.enabled !== true) {
    return null;
  }
  const { CallbackHandler } = await import('@langfuse/langchain');
  const params: LangfuseCallbackParams = {
    tags: ['temporal-parse', ...(options.langfuse.tags ?? [])],
    traceMetadata: {
      timeZone: request.calendarContext.timeZone,
      referenceInstant: request.calendarContext.referenceInstant,
      model: options.openaiModel ?? DEFAULT_OPENAI_MODEL,
    },
  };
  if (options.langfuse.sessionId !== undefined) {
    params.sessionId = options.langfuse.sessionId;
  }
  if (options.langfuse.userId !== undefined) {
    params.userId = options.langfuse.userId;
  }
  if (options.langfuse.baseUrl !== undefined) {
    params.baseUrl = options.langfuse.baseUrl;
  }
  return new CallbackHandler(params) as LangfuseHandler;
}

function getLangfuseTraceId(handler: LangfuseHandler | null): string | undefined {
  return handler?.last_trace_id ?? undefined;
}

function normalizeReasoningEffort(effort: string): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  if (effort === 'none' || effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh') {
    return effort;
  }
  return 'low';
}

function summarizeAiMessage(message: AIMessage): unknown {
  return cleanUndefined({
    content: summarizeValue(message.content),
    toolCalls: message.tool_calls?.map((call) => ({ name: call.name, args: summarizeValue(call.args), id: call.id })),
    reasoning: summarizeValue((message.additional_kwargs as { reasoning?: unknown }).reasoning),
  });
}

function summarizeValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map(summarizeValue);
  }

  const record = value as Record<string, unknown>;
  if (isCandidateLike(record)) {
    return summarizeCandidateRecord(record);
  }
  if (isEnrichedCandidateLike(record)) {
    return summarizeEnrichedCandidateRecord(record);
  }
  if (Array.isArray(record['candidates'])) {
    return cleanUndefined({
      ...Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'candidates')),
      candidates: record['candidates'].map(summarizeValue),
    });
  }

  return cleanUndefined(Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, summarizeValue(entry)]),
  ));
}

function isCandidateLike(record: Record<string, unknown>): boolean {
  return typeof record['id'] === 'string' && typeof record['isoInstant'] === 'string' && typeof record['zonedDateTime'] === 'string';
}

function isEnrichedCandidateLike(record: Record<string, unknown>): boolean {
  return record['candidate'] !== undefined && typeof record['finalizable'] === 'boolean';
}

function summarizeCandidateRecord(record: Record<string, unknown>): Record<string, unknown> {
  return cleanUndefined({
    id: record['id'],
    isoInstant: record['isoInstant'],
    zonedDateTime: record['zonedDateTime'],
    timeZone: record['timeZone'],
    precision: record['precision'],
    provenance: record['provenance'],
    assumptions: record['assumptions'],
  });
}

function summarizeEnrichedCandidateRecord(record: Record<string, unknown>): Record<string, unknown> {
  return cleanUndefined({
    candidate: summarizeValue(record['candidate']),
    facts: summarizeValue(record['facts']),
    validation: summarizeValue(record['validation']),
    finalizable: record['finalizable'],
  });
}

function cleanUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function toCalendarContext(input: z.infer<typeof CalendarContextSchema>): CalendarContext {
  const calendarContext: CalendarContext = {
    referenceInstant: input.referenceInstant,
    timeZone: input.timeZone,
  };
  if (input.locale !== undefined) {
    calendarContext.locale = input.locale;
  }
  if (input.country !== undefined) {
    calendarContext.country = input.country;
  }
  if (input.subdivision !== undefined) {
    calendarContext.subdivision = input.subdivision;
  }
  return calendarContext;
}

function resolveAgentBase(
  input: z.infer<typeof AgentBaseDateTimeSchema>,
  enrichedCandidates: Map<string, EnrichedCandidate>,
): Parameters<TemporalToolImplementations['shiftDateTime']>[0]['base'] {
  if ('candidateId' in input) {
    const enriched = enrichedCandidates.get(input.candidateId);
    if (!enriched) {
      throw new Error(`Unknown candidateId ${input.candidateId}.`);
    }
    return { zonedDateTime: enriched.candidate.zonedDateTime };
  }
  return input;
}

function cleanDelta(input: {
  years?: number | null | undefined;
  months?: number | null | undefined;
  weeks?: number | null | undefined;
  days?: number | null | undefined;
  hours?: number | null | undefined;
  minutes?: number | null | undefined;
}): { years?: number; months?: number; weeks?: number; days?: number; hours?: number; minutes?: number } {
  const delta: { years?: number; months?: number; weeks?: number; days?: number; hours?: number; minutes?: number } = {};
  if (input.years !== undefined && input.years !== null) {
    delta.years = input.years;
  }
  if (input.months !== undefined && input.months !== null) {
    delta.months = input.months;
  }
  if (input.weeks !== undefined && input.weeks !== null) {
    delta.weeks = input.weeks;
  }
  if (input.days !== undefined && input.days !== null) {
    delta.days = input.days;
  }
  if (input.hours !== undefined && input.hours !== null) {
    delta.hours = input.hours;
  }
  if (input.minutes !== undefined && input.minutes !== null) {
    delta.minutes = input.minutes;
  }
  return delta;
}

function epochSecondsToIso(epochSeconds: number | null | undefined): string {
  if (epochSeconds === undefined || epochSeconds === null) {
    throw new Error('Either isoInstant or epochSeconds is required.');
  }
  return new Date(epochSeconds * 1000).toISOString();
}
