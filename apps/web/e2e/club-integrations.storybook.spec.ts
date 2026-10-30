import { expect, test, type Page } from "@playwright/test";

const withoutCalendarRows = 4;

test("integrations list connectors with direction, mode, and state controls @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--connectors&viewMode=story");
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
  for (const label of ["Google Calendar", "Event board", "Discord events", "Discord", "VRChat calendar"])
    await expect(page.getByRole("list").getByText(label, { exact: true })).toBeVisible();
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

const capture = async (page: Page, name: string) => {
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({ path: `../../.cache/artifacts/${name}.png`, fullPage: true });
};
// Each board state also has to fit the narrowest phone the account pages support.
async function captureBoard(page: Page, state: string) {
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await capture(page, `club-integrations-board-${state}-${test.info().project.name}`);
  expect(await fits()).toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  await capture(page, `club-integrations-board-${state}-${test.info().project.name}-375`);
  expect(await fits()).toBe(true);
}

async function captureGoogle(page: Page, name: string) {
  await capture(page, `club-integrations-${name}-${test.info().project.name}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("Google Calendar connect is a link to the OAuth start route @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-connect&viewMode=story");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute("href", "/api/connectors/google/start?community=afterhours");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await captureGoogle(page, "google-connect");
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
  await captureGoogle(page, "google-picker");

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
  await captureGoogle(page, "google-reconnect");
});

test("a failed Google connect shows the error notice @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-connect-failed&viewMode=story");
  await expect(page.getByRole("alert")).toHaveText("Google Calendar did not connect. Try again.");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
  await captureGoogle(page, "google-failed");
});

test("an empty calendar list shows the error notice and Connect, not a blank select @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-no-calendars&viewMode=story");
  await expect(page.getByRole("alert")).toHaveText("Google Calendar did not connect. Try again.");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await captureGoogle(page, "google-no-calendars");
});

test("a failed connect still shows its notice when Connect is switched off @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-disabled-failed&viewMode=story");
  await expect(page.getByRole("alert")).toHaveText("Google Calendar did not connect. Try again.");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toHaveCount(0);
  await captureGoogle(page, "google-disabled-failed");
});

test("Save is disabled while the request runs and a failure can be retried @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--google-save-fails&viewMode=story");
  const save = page.getByRole("button", { name: "Save" });
  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText("Try again.");
  await expect(save).toBeEnabled();
});

test("the event board connect button starts closed @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--board-closed&viewMode=story");
  const toggle = page.getByRole("button", { name: "Event board" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("combobox", { name: "Server" })).toHaveCount(0);
  await captureBoard(page, "closed");
  await toggle.click();
  await expect(page.getByRole("combobox", { name: "Server" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Channel" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
});

test("the event board form connects a chosen channel and closes @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--board-open&viewMode=story");
  const server = page.getByRole("combobox", { name: "Server" });
  const channel = page.getByRole("combobox", { name: "Channel" });
  const connect = page.getByRole("button", { name: "Connect", exact: true });
  await expect(server).toHaveValue("123456789012345678");
  await expect(channel.locator("option:not([hidden])")).toHaveText(["announcements", "upcoming-events"]);
  await expect(connect).toBeDisabled();
  await channel.selectOption({ label: "announcements" });
  await expect(connect).toBeEnabled();
  await captureBoard(page, "open");
  await server.selectOption({ label: "Afterhours Staff" });
  await expect(channel).toHaveValue("");
  await expect(connect).toBeDisabled();
  await channel.selectOption({ label: "staff-board" });
  await connect.click();
  await expect(server).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Event board" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("list").getByText("staff-board", { exact: true })).toBeVisible();
});

const connectCalendar = (page: Page) => page.getByRole("button", { name: "Connect VRChat calendar" });
const captureCalendar = async (page: Page, state: string) => {
  await capture(page, `club-integrations-calendar-${state}-${test.info().project.name}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
};

test("the VRChat calendar control connects once, defaulting to export @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--calendar-ready&viewMode=story");
  await expect(connectCalendar(page)).toBeEnabled();
  const direction = page.getByRole("combobox", { name: "Direction" }).last();
  await expect(direction).toHaveValue("export");
  await expect(direction.locator("option")).toHaveText(["Export", "Import", "Both"]);
  await captureCalendar(page, "ready");

  await direction.selectOption("bidirectional");
  await connectCalendar(page).click();
  await expect(page.getByLabel("Submitted connector update")).toHaveText('{"kind":"vrchat_calendar","direction":"bidirectional"}');
  await expect(page.getByText("VRChat calendar", { exact: true })).toBeVisible();
  await expect(connectCalendar(page)).toHaveCount(0);
});

test("the VRChat calendar button stays silent and disabled until the community is ready @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--calendar-not-ready&viewMode=story");
  await expect(connectCalendar(page)).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await captureCalendar(page, "not-ready");
});

test("the VRChat calendar control renders nothing with the flag off @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--calendar-flag-off&viewMode=story");
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
  await expect(connectCalendar(page)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Direction" })).toHaveCount(withoutCalendarRows);
  await captureCalendar(page, "flag-off");
});

test("a failed VRChat calendar connect can be retried @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-integrations--calendar-connect-fails&viewMode=story");
  await connectCalendar(page).click();
  await expect(page.getByRole("alert")).toHaveText("Try again.");
  await expect(connectCalendar(page)).toBeEnabled();
  await captureCalendar(page, "failed");
});
