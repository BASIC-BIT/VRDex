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
});

test("the server select stays beside a ready channel list @storybook-visual", async ({ page }) => {
  await open(page, "ready-several-servers");
  await expect(page.getByRole("combobox", { name: "Server" })).toHaveValue("123456789012345678");
  await expect(page.getByRole("combobox", { name: "Channel" })).toBeVisible();
  await capture(page, "ready-several-servers");
});

type Heldset = Record<"lists" | "connects" | "updates", Array<{ args: unknown; resolve: (value?: unknown) => void; reject: () => void }>>;
const count = (page: Page, calls: keyof Heldset) =>
  page.evaluate((key) => (window as unknown as { discordConnectHeld: Heldset }).discordConnectHeld[key].length, calls);
const argsOf = (page: Page, calls: keyof Heldset, index: number) =>
  page.evaluate(([key, at]) => (window as unknown as { discordConnectHeld: Heldset }).discordConnectHeld[key as keyof Heldset][at as number].args, [calls, index]);
const settle = (page: Page, calls: keyof Heldset, index: number, value?: unknown) =>
  page.evaluate(([key, at, result]) => (window as unknown as { discordConnectHeld: Heldset }).discordConnectHeld[key as keyof Heldset][at as number].resolve(result), [calls, index, value]);
const refuse = (page: Page, calls: keyof Heldset, index: number) =>
  page.evaluate(([key, at]) => (window as unknown as { discordConnectHeld: Heldset }).discordConnectHeld[key as keyof Heldset][at as number].reject(), [calls, index]);
const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));
const INVITE = { state: "bot_missing", inviteUrl: "https://discord.com/oauth2/authorize?client_id=1" };
const READY = { state: "ready", channels: [{ channelId: "323456789012345678", name: "announcements" }] };
const GUILD_B = "223456789012345678";

test("window focus reloads the listing, so a bot invited in another tab appears @storybook-visual", async ({ page }) => {
  await open(page, "held-one-server");
  await expect.poll(() => count(page, "lists")).toBe(1);
  await settle(page, "lists", 0, INVITE);
  await expect(link(page)).toBeVisible();
  await focus(page);
  await expect.poll(() => count(page, "lists")).toBe(2);
  await settle(page, "lists", 1, READY);
  await expect(link(page)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Channel" })).toBeVisible();
});

test("a failed reload keeps the form and says so, and the next one clears it @storybook-visual", async ({ page }) => {
  await open(page, "held-one-server");
  await expect.poll(() => count(page, "lists")).toBe(1);
  await settle(page, "lists", 0, READY);
  await page.getByRole("combobox", { name: "Channel" }).selectOption({ label: "announcements" });
  await focus(page);
  await expect.poll(() => count(page, "lists")).toBe(2);
  await refuse(page, "lists", 1);
  await expect(page.getByRole("alert")).toHaveText("Try again.");
  await expect(page.getByRole("combobox", { name: "Channel" })).toHaveValue("323456789012345678");
  await focus(page);
  await expect.poll(() => count(page, "lists")).toBe(3);
  await settle(page, "lists", 2, READY);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a listing that lands after the server changed is dropped, and only the current server reloads @storybook-visual", async ({ page }) => {
  await open(page, "held-several-servers");
  await expect.poll(() => count(page, "lists")).toBe(1);
  await page.getByRole("combobox", { name: "Server" }).selectOption({ label: "Afterhours Staff" });
  await expect.poll(() => count(page, "lists")).toBe(2);
  expect(await argsOf(page, "lists", 1)).toBe(GUILD_B);
  await settle(page, "lists", 1, READY);
  await expect(page.getByRole("combobox", { name: "Channel" })).toBeVisible();
  await settle(page, "lists", 0, INVITE);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(link(page)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Channel" })).toBeVisible();
  await focus(page);
  await expect.poll(() => count(page, "lists")).toBe(3);
  expect(await argsOf(page, "lists", 2)).toBe(GUILD_B);
});

test("connecting locks the form, sends the names, and resets on success @storybook-visual", async ({ page }) => {
  await open(page, "ready");
  await page.getByRole("combobox", { name: "Channel" }).selectOption({ label: "upcoming-events" });
  await page.getByRole("combobox", { name: "Mode" }).selectOption({ label: "Publish automatically" });
  await connect(page).click();
  await expect(connect(page)).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Channel" })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Mode" })).toBeDisabled();
  expect(await argsOf(page, "connects", 0)).toEqual({
    guildId: "123456789012345678", guildName: "Afterhours", channelId: "423456789012345678", channelName: "upcoming-events", mode: "autopublish",
  });
  await settle(page, "connects", 0);
  await expect(page.getByRole("combobox", { name: "Channel" })).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Channel" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveValue("hold");
  await expect(connect(page)).toBeDisabled();
});

test("a refused connect keeps the choices and says so @storybook-visual", async ({ page }) => {
  await open(page, "ready");
  await page.getByRole("combobox", { name: "Channel" }).selectOption({ label: "announcements" });
  await connect(page).click();
  await expect.poll(() => count(page, "connects")).toBe(1);
  await refuse(page, "connects", 0);
  await expect(page.getByRole("alert")).toHaveText("Try again.");
  await expect(page.getByRole("combobox", { name: "Channel" })).toHaveValue("323456789012345678");
  await expect(connect(page)).toBeEnabled();
});

const openPage = async (page: Page, story: string) => {
  await page.setViewportSize({ width: test.info().project.name === "storybook-mobile" ? 390 : 1280, height: 844 });
  await page.goto(`/iframe.html?id=clubs-integrations-discord-connect--${story}&viewMode=story`);
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
};

test("the Discord section sits in the Integrations page in the workspace @storybook-visual", async ({ page }) => {
  await openPage(page, "in-integrations-page");
  await expect(page.getByRole("heading", { name: "Discord", level: 2 })).toBeVisible();
  await expect(link(page)).toBeVisible();
  await capture(page, "page-no-servers");
  await openPage(page, "in-integrations-page-ready");
  await expect(page.getByRole("combobox", { name: "Channel" })).toBeVisible();
  await capture(page, "page-ready");
});

test("row actions stay disabled while an update is in flight @storybook-visual", async ({ page }) => {
  await openPage(page, "in-integrations-page");
  const rowControls = [
    page.getByRole("button", { name: "Resume" }),
    page.getByRole("button", { name: "Disconnect" }).first(),
    page.getByRole("button", { name: "Disconnect" }).nth(1),
    page.getByRole("combobox", { name: "Direction" }).first(),
    page.getByRole("combobox", { name: "Mode" }),
  ];
  await rowControls[0].click();
  for (const control of rowControls) await expect(control).toBeDisabled();
  await capture(page, "page-row-pending");
  await settle(page, "updates", 0);
  for (const control of rowControls) await expect(control).toBeEnabled();
  await page.getByRole("button", { name: "Disconnect" }).first().click();
  await expect(rowControls[0]).toBeDisabled();
  await refuse(page, "updates", 1);
  await expect(page.getByRole("alert")).toHaveText("Try again.");
  await expect(rowControls[0]).toBeEnabled();
});
