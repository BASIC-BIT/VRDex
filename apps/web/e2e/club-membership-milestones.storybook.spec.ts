import { expect, test } from "@playwright/test";

test("staff membership graph marks founding and recent observation @storybook-visual", async ({ page }, testInfo) => {
  await page.goto("/iframe.html?id=clubs-membership-milestones--range&viewMode=story");
  await expect(page.getByTestId("staff-group-founding-dot")).toBeVisible();
  await expect(page.getByTestId("staff-group-today-dot")).toBeVisible();
  await expect(page.locator(".recharts-reference-line")).toHaveCount(1);
  await page.getByTestId("staff-group-founding-dot").hover();
  await expect(page.locator(".recharts-tooltip-wrapper").getByText(/Group founded/)).toBeVisible();
  await expect(page.locator(".recharts-tooltip-item-name")).toHaveText("member");
  await page.getByTestId("staff-group-today-dot").hover();
  await expect(page.locator(".recharts-tooltip-wrapper").getByText(/Today/)).toBeVisible();
  await expect(page.locator(".recharts-tooltip-item-name")).toHaveText("members");
  await page.getByRole("button", { name: "Show data table" }).click();
  await expect(page.getByRole("table").getByText(/Group founded/)).toBeVisible();
  await expect(page.getByRole("table").getByText(/Today/)).toBeVisible();
  await testInfo.attach("staff-membership-milestones", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
