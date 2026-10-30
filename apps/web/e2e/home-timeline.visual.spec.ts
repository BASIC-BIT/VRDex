import { expect, type Page } from "@playwright/test";
import { test, TIMELINE_NOW } from "./home-timeline-fixture";
import { initializeDiscovery, usableDiscovery } from "./home-discovery-fixture";
import { prepareVisualPage, waitForVisualReady } from "./public-routes";

async function capture(page: Page, name: string) {
  await waitForVisualReady(page);
  await page.locator("[data-home-schedule] img").evaluateAll(async (images) => {
    await Promise.all(
      images.map(async (image) => {
        if (image instanceof HTMLImageElement) {
          image.loading = "eager";
          await image.decode();
        }
      }),
    );
  });
  const panel = name === "details" || name === "dense";
  if (!panel) {
    const discover = await usableDiscovery(page);
    await expect(
      discover.getByRole("link", { name: "Open ORBIT Discovery", exact: true }),
    ).toBeVisible();
    await expect(
      discover.getByRole("link", { name: "Open Tidal Discovery", exact: true }),
    ).toBeVisible();
    await discover.locator("img").evaluateAll(async (images) => {
      await Promise.all(
        images.map(async (image) => {
          if (image instanceof HTMLImageElement) {
            image.loading = "eager";
            await image.decode();
          }
        }),
      );
    });
  }
  await page.evaluate((panel) => {
    const schedule = document.querySelector<HTMLElement>(
      "[data-home-schedule]",
    );
    const navHeight =
      document.querySelector("main nav")?.getBoundingClientRect().height ?? 0;
    window.scrollTo(
      0,
      panel && schedule
        ? schedule.getBoundingClientRect().top + window.scrollY - navHeight - 32
        : 0,
    );
  }, panel);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await expect(page).toHaveScreenshot(`home-timeline-${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: !panel,
    maxDiffPixelRatio: 0.002,
    scale: "css",
    threshold: 0.2,
  });
}

test.describe("Home schedule images @visual @snapshot @fixture", () => {
  test.use({ timelineScenario: "timeline-visual" });
  test.beforeEach(async ({ page, timelineFixture, timelineScenario }) => {
    await prepareVisualPage(page, { freezeClock: false });
    await page.clock.setFixedTime(TIMELINE_NOW);
    await initializeDiscovery(
      page,
      timelineFixture,
      timelineScenario === "timeline-visual"
        ? timelineFixture.profileIds.slice(2, 4)
        : [],
    );
  });
  test("ordinary browsing contains transparent wide logos, long names and missing-logo identity", async ({
    page,
    timelineFixture,
  }) => {
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
    expect(
      await page
        .getByLabel("Schedule date", { exact: true })
        .evaluate((element) => getComputedStyle(element).colorScheme),
    ).toBe("dark");
    const logo = page
      .getByTestId(`event-${timelineFixture.eventIds[3]}`)
      .locator("img");
    await expect
      .poll(() =>
        logo.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth,
        ),
      )
      .toBe(120);
    expect(
      await logo.evaluate((image: HTMLImageElement) => image.naturalHeight),
    ).toBe(60);
    expect(
      await logo.evaluate((image) => getComputedStyle(image).objectFit),
    ).toBe("contain");
    await expect(
      page.getByTestId(`event-${timelineFixture.eventIds[4]}`).locator("img"),
    ).toHaveCount(0);
    await capture(page, "ordinary");
  });
  test("selected poster leaves the timeline available", async ({
    page,
    timelineFixture,
  }) => {
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
    await page
      .getByTestId(`event-${timelineFixture.eventIds[3]}`)
      .getByRole("button", {
        name: "Open ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Event details", exact: true })
        .getByRole("listitem"),
    ).toHaveCount(2);
    await capture(page, "details");
  });
  test("overlapping My night uses purple lanes on the shared axis", async ({
    page,
  }) => {
    await page.goto("/?scheduleView=agenda");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
    for (const title of [
      "ORBIT: Interstellar Bassline Orchestra",
      "Low Tide",
    ]) {
      await page
        .getByRole("button", { name: `Add ${title} to My night`, exact: true })
        .click();
    }
    await expect(
      page
        .getByRole("region", { name: "My night", exact: true })
        .getByText("Overlap", { exact: true }),
    ).toHaveCount(2);
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await capture(page, "night");
  });
  test("empty range is settled", async ({ page }) => {
    await page.goto(`/?at=${Date.UTC(2026, 10, 5, 12)}`);
    await expect(
      page.getByText("No events in this range", { exact: true }),
    ).toBeVisible();
    await capture(page, "empty");
  });
  test("failed range keeps search and Retry usable", async ({ page }) => {
    const record = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);
    const failed = new Set<number>();
    await page.routeWebSocket("**/api/**/sync", (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        const payload: unknown = JSON.parse(String(message));
        if (
          record(payload) &&
          payload.type === "ModifyQuerySet" &&
          Array.isArray(payload.modifications)
        ) {
          for (const item of payload.modifications)
            if (
              record(item) &&
              item.udfPath === "eventTimeline:listPublic" &&
              typeof item.queryId === "number"
            )
              failed.add(item.queryId);
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
          payload.modifications = payload.modifications.map((item: unknown) =>
            record(item) &&
            item.type === "QueryUpdated" &&
            typeof item.queryId === "number" &&
            failed.has(item.queryId)
              ? {
                  type: "QueryFailed",
                  queryId: item.queryId,
                  errorMessage: "Injected transport failure",
                  errorData: null,
                  logLines: [],
                  journal: item.journal,
                }
              : item,
          );
          socket.send(JSON.stringify(payload));
        } else socket.send(message);
      });
    });
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "error",
    );
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible();
    await capture(page, "failed");
  });
  test.describe("dense lineup", () => {
    test.use({ timelineScenario: "detail" });
    test("later-page selected set remains visible in dense detail", async ({
      page,
    }) => {
      await page.goto("/?scheduleView=agenda");
      await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "ready",
        { timeout: 20000 },
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
      await expect(panel.getByRole("listitem")).toHaveCount(83);
      await expect(panel.locator('[data-selected="true"]')).toBeInViewport();
      await capture(page, "dense");
    });
  });
});
