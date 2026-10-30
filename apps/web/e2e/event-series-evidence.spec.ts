import { expect, test, type Locator, type Page } from "@playwright/test";

import { prepareVisualPage, waitForVisualReady } from "./public-routes";

test.beforeEach(async ({ page }) => { await prepareVisualPage(page); });

async function setTheme(page: Page, value: "light" | "dark") {
  await page.evaluate(next => {
    localStorage.setItem("vrdex-theme", next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
  }, value);
  await waitForVisualReady(page);
}

async function capture(page: Page, path: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path, animations: "disabled", caret: "hide", fullPage: true, scale: "css" });
}

const seriesEditorPath = "/playwright/event-editor/edit?series=1&scope=series";
const seriesUpdates = (page: Page) => page.evaluate(() => (window as unknown as { seriesUpdates?: unknown[] }).seriesUpdates ?? []);

// Input and clicks that land before hydration are lost or misread, and the dev server hydrates late under load.
async function hydrated(locator: Locator) {
  await expect.poll(() => locator.evaluate(node => Object.keys(node).some(key => key.startsWith("__reactFiber")))).toBe(true);
  return locator;
}

for (const color of ["light", "dark"] as const) test(`series editor evidence ${color} @fixture`, async ({ page }, info) => {
  await page.goto("/playwright/event-editor"); await setTheme(page, color);
  const repeats = page.getByLabel("Repeats", { exact: true });
  await expect(repeats.getByRole("option")).toHaveText(["Does not repeat", "Weekly", "Every two weeks", "Monthly"]);
  await expect(page.getByLabel("Ends", { exact: true })).toHaveCount(0);
  await repeats.selectOption({ label: "Every two weeks" });
  await expect(page.getByLabel("Ends", { exact: true })).toBeVisible();
  await capture(page, info.outputPath(`series-repeats-${color}.png`));

  await page.goto("/playwright/event-editor/edit?series=1"); await setTheme(page, color);
  await expect(page.getByText("Part of a series.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit this night", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit the series", exact: true })).toHaveAttribute("href", "/afterglow/events/harbor-sessions-7k2m4q/edit?scope=series");
  await expect(page.getByRole("button", { name: "Reset Description to series", exact: true })).toHaveText("Reset to series");
  await expect(page.getByLabel("Repeats", { exact: true })).toHaveCount(0);
  await capture(page, info.outputPath(`series-note-${color}.png`));

  await page.goto(seriesEditorPath); await setTheme(page, color);
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("18:00");
  await expect(page.getByLabel("Repeats", { exact: true }).getByRole("option")).toHaveText(["Weekly", "Every two weeks", "Monthly"]);
  await capture(page, info.outputPath(`series-editor-${color}.png`));

  await page.goto("/playwright-afterglow-social/series/playwright-afterglow-series"); await setTheme(page, color);
  await expect(page.getByRole("heading", { name: "Upcoming nights", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to calendar", exact: true })).toHaveAttribute("href", "/playwright-afterglow-social/series/playwright-afterglow-series/calendar.ics");
  await capture(page, info.outputPath(`series-page-${color}.png`));
});

test("an occurrence links its series @fixture", async ({ page }) => {
  await page.goto("/playwright-afterglow-social/events/playwright-afterglow-series-night");
  await page.getByRole("link", { name: "Upcoming nights", exact: true }).click();
  await expect(page).toHaveURL(/\/playwright-afterglow-social\/series\/playwright-afterglow-series$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Upcoming nights", exact: true })).toBeVisible();
});

test("the series editor saves only what changed @fixture", async ({ page }) => {
  await page.goto(seriesEditorPath);
  await (await hydrated(page.getByLabel("Description", { exact: true }))).fill("Now fortnightly.");
  await page.getByLabel("Repeats", { exact: true }).selectOption({ label: "Every two weeks" });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => seriesUpdates(page)).toEqual([{
    seriesId: "series-editor-preview",
    summary: "Now fortnightly.",
    rule: { frequency: "biweekly", weekday: 6, startTime: "18:00", doorsTime: "17:30" },
  }]);
});

test("changing Starts moves doors and end with it @fixture", async ({ page }) => {
  await page.goto(seriesEditorPath);
  await (await hydrated(page.getByLabel("Starts", { exact: true }))).fill("19:30");
  await expect(page.getByLabel("Doors open", { exact: true })).toHaveValue("19:00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => seriesUpdates(page)).toEqual([{
    seriesId: "series-editor-preview",
    rule: { frequency: "weekly", weekday: 6, startTime: "19:30", doorsTime: "19:00" },
  }]);
});

test("the series editor saves media links and watch settings @fixture", async ({ page }) => {
  await page.goto(seriesEditorPath);
  await (await hydrated(page.locator("textarea[name=mediaLinks]"))).fill("watch | Harbor stream | https://example.com/live | open");
  await page.getByRole("checkbox", { name: /^Promote a watch surface during the event window/ }).check();
  await page.getByLabel("Watch mode", { exact: true }).selectOption({ label: "Performer sequence" });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => seriesUpdates(page)).toEqual([{
    seriesId: "series-editor-preview",
    mediaLinks: [{ type: "watch", label: "Harbor stream", url: "https://example.com/live", presentation: "open" }],
    watchMode: "performer_sequence",
    watchSurfaceEnabled: true,
  }]);
});

test("a failed series save keeps the form and hides the server message @fixture", async ({ page }) => {
  await page.goto(`${seriesEditorPath}&fail=1`);
  await (await hydrated(page.getByLabel("Event title", { exact: true }))).fill("Harbor Nights");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Backend error - please try again later", { exact: true })).toBeVisible();
  await expect(page.getByText("Field is not overridden on this night.")).toHaveCount(0);
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Harbor Nights");
  await expect(page).toHaveURL(/fail=1/);
});

test("a failed reset hides the server message @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor/edit?series=1&fail=1");
  await (await hydrated(page.getByRole("button", { name: "Reset Description to series", exact: true }))).click();
  await expect(page.getByText("Backend error - please try again later", { exact: true })).toBeVisible();
  await expect(page.getByText("Field is not overridden on this night.")).toHaveCount(0);
});

