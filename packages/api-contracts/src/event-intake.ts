import { z } from "zod";
import { ApiIdempotencyKeySchema } from "./temporal";

export const EVENT_POSTER_MAX_BYTES = 12 * 1024 * 1024;
export const EventPosterDeclarationSchema = z.strictObject({
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteLength: z.number().int().positive().max(EVENT_POSTER_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const text = (max: number) => z.string().trim().max(max);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
const EventIntakeEvidenceSchema = z.array(z.strictObject({ fieldPath: text(120), origin: z.enum(["text", "poster", "lookup", "calculation"]), excerpt: text(500).nullable(), assessment: z.enum(["explicit", "inferred", "conflicting"]) })).max(40);
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
  sourceText: nullable(text(12_000)), posterSourceId: nullable(text(200).min(1)),
  posterDeclaration: nullable(EventPosterDeclarationSchema),
  lineup: nullable(z.array(EventIntakeLineupSchema).max(80)),
});
export const EventIntakePatchSchema = EventIntakeFieldsSchema.extend({
  // Candidates are private and never become canonical until copied into ordinary fields.
  tentative: nullable(EventIntakeFieldsSchema),
  evidence: nullable(EventIntakeEvidenceSchema),
  questions: nullable(z.array(text(2800)).max(100)),
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

const fact = (max: number) => text(max).nullable();
const candidateDate = z.iso.date().nullable();
export const EventIntakeCandidateSchema = z.strictObject({
  event: z.strictObject({
    title: fact(120), communitySlug: fact(64), eventDate: fact(10),
    start: fact(5), end: fact(5), startDate: candidateDate, endDate: candidateDate, timezone: fact(64), venueLabel: fact(120), summary: fact(240), sourceUrl: fact(2048),
  }),
  lineup: z.array(z.strictObject({
    performerLabel: fact(120), personSlug: fact(64), roleLabel: fact(48), start: fact(5), end: fact(5), startDate: candidateDate, endDate: candidateDate,
  })).max(80),
  evidence: EventIntakeEvidenceSchema,
  questions: z.array(z.strictObject({ fieldPath: text(120), reason: text(500), alternatives: z.array(text(200)).max(10) })).max(100),
});
export type EventIntakeCandidate = z.infer<typeof EventIntakeCandidateSchema>;

export const EventIntakeCandidateJsonSchema = z.toJSONSchema(EventIntakeCandidateSchema);

const intakeId = text(200).min(1);
const version = z.number().int().positive();
export const EventIntakeDraftIdSchema = z.strictObject({ draftId: intakeId });
export const ExtractEventIntakeSchema = EventIntakeDraftIdSchema.extend({ sourceText: text(12_000).optional(), posterAssetId: intakeId.optional() });
export const BeginEventPosterUploadSchema = EventIntakeDraftIdSchema.extend(EventPosterDeclarationSchema.shape);
export const CompleteEventPosterUploadSchema = EventIntakeDraftIdSchema.extend({ posterAssetId: intakeId, expectedVersion: version.optional() });
export const SelectEventArtworkSchema = CompleteEventPosterUploadSchema.extend({ expectedVersion: version });
export const UpdateEventContributionSchema = z.strictObject({
  slug: text(200).min(1), expectedUpdatedAt: z.number(),
  patch: EventIntakeFieldsSchema.pick({ title: true, eventDate: true, timeTba: true, timezone: true, start: true, end: true, doors: true, venueLabel: true, worldSlug: true, sourceUrl: true, summary: true, lineup: true }),
  duplicateAcknowledgements: z.array(intakeId).max(100).optional(),
});
export const RetractEventContributionSchema = z.strictObject({ slug: text(200).min(1) });
export const GetEventContributionSchema = RetractEventContributionSchema;
export const ReportEventSchema = z.strictObject({ reason: text(500).min(5) });
export const SavedEventIntakeSchema = z.object({ draftId: intakeId, version });
export const EventIntakeDraftSchema = SavedEventIntakeSchema.extend({
  fields: EventIntakePatchSchema, publishedReceiptId: intakeId.optional(), artworkAssetId: intakeId.optional(), artworkSourceId: intakeId.optional(),
});
export const PublishedEventIntakeSchema = z.object({ eventId: intakeId, eventPath: text(2048), receiptId: intakeId });
export const EventPosterUploadSchema = z.object({ posterAssetId: intakeId, expiresAt: z.number(), transfer: z.object({
  method: z.literal("POST"), url: z.url(), fields: z.record(z.string(), z.string()), fileField: z.literal("file"),
}) });
export const EventContributionResultSchema = z.object({ eventId: intakeId, updatedAt: z.number().optional(), changed: z.boolean().optional() });
export const EventContributionReadSchema = z.object({ eventId: intakeId, updatedAt: z.number(), contributionVersion: z.number().optional(), fields: EventIntakeFieldsSchema });

// These contracts are shared by REST and hosted/local MCP adapters.
export const eventIntakeOperations = {
  draft_save: { input: SaveEventIntakeDraftSchema, output: SavedEventIntakeSchema, method: "POST", path: "/event-intake" },
  draft_get: { input: EventIntakeDraftIdSchema, output: EventIntakeDraftSchema, method: "GET", path: "/event-intake/{draftId}" },
  extract: { input: ExtractEventIntakeSchema, output: EventIntakeCandidateSchema, method: "POST", path: "/event-intake/{draftId}/extract" },
  publish: { input: PublishEventIntakeSchema, output: PublishedEventIntakeSchema, method: "POST", path: "/event-intake/{draftId}/publish" },
  poster_upload_begin: { input: BeginEventPosterUploadSchema, output: EventPosterUploadSchema, method: "POST", path: "/event-intake/{draftId}/poster-upload/begin" },
  poster_upload_complete: { input: CompleteEventPosterUploadSchema, output: z.object({ posterAssetId: intakeId, artworkAssetId: intakeId.optional(), version }), method: "POST", path: "/event-intake/{draftId}/poster-upload/complete" },
  artwork_select: { input: SelectEventArtworkSchema, output: z.object({ artworkAssetId: intakeId, version }), method: "POST", path: "/event-intake/{draftId}/artwork" },
  event_get: { input: GetEventContributionSchema, output: EventContributionReadSchema, method: "GET", path: "/events/{slug}/contribution" },
  event_update: { input: UpdateEventContributionSchema, output: EventContributionResultSchema, method: "PATCH", path: "/events/{slug}/contribution" },
  event_retract: { input: RetractEventContributionSchema, output: EventContributionResultSchema, method: "DELETE", path: "/events/{slug}/contribution" },
} as const;
export type EventIntakeOperation = keyof typeof eventIntakeOperations;

// Local clients explicitly supply the contents of their chosen file. No path or source URL is accepted.
const EVENT_POSTER_MAX_BASE64_LENGTH = Math.ceil(EVENT_POSTER_MAX_BYTES / 3) * 4;
function validPosterBase64(value: string): boolean {
  if (value.length < 4 || value.length > EVENT_POSTER_MAX_BASE64_LENGTH || value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  // A character scan uses constant stack space even for the largest poster.
  for (let i = 0; i < value.length - padding; i++) {
    const code = value.charCodeAt(i);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  return true;
}
export const EventPosterBytesSchema = z.strictObject({
  draftId: intakeId, contentType: EventPosterDeclarationSchema.shape.contentType,
  base64: z.string().min(4).max(EVENT_POSTER_MAX_BASE64_LENGTH).refine(validPosterBase64, "Invalid base64"),
});
