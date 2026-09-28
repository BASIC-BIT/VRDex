import { expect, test } from "@playwright/test";

for (const mode of ["draft", "correction"] as const) {
  test(`${mode} retains its editing revision across query refresh @flow`, async ({ page }) => {
    await page.goto(`/playwright/event-intake?revision=${mode}`);
    if (mode === "correction") await page.getByRole("button", { name: "Correct event", exact: true }).click();
    await page.getByLabel("Event title", { exact: true }).fill("My local edit");
    await page.getByRole("button", { name: "Update elsewhere" }).click();
    await expect(page.getByText("Query refreshed", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Venue", { exact: true })).toHaveValue("Original venue");
    await page.getByRole("button", { name: mode === "draft" ? "Save draft" : "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "This draft changed elsewhere." })).toBeVisible();
    await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("My local edit");
    const submission = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!));
    expect(submission[mode === "draft" ? "expectedVersion" : "expectedUpdatedAt"]).toBe(1);
  });
}

test("draft advances its revision only after a successful local save @flow", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=draft");
  await page.getByLabel("Event title", { exact: true }).fill("First edit");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.getByLabel("Event title", { exact: true }).fill("Second edit");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  const submission = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!));
  expect(submission.expectedVersion).toBe(2);
  expect(submission.patch.title).toBe("Second edit");
});

test("owner timezone keyboard search stores a region, not EST @flow", async ({ page }) => {
  await page.goto("/playwright/event-editor");
  await page.getByLabel("Start", { exact: true }).fill("2026-07-15T20:00");
  const timezone = page.getByRole("combobox", { name: "Time zone" });
  await timezone.fill("EST");
  await expect(page.getByRole("option", { name: /New York.*UTC-04:00/ })).toBeVisible();
  await timezone.press("ArrowDown");
  await timezone.press("Enter");
  await expect(page.locator('input[name="timezone"]')).toHaveValue("America/New_York");
  await timezone.fill("not a zone");
  await expect(page.locator('input[name="timezone"]')).toHaveValue("");
});

test("direct intake auth preserves community and draft @flow", async ({ page }) => {
  await page.goto("/events/new?community=afterglow&draft=saved-draft");
  await expect(page).toHaveURL(/\/sign-in\?/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/events/new?community=afterglow&draft=saved-draft");
});

test("community and Events expose intake entry @flow", async ({ page }) => {
  await page.goto("/search?type=event");
  await expect(page.getByRole("link", { name: "Add event", exact: true })).toHaveAttribute("href", "/events/new");
  await page.goto("/playwright-afterglow-social");
  await expect(page.getByRole("link", { name: "Add event", exact: true })).toHaveAttribute("href", "/events/new?community=playwright-afterglow-social");
});

test("intake draft resumes, date-only publishes directly, and has no mobile overflow @flow", async ({ page }, testInfo) => {
  await page.goto("/playwright/event-intake");
  await expect(page.getByLabel("Community", { exact: true })).toHaveValue("playwright-afterglow-social");
  await page.getByLabel("Event title", { exact: true }).fill("Summer gathering");
  await page.getByLabel("Date", { exact: true }).fill("2027-07-15");
  await page.getByLabel("Time TBA").check();
  await page.getByRole("button", { name: "Add performer" }).click();
  await page.getByLabel("Performer", { exact: true }).fill("Aurora");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByLabel("Event title")).toHaveValue("Summer gathering");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("heading", { name: "Add event", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("event-intake.png"), fullPage: true });
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/\/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/);
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions", exact: true })).toBeVisible();
});

test("ambiguous start requires occurrence and gap is refused @flow", async ({ page }) => {
  await page.goto("/playwright/event-intake");
  await page.getByLabel("Event title").fill("Autumn gathering");
  await page.getByLabel("Date", { exact: true }).fill("2026-11-01");
  const timezone = page.getByRole("combobox", { name: "Time zone" });
  await timezone.fill("EST"); await timezone.press("ArrowDown"); await timezone.press("Enter");
  await page.getByLabel("Start time", { exact: true }).fill("01:30");
  await page.getByRole("button", { name: "Publish event" }).click();
  await expect(page.getByRole("status")).toContainText("Ambiguous local time");
  await page.getByLabel("Start time occurrence").selectOption("later");
  await page.getByLabel("Date", { exact: true }).fill("2027-03-14");
  await page.getByLabel("Start time", { exact: true }).fill("02:30");
  await expect(page.getByText("This local time does not exist.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish event" }).click();
  await expect(page.getByRole("status")).toContainText("Local time does not exist");
});
