import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import ts from "typescript";

import {
  createPublicEventFeedIcs,
  createPublicEventIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsUtcTimestamp,
  publicEventIcsFilename,
} from "../../apps/web/src/lib/calendar/ics";

const webRequire = createRequire(path.resolve("apps/web/package.json"));

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

describe("series calendar feed", () => {
  it("a series feed emits each occurrence and no RRULE", () => {
    const night = (id: string, startAt: number) => ({ id, slug: id, title: "Harbor Night", startAt, worlds: [] });
    const calendar = createPublicEventFeedIcs([night("n1", Date.UTC(2026, 10, 7, 1)), night("n2", Date.UTC(2026, 10, 14, 2))],
      { feedName: "Harbor Night", feedUrl: "https://vrdex.example/faceless/series/s1", eventUrl: e => `https://vrdex.example/faceless/events/${e.slug}` });
    assert.match(calendar, /DTSTART:20261107T010000Z/);
    assert.match(calendar, /DTSTART:20261114T020000Z/);
    assert.doesNotMatch(calendar, /RRULE/);
  });

  const series = {
    id: "s1",
    title: "Harbor Night",
    communitySlug: "faceless",
    communityName: "The Faceless",
    nights: [{ id: "n1", slug: "abc", title: "Harbor Night", startAt: Date.UTC(2026, 10, 7, 1), worlds: [] }],
  };
  const routeRequest = new Request("https://vrdex.example/faceless/series/s1/calendar.ics");
  const params = (slug: string) => ({ params: Promise.resolve({ slug, seriesId: "s1" }) });

  function loadSeriesModule(relative: string, result: unknown) {
    const source = readFileSync(path.resolve("apps/web/src/app/[slug]/series/[seriesId]", relative), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
    const dependencies: Record<string, unknown> = {
      "@/convex/server": { fetchPublicEventSeries: async () => result },
      "@/lib/calendar/ics": { createPublicEventFeedIcs, publicEventIcsFilename },
      "@/components/ui/button": { buttonVariants: () => "" },
      "@/components/ui/card": { Card: () => null },
      "@/components/ui/page-shell": { BrandLink: () => null, PageContainer: () => null, PageNav: () => null, PageShell: () => null },
      "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
      "../../../_components/event-public-page": { EventBackendNotice: () => null, EventPreviewCard: () => null },
    };
    const exports: Record<string, any> = {};
    vm.runInNewContext(outputText, { exports, require: (name: string) => dependencies[name] ?? webRequire(name), Response, URL });
    return exports;
  }

  it("the feed route serves a series only under its own community", async () => {
    const { GET } = loadSeriesModule("calendar.ics/route.ts", { kind: "live", series });

    const response = await GET(routeRequest, params("faceless"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/calendar; charset=utf-8");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
    assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="s1.ics"');
    const body = unfoldIcs(await response.text());
    assert.match(body, /X-WR-CALNAME:Harbor Night\r\n/);
    assert.match(body, /URL:https:\/\/vrdex\.example\/faceless\/series\/s1\r\n/);
    assert.match(body, /URL:https:\/\/vrdex\.example\/faceless\/events\/abc\r\n/);

    assert.equal((await GET(routeRequest, params("elsewhere"))).status, 404);
    const missing = loadSeriesModule("calendar.ics/route.ts", { kind: "live", series: null });
    assert.equal((await missing.GET(routeRequest, params("faceless"))).status, 404);
    const failed = loadSeriesModule("calendar.ics/route.ts", { kind: "error" });
    assert.equal((await failed.GET(routeRequest, params("faceless"))).status, 503);
  });

  it("the series page renders only under its own community", async () => {
    const page = loadSeriesModule("page.tsx", { kind: "live", series });
    assert.ok(await page.default(params("faceless")));
    await assert.rejects(page.default(params("elsewhere")), /NOT_FOUND/);
    const missing = loadSeriesModule("page.tsx", { kind: "live", series: null });
    await assert.rejects(missing.default(params("faceless")), /NOT_FOUND/);
  });
});
