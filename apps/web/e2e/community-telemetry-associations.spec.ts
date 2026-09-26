import { expect, test } from "@playwright/test";

for (const state of ["recap-only", "integration-only", "event-manager"]) {
  test(`legacy telemetry keeps recap and association controls separate for ${state} @fixture`, async ({ page, isMobile }) => {
    await page.goto(`/playwright/community-telemetry?state=${state}`);
    await expect(page.getByRole("heading", { name: "Recent event recaps" })).toBeVisible();
    await expect(page.getByText("Faceless Friday", { exact: true }).first()).toBeVisible();
    const associations = page.getByRole("heading", { name: "Event associations", exact: true });
    if (state === "event-manager") {
      await expect(associations).toBeVisible();
      await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(2);
      await expect(page.getByRole("button", { name: "Confirm", exact: true }).first()).toBeVisible();
    } else {
      await expect(associations).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
    }
    await page.screenshot({ path: `../../.cache/artifacts/private-association-${state}-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });
  });
}
