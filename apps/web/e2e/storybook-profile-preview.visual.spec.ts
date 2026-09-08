import { expect, test } from "@playwright/test";

test("embedded profile preview keeps a single page landmark @storybook-visual", async ({ page }, testInfo) => {
  await page.goto("/iframe.html?id=profiles-profile-editor--embedded-preview&viewMode=story");
  await expect(page.getByRole("heading", { name: "Example DJ", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Edit profile", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch on Twitch" })).toBeVisible();
  await testInfo.attach("embedded-preview", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
