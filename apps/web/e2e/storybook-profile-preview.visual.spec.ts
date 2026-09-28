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

test("public instance history appears on a community profile @storybook-visual", async ({ page }, testInfo) => {
  await page.goto("/iframe.html?id=profiles-profile-editor--public-instance-history&viewMode=story");
  await expect(page.getByRole("heading", { name: "Recent instances" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Neon Harbor" })).toBeVisible();
  await expect(page.getByText("VRChat instance", { exact: true })).toBeVisible();
  await testInfo.attach("public-instance-history", { body: await page.screenshot({ path: `../../.cache/artifacts/public-instance-history-${testInfo.project.name}.png`, fullPage: true }), contentType: "image/png" });
});
