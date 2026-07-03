import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Id } from "../../convex/_generated/dataModel";
import {
  createEventImportDocumentsFromGoogleCalendar,
  getEventImportPublicationBlockers,
  normalizeGoogleCalendarImport,
  type GoogleCalendarImportInput,
} from "../../convex/_eventCalendarImports";

const GOOGLE_CALENDAR_IMPORT_FIXTURE: GoogleCalendarImportInput = {
  batchId: "calendar_batch_afterglow_2026_001",
  calendarId: "afterglow-public-calendar",
  calendarSummary: "Afterglow Public Events",
  calendarTimeZone: "America/Los_Angeles",
  syncJobId: "calendar_sync_afterglow_2026_001",
  receivedAt: "2026-06-01T12:00:00.000Z",
  notes: "Operator-selected public events for review.",
  events: [
    {
      id: "google_event_afterglow_harbor",
      iCalUID: "afterglow-harbor@google.com",
      status: "confirmed",
      htmlLink: "https://calendar.google.com/calendar/event?eid=afterglow",
      summary: "Afterglow Harbor Sessions",
      description: "Main harbor night. RSVP at https://tickets.example.invalid/afterglow.",
      location: "Neon Harbor https://worlds.example.invalid/neon-harbor",
      start: {
        dateTime: "2026-06-14T15:00:00-07:00",
        timeZone: "America/Los_Angeles",
      },
      end: {
        dateTime: "2026-06-14T18:30:00-07:00",
        timeZone: "America/Los_Angeles",
      },
      updated: "2026-05-24T12:00:00.000Z",
      recurringEventId: "google_event_afterglow_series",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"],
      attendees: [{ email: "private-person@example.invalid" }],
      reminders: { useDefault: true },
      extendedProperties: { private: { operatorNote: "Do not import" } },
    },
  ],
};

function cloneFixture(): GoogleCalendarImportInput {
  return structuredClone(GOOGLE_CALENDAR_IMPORT_FIXTURE);
}

