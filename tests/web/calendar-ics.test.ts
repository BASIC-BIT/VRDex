import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createPublicEventFeedIcs,
  createPublicEventIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsUtcTimestamp,
  publicEventIcsFilename,
} from "../../apps/web/src/lib/calendar/ics";

function unfoldIcs(calendar: string): string {
  return calendar.replace(/\r\n[ \t]/g, "");
}

describe("public event ICS serialization", () => {
  it("serializes a public event with UTC timestamps, URL, description, and location", () => {
    const calendar = createPublicEventIcs(
      {
        id: "event_2a7f9z",
        slug: "afterglow-harbor-sessions-2026-06-14",
        title: "Afterglow Harbor Sessions",
        startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
        endAt: Date.UTC(2026, 5, 15, 1, 30, 0),
        summary: "A confirmed public event.",
        communityName: "Afterglow Social",
        worlds: [{ displayName: "Neon Harbor" }, { displayName: "Crystal Annex" }],
      },
      {
        canonicalUrl: "https://vrdex.example/afterglow-harbor-sessions-2026-06-14",
        now: Date.UTC(2026, 4, 24, 12, 0, 0),
      },
    );
    const unfoldedCalendar = unfoldIcs(calendar);

    assert.match(calendar, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
    assert.match(unfoldedCalendar, /UID:event_2a7f9z@vrdex\.example\r\n/);
    assert.match(unfoldedCalendar, /DTSTAMP:20260524T120000Z\r\n/);
    assert.match(unfoldedCalendar, /DTSTART:20260614T220000Z\r\n/);
    assert.match(unfoldedCalendar, /DTEND:20260615T013000Z\r\n/);
    assert.match(unfoldedCalendar, /SUMMARY:Afterglow Harbor Sessions\r\n/);
    assert.match(unfoldedCalendar, /DESCRIPTION:A confirmed public event\.\\n\\nhttps:\/\/vrdex\.example\/afterglow-harbor-sessions-2026-06-14\r\n/);
    assert.match(unfoldedCalendar, /LOCATION:Neon Harbor\\, Crystal Annex\r\n/);
    assert.match(unfoldedCalendar, /URL:https:\/\/vrdex\.example\/afterglow-harbor-sessions-2026-06-14\r\n/);
    assert.match(calendar, /END:VCALENDAR\r\n$/);
  });

  it("escapes text values and folds long lines by UTF-8 octets", () => {
    assert.equal(escapeIcsText("A, B; C\\D\nE"), "A\\, B\\; C\\\\D\\nE");

    const folded = foldIcsLine(`DESCRIPTION:${"VRDex ".repeat(20)}After party`);
    const physicalLines = folded.split("\r\n");

    assert.ok(physicalLines.length > 1);
    assert.ok(physicalLines.slice(1).every((line) => line.startsWith(" ")));
    assert.ok(physicalLines.every((line) => new TextEncoder().encode(line).length <= 75));
  });

  it("serializes a public feed with multiple safe VEVENT entries", () => {
    const feed = createPublicEventFeedIcs(
      [
        {
          id: "event_afterglow",
          slug: "afterglow",
          title: "Afterglow Harbor",
          startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
          endAt: Date.UTC(2026, 5, 15, 1, 0, 0),
          summary: "Public harbor night.",
          communityName: "Afterglow Social",
          worlds: [{ displayName: "Neon Harbor" }],
        },
        {
          id: "event_dawn",
          slug: "dawn-room",
          title: "Dawn Room",
          startAt: Date.UTC(2026, 5, 21, 3, 0, 0),
          worlds: [],
        },
      ],
      {
        feedName: "VRDex public events",
        feedUrl: "https://vrdex.example/calendar/events.ics",
        eventUrl: (event) => `https://vrdex.example/${event.slug}`,
        now: Date.UTC(2026, 4, 24, 12, 0, 0),
      },
    );
    const unfoldedFeed = unfoldIcs(feed);

    assert.match(unfoldedFeed, /X-WR-CALNAME:VRDex public events\r\n/);
    assert.match(unfoldedFeed, /URL:https:\/\/vrdex\.example\/calendar\/events\.ics\r\n/);
    assert.equal(unfoldedFeed.match(/BEGIN:VEVENT\r\n/g)?.length, 2);
    assert.match(unfoldedFeed, /UID:event_afterglow@vrdex\.example\r\n/);
    assert.match(unfoldedFeed, /UID:event_dawn@vrdex\.example\r\n/);
    assert.equal(feed.includes("operatorNotes"), false);
  });

  it("marks a cancelled public event as cancelled in calendar exports", () => {
    const calendar = createPublicEventIcs(
      {
        id: "event_cancelled",
        slug: "cancelled-night",
        title: "Cancelled Night",
        startAt: Date.UTC(2026, 8, 1, 2, 0, 0),
        status: "cancelled",
        worlds: [],
      },
      {
        canonicalUrl: "https://vrdex.example/cancelled-night",
        now: Date.UTC(2026, 7, 26, 12, 0, 0),
      },
    );

    assert.match(calendar, /STATUS:CANCELLED\r\n/);
    assert.equal(calendar.includes("STATUS:CONFIRMED"), false);
  });

  it("omits missing or invalid end times and ignores fields outside the public export contract", () => {
    const calendar = createPublicEventIcs(
      {
        id: "event_community_night",
        slug: "community-night",
        title: "Community Night, Wave 1",
        startAt: Date.UTC(2026, 7, 1, 2, 15, 0),
        endAt: Date.UTC(2026, 7, 1, 2, 15, 0),
        summary: "Bring friends; stay hydrated.",
        communityName: "Public Host",
        worlds: [],
        operatorNotes: "Do not export this.",
        mediaCommands: ["switch_source"],
      } as Parameters<typeof createPublicEventIcs>[0],
      {
        canonicalUrl: "https://vrdex.example/community-night",
        now: Date.UTC(2026, 6, 3, 15, 45, 30),
      },
    );
    const unfoldedCalendar = unfoldIcs(calendar);

    assert.equal(calendar.includes("DTEND"), false);
    assert.match(unfoldedCalendar, /SUMMARY:Community Night\\, Wave 1\r\n/);
    assert.match(unfoldedCalendar, /DESCRIPTION:Bring friends\\; stay hydrated\.\\n\\nhttps:\/\/vrdex\.example\/community-night\r\n/);
    assert.match(unfoldedCalendar, /LOCATION:Public Host\r\n/);
    assert.equal(calendar.includes("operatorNotes"), false);
    assert.equal(calendar.includes("switch_source"), false);
  });

  it("formats helper values deterministically", () => {
    assert.equal(formatIcsUtcTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5)), "20260102T030405Z");
    assert.equal(publicEventIcsFilename("afterglow/harbor sessions"), "afterglow-harbor-sessions.ics");
    assert.throws(
      () =>
        createPublicEventIcs(
          {
            id: "event_bad_url",
            slug: "bad-url",
            title: "Bad URL",
            startAt: Date.UTC(2026, 0, 1, 0, 0, 0),
            worlds: [],
          },
          { canonicalUrl: "ftp://example.invalid/bad-url" },
        ),
      /absolute HTTP URL/,
    );
  });
});