test("resetting with unsaved edits asks first @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor/edit?series=1");
  const description = await hydrated(page.getByLabel("Description", { exact: true }));
  await description.fill("Unsaved");
  const prompts: string[] = [];
  page.once("dialog", dialog => { prompts.push(dialog.message()); void dialog.dismiss(); });
  await page.getByRole("button", { name: "Reset Description to series", exact: true }).click();
  expect(prompts).toEqual(["Leave without saving?"]);
  await expect(description).toHaveValue("Unsaved");
});

test("a past night keeps the series link and drops its resets @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor/edit?series=1&past=1");
  await expect(page.getByText("Part of a series.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit the series", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset Description to series", exact: true })).toHaveCount(0);
});

test("an ended series offers only this night @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor/edit?series=1&state=ended");
  await expect(page.getByText("Part of a series.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit this night", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit the series", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset Description to series", exact: true })).toHaveCount(0);
});

for (const variant of ["state=ended", "flag=off"]) test(`scope=series falls back to the night editor with ${variant} @fixture`, async ({ page }) => {
  await page.goto(`${seriesEditorPath}&${variant}`);
  await expect(page.getByRole("navigation", { name: "Event editor" })).toBeVisible();
  await expect(page.getByText("Part of a series.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Repeats", { exact: true })).toHaveCount(0);
});

async function fillRepeatingEvent(page: Page, endsOn: string) {
  await (await hydrated(page.getByLabel("Event title", { exact: true }))).fill("Harbor Night");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  await page.getByLabel("Repeats", { exact: true }).selectOption({ label: "Weekly" });
  await page.getByLabel("Ends", { exact: true }).fill(endsOn);
}

async function publish(page: Page) {
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: /^(Publish event|Save changes)$/ }).click();
}

const editorMutations = (page: Page) => page.evaluate(() => (window as unknown as { editorMutations?: { name: string; args: unknown }[] }).editorMutations ?? []);
const seriesCreate = { eventSlug: "harbor-night", repeat: { frequency: "weekly", endsOn: "2027-12-31" } };

test("choosing a repeat creates one series on publish @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor?connected=1");
  await fillRepeatingEvent(page, "2027-12-31");
  await publish(page);
  await expect.poll(async () => (await editorMutations(page)).map(mutation => mutation.name)).toEqual(["events:createCommunityEvent", "eventSeries:create"]);
  expect((await editorMutations(page))[1]!.args).toEqual(seriesCreate);
});

test("a rejected series create retries without a second create of the event @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor?connected=1&fail=1");
  await fillRepeatingEvent(page, "2027-12-31");
  await publish(page);
  await expect(page.getByText("Backend error - please try again later", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/connected=1/);
  await page.getByRole("button", { name: /^(Publish event|Save changes)$/ }).click();
  await expect.poll(async () => (await editorMutations(page)).map(mutation => mutation.name)).toEqual([
    "events:createCommunityEvent", "eventSeries:create", "events:updateCommunityEvent", "eventSeries:create",
  ]);
  expect((await editorMutations(page))[3]!.args).toEqual(seriesCreate);
});

test("an Ends date before the start blocks publish @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor?connected=1");
  await fillRepeatingEvent(page, "2027-10-14");
  await publish(page);
  const ends = page.getByLabel("Ends", { exact: true });
  await expect(ends).toBeVisible();
  await expect(ends).toHaveJSProperty("validity.rangeUnderflow", true);
  expect(await editorMutations(page)).toEqual([]);
});

test("an Ends date before the series start blocks a series save @fixture", async ({ page }) => {
  await page.goto(seriesEditorPath);
  await (await hydrated(page.getByLabel("Ends", { exact: true }))).fill("2099-09-01");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Ends", { exact: true })).toHaveJSProperty("validity.rangeUnderflow", true);
  expect(await seriesUpdates(page)).toEqual([]);
});

test("Edit this night moves focus into the form @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor/edit?series=1");
  await (await hydrated(page.getByRole("link", { name: "Edit this night", exact: true }))).click();
  await expect(page.getByLabel("Event title", { exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/playwright\/event-editor\/edit\?series=1$/);
});
