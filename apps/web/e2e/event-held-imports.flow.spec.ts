import { expect, test, type Page } from "@playwright/test";

const stored = (page: Page, key: string) => page.evaluate(key => sessionStorage.getItem(key), key);
const review = (page: Page) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
const publish = (page: Page) => page.getByRole("button", { name: "Publish event", exact: true }).click();
const accept = async (page: Page, ...labels: string[]) => { for (const label of labels) await page.getByRole("button", { name: `Accept ${label}`, exact: true }).click(); };
const heldSubmission = JSON.stringify({ draftId: "fixture-draft", expectedVersion: 2 });

test("a connector draft opened in the editor publishes through the held path @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
  expect(await stored(page, "event-intake-revision-submission")).toBe(heldSubmission);
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
});

test("a date-only connector draft publishes from the editor @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-date-only");
  await accept(page, "Community", "Event title", "Date");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2027-07-15");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
  expect(await stored(page, "event-intake-revision-submission")).toBe(heldSubmission);
  const saved = JSON.parse((await stored(page, "fixture-published"))!);
  expect(saved).toMatchObject({ communitySlug: "afterglow", title: "Held night", eventDate: "2027-07-15" });
  expect(saved).not.toHaveProperty("timeTba");
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
});

test("a draft saved with a start and then cleared opens date-only @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-cleared-start");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2027-07-15");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
  expect(JSON.parse((await stored(page, "fixture-published"))!).timeTba).not.toBe(true);
});

test("a re-dated draft opens date-only, as row Publish reads it @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-redated");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2027-07-16");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
});

test("an imported start stays a choice the staffer makes @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-tentative-start");
  await accept(page, "Community", "Event title", "Date");
  await review(page);
  await publish(page);
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await stored(page, "event-intake-review-command")).toBeNull();
  await accept(page, "Time zone", "Start time");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
  expect(JSON.parse((await stored(page, "fixture-published"))!)).toMatchObject({ timeTba: false, start: { time: "20:00" } });
});

test("a poster change keeps a connector draft's import @flow @fixture", async ({ page }) => {
  const savedImport = async () => JSON.parse((await stored(page, "event-intake-revision-submission"))!).patch.tentative;
  const poster = page.getByAltText("Source poster", { exact: true });
  await page.goto("/playwright/event-intake?revision=held-date-only");
  await page.getByRole("button", { name: "Import poster or text", exact: true }).click();
  await page.getByLabel("Poster", { exact: true }).setInputFiles("public/test-media/event-poster.png");
  await expect(poster).toBeVisible();
  expect(await savedImport()).toMatchObject({ title: "Held night" });
  await page.getByRole("button", { name: "Remove poster", exact: true }).click();
  await expect(poster).toHaveCount(0);
  expect(await savedImport()).toMatchObject({ title: "Held night" });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept Event title", exact: true })).toBeVisible();
});

test("a source text edit keeps a connector draft's import @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-date-only");
  await page.getByRole("button", { name: "Import poster or text", exact: true }).click();
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Held night moved");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept Event title", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(JSON.parse((await stored(page, "event-intake-revision-submission"))!).patch).toMatchObject({ sourceText: "Held night moved", tentative: { title: "Held night" } });
});

for (const mode of ["held-date-only", "held-tentative-start"]) {
  test(`Save draft on ${mode} does not persist the derived Time TBA @flow @fixture`, async ({ page }) => {
    await page.goto(`/playwright/event-intake?revision=${mode}`);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved");
    expect(JSON.parse((await stored(page, "event-intake-revision-submission"))!).patch).not.toHaveProperty("timeTba");
  });
}

test("a personal draft still needs a start @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=draft");
  await review(page);
  await publish(page);
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await stored(page, "event-intake-review-command")).toBeNull();
});
