import { expect, type Page } from "@playwright/test";
import {
  test,
  TIMELINE_NOW,
  changeTimelineFixture,
} from "./home-timeline-fixture";
import { waitForPublicSearchHydration } from "./public-search-fixture";
async function saveInInspector(page: Page, title: string, performer?: string) {
  await page.locator("[data-home-schedule]").getByRole("button", { name: `Open ${title}`, exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Event details", exact: true });
  await panel.getByRole("button", { name: `Interested: ${performer ?? title}`, exact: true }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
}
async function toggleAuroraFavorite(page: Page, selected: boolean) {
  await page.locator("[data-home-schedule]").getByRole("button", { name: "Open ORBIT: Interstellar Bassline Orchestra", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Event details", exact: true });
  await panel.getByRole("button", { name: `${selected ? "Remove favorite" : "Favorite"}: Aurora`, exact: true }).first().click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
}
test.describe("continuous schedule @flow @fixture", () => {
  test.beforeEach(async ({ page, timelineFixture }) => {
    void timelineFixture;
    await page.emulateMedia({ colorScheme: "dark" });
    await page.clock.setFixedTime(TIMELINE_NOW);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Schedule", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
  });
  test("dateOnlyRecordsRemainDiscoverableWithoutAgenda", async ({ page, timelineFixture }) => {
    await page.goto(`/?at=${TIMELINE_NOW - 3600000}&tz=America%2FNew_York&scheduleView=agenda&tag=a&tag=b`);
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "Agenda", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Timeline", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Schedule agenda", { exact: true })).toHaveCount(0);
    const marker = page.getByTestId(`date-marker-${timelineFixture.eventIds[7]}`);
    await expect(marker).toHaveAttribute("data-calendar-date", "2026-10-26");
    await expect(marker).toContainText("Time TBA");
    await marker.getByRole("button", { name: "Open Day Gathering, Time TBA", exact: true }).click();
    const panel = page.getByRole("region", { name: "Event details", exact: true });
    await expect(panel.getByRole("heading", { name: "Day Gathering", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Later", exact: true }).click();
    const query = new URL(page.url()).searchParams;
    expect(query.has("scheduleView")).toBe(false);
    expect(query.get("tz")).toBe("America/New_York");
    expect(query.getAll("tag")).toEqual(["a", "b"]);
  });
  test("openEndDoesNotInventDuration", async ({ page, timelineFixture }) => {
    const marker = page.getByTestId(`date-marker-${timelineFixture.eventIds[6]}`);
    await expect(marker).toBeVisible();
    await expect(marker).toHaveAttribute("data-start-at", String(TIMELINE_NOW + 1800000));
    await expect(page.getByTestId(`event-${timelineFixture.eventIds[6]}`)).toHaveCount(0);
    await marker.getByRole("button", { name: /Open Night Without End/ }).click();
    await expect(page.getByRole("region", { name: "Event details", exact: true })).toBeVisible();
  });
  test("savedUntimedReferencesRemainRemovable", async ({ page, timelineFixture }) => {
    for (const index of [6, 7]) {
      const marker = page.getByTestId(`date-marker-${timelineFixture.eventIds[index]}`);
      await marker.getByRole("button", { name: /^Interested:/ }).click();
      await expect(marker.getByRole("button", { name: /^Remove interest:/ })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "My night", exact: true })).toHaveCount(0);
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-05");
    const fallback = page.getByRole("region", { name: "My night", exact: true });
    for (const title of ["Night Without End", "Day Gathering"]) {
      await fallback.getByRole("button", { name: `Remove ${title} from My night`, exact: true }).click();
    }
    await expect(fallback).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null").plan)).toEqual([]);
  });
  test("quietRangeNavigatesToKnownLaterEvent", async ({ page }) => {
    const width = await page.getByRole("region", { name: "Timeline chart", exact: true }).evaluate((el) => el.clientWidth);
    const quietAnchor = Date.UTC(2026, 9, 26) - (4 + width / 100) * 3600000;
    await page.goto(`/?at=${quietAnchor}&tz=UTC&tag=a&tag=b`);
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute("data-state", "ready");
    await page.getByRole("button", { name: "Next event", exact: true }).click();
    expect(new URL(page.url()).searchParams.get("at")).toBe(String(Date.UTC(2026, 9, 26)));
    expect(new URL(page.url()).searchParams.getAll("tag")).toEqual(["a", "b"]);
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue("2026-10-26");
    await page.getByLabel("Schedule date", { exact: true }).fill("2036-11-05");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "Next event", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Now", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Earlier", exact: true })).toBeVisible();
  });
  test("quietRangePreservesFavoritesWhenNavigatingKnownStart", async ({ page }) => {
    await page.locator("[data-home-schedule]").getByRole("button", { name: "Open ORBIT: Interstellar Bassline Orchestra", exact: true }).click();
    const panel = page.getByRole("region", { name: "Event details", exact: true });
    await panel.getByRole("button", { name: "Favorite: Aurora", exact: true }).first().click();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    const width = await page.getByRole("region", { name: "Timeline chart", exact: true }).evaluate((el) => el.clientWidth);
    const quietAnchor = Date.UTC(2026, 9, 26) - (4 + width / 100) * 3600000;
    await page.goto(`/?at=${quietAnchor}&tz=America%2FNew_York&favorites=1&tag=keep`);
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute("data-state", "ready");
    await page.getByRole("button", { name: "Next event", exact: true }).click();
    const params = new URL(page.url()).searchParams;
    expect(params.get("at")).toBe(String(TIMELINE_NOW - 9000000));
    expect(params.get("favorites")).toBe("1");
    expect(params.get("tz")).toBe("America/New_York");
    expect(params.get("tag")).toBe("keep");
  });
  test("defaultHomeGeometry", async ({ page, isMobile }, info) => {
    const sizes = isMobile ? [page.viewportSize()!] : [{ width: 1280, height: 800 }, { width: 1440, height: 900 }];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.evaluate(() => window.scrollTo(0, 0));
      const metrics = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
        return { search: rect('input[aria-label="Search VRDex"]'), schedule: rect('[data-home-schedule]'), lanes: rect('[data-testid="public-timeline-lanes"]'), chart: rect('[aria-label="Timeline chart"]'), discover: rect('[aria-labelledby="discover-heading"]'), artwork: rect('[data-testid="discovery-event-card"] a'), bars: [...document.querySelectorAll('[data-testid^="event-"]')].map((el) => ({ id: el.getAttribute("data-testid"), top: (el as HTMLElement).style.top })), markers: document.querySelectorAll('[data-testid^="date-marker-"]').length };
      });
      await info.attach(`default-${size.width}.json`, { body: JSON.stringify({ size, ...metrics }), contentType: "application/json" });
      await page.screenshot({ path: info.outputPath(`default-${size.width}.png`), fullPage: true });
    }
  });
  test("fourPublicRowsRemainAtQuietStartup", async ({ page }, info) => {
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-05");
    const lanes = page.getByTestId("public-timeline-lanes");
    await expect(lanes).toHaveCount(1);
    expect((await lanes.boundingBox())?.height).toBeGreaterThanOrEqual(376);
    await info.attach("quiet-lanes.json", { body: JSON.stringify(await lanes.boundingBox()), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath("quiet-four-rows.png"), fullPage: true });
  });
  test("favorites synchronize across tabs and saves survive reload without public snapshots", async ({
    page,
    timelineFixture,
  }) => {
    await expect(
      page.getByRole("heading", { name: "My night", exact: true }),
    ).toHaveCount(0);

    const other = await page.context().newPage();
    try {
      await other.clock.setFixedTime(TIMELINE_NOW);
      await other.goto("/");
      await expect(other.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "ready",
      );
      await page
        .getByRole("button", { name: "Favorite: Prism Collective", exact: true })
        .first()
        .click();
      await expect(
        other
          .getByRole("button", {
            name: "Remove favorite: Prism Collective",
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await other
        .getByRole("button", {
          name: "Remove favorite: Prism Collective",
          exact: true,
        })
        .first()
        .click();
      await expect(
        page
          .getByRole("button", {
            name: "Favorite: Prism Collective",
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await toggleAuroraFavorite(page, false);
      await page
        .getByRole("button", { name: "Favorites only", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Open Low Tide", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "Open ORBIT: Interstellar Bassline Orchestra",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Open Neon Harbor at ORBIT: Interstellar Bassline Orchestra",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Favorites only", exact: true })
        .click();
      await toggleAuroraFavorite(page, true);
      await page
        .getByRole("button", { name: "Interested: Low Tide", exact: true })
        .click();
      await page.reload();
      await expect(
        page
          .getByRole("region", { name: "My night", exact: true })
          .getByText("Low Tide", { exact: false }),
      ).toBeVisible();
      expect(
        await page.evaluate(() =>
          JSON.parse(
            localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
          ),
        ),
      ).toEqual({
        version: 1,
        plan: [{ kind: "event", eventId: timelineFixture.eventIds[4] }],
        favoriteProfileIds: [],
      });
    } finally {
      await other.close();
    }
  });
  test("blocked storage retains usable session saves with Not saved", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem,
        set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key === "vrdex.timeline.preferences.v1")
          throw new DOMException("Blocked", "SecurityError");
        return get.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === "vrdex.timeline.preferences.v1")
          throw new DOMException("Blocked", "SecurityError");
        return set.call(this, key, value);
      };
    });
    await page.reload();
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
    );

    await page
      .getByRole("button", { name: "Interested: Low Tide", exact: true })
      .click();
    await expect(page.getByText("Not saved", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "My night", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("region", { name: "My night", exact: true })
      .getByRole("button", {
        name: "Remove interest: Low Tide",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "My night", exact: true }),
    ).toHaveCount(0);
  });
  test("overlapping sets survive together, whole-event replacement is explicit, and recreated slots stay unavailable", async ({
    page,
    request,
    timelineFixture,
  }) => {

    await saveInInspector(page, "ORBIT: Interstellar Bassline Orchestra", "Aurora");
    await saveInInspector(page, "Glasshouse Sessions", "Neon Harbor");
    const night = page.getByRole("region", { name: "My night", exact: true });
    await expect(page.getByTestId("night-lanes").getByLabel("Overlap", { exact: true })).toHaveCount(2);
    await changeTimelineFixture(request, timelineFixture, 3, "recreate-slot");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(night.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(night.getByText("Aurora", { exact: true })).toHaveCount(0);
    await night
      .getByRole("button", {
        name: "Remove unavailable item from My night",
        exact: true,
      })
      .click();
    await saveInInspector(page, "ORBIT: Interstellar Bassline Orchestra", "Aurora");
    await saveInInspector(page, "ORBIT: Interstellar Bassline Orchestra", "Neon Harbor");
    await saveInInspector(page, "ORBIT: Interstellar Bassline Orchestra");
    const plan = await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
        ).plan,
    );
    expect(plan).toEqual([
      {
        kind: "set",
        eventId: timelineFixture.eventIds[2],
        slotId: timelineFixture.slotIds[5],
      },
      { kind: "event", eventId: timelineFixture.eventIds[3] },
    ]);
  });
  for (const departure of ["submit", "suggestion", "discovery"] as const) {
    test(`pending pan cannot overwrite ${departure} navigation`, async ({
      page,
    }) => {
      await waitForPublicSearchHydration(page);
      const input = page.getByRole("combobox", { name: "Search VRDex" });
      if (departure !== "discovery") {
        await input.fill("BASICBIT");
        await expect(
          page.getByRole("option", { name: /BASICBIT/ }).first(),
        ).toBeVisible();
      }
      const destination =
        departure === "discovery"
          ? "/discovery"
          : departure === "suggestion"
            ? "/basicbit"
            : "/search";
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const requested = new Promise<void>((resolve) => {
        started = resolve;
      });
      await page.route(
        (url) => url.pathname === destination,
        async (route) => {
          started();
          await barrier;
          await route.continue();
        },
      );
      await page.clock.install({ time: TIMELINE_NOW });
      await page.clock.pauseAt(TIMELINE_NOW + 1000);
      const expectedAnchor = TIMELINE_NOW - 3_600_000 + 1.2 * 3_600_000;
      const expectedScroll = await page
        .getByRole("region", { name: "Timeline chart" })
        .evaluate((element) => element.scrollLeft + 120);
      // Pan and depart in one browser task: no waits between user actions.
      await page.evaluate((departure) => {
        const chart = document.querySelector('[aria-label="Timeline chart"]');
        if (!chart) throw Error("Missing chart");
        chart.scrollLeft += 120;
        chart.dispatchEvent(new Event("scroll"));
        if (departure === "submit")
          document.querySelector("form")?.requestSubmit();
        else if (departure === "suggestion")
          document.querySelector<HTMLButtonElement>('[role="option"]')?.click();
        else
          document
            .querySelector<HTMLAnchorElement>('a[href="/discovery"]')
            ?.click();
      }, departure);
      await requested;
      try {
        await page.clock.runFor(500);
        expect(new URL(page.url()).searchParams.get("at")).toBe(
          String(expectedAnchor),
        );
      } finally {
        release();
      }
      await expect(page).toHaveURL(
        departure === "submit"
          ? /\/search\?q=BASICBIT$/
          : new RegExp(destination + "$"),
      );
      await page.clock.resume();
      await page.goBack();
      await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "ready",
      );
      expect(new URL(page.url()).searchParams.get("at")).toBe(
        String(expectedAnchor),
      );
      const chart = page.getByRole("region", { name: "Timeline chart" });
      await expect
        .poll(() => chart.evaluate((element) => element.scrollLeft))
        .toBe(expectedScroll);
    });
  }
  test("panelReservesLoadingBounds", async ({
    page,
    timelineFixture,
  }, info) => {
    const record = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);
    let held = false;
    const buffered: Array<string | Buffer> = [];
    let release = () => {};
    await page.routeWebSocket("**/api/**/sync", (socket) => {
      const server = socket.connectToServer();
      release = () => {
        held = false;
        for (const message of buffered.splice(0)) socket.send(message);
      };
      socket.onMessage((message) => {
        const payload: unknown = JSON.parse(String(message));
        if (
          record(payload) &&
          payload.type === "ModifyQuerySet" &&
          Array.isArray(payload.modifications) &&
          payload.modifications.some(
            (modification) =>
              record(modification) &&
              modification.type === "Add" &&
              modification.udfPath === "events:getPublicBySlug",
          )
        )
          held = true;
        server.send(message);
      });
      server.onMessage((message) => {
        if (held) buffered.push(message);
        else socket.send(message);
      });
    });
    await page.reload();
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
    );
    const trigger = page
      .getByTestId(`event-${timelineFixture.eventIds[3]}`)
      .getByRole("button", {
        name: "Open ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      });
    await trigger.click();
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    await expect(
      panel.getByText("Loading events", { exact: true }),
    ).toBeVisible();
    const loading = await panel.boundingBox();
    release();
    await expect(
      panel.getByRole("heading", {
        name: "ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    const ready = await panel.boundingBox();
    await info.attach("panel-loading-bounds.json", {
      body: JSON.stringify({ loading, ready }),
      contentType: "application/json",
    });
    expect(ready).toEqual(loading);
    await page.screenshot({ path: info.outputPath("panel-ready-bounds.png") });
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(trigger).toBeFocused();
  });
  test("fullEventLinksPreserveNativeActivation", async ({
    page,
    context,
    timelineFixture,
  }) => {
    await page
      .getByTestId(`event-${timelineFixture.eventIds[3]}`)
      .getByRole("button", {
        name: "Open ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      })
      .click();
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    const href = `/${timelineFixture.runId}-community/events/${timelineFixture.runId}-3`;
    const links = [
      panel.getByRole("link", {
        name: "ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      }),
      panel.getByRole("link", { name: "Open full event page", exact: true }),
    ];
    for (const link of links) {
      await expect(link).toHaveAttribute("href", href);
      const opened = context.waitForEvent("page");
      await link.click({ modifiers: ["ControlOrMeta"] });
      const tab = await opened;
      await expect(tab).toHaveURL(new RegExp(href + "$"));
      await tab.close();
      await expect(panel).toBeVisible();
    }
    await expect(
      panel.getByRole("link", { name: "Open event", exact: true }),
    ).toHaveCount(0);
  });
  test("panelUsesCompactPerformerControls", async ({
    page,
    timelineFixture,
    isMobile,
  }, info) => {
    let releasePoster: () => void = () => {};
    const posterHeld = new Promise<void>((resolve) => {
      releasePoster = resolve;
    });
    await page.route(
      "**/api/e2e/fixture-assets/fixture-orbit-timeline-poster",
      async (route) => {
        await posterHeld;
        await route.continue();
      },
    );
    const chart = page.getByRole("region", { name: "Timeline chart" });
    const width = await chart.evaluate((el) => el.clientWidth);
    const open = page
      .getByTestId(`event-${timelineFixture.eventIds[3]}`)
      .getByRole("button", {
        name: "Open ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      });
    await open.focus();
    const beforeOpen = await page.evaluate(() => ({
      y: window.scrollY,
      x: document.querySelector('[aria-label="Timeline chart"]')?.scrollLeft,
    }));
    await open.press("Enter");
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("heading", {
        name: "ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      }),
    ).toBeVisible();
    const poster = panel.getByRole("img", {
      name: "ORBIT: Interstellar Bassline Orchestra poster",
    });
    await expect(poster).toBeVisible();
    const posterBoundsBeforeDecode = await poster.boundingBox();
    releasePoster();

    await expect
      .poll(() =>
        poster.evaluate(
          (el) =>
            el instanceof HTMLImageElement &&
            el.complete &&
            el.naturalWidth > 0,
        ),
      )
      .toBe(true);
    expect(await poster.boundingBox()).toEqual(posterBoundsBeforeDecode);
    expect(await poster.evaluate((el) => getComputedStyle(el).objectFit)).toBe(
      "contain",
    );
    expect(await chart.evaluate((el) => el.clientWidth)).toBe(width);
    expect(
      await page.evaluate(() => ({
        y: window.scrollY,
        x: document.querySelector('[aria-label="Timeline chart"]')?.scrollLeft,
      })),
    ).toEqual(beforeOpen);
    expect(await page.locator("audio, video, iframe").count()).toBe(0);
    expect(await page.getByRole("dialog").count()).toBe(0);
    const initial = await chart.evaluate((el) => el.scrollLeft);
    await chart.focus();
    await chart.press("ArrowRight");
    await expect
      .poll(() => chart.evaluate((el) => el.scrollLeft))
      .not.toBe(initial);
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Expand", exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByText("DJ", { exact: true })).toHaveCount(0);
    await expect(
      panel.getByLabel("Timezone and hour format", { exact: true }),
    ).toHaveText("UTC · 12h");
    if (isMobile) {
      expect((await panel.boundingBox())?.height).toBeLessThanOrEqual(
        (page.viewportSize()?.height ?? 0) / 2 + 1,
      );
    }
    await panel
      .getByRole("button", {
        name: "Interested: ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      })
      .click();
    const included = panel.getByRole("button", {
      name: "Included with event: Aurora",
      exact: true,
    });
    await expect(included).toBeDisabled();
    await panel
      .getByRole("button", { name: "Favorite: Aurora", exact: true })
      .first()
      .click();
    await expect(
      panel
        .getByRole("button", { name: "Remove favorite: Aurora", exact: true })
        .first(),
    ).toBeVisible();
    await panel
      .getByRole("button", {
        name: "Remove interest: ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      })
      .click();
    await expect(
      panel.getByRole("button", {
        name: "Interested: Aurora",
        exact: true,
      }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "Interested: Aurora", exact: true })
      .click();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
          ).plan,
      ),
    ).toEqual([
      {
        kind: "set",
        eventId: timelineFixture.eventIds[3],
        slotId: timelineFixture.slotIds[6],
      },
    ]);
    const performer = panel.getByRole("listitem").first();
    await performer.scrollIntoViewIfNeeded();
    for (const button of await performer.getByRole("button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(40);
      expect(bounds?.height).toBeGreaterThanOrEqual(40);
    }
    await page.screenshot({
      path: info.outputPath("detail-compact-lineup.png"),
    });
    const scroll = panel.getByTestId("event-detail-scroll");
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await scroll.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath("detail-panel.png") });
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.press("Enter");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.click();
    const href = `/${timelineFixture.runId}-community/events/${timelineFixture.runId}-3`;
    await expect(
      panel.getByRole("link", { name: "Open full event page", exact: true }),
    ).toHaveAttribute("href", href);
    await panel
      .getByRole("link", { name: "Open full event page", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(href + "$"));
  });
  test("real bars, timeline markers, saves, favorites and usable public search", async ({
    page,
    timelineFixture,
  }, info) => {
    const bar = page.getByTestId(`event-${timelineFixture.eventIds[3]}`);
    await expect(bar).toBeVisible();
    await expect(
      page.getByText("Day Gathering", { exact: true }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", {
        name: "Open ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Interested: ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "My night", exact: true }),
    ).toBeVisible();

    await expect(page.getByTestId("night-lanes")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("schedule-saved.png"),
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Favorite: Prism Collective", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Favorites only", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Open Low Tide", exact: true }),
    ).toHaveCount(0);
    await waitForPublicSearchHydration(page);
    await page.getByRole("combobox", { name: /Search/i }).fill("Aurora");
    await page.getByRole("combobox", { name: /Search/i }).press("Enter");
    await expect(page).toHaveURL(/\/search\?q=Aurora/);
  });
  test("midnight pan, Now/date navigation, history and refresh focus", async ({
    page,
    request,
    timelineFixture,
  }, info) => {
    const viewport = page.getByRole("region", { name: "Timeline chart" });
    await viewport.focus();
    await viewport.press("ArrowRight");
    await expect.poll(() => page.url()).toContain("at=");
    await page.getByRole("button", { name: "Later", exact: true }).click();
    await expect(
      page.getByText("Oct 27, 2026", { exact: false }).first(),
    ).toBeVisible();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-10-28");
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue(
      "2026-10-28",
    );
    await page.goBack();
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue(
      "2026-10-27",
    );
    await page.goForward();
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue(
      "2026-10-28",
    );
    await page.getByRole("button", { name: "Now", exact: true }).click();
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue(
      "2026-10-26",
    );
    const nowControl = page.getByRole("button", { name: "Now", exact: true });
    await nowControl.focus();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(nowControl).toBeFocused();
    const ongoing = page
      .getByTestId(`event-${timelineFixture.eventIds[0]}`)
      .getByRole("button", { name: "Open Soft Focus", exact: true });
    await changeTimelineFixture(request, timelineFixture, 1, "hidden");
    await ongoing.focus();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await expect(
      page.getByTestId(`event-${timelineFixture.eventIds[1]}`),
    ).toHaveCount(0);
    await expect(ongoing).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("schedule-dense.png"),
      fullPage: true,
    });
  });
  test("pointer drag suppresses selection, keyboard and touch actions select deliberately", async ({
    page,
    timelineFixture,
    isMobile,
  }) => {
    const bar = page.getByTestId(`event-${timelineFixture.eventIds[3]}`);
    const open = bar.getByRole("button", {
      name: "Open ORBIT: Interstellar Bassline Orchestra",
      exact: true,
    });
    if (!isMobile) {
      const box = await open.boundingBox();
      if (!box) throw Error("Missing event bounds");
      await page.mouse.move(box.x + 50, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x - 100, box.y + 20, { steps: 8 });
      await page.mouse.up();
      await expect(open).toHaveAttribute("aria-pressed", "false");
      await open.focus();
      await open.press("Enter");
      await expect(open).toHaveAttribute("aria-pressed", "true");
    } else {

      await page
        .getByRole("button", {
          name: "Interested: ORBIT: Interstellar Bassline Orchestra",
          exact: true,
        })
        .tap();
      await expect(
        page.getByRole("heading", { name: "My night", exact: true }),
      ).toBeVisible();
    }
  });
  test("saved conflicts, Next saved and revoked metadata use real public resolution", async ({
    page,
    request,
    timelineFixture,
  }, info) => {

    for (const title of [
      "ORBIT: Interstellar Bassline Orchestra",
      "Low Tide",
      "Day Gathering",
    ])
      await page
        .getByRole("button", { name: `Interested: ${title}`, exact: true })
        .click();
    const night = page.getByRole("region", { name: "My night", exact: true });
    await expect(page.getByTestId("night-lanes").getByLabel("Overlap", { exact: true })).toHaveCount(2);
    await expect(
      page.getByTestId(`date-marker-${timelineFixture.eventIds[7]}`).getByText("Time TBA", { exact: true }),
    ).toBeVisible();

    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-02");
    await expect(
      page.getByRole("button", { name: "Next saved", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("night-lanes")).toHaveCount(0);
    await expect(
      page.getByText("No events in this range", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next saved", exact: true }).click();
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue(
      "2026-10-26",
    );
    await changeTimelineFixture(request, timelineFixture, 3, "cancelled");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(night.getByText("Cancelled", { exact: true })).toBeVisible();
    await night
      .getByRole("button", {
        name: "ORBIT: Interstellar Bassline Orchestra Cancelled",
        exact: true,
      })
      .click();
    const cancelledPanel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    await expect(
      cancelledPanel.getByText("Cancelled", { exact: true }),
    ).toBeVisible();
    await cancelledPanel
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await changeTimelineFixture(request, timelineFixture, 3, "hidden");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(night.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(
      night.getByText("ORBIT: Interstellar Bassline Orchestra", {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await page.screenshot({
      path: info.outputPath("schedule-unavailable.png"),
      fullPage: true,
    });
    await night
      .getByRole("button", {
        name: "Remove unavailable item from My night",
        exact: true,
      })
      .click();
    await expect(night.getByText("Unavailable", { exact: true })).toHaveCount(
      0,
    );
    const saved = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
      ),
    );
    expect(saved.plan).toHaveLength(2);
    expect(Object.keys(saved.plan[0]).sort()).toEqual(["eventId", "kind"]);
  });
  test("unsupported query dates fall back to the useful Now range", async ({
    page,
  }) => {
    await page.goto("/?at=253402300800000&tz=%2B02%3A00");
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue(
      "2026-10-26",
    );
    await expect(
      page.getByLabel("Timeline chart", { exact: true }),
    ).toBeVisible();
  });
  test("included sets cannot remove their whole-event save", async ({ page, timelineFixture, isMobile }, info) => {
    const title = "ORBIT: Interstellar Bassline Orchestra";
    await saveInInspector(page, title);
    const bar = page.getByTestId(`event-${timelineFixture.eventIds[3]}`);
    const chartIncluded = bar.getByRole("button", { name: `Included with event: Aurora at ${title}`, exact: true, includeHidden: true });
    await expect(chartIncluded).toBeDisabled();
    await expect(chartIncluded).toHaveAttribute("title", "Included with event");
    await chartIncluded.dispatchEvent("click");
    await bar.getByRole("button", { name: `Open ${title}`, exact: true }).click();
    const panel = page.getByRole("region", { name: "Event details", exact: true });
    const included = panel.getByRole("button", { name: "Included with event: Aurora", exact: true });
    await expect(included).toBeDisabled();
    await included.dispatchEvent("click");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null").plan)).toEqual([{ kind: "event", eventId: timelineFixture.eventIds[3] }]);
    await page.screenshot({ path: info.outputPath("schedule-included.png"), fullPage: true });
    const remove = panel.getByRole("button", { name: `Remove interest: ${title}`, exact: true });
    if (isMobile) await remove.tap(); else await remove.click();
    await expect(panel.getByRole("button", { name: "Interested: Aurora", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null").plan)).toEqual([]);
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("heading", { name: "My night", exact: true })).toHaveCount(0);
  });
  test("detail replacement, hostless navigation and vanished-invoker focus", async ({
    page,
    timelineFixture,
  }) => {
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });

    await page
      .getByRole("button", {
        name: "Open ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      })
      .click();
    await expect(
      panel.getByRole("heading", {
        name: "ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      }),
    ).toBeVisible();
    const other = page.getByRole("button", {
      name: "Open Low Tide",
      exact: true,
    });
    await other.focus();
    await other.press("Enter");
    await expect(
      panel.getByRole("heading", { name: "Low Tide", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("heading", {
        name: "ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("link", { name: "Open full event page", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-02");
    await expect(other).toHaveCount(0);
    await expect(
      panel.getByRole("heading", { name: "Low Tide", exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Schedule", exact: true }),
    ).toBeFocused();
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue(
      "2026-11-02",
    );
    void timelineFixture;
  });
  test.describe("dense detail roster", () => {
    test.use({ timelineScenario: "detail" });
    test("selected-read transport failure offers independent Retry without dropping usable lineup", async ({
      page,
      timelineFixture,
    }, info) => {
      const record = (value: unknown): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value);
      const failures = new Map<number, "selected" | "continuation">();
      let failSelected = true,
        selectedRequests = 0,
        detailRequests = 0;
      await page.routeWebSocket("**/api/**/sync", (socket) => {
        const server = socket.connectToServer();
        socket.onMessage((message) => {
          const payload: unknown = JSON.parse(String(message));
          if (
            record(payload) &&
            payload.type === "ModifyQuerySet" &&
            Array.isArray(payload.modifications)
          ) {
            for (const modification of payload.modifications) {
              if (
                !record(modification) ||
                modification.type !== "Add" ||
                typeof modification.queryId !== "number" ||
                !Array.isArray(modification.args)
              )
                continue;
              const args: unknown = modification.args[0];
              if (!record(args)) continue;
              if (
                modification.udfPath === "eventTimeline:listPublicRoster" &&
                args.detail === true &&
                args.eventId === timelineFixture.eventIds[3]
              ) {
                detailRequests++;
                if (typeof args.cursor === "string")
                  failures.set(modification.queryId, "continuation");
              }
              if (
                modification.udfPath === "eventTimeline:resolveSaved" &&
                Array.isArray(args.references)
              ) {
                const ref: unknown = args.references[0];
                if (record(ref) && ref.slotId === timelineFixture.slotIds[86]) {
                  selectedRequests++;
                  if (failSelected)
                    failures.set(modification.queryId, "selected");
                }
              }
            }
          }
          server.send(message);
        });
        server.onMessage((message) => {
          const payload: unknown = JSON.parse(String(message));
          if (
            record(payload) &&
            payload.type === "Transition" &&
            Array.isArray(payload.modifications)
          ) {
            payload.modifications = payload.modifications.map(
              (modification: unknown) => {
                if (
                  !record(modification) ||
                  modification.type !== "QueryUpdated" ||
                  typeof modification.queryId !== "number"
                )
                  return modification;
                const failure = failures.get(modification.queryId);
                if (!failure) return modification;
                if (failure === "selected") failSelected = false;
                return {
                  type: "QueryFailed",
                  queryId: modification.queryId,
                  errorMessage: "Injected transport failure",
                  errorData: null,
                  logLines: [],
                  journal: modification.journal,
                };
              },
            );
            socket.send(JSON.stringify(payload));
          } else socket.send(message);
        });
      });
      await page.reload();
      await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "ready",
      );

      await page
        .getByRole("button", {
          name: "Open Later-page guest at ORBIT: Interstellar Bassline Orchestra",
          exact: true,
        })
        .click();
      const panel = page.getByRole("region", {
        name: "Event details",
        exact: true,
      });
      const rows = panel.getByRole("listitem");
      await expect(rows).toHaveCount(80);
      await expect(panel.locator('[data-selected="true"]')).toHaveCount(0);
      const retry = panel.getByRole("button", {
        name: "Retry selected set",
        exact: true,
      });
      await expect(retry).toBeInViewport();
      await page.screenshot({
        path: info.outputPath("selected-retry-error.png"),
      });
      expect(selectedRequests).toBe(1);
      expect(detailRequests).toBe(2);
      await retry.click();
      await expect(panel.locator('[data-selected="true"]')).toHaveAttribute(
        "data-slot-id",
        timelineFixture.slotIds[86],
      );
      await expect(panel.locator('[data-selected="true"]')).toBeInViewport();
      await expect(rows).toHaveCount(81);
      await expect(retry).toHaveCount(0);
      expect(selectedRequests).toBe(2);
      expect(detailRequests).toBe(2);
      await page.screenshot({ path: info.outputPath("selected-retry.png") });
    });

    test("panelKeepsLatePageSetAndFocus", async ({
      page,
      request,
      timelineFixture,
    }, info) => {

      const later = page.getByRole("button", {
        name: "Open Later-page guest at ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      });
      await later.focus();
      const beforeSelection = await page.evaluate(() => window.scrollY);
      await later.press("Enter");
      const panel = page.getByRole("region", {
        name: "Event details",
        exact: true,
      });
      const row = panel.locator('[data-selected="true"]');
      await expect(row).toHaveAttribute(
        "data-slot-id",
        timelineFixture.slotIds[86],
      );
      await expect(row).toBeInViewport();
      expect(await page.evaluate(() => window.scrollY)).toBe(beforeSelection);
      const firstSet = page.getByRole("button", {
        name: "Open Aurora at ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      });
      await firstSet.focus();
      const beforeSameEvent = await page.evaluate(() => window.scrollY);
      await firstSet.press("Enter");
      await expect(row).toHaveAttribute(
        "data-slot-id",
        timelineFixture.slotIds[6],
      );
      await expect(row).toBeInViewport();
      expect(await page.evaluate(() => window.scrollY)).toBe(beforeSameEvent);
      await later.focus();
      await later.press("Enter");
      await expect(row).toHaveAttribute(
        "data-slot-id",
        timelineFixture.slotIds[86],
      );
      await expect(row).toBeInViewport();
      expect(
        await page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
            )?.plan ?? [],
        ),
      ).toEqual([]);
      await expect(
        panel.getByText("Manual guest", { exact: true }),
      ).toHaveCount(1);
      await expect(
        panel.getByText("Untimed Aurora", { exact: true }),
      ).toHaveCount(1);
      await expect(
        panel.getByText("SECRET PERSON", { exact: true }),
      ).toHaveCount(0);
      expect(await panel.innerHTML()).not.toContain(
        timelineFixture.profileIds[2],
      );
      const manual = panel
        .getByRole("listitem")
        .filter({ has: page.getByText("Manual guest", { exact: true }) });
      await expect(
        manual.getByRole("button", { name: /Favorite/ }),
      ).toHaveCount(0);
      await expect(manual.getByText("Host", { exact: true })).toHaveCount(1);
      await expect(manual.getByRole("link")).toHaveCount(0);
      await expect(panel.getByText("DJ", { exact: true })).toHaveCount(0);
      const favorite = row.getByRole("button", {
        name: "Favorite: Aurora",
        exact: true,
      });
      await favorite.focus();
      const scrollBefore = await panel
        .getByTestId("event-detail-scroll")
        .evaluate((el) => el.scrollTop);
      await favorite.press("Enter");
      await expect(
        row.getByRole("button", {
          name: "Remove favorite: Aurora",
          exact: true,
        }),
      ).toBeFocused();
      expect(
        await panel
          .getByTestId("event-detail-scroll")
          .evaluate((el) => el.scrollTop),
      ).toBe(scrollBefore);
      await row
        .getByRole("button", { name: "Remove favorite: Aurora", exact: true })
        .press("Enter");
      await page.screenshot({
        path: info.outputPath("detail-selected-later.png"),
      });
      await row
        .getByRole("button", {
          name: "Interested: Later-page guest",
          exact: true,
        })
        .click();
      await panel.getByRole("button", { name: "Close", exact: true }).click();
      await page
        .getByLabel("Schedule date", { exact: true })
        .fill("2036-11-04");
      await expect(
        page.getByText("No events in this range", { exact: true }),
      ).toBeVisible();
      const saved = page
        .getByRole("region", { name: "My night", exact: true })
        .getByRole("button", { name: /^Later-page guest/ });
      await saved.click();
      await expect(row).toBeInViewport();
      await row
        .getByRole("button", { name: "Favorite: Aurora", exact: true })
        .click();
      await expect(
        row.getByRole("button", {
          name: "Remove favorite: Aurora",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
            ).favoriteProfileIds,
        ),
      ).toEqual([timelineFixture.profileIds[1]]);
      await changeTimelineFixture(request, timelineFixture, 3, "hidden");
      await expect(panel).toHaveCount(0);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        page
          .getByRole("region", { name: "My night", exact: true })
          .getByText("Unavailable", { exact: true }),
      ).toBeVisible();
    });
  });
  test.describe("prefetch row stability", () => {
    test.use({ timelineScenario: "prefetch" });
    test("ordinary panning across the six-hour threshold preserves an unchanged ongoing row", async ({
      page,
      timelineFixture,
    }, info) => {
      const h = 3_600_000,
        boundary = Date.UTC(2026, 9, 26);
      await page.goto(`/?at=${boundary + 3 * h}`);
      await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "ready",
      );
      const earlier = page.getByTestId(`event-${timelineFixture.eventIds[0]}`);
      const ongoing = page.getByTestId(`event-${timelineFixture.eventIds[1]}`);
      await expect(earlier).toHaveCount(1);
      await expect(ongoing).toBeVisible();
      const initialTop = await ongoing.evaluate((el) => el.style.top);
      expect(initialTop).toBe("102px");
      const chart = page.getByRole("region", { name: "Timeline chart" });
      await chart.evaluate((el) => {
        el.scrollLeft += 400;
      });
      // The previous-window-only record disappearing witnesses the real query/window transition.
      await expect(earlier).toHaveCount(0);
      await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "ready",
      );
      await expect(ongoing).toBeVisible();
      await expect
        .poll(() => ongoing.evaluate((el) => el.style.top))
        .toBe(initialTop);
      await chart.evaluate((el) => {
        el.scrollLeft -= 400;
      });
      await expect(earlier).toHaveCount(1);
      await expect
        .poll(() => ongoing.evaluate((el) => el.style.top))
        .toBe(initialTop);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath("schedule-stable-row.png"),
        fullPage: true,
      });
      // Starting without the neighbor also preserves the established row when
      // panning back loads that earlier window for the first time.
      await page.goto(`/?at=${boundary + 7 * h}`);
      await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "ready",
      );
      await expect(earlier).toHaveCount(0);
      await expect
        .poll(() => ongoing.evaluate((el) => el.style.top))
        .toBe("8px");
      await chart.evaluate((el) => {
        el.scrollLeft -= 400;
      });
      await expect(earlier).toHaveCount(1);
      await expect
        .poll(() => ongoing.evaluate((el) => el.style.top))
        .toBe("8px");
    });
  });
});
