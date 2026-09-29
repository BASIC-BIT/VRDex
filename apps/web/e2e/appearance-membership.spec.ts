import { expect, test } from "@playwright/test";

test("membership controls belong only to community appearance", async ({ page }) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Appearance demo fixtures are local-only.");

  await page.goto("/account/appearance?profileId=demo");
  await expect(page.getByRole("heading", { level: 1, name: "DJ Aurora" })).toBeVisible();
  await expect(page.getByLabel("Show member count")).toHaveCount(0);
  await expect(page.getByLabel("Show membership graph")).toHaveCount(0);

  await page.goto("/account/appearance?profileId=demo-community");
  await expect(page.getByRole("heading", { level: 1, name: "Night Shift" })).toBeVisible();
  await expect(page.getByLabel("Show member count")).toBeChecked();
  await expect(page.getByLabel("Show membership graph")).toBeChecked();
  await page.getByLabel("Show member count").uncheck();
  await expect(page.getByLabel("Show membership graph")).toBeChecked();
});
