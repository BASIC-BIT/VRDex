import { expect, test } from "@playwright/test";

import {
  capturedRoutes,
  prepareVisualPage,
  waitForVisualReady,
} from "./public-routes";
import { test as homeTest } from "./home-timeline-fixture";
import { initializeDiscovery, usableDiscovery } from "./home-discovery-fixture";
import { AUTH_UNAVAILABLE_COPY } from "../src/lib/auth-copy";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

for (const route of capturedRoutes) {
  if (route.name === "home") {
    homeTest.describe("Home public snapshot @fixture", () => {
      // Keep the existing Jan 1 clock and empty Schedule. Owned candidates
      // span separate future bands instead of collapsing beside 2026 seeds.
      homeTest.use({
        timelineScenario: "timeline-visual",
        timelineStartAt: Date.UTC(2025, 0, 6, 11, 30),
      });
      homeTest("home @snapshot", async ({ page, timelineFixture }) => {
        await initializeDiscovery(
          page,
          timelineFixture,
          timelineFixture.profileIds.slice(2, 4),
          "light",
        );
        await page.goto(route.path);
        await route.expectPage(page);
        const discover = await usableDiscovery(page);
        await expect(
          discover.getByRole("link", {
            name: "Open ORBIT Discovery",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          discover.getByRole("link", {
            name: "Open Tidal Discovery",
            exact: true,
          }),
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
        await waitForVisualReady(page);
        expect(
          await page
            .getByLabel("Schedule date", { exact: true })
            .evaluate((element) => getComputedStyle(element).colorScheme),
        ).toBe("light");
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page).toHaveScreenshot("home.png", {
          animations: "disabled",
          caret: "hide",
          fullPage: true,
          maxDiffPixelRatio: 0.002,
          scale: "css",
          threshold: 0.2,
        });
      });
    });
    continue;
  }
  test(`${route.name} @snapshot`, async ({ page }) => {
    await page.goto(route.path);
    await route.expectPage(page);
    await waitForVisualReady(page);
    if (route.name === "person-profile") {
      await page
        .locator('article[id^="media-"] img')
        .evaluateAll(async (images) => {
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

    // Several captured routes are protected and render the sign-in page after a
    // redirect. Without auth credentials that page shows an unavailable
    // notice rather than Clerk's own UI, so a baseline captured here would record
    // a broken sign-in as the expected appearance — and would break again as soon
    // as credentials exist. The redirect and heading assertions above still run;
    // only the pixel comparison is skipped.
    //
    // This condition is permanent, not pending work. #226 wired auth E2E to
    // Clerk on *hosted* targets only, because `convex/auth.config.ts` pins local
    // deployments to an unresolvable issuer on purpose. This lane runs locally
    // and has no Clerk keys by design, so these routes keep rendering the notice.
    //
    // Matched against the exported constant, not a copy of it. This guard held a
    // duplicate of the string, so editing the notice silently stopped the skip
    // from firing and three routes failed against baselines that were never
    // meant to exist.
    const clerkUnconfigured = await page
      .getByText(AUTH_UNAVAILABLE_COPY)
      .count();

    test.skip(
      clerkUnconfigured > 0,
      `${route.name} renders the auth-unavailable notice: this lane runs against a local deployment with no Clerk credentials, which is deliberate.`,
    );

    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.002,
      scale: "css",
      threshold: 0.2,
    });
  });
}
