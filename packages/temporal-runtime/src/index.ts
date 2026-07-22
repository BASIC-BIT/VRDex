import { createDeterministicTemporalToolImplementations } from './tools';
import { parseCalendarContext } from './deterministic';
import { runTemporalCoalescingGraph, type TemporalGraphOptions } from './graph';
import type { TemporalFeatureFlags, TemporalParseResponse, TemporalPlanIrEndpointConfig } from './types';

export async function parseTemporalExpression(params: {
  text: string;
  timeZone: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiReasoningEffort?: string;
  langfuse?: TemporalGraphOptions['langfuse'];
  referenceInstant?: string;
  features?: TemporalFeatureFlags;
  planIrEndpoint?: TemporalPlanIrEndpointConfig;
}): Promise<TemporalParseResponse> {
  const implementations = createDeterministicTemporalToolImplementations();
  const options: TemporalGraphOptions = params.openaiApiKey === undefined
    ? { implementations }
    : { openaiApiKey: params.openaiApiKey, implementations };
  if (params.features !== undefined) {
    options.features = params.features;
  }
  if (params.planIrEndpoint !== undefined) {
    options.planIrEndpoint = params.planIrEndpoint;
  }
  if (params.openaiModel !== undefined && 'openaiApiKey' in options) {
    options.openaiModel = params.openaiModel;
  }
  if (params.openaiReasoningEffort !== undefined && 'openaiApiKey' in options) {
    options.openaiReasoningEffort = params.openaiReasoningEffort;
  }
  if (params.langfuse !== undefined && 'openaiApiKey' in options) {
    options.langfuse = params.langfuse;
  }
  return runTemporalCoalescingGraph(
    {
      text: params.text,
      calendarContext: parseCalendarContext(params.timeZone, params.referenceInstant),
    },
    options,
  );
}

export { executeTemporalPlanPlannerOutput } from './graph';
export { parseTemporalPlanPlannerOutput } from './plan-ir';
export { createDeterministicTemporalToolImplementations } from './tools';
export { parseCalendarContext } from './deterministic';
