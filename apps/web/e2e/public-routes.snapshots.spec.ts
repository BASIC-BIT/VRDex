import { expect, test } from "@playwright/test";

import { capturedRoutes, prepareVisualPage, waitForVisualReady } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

for (const route of capturedRoutes) {
  test(`${route.name} @snapshot`, async ({ page }) => {
    await page.goto(route.path);
    await route.expectPage(page);
    await waitForVisualReady(page);

    // Several captured routes are protected and render the sign-in page after a
    // redirect. Without auth credentials that page shows an unavailable
    // notice rather than Clerk's own UI, so a baseline captured here would record
    // a broken sign-in as the expected appearance — and would break again as soon
    // as credentials exist. The redirect and heading assertions above still run;
    // only the pixel comparison is skipped. Tracked in #226.
    const clerkUnconfigured = await page
      .getByText("Sign-in is temporarily unavailable.")
      .count();

    test.skip(
      clerkUnconfigured > 0,
      `${route.name} renders Clerk's sign-in UI, which this environment has no credentials for. Tracked in #226.`,
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
