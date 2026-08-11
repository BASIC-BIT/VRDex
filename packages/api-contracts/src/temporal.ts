import * as z from "zod";

const TimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    if (/^[+-]/.test(value)) {
      return false;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "timeZone must be a valid IANA timezone.")
  .transform((value) =>
    new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone
  );

const LocaleSchema = z.string().min(2).max(35).refine((value) => {
  try {
    new Intl.Locale(value);
    return true;
  } catch {
    return false;
  }
}, "locale must be a valid BCP 47 locale.");

export const TemporalParseRequestSchema = z.object({
  text: z.string().trim().min(1).max(500),
  timeZone: TimeZoneSchema.optional(),
  locale: LocaleSchema.optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  subdivision: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,3}$/).optional(),
  referenceInstant: z.iso.datetime({ offset: true }).optional(),
  retainInput: z.boolean().optional(),
}).strict();

export const TemporalCanonicalInstantSchema = z.object({
  isoInstant: z.iso.datetime({ offset: true }),
  zonedDateTime: z.string().min(1),
  timeZone: z.string().min(1),
  precision: z.enum(["date", "time", "datetime", "relative"]),
  weekday: z.enum([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]).optional(),
});

export const TemporalRangeEndpointSchema = z.object({
  epoch: z.number().int(),
  canonical: TemporalCanonicalInstantSchema,
});

const TemporalResolvedBaseShape = {
  requestId: z.string().min(1),
  status: z.literal("resolved"),
  confidence: z.number().min(0).max(1),
  method: z.literal("trained_plan"),
  assumptions: z.array(z.string()),
};

export const TemporalResolvedInstantResponseSchema = z.object({
  ...TemporalResolvedBaseShape,
  kind: z.literal("instant"),
  epoch: z.number().int(),
  canonical: TemporalCanonicalInstantSchema,
});

export const TemporalResolvedRangeResponseSchema = z.object({
  ...TemporalResolvedBaseShape,
  kind: z.literal("time_range"),
  range: z.object({
    start: TemporalRangeEndpointSchema,
    end: TemporalRangeEndpointSchema,
  }),
  epoch: z.number().int().optional(),
  canonical: TemporalCanonicalInstantSchema.optional(),
});

export const TemporalResolvedResponseSchema = z.union([
  TemporalResolvedInstantResponseSchema,
  TemporalResolvedRangeResponseSchema,
]);
export const TemporalClarificationAlternativeSchema = z.object({
  label: z.string(),
  kind: z.enum(["instant", "time_range"]).optional(),
  epoch: z.number().int(),
  confidence: z.number().min(0).max(1),
  canonical: TemporalCanonicalInstantSchema,
  range: z.object({
    start: TemporalRangeEndpointSchema,
    end: TemporalRangeEndpointSchema,
  }).optional(),
});

export const TemporalClarificationResponseSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("needs_clarification"),
  question: z.string().min(1),
  alternatives: z.array(TemporalClarificationAlternativeSchema),
});

export const TemporalNoPlanResponseSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("no_plan"),
  reason: z.string().min(1),
});

export const TemporalParseCompletedResponseSchema = z.union([
  TemporalResolvedInstantResponseSchema,
  TemporalResolvedRangeResponseSchema,
  TemporalClarificationResponseSchema,
  TemporalNoPlanResponseSchema,
]);

/**
 * The `Idempotency-Key` value VRDex write routes accept.
 *
 * Defined once because a second route inventing its own bounds is how two
 * endpoints end up disagreeing about what a valid key looks like.
 */
export const ApiIdempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Idempotency-Key contains unsupported characters.");

export const ApiIdempotencyHeaderSchema = z.object({
  "idempotency-key": ApiIdempotencyKeySchema.optional(),
});

/** Kept so the temporal route and its OpenAPI entry read as they always did. */
export const TemporalIdempotencyHeaderSchema = ApiIdempotencyHeaderSchema;

export const TemporalContinuationPathParamsSchema = z.object({
  continuationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const TemporalParsePendingResponseSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("pending"),
  continuationToken: z.string().min(32).max(256),
  retryAfterSeconds: z.number().int().min(1).max(30),
  estimatedWaitSeconds: z.number().int().min(1).max(180),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type TemporalParseRequest = z.infer<typeof TemporalParseRequestSchema>;
export type TemporalParseCompletedResponse = z.infer<typeof TemporalParseCompletedResponseSchema>;
export type TemporalParsePendingResponse = z.infer<typeof TemporalParsePendingResponseSchema>;
