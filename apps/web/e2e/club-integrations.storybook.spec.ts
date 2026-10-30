import { expect, test } from "@playwright/test";

test("integrations list connectors with direction, mode, and state controls @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--connectors&viewMode=story");
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
  for (const label of ["Google Calendar", "Event board", "Discord events", "Discord", "VRChat calendar"])
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText("Notion", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Synced 5 minutes ago", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs reconnecting", { exact: true })).toBeVisible();
  await expect(page.getByText("Missing Access", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(5);
  const directions = page.getByRole("combobox", { name: "Direction" });
  await expect(directions.nth(1).locator("option")).toHaveText(["Export", "Off"]);
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveCount(3);
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({ path: `../../.cache/artifacts/club-integrations-${test.info().project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await directions.nth(4).selectOption("import");
  await expect(page.getByText("Events there appear here.", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveCount(4);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByLabel("Submitted connector update")).toHaveText('{"connectorId":"board","state":"active"}');
  await expect(page.getByRole("button", { name: "Resume" })).toHaveCount(0);
});

test("an empty integrations page shows only its heading @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--empty&viewMode=story");
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
  await expect(page.getByRole("list")).toHaveCount(0);
});
