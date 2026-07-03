import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import type { AuthSubject } from "./_communityAuthority";

export const eventImportProviderValidator = v.literal("google_calendar");
export const eventImportBatchReviewStateValidator = v.union(
  v.literal("draft"),
  v.literal("ready_for_review"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("superseded"),
);
export const eventImportCandidateReviewStateValidator = v.union(
  v.literal("unreviewed"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("needs_correction"),
);
export const eventImportCandidatePublicationStateValidator = v.union(
  v.literal("draft_private"),
  v.literal("review_pending"),
  v.literal("published_event"),
  v.literal("rejected"),
  v.literal("superseded"),
);
export const eventImportFieldConfidenceValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("owner_confirmed"),
);
export const eventImportFieldReviewStateValidator = v.union(
  v.literal("unreviewed"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("needs_correction"),
);
export const eventImportFieldVisibilityValidator = v.union(
  v.literal("public"),
  v.literal("private"),
);
export const eventImportCancellationStateValidator = v.union(
  v.literal("active"),
  v.literal("cancelled"),
);

export type EventImportProvider = "google_calendar";
export type EventImportBatchReviewState =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "rejected"
  | "superseded";
export type EventImportCandidateReviewState =
  | "unreviewed"
  | "accepted"
  | "rejected"
  | "needs_correction";
export type EventImportCandidatePublicationState =
  | "draft_private"
  | "review_pending"
  | "published_event"
  | "rejected"
  | "superseded";
export type EventImportFieldConfidence =
  | "low"
  | "medium"
  | "high"
  | "owner_confirmed";
export type EventImportFieldReviewState =
  | "unreviewed"
  | "accepted"
  | "rejected"
  | "needs_correction";
export type EventImportFieldVisibility = "public" | "private";
export type EventImportCancellationState = "active" | "cancelled";

export type GoogleCalendarDateValue = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

export type GoogleCalendarEventInput = {
  id: string;
  iCalUID?: string;
  status?: "confirmed" | "cancelled" | "tentative" | string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarDateValue;
  end?: GoogleCalendarDateValue;
  updated?: string;
  recurringEventId?: string;
  recurrence?: string[];
  attendees?: unknown;
  reminders?: unknown;
  extendedProperties?: unknown;
};

export type GoogleCalendarImportInput = {
  batchId: string;
  calendarId: string;
  calendarSummary?: string;
  calendarTimeZone?: string;
  syncJobId?: string;
  receivedAt: string;
  notes?: string;
  events: GoogleCalendarEventInput[];
};

export type EventImportCandidateField = {
  fieldKey: string;
  value: unknown;
  sourceLabel: string;
  sourceUrl?: string;
  confidence: EventImportFieldConfidence;
  reviewState: EventImportFieldReviewState;
  visibility: EventImportFieldVisibility;
};

export type NormalizedGoogleCalendarImportCandidate = {
  externalEventId: string;
  externalICalUid?: string;
  sourceUpdatedAt?: number;
  sourceUrl?: string;
  title: string;
  startAt: number;
  endAt?: number;
  timezone?: string;
  allDay: boolean;
  location?: string;
  description?: string;
  recurrenceRules: string[];
  recurringEventId?: string;
  cancellationState: EventImportCancellationState;
  reviewState: EventImportCandidateReviewState;
  publicationState: EventImportCandidatePublicationState;
  fields: EventImportCandidateField[];
};

export type NormalizedGoogleCalendarImport = {
  externalBatchId: string;
  provider: EventImportProvider;
  sourceName: string;
  sourceCalendarId: string;
  sourceCalendarSummary?: string;
  sourceCalendarTimeZone?: string;
  syncJobId?: string;
  receivedAt: number;
  reviewState: EventImportBatchReviewState;
  notes?: string;
  candidates: NormalizedGoogleCalendarImportCandidate[];
};

type EventImportWriter = Pick<DatabaseWriter, "insert">;

const EVENT_TITLE_FALLBACK = "Untitled calendar event";
const EVENT_DESCRIPTION_MAX_LENGTH = 2_000;
const EVENT_LOCATION_MAX_LENGTH = 500;
const EVENT_TEXT_MAX_LENGTH = 240;
const EVENT_SOURCE_URL_MAX_LENGTH = 2_048;
const MAX_EXTRACTED_LINKS = 8;
const HTTPS_URL_PATTERN = /\bhttps:\/\/[^\s<>"')]+/gi;

function optionalRecord<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function normalizeInlineText(value: string | undefined, fallback: string, maxLength: number): string {
  const normalized = value?.trim().replace(/\s+/g, " ");

  return (normalized || fallback).slice(0, maxLength);
}

function optionalInlineText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");

  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function parseIsoTimestamp(value: string | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`${fieldName} must be an ISO timestamp.`);
  }

  return timestamp;
}

function requireIsoTimestamp(value: string, fieldName: string): number {
  const timestamp = parseIsoTimestamp(value, fieldName);

  if (timestamp === undefined) {
    throw new Error(`${fieldName} is required.`);
  }

  return timestamp;
}

function requireHttpsUrl(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  try {
    const url = new URL(normalized);

    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error();
    }

    return url.href.slice(0, EVENT_SOURCE_URL_MAX_LENGTH);
  } catch {
    throw new Error(`${fieldName} must be an HTTPS URL without embedded credentials.`);
  }
}

