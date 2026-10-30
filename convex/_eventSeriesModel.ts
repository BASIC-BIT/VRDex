import { v, type Infer } from "convex/values";

// Leaf module: imported by schema.ts, so it must not import anything but convex/values.

export const seriesFrequencyValidator = v.union(
  v.literal("weekly"),
  v.literal("biweekly"),
  v.literal("monthly_weekday"),
);

export const seriesOrdinalValidator = v.union(
  v.literal(1),
  v.literal(2),
  v.literal(3),
  v.literal(4),
  v.literal(-1),
);

export const eventSeriesRuleValidator = v.object({
  frequency: seriesFrequencyValidator,
  weekday: v.number(),
  ordinal: v.optional(seriesOrdinalValidator),
  startTime: v.string(),
  endTime: v.optional(v.string()),
  doorsTime: v.optional(v.string()),
});

export const seriesRepeatValidator = v.object({
  frequency: seriesFrequencyValidator,
  weekday: v.optional(v.number()),
  ordinal: v.optional(seriesOrdinalValidator),
  endsOn: v.optional(v.string()),
  count: v.optional(v.number()),
});

export type SeriesRule = Infer<typeof eventSeriesRuleValidator>;
export type SeriesRepeat = Infer<typeof seriesRepeatValidator>;

export const SERIES_HORIZON_DAYS = 60;

export const SERIES_OWNED_EVENT_FIELDS = [
  "title",
  "summary",
  "timezone",
  "venueLabel",
  "worldSlug",
  "mediaLinks",
  "watchMode",
  "watchSurfaceEnabled",
  "bannerImageUrl",
  "thumbnailImageUrl",
  "sourceUrl",
  "startAt",
  "doorsOpenAt",
  "endAt",
] as const;

export type SeriesOwnedEventField = (typeof SERIES_OWNED_EVENT_FIELDS)[number];

export function recurringEventsEnabled(): boolean {
  return process.env.VRDEX_RECURRING_EVENTS_ENABLED === "true";
}

export function requireRecurringEventsEnabled(): void {
  if (!recurringEventsEnabled()) throw new Error("Recurring events are not enabled.");
}
