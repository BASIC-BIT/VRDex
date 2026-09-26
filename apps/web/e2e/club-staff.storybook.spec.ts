import { expect, test } from "@playwright/test";

test("a role editor keeps its displayed revision after a second tab changes permissions @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-workspace--staff-stale-role&viewMode=story");
  await page.getByRole("button", { name: "Edit role" }).first().click();
  await page.getByRole("textbox", { name: "Role name" }).fill("Renamed admin");
  await page.getByRole("button", { name: "Simulate other tab" }).click();
  await expect(page.getByLabel("Stored role permissions")).not.toContainText("manage_staff");
  await page.getByRole("button", { name: "Save role" }).click();
  await expect(page.getByRole("alert")).toContainText("Refresh to continue.");
  await expect(page.getByLabel("Submitted role token")).toHaveText(String(Date.UTC(2026, 8, 12, 21)));
  await expect(page.getByLabel("Stored role permissions")).not.toContainText("manage_staff");
  await page.screenshot({
    path: `../../.cache/artifacts/club-stale-role-${test.info().project.name}.png`,
    fullPage: true,
  });
});
