import { expect, test } from "@playwright/test";

import { capturedRoutes, prepareVisualPage, waitForVisualReady } from "./public-routes";
import { AUTH_UNAVAILABLE_COPY } from "../src/lib/auth-copy";

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
    const clerkUnconfigured = await page.getByText(AUTH_UNAVAILABLE_COPY).count();

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
