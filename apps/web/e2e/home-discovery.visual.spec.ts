import { expect } from "@playwright/test";
import {
  test,
  TIMELINE_NOW,
  initializeDiscovery,
  usableDiscovery,
} from "./home-discovery-fixture";
import { prepareVisualPage, waitForVisualReady } from "./public-routes";

test.describe("Home discovery images @visual @snapshot @fixture", () => {
  test.use({ timelineScenario: "discovery" });
  for (const state of ["mixed", "cold-start"] as const) {
    test(state, async ({ page, timelineFixture }, info) => {
      await prepareVisualPage(page, { freezeClock: false });
      await page.clock.setFixedTime(TIMELINE_NOW);
      await initializeDiscovery(
        page,
        timelineFixture,
        state === "cold-start" ? [] : undefined,
      );
      await page.goto("/");
      const discover = await usableDiscovery(page);
      await expect(discover.getByTestId("discovery-event-card")).toHaveCount(2);
      await expect(discover.getByTestId("discovery-club-card")).toHaveCount(2);
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
      await waitForVisualReady(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (state === "cold-start") {
        // Cold recommendations include the ordinary local public pool. Keep
        // actual integration evidence without fixing an arbitrary ranking.
        await expect(discover.locator('[data-favorite="true"]')).toHaveCount(0);
        if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") {
          await page.screenshot({
            path: info.outputPath("home-discovery-cold-start.png"),
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            scale: "css",
          });
        }
      } else
        await expect(page).toHaveScreenshot("home-discovery-mixed.png", {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: 0.002,
          threshold: 0.2,
          scale: "css",
        });
    });
  }
  test.describe("sparse", () => {
    test.use({
      timelineScenario: "discovery-sparse",
      timelineStartAt: Date.UTC(2036, 9, 26, 21),
    });
    test("one real event keeps an honest sparse composition", async ({
      page,
      timelineFixture,
    }) => {
      await prepareVisualPage(page, { freezeClock: false });
      // A future clock excludes permanent 2026 local seed events without
      // filtering or intercepting the public recommendation query.
      await page.clock.setFixedTime(Date.UTC(2036, 9, 26, 21, 30));
      await initializeDiscovery(page, timelineFixture);
      await page.goto("/");
      const discover = await usableDiscovery(page);
      await expect(discover.getByTestId("discovery-event-card")).toHaveCount(1);
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
      await waitForVisualReady(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page).toHaveScreenshot("home-discovery-sparse.png", {
        fullPage: true,
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.002,
        threshold: 0.2,
        scale: "css",
      });
    });
  });
});
