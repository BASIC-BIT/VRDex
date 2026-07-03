import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
        canonicalUrl: "https://vrdex.example/e/afterglow-harbor-sessions-2026-06-14",
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
    assert.match(unfoldedCalendar, /DESCRIPTION:A confirmed public event\.\\n\\nhttps:\/\/vrdex\.example\/e\/afterglow-harbor-sessions-2026-06-14\r\n/);
    assert.match(unfoldedCalendar, /LOCATION:Neon Harbor\\, Crystal Annex\r\n/);
    assert.match(unfoldedCalendar, /URL:https:\/\/vrdex\.example\/e\/afterglow-harbor-sessions-2026-06-14\r\n/);
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
        canonicalUrl: "https://vrdex.example/e/community-night",
        now: Date.UTC(2026, 6, 3, 15, 45, 30),
      },
    );
    const unfoldedCalendar = unfoldIcs(calendar);

    assert.equal(calendar.includes("DTEND"), false);
    assert.match(unfoldedCalendar, /SUMMARY:Community Night\\, Wave 1\r\n/);
    assert.match(unfoldedCalendar, /DESCRIPTION:Bring friends\\; stay hydrated\.\\n\\nhttps:\/\/vrdex\.example\/e\/community-night\r\n/);
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
