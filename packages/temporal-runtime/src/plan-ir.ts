import * as z from 'zod';

export const PLAN_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type PlanWeekday = typeof PLAN_WEEKDAYS[number];
export const TEMPORAL_PLAN_MAX_PLANS = 10;
export const TEMPORAL_PLAN_MAX_STEPS = 12;

export const PLAN_WEEKDAY_INDEX: Record<PlanWeekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

export const PLAN_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const TimeOfDaySchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});

export const PlanDeltaSchema = z.object({
  years: z.number().int().nullable(),
  months: z.number().int().nullable(),
  weeks: z.number().int().nullable(),
  days: z.number().int().nullable(),
  hours: z.number().int().nullable(),
  minutes: z.number().int().nullable(),
});

export const TemporalPlanStepSchema = z.object({
  operation: z.enum([
    'resolve_calendar_query',
    'resolve_weekday_anchor',
    'resolve_holiday',
    'resolve_clock_time',
    'resolve_timezone',
    'interpret_clock_phrase',
    'shift_datetime',
    'set_clock_time',
    'combine_date_time',
    'propose_candidate',
  ]),
  query: z.string().nullable(),
  text: z.string().nullable(),
  holidayName: z.string().nullable(),
  weekday: z.enum(PLAN_WEEKDAYS).nullable(),
  weekdayAnchor: z.enum(['upcoming', 'this', 'next', 'last', 'next_ambiguous', 'after_next_ambiguous']).nullable(),
  year: z.number().int().min(1900).max(2200).nullable(),
  baseStep: z.number().int().min(0).nullable(),
  time: TimeOfDaySchema.nullable(),
  timeStep: z.number().int().min(0).nullable(),
  timeZoneStep: z.number().int().min(0).nullable(),
  delta: PlanDeltaSchema,
  isoInstant: z.string().nullable(),
  epochSeconds: z.number().int().nullable(),
  timeZone: z.string().nullable(),
  precision: z.enum(['date', 'time', 'datetime', 'relative']).nullable(),
  assumptions: z.array(z.string()),
});

export const TemporalPlanSchema = z.object({
  kind: z.enum(['instant', 'time_range']).optional(),
  label: z.string(),
  rationale: z.string(),
  assumptions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  finalStep: z.number().int().min(0).nullable(),
  startStep: z.number().int().min(0).nullable().optional(),
  endStep: z.number().int().min(0).nullable().optional(),
  steps: z.array(TemporalPlanStepSchema).min(1).max(TEMPORAL_PLAN_MAX_STEPS),
});

export const TemporalPlanPlannerSchema = z.object({
  outcome: z.enum(['plans', 'clarification', 'no_plan']),
  reason: z.string(),
  clarificationQuestion: z.string().nullable(),
  plans: z.array(TemporalPlanSchema).max(TEMPORAL_PLAN_MAX_PLANS),
});

export const CompactPlanDeltaSchema = z.object({
  years: z.number().int().optional(),
  months: z.number().int().optional(),
  weeks: z.number().int().optional(),
  days: z.number().int().optional(),
  hours: z.number().int().optional(),
  minutes: z.number().int().optional(),
});

export const CompactTemporalPlanStepSchema = z.object({
  op: z.enum([
    'resolve_calendar_query',
    'resolve_weekday_anchor',
    'resolve_holiday',
    'resolve_clock_time',
    'resolve_timezone',
    'interpret_clock_phrase',
    'shift_datetime',
    'set_clock_time',
    'combine_date_time',
    'propose_candidate',
  ]),
  query: z.string().optional(),
  text: z.string().optional(),
  holidayName: z.string().optional(),
  weekday: z.enum(PLAN_WEEKDAYS).optional(),
  weekdayAnchor: z.enum(['upcoming', 'this', 'next', 'last', 'next_ambiguous', 'after_next_ambiguous']).optional(),
  year: z.number().int().min(1900).max(2200).optional(),
  baseStep: z.number().int().min(0).optional(),
  time: TimeOfDaySchema.optional(),
  timeStep: z.number().int().min(0).optional(),
  timeZoneStep: z.number().int().min(0).optional(),
  delta: CompactPlanDeltaSchema.optional(),
  isoInstant: z.string().optional(),
  epochSeconds: z.number().int().optional(),
  timeZone: z.string().optional(),
  precision: z.enum(['date', 'time', 'datetime', 'relative']).optional(),
  assumptions: z.array(z.string()).optional(),
});

