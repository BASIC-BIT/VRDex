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
  expect(JSON.parse((await stored(page, "fixture-published"))!)).toMatchObject({ communitySlug: "afterglow", title: "Held night", eventDate: "2027-07-15", timeTba: true });
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
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

test("a personal draft still needs a start @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=draft");
  await review(page);
  await publish(page);
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await stored(page, "event-intake-review-command")).toBeNull();
});
