import { expect, test, type Page } from "@playwright/test";

const withoutCalendarRows = 4;

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

const connect = (page: Page) => page.getByRole("button", { name: "Connect VRChat calendar" });
const capture = async (page: Page, state: string) => {
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({ path: `../../.cache/artifacts/club-integrations-calendar-${state}-${test.info().project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
};

test("the VRChat calendar control connects once, defaulting to export @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--calendar-ready&viewMode=story");
  await expect(connect(page)).toBeEnabled();
  const direction = page.getByRole("combobox", { name: "Direction" }).last();
  await expect(direction).toHaveValue("export");
  await expect(direction.locator("option")).toHaveText(["Export", "Import", "Both"]);
  await capture(page, "ready");

  await direction.selectOption("bidirectional");
  await connect(page).click();
  await expect(page.getByLabel("Submitted connector update")).toHaveText('{"kind":"vrchat_calendar","direction":"bidirectional"}');
  await expect(page.getByText("VRChat calendar", { exact: true })).toBeVisible();
  await expect(connect(page)).toHaveCount(0);
});

test("the VRChat calendar button stays silent and disabled until the community is ready @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--calendar-not-ready&viewMode=story");
  await expect(connect(page)).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await capture(page, "not-ready");
});

test("the VRChat calendar control renders nothing with the flag off @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--calendar-flag-off&viewMode=story");
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
  await expect(connect(page)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Direction" })).toHaveCount(withoutCalendarRows);
  await capture(page, "flag-off");
});

test("a failed VRChat calendar connect can be retried @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--calendar-connect-fails&viewMode=story");
  await connect(page).click();
  await expect(page.getByRole("alert")).toHaveText("Try again.");
  await expect(connect(page)).toBeEnabled();
  await capture(page, "failed");
});
