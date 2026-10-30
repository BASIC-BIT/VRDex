import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, story: string) => {
  await page.setViewportSize({ width: test.info().project.name === "storybook-mobile" ? 390 : 1024, height: 844 });
  await page.goto(`/iframe.html?id=clubs-integrations-discord-connect--${story}&viewMode=story`);
  await expect(page.getByRole("heading", { name: "Discord", level: 2 })).toBeVisible();
};
const capture = async (page: Page, name: string) => {
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({ path: `../../.cache/artifacts/discord-connect-${name}-${test.info().project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
};
const connect = (page: Page) => page.getByRole("button", { name: "Connect Discord" });
const link = (page: Page) => page.getByRole("link", { name: "Connect Discord" });

test("no provable server links to Discord verification and returns here @storybook-visual", async ({ page }) => {
  await open(page, "no-servers");
  await expect(link(page)).toHaveAttribute("href", "/api/discord/verify/start?returnTo=%2Faccount%2Fcommunities%2Fafterhours%2Fintegrations");
  await capture(page, "no-servers");
});

test("a server without the bot opens the invite in a new tab @storybook-visual", async ({ page }) => {
  await open(page, "bot-missing");
  await expect(link(page)).toHaveAttribute("href", /^https:\/\/discord\.com\/oauth2\/authorize\?/);
  await expect(link(page)).toHaveAttribute("target", "_blank");
  await expect(link(page)).toHaveAttribute("rel", "noopener");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await capture(page, "bot-missing");
});

test("several servers need a choice before anything else shows @storybook-visual", async ({ page }) => {
  await open(page, "choose-server");
  await expect(page.getByRole("combobox", { name: "Server" }).locator("option:not([hidden])")).toHaveText(["Afterhours", "Afterhours Staff"]);
  await expect(link(page)).toHaveCount(0);
  await capture(page, "choose-server");
  await page.getByRole("combobox", { name: "Server" }).selectOption({ label: "Afterhours" });
  await expect(link(page)).toBeVisible();
});

test("a ready server picks a channel and a mode, and the help follows the mode @storybook-visual", async ({ page }) => {
  await open(page, "ready");
  await expect(page.getByRole("combobox", { name: "Server" })).toHaveCount(0);
  await expect(connect(page)).toBeDisabled();
  await expect(page.getByText("New events wait in My events until you approve them.", { exact: true })).toBeVisible();
  await capture(page, "ready-hold");
  await page.getByRole("combobox", { name: "Channel" }).selectOption({ label: "announcements" });
  await page.getByRole("combobox", { name: "Mode" }).selectOption({ label: "Publish automatically" });
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveAccessibleDescription("New events and changes go live as soon as they are read.");
  await expect(page.getByText("New events wait in My events until you approve them.", { exact: true })).toHaveCount(0);
  await capture(page, "ready-autopublish");
  await connect(page).click();
  await expect(page.getByLabel("Submitted connection")).toHaveText('{"guildId":"123456789012345678","channelId":"323456789012345678","mode":"autopublish"}');
});

test("the server select stays beside a ready channel list @storybook-visual", async ({ page }) => {
  await open(page, "ready-several-servers");
  await expect(page.getByRole("combobox", { name: "Server" })).toHaveValue("123456789012345678");
  await expect(page.getByRole("combobox", { name: "Channel" })).toBeVisible();
  await capture(page, "ready-several-servers");
});
