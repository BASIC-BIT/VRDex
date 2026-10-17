import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "UTC" });
const step = (page: Page, name: string) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name, exact: true }).click();

for (const editor of ["intake", "staff"]) {
  test(`${editor} generates and edits relative times before anchoring Starts @flow @fixture`, async ({ page }, testInfo) => {
    await page.goto(editor === "intake" ? "/playwright/event-intake" : "/playwright/event-lineup?editor&mode=create");
    await expect(page.getByLabel("Time TBA", { exact: true })).toHaveCount(0);
    await step(page, "Lineup");
    await page.getByLabel("Slots", { exact: true }).fill("3");
    await page.getByLabel("Minutes each", { exact: true }).fill("60");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const rows = page.locator("[data-lineup-row]");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("+60 min");
    await page.getByRole("button", { name: "Add slot at position 2", exact: true }).click();
    await page.getByLabel("Slot duration", { exact: true }).fill("15");
    await page.getByRole("button", { name: "Insert slot", exact: true }).click();
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(2)).toContainText("+75 min");
    await rows.first().getByLabel("Duration", { exact: true }).fill("30");
    await rows.first().getByLabel("Duration", { exact: true }).press("Tab");
    await expect(rows.nth(2)).toContainText("+45 min");
    if (editor === "intake") {
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Draft saved");
      const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!));
      expect(saved.lineup.map((row: { relativeTiming: { offsetMinutes: number } }) => row.relativeTiming.offsetMinutes)).toEqual([0, 30, 45, 105]);
      expect(saved.start).toBeUndefined();
      await page.reload();
      await step(page, "Lineup");
      await expect(rows.nth(2)).toContainText("+45 min");
    }
    await page.screenshot({ path: testInfo.outputPath("relative-lineup.png"), fullPage: true });
    await step(page, "Details");
    await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T23:30");
    await step(page, "Lineup");
    await expect(rows.first()).toContainText("23:30");
    await expect(rows.nth(2)).toContainText("00:15");
    await page.screenshot({ path: testInfo.outputPath("anchored-lineup.png"), fullPage: true });
    await step(page, "Details");
    await page.getByLabel("Starts", { exact: true }).fill("");
    await step(page, "Lineup");
    await expect(rows.nth(2)).toContainText("+45 min");
    await step(page, "Details");
    await page.getByLabel("Starts", { exact: true }).fill("2027-10-16T20:00");
    await step(page, "Lineup");
    await expect(rows.nth(2)).toContainText("20:45");
  });
}
test("incomplete intake drafts save but publication requires Starts @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake");
  await page.getByLabel("Event title", { exact: true }).fill("Partial event");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem("event-intake-published"))).toBeNull();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!));
  expect(saved.title).toBe("Partial event");
  expect(saved.start).toBeUndefined();
});

test("legacy date-only draft is retained until an explicit start is authored @flow @fixture", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("event-intake-fixture", JSON.stringify({ communitySlug: "playwright-afterglow-social", title: "Date-only event", eventDate: "2027-10-15", timezone: "UTC", timeTba: true })));
  await page.goto("/playwright/event-intake");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!))).toMatchObject({ eventDate: "2027-10-15", timeTba: true });
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem("event-intake-published"))).toBeNull();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!))).toMatchObject({ timeTba: false, start: { time: "20:00" } });
});

test("details keep optional times compact and give the description room @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/event-intake");
  const description = page.getByLabel("Description", { exact: true });
  await expect(description).toHaveAttribute("rows", "5");
  const end = page.getByText("Add end time", { exact: true });
  const doors = page.getByText("Add doors-open time", { exact: true });
  await expect(end).toBeVisible();
  await expect(doors).toBeVisible();
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeHidden();
  await expect(page.getByLabel("Doors open", { exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("details-polish.png"), fullPage: true });
  await doors.click();
  await expect(page.getByLabel("Doors open", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeHidden();
  await page.getByText("Announcement link", { exact: true }).first().click();
  await expect(page.getByLabel("Announcement link", { exact: true })).toBeVisible();
  await step(page, "Review");
  await expect(page.getByRole("button", { name: "Publish event", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("publish-polish.png"), fullPage: true });
});