describe("Google Calendar event import normalization", () => {
  it("creates review-only candidates with provenance and safe public fields", () => {
    const normalized = normalizeGoogleCalendarImport(cloneFixture());
    const candidate = normalized.candidates[0];

    assert.equal(normalized.externalBatchId, "calendar_batch_afterglow_2026_001");
    assert.equal(normalized.provider, "google_calendar");
    assert.equal(normalized.sourceCalendarId, "afterglow-public-calendar");
    assert.equal(normalized.sourceCalendarSummary, "Afterglow Public Events");
    assert.equal(normalized.receivedAt, Date.parse("2026-06-01T12:00:00.000Z"));
    assert.equal(normalized.reviewState, "draft");
    assert.equal(candidate?.externalEventId, "google_event_afterglow_harbor");
    assert.equal(candidate?.externalICalUid, "afterglow-harbor@google.com");
    assert.equal(candidate?.sourceUpdatedAt, Date.parse("2026-05-24T12:00:00.000Z"));
    assert.equal(candidate?.sourceUrl, "https://calendar.google.com/calendar/event?eid=afterglow");
    assert.equal(candidate?.title, "Afterglow Harbor Sessions");
    assert.equal(candidate?.startAt, Date.parse("2026-06-14T15:00:00-07:00"));
    assert.equal(candidate?.endAt, Date.parse("2026-06-14T18:30:00-07:00"));
    assert.equal(candidate?.timezone, "America/Los_Angeles");
    assert.equal(candidate?.allDay, false);
    assert.equal(candidate?.reviewState, "unreviewed");
    assert.equal(candidate?.publicationState, "draft_private");
    assert.equal(candidate?.cancellationState, "active");

    const fieldsByKey = new Map(candidate?.fields.map((field) => [field.fieldKey, field]));

    assert.equal(fieldsByKey.get("title")?.sourceLabel, "Afterglow Public Events");
    assert.equal(fieldsByKey.get("title")?.confidence, "medium");
    assert.equal(fieldsByKey.get("title")?.reviewState, "unreviewed");
    assert.equal(fieldsByKey.get("title")?.visibility, "public");
    assert.deepEqual(fieldsByKey.get("links")?.value, [
      "https://tickets.example.invalid/afterglow",
      "https://worlds.example.invalid/neon-harbor",
    ]);
    assert.equal(fieldsByKey.get("recurringEventId")?.visibility, "private");
    assert.equal(fieldsByKey.get("sourceStatus")?.visibility, "private");
    assert.equal(fieldsByKey.has("attendees"), false);
    assert.equal(fieldsByKey.has("reminders"), false);
    assert.equal(fieldsByKey.has("extendedProperties"), false);
  });

  it("creates import staging documents without publishing canonical events", async () => {
    const inserts: Array<{ table: string; id: string; document: Record<string, unknown> }> = [];
    const db = {
      async insert(table: string, document: Record<string, unknown>) {
        const id = `${table}-${inserts.length + 1}`;
        inserts.push({ table, id, document });
        return id;
      },
    };
    const importedBy = {
      tokenIdentifier: "fixture:calendar-import",
      issuer: "vrdex:test",
      subject: "calendar-importer",
      displayName: "Calendar Importer",
    };

    const result = await createEventImportDocumentsFromGoogleCalendar(
      db as never,
      cloneFixture(),
      { importedBy, now: 1_788_220_800_000 },
    );

    assert.equal(result.candidateIds.length, 1);
    assert.ok(result.fieldIds.length >= 8);
    assert.equal(inserts.some((insert) => insert.table === "events"), false);
    assert.equal(inserts[0]?.table, "eventImportBatches");
    assert.deepEqual(inserts[0]?.document, {
      externalBatchId: "calendar_batch_afterglow_2026_001",
      provider: "google_calendar",
      sourceName: "Afterglow Public Events",
      sourceCalendarId: "afterglow-public-calendar",
      sourceCalendarSummary: "Afterglow Public Events",
      sourceCalendarTimeZone: "America/Los_Angeles",
      syncJobId: "calendar_sync_afterglow_2026_001",
      receivedAt: Date.parse("2026-06-01T12:00:00.000Z"),
      importedBy,
      reviewState: "draft",
      notes: "Operator-selected public events for review.",
      createdAt: 1_788_220_800_000,
      updatedAt: 1_788_220_800_000,
    });

    const candidateInsert = inserts.find((insert) => insert.table === "eventImportCandidates");
    assert.equal(candidateInsert?.document.reviewState, "unreviewed");
    assert.equal(candidateInsert?.document.publicationState, "draft_private");
    assert.equal(candidateInsert?.document.cancellationState, "active");

    const fieldInsert = inserts.find(
      (insert) =>
        insert.table === "eventImportCandidateFields" &&
        insert.document.fieldKey === "links",
    );
    assert.deepEqual(fieldInsert?.document.value, [
      "https://tickets.example.invalid/afterglow",
      "https://worlds.example.invalid/neon-harbor",
    ]);
    assert.equal(fieldInsert?.document.visibility, "public");
  });

  it("handles all-day and cancelled events as private review candidates", () => {
    const fixture = cloneFixture();
    fixture.events = [
      {
        id: "google_event_cancelled_all_day",
        status: "cancelled",
        summary: "Cancelled all-day meetup",
        start: { date: "2026-07-03" },
        end: { date: "2026-07-04" },
      },
    ];

    const candidate = normalizeGoogleCalendarImport(fixture).candidates[0];

    assert.equal(candidate?.allDay, true);
    assert.equal(candidate?.startAt, Date.parse("2026-07-03T00:00:00.000Z"));
    assert.equal(candidate?.endAt, Date.parse("2026-07-04T00:00:00.000Z"));
    assert.equal(candidate?.timezone, "America/Los_Angeles");
    assert.equal(candidate?.cancellationState, "cancelled");
    assert.equal(candidate?.publicationState, "draft_private");
  });

  it("omits imported end times that do not come after the start time", () => {
    const fixture = cloneFixture();
    fixture.events[0]!.end = {
      dateTime: "2026-06-14T14:00:00-07:00",
      timeZone: "America/Los_Angeles",
    };

    const candidate = normalizeGoogleCalendarImport(fixture).candidates[0];

    assert.equal(candidate?.endAt, undefined);
    assert.equal(candidate?.fields.some((field) => field.fieldKey === "endAt"), false);
  });

  it("rejects missing ids, unsafe event URLs, and invalid timestamps", () => {
    const missingBatch = cloneFixture();
    missingBatch.batchId = " ";
    assert.throws(() => normalizeGoogleCalendarImport(missingBatch), /batch id/);

    const missingCalendar = cloneFixture();
    missingCalendar.calendarId = "";
    assert.throws(() => normalizeGoogleCalendarImport(missingCalendar), /Calendar id/);

    const unsafeUrl = cloneFixture();
    unsafeUrl.events[0]!.htmlLink = "http://calendar.google.com/calendar/event?eid=afterglow";
    assert.throws(() => normalizeGoogleCalendarImport(unsafeUrl), /HTTPS URL/);

    const invalidTimestamp = cloneFixture();
    invalidTimestamp.events[0]!.start = { dateTime: "not-a-date" };
    assert.throws(() => normalizeGoogleCalendarImport(invalidTimestamp), /ISO timestamp/);
  });
});

describe("event import publication guards", () => {
  const approvedBatch = { reviewState: "approved" as const };
  const acceptedCandidate = {
    reviewState: "accepted" as const,
    publicationState: "review_pending" as const,
    cancellationState: "active" as const,
  };
  const acceptedPublicFields = [
    {
      fieldKey: "title",
      reviewState: "accepted" as const,
      visibility: "public" as const,
    },
    {
      fieldKey: "startAt",
      reviewState: "accepted" as const,
      visibility: "public" as const,
    },
  ];

  it("allows a reviewed active event candidate to be queued for later publication", () => {
    assert.deepEqual(
      getEventImportPublicationBlockers({
        batch: approvedBatch,
        candidate: acceptedCandidate,
        fields: acceptedPublicFields,
      }),
      [],
    );
  });

  it("blocks unreviewed, cancelled, already matched, and unsafe candidate data", () => {
    const blockers = getEventImportPublicationBlockers({
      batch: { reviewState: "draft" },
      candidate: {
        reviewState: "unreviewed",
        publicationState: "draft_private",
        cancellationState: "cancelled",
        matchedEventId: "event_existing" as Id<"events">,
      },
      fields: [
        {
          fieldKey: "title",
          reviewState: "unreviewed",
          visibility: "public",
        },
        {
          fieldKey: "description",
          reviewState: "needs_correction",
          visibility: "public",
        },
        {
          fieldKey: "sourceStatus",
          reviewState: "accepted",
          visibility: "public",
        },
      ],
    });

    assert.deepEqual(new Set(blockers), new Set([
      "batch_not_approved",
      "candidate_not_accepted",
      "candidate_not_pending_publication",
      "candidate_cancelled",
      "candidate_already_matched",
      "field_unreviewed",
      "field_needs_correction",
      "unsafe_public_field",
    ]));
  });
});
