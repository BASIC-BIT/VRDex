import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readTimelineNavigation, timelineNavigationHref } from "../../apps/web/src/lib/timeline/navigation";

describe("timeline navigation", () => {
  it("rounds internally computed subpixel anchors before URL validation", () => {
    for (const [anchor, expected] of [[1792972828792.9688, 1792972828793], [1792972828792.25, 1792972828792], [-1.75, -2]]) {
      const href = timelineNavigationHref({ pathname: "/", searchParams: new URLSearchParams(), state: {
        anchor, timeZone: "UTC", view: "timeline", favoritesOnly: false,
      } });
      assert.equal(readTimelineNavigation(new URL(href, "https://vrdex.test").searchParams).anchor, expected);
    }
  });

  it("does not serialize unsafe internal anchors as valid navigation", () => {
    for (const anchor of [NaN, Infinity, -Infinity, Date.UTC(10000, 0, 1), Date.parse("0001-01-01T00:00:00Z")]) {
      const href = timelineNavigationHref({ pathname: "/", searchParams: new URLSearchParams(), state: {
        anchor, timeZone: "UTC", view: "timeline", favoritesOnly: false,
      } });
      assert.equal(new URL(href, "https://vrdex.test").searchParams.get("at"), null);
    }
  });

  it("defaults to timeline without guessing an anchor or viewer timezone", () => {
    assert.deepEqual(readTimelineNavigation(new URLSearchParams()), {
      anchor: null, timeZone: null, view: "timeline", favoritesOnly: false,
    });
  });

  it("reads explicit epoch milliseconds, IANA timezone, agenda and favorites", () => {
    assert.deepEqual(readTimelineNavigation(new URLSearchParams("at=1793509200000&tz=America%2FNew_York&scheduleView=agenda&favorites=1")), {
      anchor: 1793509200000, timeZone: "America/New_York", view: "agenda", favoritesOnly: true,
    });
    assert.equal(readTimelineNavigation(new URLSearchParams("at=0&tz=America%2FIndiana%2FIndianapolis")).anchor, 0);
  });

  it("ignores malformed, out-of-range and nonfinite query values", () => {
    for (const at of ["", "NaN", "Infinity", "1e3", "12oops", "1.5", "8640000000000001", " 0"]) {
      assert.equal(readTimelineNavigation(new URLSearchParams({ at })).anchor, null);
    }
    assert.deepEqual(readTimelineNavigation(new URLSearchParams("tz=MadeUp%2FZone&scheduleView=nope&favorites=true")), {
      anchor: null, timeZone: null, view: "timeline", favoritesOnly: false,
    });
  });

  it("preserves search and duplicate unrelated keys through anchor and view changes", () => {
    const searchParams = new URLSearchParams("q=DJ+Aurora&tag=a&tag=b&view=dj&at=1&tz=UTC");
    const href = timelineNavigationHref({ pathname: "/", searchParams, state: {
      anchor: 1793509200000, timeZone: "America/New_York", view: "agenda", favoritesOnly: true,
    } });
    assert.equal(href, "/?q=DJ+Aurora&tag=a&tag=b&view=dj&at=1793509200000&tz=America%2FNew_York&scheduleView=agenda&favorites=1");
    assert.equal(searchParams.get("at"), "1");
  });

  it("clears optional timeline keys without resetting unrelated navigation history", () => {
    assert.equal(timelineNavigationHref({ pathname: "/", searchParams: new URLSearchParams("q=test&view=dj&at=1&tz=UTC&scheduleView=agenda&favorites=1"), state: {
      anchor: null, timeZone: null, view: "timeline", favoritesOnly: false,
    } }), "/?q=test&view=dj");
    assert.equal(timelineNavigationHref({ pathname: "/", searchParams: new URLSearchParams(), state: {
      anchor: null, timeZone: null, view: "timeline", favoritesOnly: false,
    } }), "/");
  });

  it("restores the previous anchor when a caller reads a prior history URL", () => {
    const previous = new URL("https://vrdex.test/?q=aurora&at=1793509200000&tz=America%2FNew_York");
    const next = timelineNavigationHref({ pathname: previous.pathname, searchParams: previous.searchParams, state: {
      ...readTimelineNavigation(previous.searchParams), anchor: 1793512800000,
    } });
    assert.equal(new URL(next, previous).searchParams.get("at"), "1793512800000");
    assert.equal(readTimelineNavigation(previous.searchParams).anchor, 1793509200000);
    assert.equal(previous.searchParams.get("q"), "aurora");
  });
});

it("rejects navigation outside safe four-digit calendar years, including range padding", () => {
  for (const value of [Date.UTC(10000,0,1), Date.UTC(9999,11,31), Date.parse("0001-01-01T00:00:00Z")]) {
    assert.equal(readTimelineNavigation(new URLSearchParams({at:String(value)})).anchor,null);
  }
  assert.equal(readTimelineNavigation(new URLSearchParams({at:String(Date.UTC(2026,9,26))})).anchor,Date.UTC(2026,9,26));
});

it("rejects encoded fixed offsets while accepting named zones and UTC", () => {
  for (const query of ["tz=%2B02%3A00", "tz=-05%3A00"]) {
    assert.equal(
      readTimelineNavigation(new URLSearchParams(query)).timeZone,
      null,
    );
  }
  assert.equal(
    readTimelineNavigation(new URLSearchParams("tz=UTC")).timeZone,
    "UTC",
  );
});
