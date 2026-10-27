import { expect } from "@playwright/test";
import {
  test,
  TIMELINE_NOW,
  changeTimelineFixture,
} from "./home-timeline-fixture";
import { waitForPublicSearchHydration } from "./public-search-fixture";
test.describe("continuous schedule @flow @fixture", () => {
  test.beforeEach(async ({ page, timelineFixture }) => {
    void timelineFixture;
    await page.emulateMedia({ colorScheme: "dark" });
    await page.clock.setFixedTime(TIMELINE_NOW);
    await page.goto("/playwright/home-timeline");
    await expect(
      page.getByRole("heading", { name: "Schedule", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
  });
  test("real bars, shared Agenda, saves, favorites and usable public search", async ({
    page,
    timelineFixture,
  }, info) => {
    const bar = page.getByTestId(`event-${timelineFixture.eventIds[3]}`);
    await expect(bar).toBeVisible();
    await expect(
      page.getByText("Day Gathering", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Open ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Add ORBIT: Interstellar Bassline Orchestra to My night",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "My night", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(page.getByTestId("night-lanes")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("schedule-saved.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await page
      .getByRole("button", { name: "Favorite Prism Collective", exact: true })
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
    const agenda = page.getByRole("button", { name: "Agenda", exact: true });
    await agenda.focus();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(agenda).toBeFocused();
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
      await page.getByRole("button", { name: "Agenda", exact: true }).tap();
      await page
        .getByRole("button", {
          name: "Add ORBIT: Interstellar Bassline Orchestra to My night",
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
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    for (const title of [
      "ORBIT: Interstellar Bassline Orchestra",
      "Low Tide",
      "Day Gathering",
    ])
      await page
        .getByRole("button", { name: `Add ${title} to My night`, exact: true })
        .click();
    const night = page.getByRole("region", { name: "My night", exact: true });
    await expect(night.getByText("Overlap", { exact: true })).toHaveCount(2);
    await expect(
      night.getByText("2026-10-26 · Time TBA", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
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
    await page.goto("/playwright/home-timeline?at=253402300800000");
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue(
      "2026-10-26",
    );
    await expect(
      page.getByLabel("Timeline chart", { exact: true }),
    ).toBeVisible();
  });
  test("included sets cannot remove their whole-event save", async ({
    page,
    timelineFixture,
    isMobile,
  }, info) => {
    const title = "ORBIT: Interstellar Bassline Orchestra";
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    const article = page.locator("article").filter({
      has: page.getByRole("button", { name: `Open ${title}`, exact: true }),
    });
    await article
      .getByRole("button", { name: `Add ${title} to My night`, exact: true })
      .click();
    const included = article.getByRole("button", {
      name: `Aurora: Included in ${title}`,
      exact: true,
    });
    await expect(included).toBeDisabled();
    await expect(included).toHaveText("Included");
    // Dispatching click also checks the React callback guard, beyond native disabled behavior.
    await included.dispatchEvent("click");
    await expect(
      page.getByRole("heading", { name: "My night", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
          ).plan,
      ),
    ).toEqual([{ kind: "event", eventId: timelineFixture.eventIds[3] }]);
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    const bar = page.getByTestId(`event-${timelineFixture.eventIds[3]}`);
    const chartIncluded = bar.getByRole("button", {
      name: `Aurora: Included in ${title}`,
      exact: true,
    });
    await expect(chartIncluded).toBeDisabled();
    await expect(chartIncluded).toHaveText("Included");
    if (!isMobile) {
      await chartIncluded.dispatchEvent("click");
    }
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(included).toBeDisabled();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("schedule-included.png"),
      fullPage: true,
    });
    const remove = article.getByRole("button", {
      name: `Remove ${title} from My night`,
      exact: true,
    });
    if (isMobile) await remove.tap();
    else await remove.click();
    await expect(
      page.getByRole("heading", { name: "My night", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
          ).plan,
      ),
    ).toEqual([]);
    await expect(
      article.getByRole("button", {
        name: "Add Aurora to My night",
        exact: true,
      }),
    ).toBeEnabled();
  });
  test.describe("prefetch row stability", () => {
    test.use({ timelineScenario: "prefetch" });
    test("ordinary panning across the six-hour threshold preserves an unchanged ongoing row", async ({
      page,
      timelineFixture,
    }, info) => {
      const h = 3_600_000,
        boundary = Date.UTC(2026, 9, 26);
      await page.goto(`/playwright/home-timeline?at=${boundary + 3 * h}`);
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
      await page.goto(`/playwright/home-timeline?at=${boundary + 7 * h}`);
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
