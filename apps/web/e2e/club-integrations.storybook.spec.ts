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
  await expect(page.getByText("Reconnect", { exact: true })).toHaveCount(0);
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

const capture = async (page: import("@playwright/test").Page, name: string) => {
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({ path: `../../.cache/artifacts/club-integrations-${name}-${test.info().project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
};

test("Google Calendar connect is a link to the OAuth start route @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-connect&viewMode=story");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute("href", "/api/connectors/google/start?community=afterhours");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await capture(page, "google-connect");
});

test("the Google calendar picker lists the primary calendar first and saves the choice @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-calendar-picker&viewMode=story");
  const calendar = page.getByRole("combobox", { name: "Calendar" });
  await expect(calendar.locator("option")).toHaveText(["host@example.com", "Afterhours events", "Late night sets and guest DJ rotations across every Afterhours stage"]);
  await expect(calendar).toHaveValue("host@example.com");
  const direction = page.getByRole("combobox", { name: "Direction" });
  await expect(direction.locator("option")).toHaveText(["Import", "Export", "Both", "Off"]);
  await expect(direction).toHaveValue("import");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toHaveCount(0);
  await capture(page, "google-picker");

  await calendar.selectOption("afterhours@group.calendar.google.com");
  await direction.selectOption("bidirectional");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Submitted connector update")).toHaveText(
    '{"kind":"google_calendar","direction":"bidirectional","mode":"hold","target":{"calendarId":"afterhours@group.calendar.google.com","calendarName":"Afterhours events"}}',
  );
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
});

test("a Google row that needs reconnecting links back through OAuth @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-reconnect&viewMode=story");
  await expect(page.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/api/connectors/google/start?community=afterhours&connectorId=google");
  await expect(page.getByRole("combobox", { name: "Direction" }).locator("option")).toHaveText(["Import", "Export", "Both", "Off"]);
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await expect(page.getByText("Needs reconnecting", { exact: true })).toBeVisible();
  await expect(page.getByText("GOOGLE_REAUTH_REQUIRED")).toHaveCount(0);
  await capture(page, "google-reconnect");
});

test("a failed Google connect shows the error notice @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-connect-failed&viewMode=story");
  await expect(page.getByRole("alert")).toHaveText("Google Calendar did not connect. Try again.");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
  await capture(page, "google-failed");
});

test("an empty calendar list shows the error notice and Connect, not a blank select @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-no-calendars&viewMode=story");
  await expect(page.getByRole("alert")).toHaveText("Google Calendar did not connect. Try again.");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await capture(page, "google-no-calendars");
});

test("a failed connect still shows its notice when Connect is switched off @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-disabled-failed&viewMode=story");
  await expect(page.getByRole("alert")).toHaveText("Google Calendar did not connect. Try again.");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toHaveCount(0);
  await capture(page, "google-disabled-failed");
});

test("Save is disabled while the request runs and a failure can be retried @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-save-fails&viewMode=story");
  const save = page.getByRole("button", { name: "Save" });
  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText("Try again.");
  await expect(save).toBeEnabled();
});
