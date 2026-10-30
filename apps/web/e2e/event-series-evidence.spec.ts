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
    rule: { frequency: "biweekly", weekday: 6, startTime: "18:00" },
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

test("Edit this night moves focus into the form @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor/edit?series=1");
  await (await hydrated(page.getByRole("link", { name: "Edit this night", exact: true }))).click();
  await expect(page.getByLabel("Event title", { exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/playwright\/event-editor\/edit\?series=1$/);
});
