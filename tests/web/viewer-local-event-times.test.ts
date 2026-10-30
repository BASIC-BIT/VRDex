import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { it } from "node:test";

// Render the real shared components without browser state or query doubles.
function render(component: string, props: Record<string, unknown>): string {
  return execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import * as components from "./src/app/_components/viewer-local-event-times.tsx";
    process.stdout.write(renderToStaticMarkup(createElement(components[${JSON.stringify(component)}], ${JSON.stringify(props)})));
  `,
    ],
    {
      cwd: path.resolve("apps/web"),
      encoding: "utf8",
      env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.json" },
    },
  );
}

for (const [instant, expected] of [
  ["2026-11-01T05:30:00Z", "1:30 AM GMT-4"],
  ["2026-11-01T06:30:00Z", "1:30 AM GMT-5"],
] as const) {
  it(`distinguishes the repeated hour at ${instant} in exact detail`, () => {
    assert.match(
      render("ViewerLocalEventTimeRange", {
        startAt: Date.parse(instant),
        timeZone: "America/New_York",
        showOffset: true,
      }),
      new RegExp(`>${expected}<`),
    );
  });
}

it("labels both endpoints when a set crosses the DST rollback", () => {
  const html = render("ViewerLocalEventTimeRange", {
    startAt: Date.parse("2026-11-01T05:45:00Z"),
    endAt: Date.parse("2026-11-01T06:15:00Z"),
    timeZone: "America/New_York",
    showOffset: true,
  });
  assert.match(
    html,
    />1:45 AM GMT-4<\/time> - <time[^>]+>1:15 AM GMT-5<\/time>/,
  );
});

it("uses an explicit schedule timezone for event dates", () => {
  assert.match(
    render("ViewerLocalEventDateTime", {
      timestamp: Date.parse("2026-10-27T01:00:00Z"),
      timeZone: "America/New_York",
    }),
    />Oct 26, 9:00 PM EDT</,
  );
});

it("preserves the canonical page's default time presentation and authored date-only value", () => {
  const html = render("ViewerLocalEventTimeRange", {
    startAt: Date.parse("2026-11-01T05:30:00Z"),
    endAt: Date.parse("2026-11-01T06:30:00Z"),
  });
  assert.match(html, />5:30 AM<\/time> - <time[^>]+>6:30 AM<\/time>/);
  assert.doesNotMatch(html, /GMT|UTC/);
  assert.match(
    render("ViewerLocalEventDateTime", {
      scheduleKind: "date_only",
      eventDate: "2026-11-01",
      timeZone: "America/New_York",
    }),
    /dateTime="2026-11-01">Nov 1, 2026 · Time TBA</,
  );
});

it("inspector opts out of zone labels without fixing a DST offset for either instant", () => {
  const html = render("ViewerLocalEventTimeRange", {
    startAt: Date.parse("2026-11-01T05:45:00Z"),
    endAt: Date.parse("2026-11-01T06:15:00Z"),
    timeZone: "America/New_York",
    showOffset: true,
    showTimeZone: false,
  });
  assert.match(html, />1:45 AM<\/time> - <time[^>]+>1:15 AM<\/time>/);
  assert.doesNotMatch(html, /GMT|EDT|EST/);
  assert.match(
    render("ViewerLocalEventDateTime", {
      timestamp: Date.parse("2026-11-01T06:15:00Z"),
      timeZone: "America/New_York",
      showTimeZone: false,
    }),
    />Nov 1, 1:15 AM</,
  );
});