function parseAllDayDate(value: string, fieldName: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must be a YYYY-MM-DD all-day date.`);
  }

  return requireIsoTimestamp(`${value}T00:00:00.000Z`, fieldName);
}

function parseGoogleCalendarTime(
  value: GoogleCalendarDateValue | undefined,
  fieldName: string,
  fallbackTimeZone: string | undefined,
): { timestamp: number; timezone?: string; allDay: boolean } {
  if (value?.dateTime !== undefined) {
    return {
      timestamp: requireIsoTimestamp(value.dateTime, fieldName),
      ...optionalRecord("timezone", optionalInlineText(value.timeZone ?? fallbackTimeZone, EVENT_TEXT_MAX_LENGTH)),
      allDay: false,
    };
  }

  if (value?.date !== undefined) {
    return {
      timestamp: parseAllDayDate(value.date, fieldName),
      ...optionalRecord("timezone", optionalInlineText(value.timeZone ?? fallbackTimeZone, EVENT_TEXT_MAX_LENGTH)),
      allDay: true,
    };
  }

  throw new Error(`${fieldName} is required.`);
}

function normalizeRecurrenceRules(value: string[] | undefined): string[] {
  const seen = new Set<string>();
  const rules: string[] = [];

  for (const rule of value ?? []) {
    const normalized = optionalInlineText(rule, 1_000);

    if (normalized === undefined || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    rules.push(normalized);
  }

  return rules;
}

function extractPublicHttpsLinks(...values: Array<string | undefined>): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    for (const match of value?.match(HTTPS_URL_PATTERN) ?? []) {
      const url = requireHttpsUrl(match.replace(/[),.;]+$/g, ""), "Imported event link");

      if (url !== undefined && !seen.has(url)) {
        seen.add(url);
        links.push(url);
      }

      if (links.length >= MAX_EXTRACTED_LINKS) {
        return links;
      }
    }
  }

  return links;
}

function candidateField(
  fieldKey: string,
  value: unknown,
  sourceLabel: string,
  sourceUrl?: string,
  visibility: EventImportFieldVisibility = "public",
): EventImportCandidateField {
  return {
    fieldKey,
    value,
    sourceLabel,
    ...optionalRecord("sourceUrl", sourceUrl),
    confidence: "medium",
    reviewState: "unreviewed",
    visibility,
  };
}

function normalizeGoogleCalendarEvent(
  event: GoogleCalendarEventInput,
  sourceLabel: string,
  fallbackTimeZone: string | undefined,
): NormalizedGoogleCalendarImportCandidate {
  const externalEventId = normalizeInlineText(event.id, "", EVENT_TEXT_MAX_LENGTH);

  if (!externalEventId) {
    throw new Error("Google Calendar event id is required.");
  }

  const sourceUrl = requireHttpsUrl(event.htmlLink, "Google Calendar event URL");
  const start = parseGoogleCalendarTime(event.start, "Event start", fallbackTimeZone);
  const end =
    event.end === undefined
      ? undefined
      : parseGoogleCalendarTime(event.end, "Event end", start.timezone ?? fallbackTimeZone);
  const title = normalizeInlineText(event.summary, EVENT_TITLE_FALLBACK, EVENT_TEXT_MAX_LENGTH);
  const description = optionalInlineText(event.description, EVENT_DESCRIPTION_MAX_LENGTH);
  const location = optionalInlineText(event.location, EVENT_LOCATION_MAX_LENGTH);
  const recurrenceRules = normalizeRecurrenceRules(event.recurrence);
  const links = extractPublicHttpsLinks(description, location);
  const sourceUpdatedAt = parseIsoTimestamp(event.updated, "Google Calendar event updated time");
  const cancellationState = event.status === "cancelled" ? "cancelled" : "active";
  const endAt = end === undefined || end.timestamp <= start.timestamp ? undefined : end.timestamp;
  const fields = [
    candidateField("title", title, sourceLabel, sourceUrl),
    candidateField("startAt", start.timestamp, sourceLabel, sourceUrl),
    candidateField("allDay", start.allDay, sourceLabel, sourceUrl),
    ...(endAt === undefined ? [] : [candidateField("endAt", endAt, sourceLabel, sourceUrl)]),
    ...(start.timezone === undefined ? [] : [candidateField("timezone", start.timezone, sourceLabel, sourceUrl)]),
    ...(description === undefined ? [] : [candidateField("description", description, sourceLabel, sourceUrl)]),
    ...(location === undefined ? [] : [candidateField("location", location, sourceLabel, sourceUrl)]),
    ...(links.length === 0 ? [] : [candidateField("links", links, sourceLabel, sourceUrl)]),
    ...(recurrenceRules.length === 0 ? [] : [candidateField("recurrenceRules", recurrenceRules, sourceLabel, sourceUrl)]),
    ...(event.recurringEventId === undefined
      ? []
      : [candidateField("recurringEventId", event.recurringEventId, sourceLabel, sourceUrl, "private")]),
    ...(event.status === undefined ? [] : [candidateField("sourceStatus", event.status, sourceLabel, sourceUrl, "private")]),
  ];

  return {
    externalEventId,
    ...optionalRecord("externalICalUid", optionalInlineText(event.iCalUID, EVENT_TEXT_MAX_LENGTH)),
    ...optionalRecord("sourceUpdatedAt", sourceUpdatedAt),
    ...optionalRecord("sourceUrl", sourceUrl),
    title,
    startAt: start.timestamp,
    ...optionalRecord("endAt", endAt),
    ...optionalRecord("timezone", start.timezone),
    allDay: start.allDay,
    ...optionalRecord("location", location),
    ...optionalRecord("description", description),
    recurrenceRules,
    ...optionalRecord("recurringEventId", optionalInlineText(event.recurringEventId, EVENT_TEXT_MAX_LENGTH)),
    cancellationState,
    reviewState: "unreviewed",
    publicationState: "draft_private",
    fields,
  };
}

export function normalizeGoogleCalendarImport(input: GoogleCalendarImportInput): NormalizedGoogleCalendarImport {
  const externalBatchId = normalizeInlineText(input.batchId, "", EVENT_TEXT_MAX_LENGTH);
  const sourceCalendarId = normalizeInlineText(input.calendarId, "", EVENT_TEXT_MAX_LENGTH);

  if (!externalBatchId) {
    throw new Error("Calendar import batch id is required.");
  }

  if (!sourceCalendarId) {
    throw new Error("Google Calendar id is required.");
  }

  const sourceCalendarSummary = optionalInlineText(input.calendarSummary, EVENT_TEXT_MAX_LENGTH);
  const sourceLabel = sourceCalendarSummary ?? "Google Calendar";

  return {
    externalBatchId,
    provider: "google_calendar",
    sourceName: sourceLabel,
    sourceCalendarId,
    ...optionalRecord("sourceCalendarSummary", sourceCalendarSummary),
    ...optionalRecord("sourceCalendarTimeZone", optionalInlineText(input.calendarTimeZone, EVENT_TEXT_MAX_LENGTH)),
    ...optionalRecord("syncJobId", optionalInlineText(input.syncJobId, EVENT_TEXT_MAX_LENGTH)),
    receivedAt: requireIsoTimestamp(input.receivedAt, "Calendar import receivedAt"),
    reviewState: "draft",
    ...optionalRecord("notes", optionalInlineText(input.notes, 1_000)),
    candidates: input.events.map((event) =>
      normalizeGoogleCalendarEvent(event, sourceLabel, input.calendarTimeZone),
    ),
  };
}

export async function createEventImportDocumentsFromGoogleCalendar(
  db: EventImportWriter,
  input: GoogleCalendarImportInput,
  options: { importedBy?: AuthSubject; now: number },
) {
  const normalized = normalizeGoogleCalendarImport(input);
  const batchId = await db.insert("eventImportBatches", {
    externalBatchId: normalized.externalBatchId,
    provider: normalized.provider,
    sourceName: normalized.sourceName,
    sourceCalendarId: normalized.sourceCalendarId,
    ...optionalRecord("sourceCalendarSummary", normalized.sourceCalendarSummary),
    ...optionalRecord("sourceCalendarTimeZone", normalized.sourceCalendarTimeZone),
    ...optionalRecord("syncJobId", normalized.syncJobId),
    receivedAt: normalized.receivedAt,
    ...optionalRecord("importedBy", options.importedBy),
    reviewState: normalized.reviewState,
    ...optionalRecord("notes", normalized.notes),
    createdAt: options.now,
    updatedAt: options.now,
  });
  const candidateIds: Id<"eventImportCandidates">[] = [];
  const fieldIds: Id<"eventImportCandidateFields">[] = [];

  for (const candidate of normalized.candidates) {
    const candidateId = await db.insert("eventImportCandidates", {
      batchId,
      externalEventId: candidate.externalEventId,
      ...optionalRecord("externalICalUid", candidate.externalICalUid),
      ...optionalRecord("sourceUpdatedAt", candidate.sourceUpdatedAt),
      ...optionalRecord("sourceUrl", candidate.sourceUrl),
      title: candidate.title,
      startAt: candidate.startAt,
      ...optionalRecord("endAt", candidate.endAt),
      ...optionalRecord("timezone", candidate.timezone),
      allDay: candidate.allDay,
      ...optionalRecord("location", candidate.location),
      ...optionalRecord("description", candidate.description),
      recurrenceRules: candidate.recurrenceRules,
      ...optionalRecord("recurringEventId", candidate.recurringEventId),
      cancellationState: candidate.cancellationState,
      reviewState: candidate.reviewState,
      publicationState: candidate.publicationState,
      createdAt: options.now,
      updatedAt: options.now,
    });

    candidateIds.push(candidateId);

    for (const field of candidate.fields) {
      fieldIds.push(
        await db.insert("eventImportCandidateFields", {
          candidateId,
          fieldKey: field.fieldKey,
          value: field.value,
          sourceLabel: field.sourceLabel,
          ...optionalRecord("sourceUrl", field.sourceUrl),
          confidence: field.confidence,
          reviewState: field.reviewState,
          visibility: field.visibility,
          createdAt: options.now,
          updatedAt: options.now,
        }),
      );
    }
  }

  return {
    batchId,
    candidateIds,
    fieldIds,
  };
}

export type EventImportPublicationCandidate = Pick<
  Doc<"eventImportCandidates">,
  "reviewState" | "publicationState" | "cancellationState" | "matchedEventId"
>;

export type EventImportPublicationBatch = Pick<Doc<"eventImportBatches">, "reviewState">;
export type EventImportPublicationField = Pick<
  Doc<"eventImportCandidateFields">,
  "fieldKey" | "reviewState" | "visibility"
>;

export type EventImportPublicationBlocker =
  | "batch_not_approved"
  | "candidate_not_accepted"
  | "candidate_not_pending_publication"
  | "candidate_cancelled"
  | "candidate_already_matched"
  | "field_unreviewed"
  | "field_needs_correction"
  | "unsafe_public_field";

const SAFE_PUBLIC_IMPORT_FIELDS = new Set([
  "title",
  "startAt",
  "endAt",
  "timezone",
  "allDay",
  "description",
  "location",
  "links",
  "recurrenceRules",
]);

export function getEventImportPublicationBlockers(options: {
  batch: EventImportPublicationBatch;
  candidate: EventImportPublicationCandidate;
  fields: EventImportPublicationField[];
}): EventImportPublicationBlocker[] {
  const blockers = new Set<EventImportPublicationBlocker>();

  if (options.batch.reviewState !== "approved") {
    blockers.add("batch_not_approved");
  }

  if (options.candidate.reviewState !== "accepted") {
    blockers.add("candidate_not_accepted");
  }

  if (options.candidate.publicationState !== "review_pending") {
    blockers.add("candidate_not_pending_publication");
  }

  if (options.candidate.cancellationState === "cancelled") {
    blockers.add("candidate_cancelled");
  }

  if (options.candidate.matchedEventId !== undefined) {
    blockers.add("candidate_already_matched");
  }

  for (const field of options.fields) {
    if (field.reviewState === "unreviewed") {
      blockers.add("field_unreviewed");
    }

    if (field.reviewState === "needs_correction") {
      blockers.add("field_needs_correction");
    }

    if (field.visibility === "public" && !SAFE_PUBLIC_IMPORT_FIELDS.has(field.fieldKey)) {
      blockers.add("unsafe_public_field");
    }
  }

  return [...blockers];
}