export const CompactTemporalPlanSchema = z.object({
  kind: z.enum(['instant', 'time_range']).optional(),
  label: z.string(),
  rationale: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  finalStep: z.number().int().min(0).nullable().optional(),
  startStep: z.number().int().min(0).nullable().optional(),
  endStep: z.number().int().min(0).nullable().optional(),
  steps: z.array(CompactTemporalPlanStepSchema).min(1).max(TEMPORAL_PLAN_MAX_STEPS),
});

export const CompactTemporalPlanPlannerSchema = z.object({
  outcome: z.enum(['plans', 'clarification', 'no_plan']),
  reason: z.string().optional(),
  clarificationQuestion: z.string().nullable().optional(),
  plans: z.array(CompactTemporalPlanSchema).max(TEMPORAL_PLAN_MAX_PLANS),
});

export type TemporalPlan = z.infer<typeof TemporalPlanSchema>;
export type TemporalPlanStep = z.infer<typeof TemporalPlanStepSchema>;
export type RawTemporalPlanStep = z.input<typeof TemporalPlanStepSchema>;
export type TemporalPlanPlannerOutput = z.infer<typeof TemporalPlanPlannerSchema>;
export type CompactTemporalPlanPlannerOutput = z.infer<typeof CompactTemporalPlanPlannerSchema>;

export function parseTemporalPlanPlannerOutput(input: unknown): TemporalPlanPlannerOutput {
  const full = TemporalPlanPlannerSchema.safeParse(input);
  if (full.success) {
    return full.data;
  }
  return expandCompactTemporalPlanPlannerOutput(input);
}

export function expandCompactTemporalPlanPlannerOutput(input: unknown): TemporalPlanPlannerOutput {
  const compact = CompactTemporalPlanPlannerSchema.parse(input);
  return TemporalPlanPlannerSchema.parse({
    outcome: compact.outcome,
    reason: compact.reason ?? '',
    clarificationQuestion: compact.clarificationQuestion ?? null,
    plans: compact.plans.map((plan) => ({
      kind: plan.kind,
      label: plan.label,
      rationale: plan.rationale ?? plan.label,
      assumptions: plan.assumptions ?? [],
      confidence: plan.confidence ?? 0.8,
      finalStep: plan.finalStep ?? null,
      startStep: plan.startStep ?? null,
      endStep: plan.endStep ?? null,
      steps: plan.steps.map((step) => ({
        operation: step.op,
        query: step.query ?? null,
        text: step.text ?? null,
        holidayName: step.holidayName ?? null,
        weekday: step.weekday ?? null,
        weekdayAnchor: step.weekdayAnchor ?? null,
        year: step.year ?? null,
        baseStep: step.baseStep ?? null,
        time: step.time ?? null,
        timeStep: step.timeStep ?? null,
        timeZoneStep: step.timeZoneStep ?? null,
        delta: {
          years: step.delta?.years ?? null,
          months: step.delta?.months ?? null,
          weeks: step.delta?.weeks ?? null,
          days: step.delta?.days ?? null,
          hours: step.delta?.hours ?? null,
          minutes: step.delta?.minutes ?? null,
        },
        isoInstant: step.isoInstant ?? null,
        epochSeconds: step.epochSeconds ?? null,
        timeZone: step.timeZone ?? null,
        precision: step.precision ?? null,
        assumptions: step.assumptions ?? [],
      })),
    })),
  });
}
