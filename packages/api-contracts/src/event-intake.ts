import { z } from "zod";
import { ApiIdempotencyKeySchema } from "./temporal";

const text = (max: number) => z.string().trim().max(max);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
export const EventIntakeLocalTimeSchema = z.strictObject({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  dayOffset: z.number().int().min(-1).max(7).optional(),
  occurrence: z.enum(["earlier", "later"]).optional(),
});
export const EventIntakeLineupSchema = z.strictObject({
  clientKey: text(120).min(1), position: z.number().int().min(0).max(79),
  performerLabel: nullable(text(120)), personSlug: nullable(text(64)), roleLabel: nullable(text(48)),
  start: nullable(EventIntakeLocalTimeSchema), end: nullable(EventIntakeLocalTimeSchema),
});
export const EventIntakeFieldsSchema = z.strictObject({
  communitySlug: nullable(text(64)), title: nullable(text(120)), eventDate: nullable(text(10)),
  timeTba: nullable(z.boolean()), timezone: nullable(text(64)),
  start: nullable(EventIntakeLocalTimeSchema), end: nullable(EventIntakeLocalTimeSchema), doors: nullable(EventIntakeLocalTimeSchema),
  venueLabel: nullable(text(120)), summary: nullable(text(240)), sourceUrl: nullable(text(2048)),
  worldSlug: nullable(text(64)),
  sourceText: nullable(text(12_000)), posterSourceId: nullable(text(200)),
  lineup: nullable(z.array(EventIntakeLineupSchema).max(80)),
});
export const EventIntakePatchSchema = EventIntakeFieldsSchema.extend({
  // Candidates are private and never become canonical until copied into ordinary fields.
  tentative: nullable(EventIntakeFieldsSchema),
  questions: nullable(z.array(text(500)).max(20)),
  duplicateAcknowledgements: nullable(z.array(text(200).min(1)).max(100)),
}).strict();
export const SaveEventIntakeDraftSchema = z.strictObject({
  draftId: text(200).min(1).optional(), expectedVersion: z.number().int().positive().optional(), patch: EventIntakePatchSchema,
}).refine(value => Boolean(value.draftId) === (value.expectedVersion !== undefined), "Existing drafts require expectedVersion.");
export const PublishEventIntakeSchema = z.strictObject({
  draftId: text(200).min(1), expectedVersion: z.number().int().positive(), idempotencyKey: ApiIdempotencyKeySchema,
});
export type EventIntakeFields = z.infer<typeof EventIntakeFieldsSchema>;
export type EventIntakePatch = z.infer<typeof EventIntakePatchSchema>;
export type EventIntakeLocalTime = z.infer<typeof EventIntakeLocalTimeSchema>;

/** Return every valid instant. A gap is empty; a repeated hour has two choices. */
export function resolveEventLocalTime(date: string, local: EventIntakeLocalTime, timezone: string): number[] {
  const base = Date.parse(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== date)
    throw new Error("Event date must be valid.");
  EventIntakeLocalTimeSchema.parse(local);
  const targetDate = new Date(base + (local.dayOffset ?? 0) * 86_400_000).toISOString().slice(0, 10);
  const target = `${targetDate}T${local.time}`;
  const wall = Date.parse(`${target}:00Z`);
  if (!timezone || /^[+-]/.test(timezone)) throw new Error("An IANA timezone is required.");
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const format = (instant: number) => {
    const parts = formatter.formatToParts(instant);
    const get = (key: string) => parts.find(part => part.type === key)!.value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  };
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = wall + hours * 3_600_000;
    offsets.add(Date.parse(`${format(sample)}:00Z`) - sample);
  }
  return [...offsets].map(offset => wall - offset).filter(instant => format(instant) === target).sort((a, b) => a - b);
}
export function selectEventLocalTime(date: string, local: EventIntakeLocalTime, timezone: string): number {
  const choices = resolveEventLocalTime(date, local, timezone);
  if (!choices.length) throw new Error("Local time does not exist in this timezone.");
  if (choices.length > 1 && !local.occurrence) throw new Error("Ambiguous local time requires an earlier or later occurrence.");
  return local.occurrence === "later" ? choices[choices.length - 1]! : choices[0]!;
}
