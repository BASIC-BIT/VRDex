import { expect, test } from "@playwright/test";
test.use({ timezoneId: "America/New_York" });

test("timezone options highlight on hover and keyboard navigation", async ({ page }) => {
  await page.goto("/playwright/event-intake?timezone=controls");
  const picker = page.getByTestId("picker-probe");
  await picker.getByRole("button", { name: "Time zone", exact: true }).click();
  const option = picker.getByRole("option").first();
  const idleBackground = await option.evaluate(element => getComputedStyle(element).backgroundColor);
  let hoveredBackground: string | undefined;
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
    await option.hover();
    await expect.poll(() => option.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(idleBackground);
    hoveredBackground = await option.evaluate(element => getComputedStyle(element).backgroundColor);
    await picker.getByRole("combobox").hover();
  }
  await picker.getByRole("combobox").press("ArrowDown");
  await expect.poll(() => option.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(idleBackground);
  if (hoveredBackground) await expect.poll(() => option.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(hoveredBackground);
});

test("search and cancellation preserve authored timezone and occurrences", async ({ page }, testInfo) => {
  await page.addInitScript(() => sessionStorage.setItem("event-intake-fixture", JSON.stringify({ communitySlug: "playwright-afterglow-social", eventDate: "2026-11-01", timezone: "America/New_York", start: { time: "01:30", occurrence: "later" }, end: { time: "01:45", occurrence: "later" }, timeTba: false })));
  await page.goto("/playwright/event-intake");
  const hidden = page.locator('input[name="timezone"]');
  await expect(hidden).toHaveValue("America/New_York");
  await page.screenshot({ path: testInfo.outputPath("timezone-picker-closed.png"), fullPage: true });
  await page.getByRole("button", { name: "Time zone", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Time zone" });
  await search.fill("London");
  await page.screenshot({ path: testInfo.outputPath("timezone-picker-open.png"), fullPage: true });
  await expect(hidden).toHaveValue("America/New_York");
  await search.press("Escape");
  await expect(hidden).toHaveValue("America/New_York");
  await expect(page.getByLabel("Starts occurrence")).toHaveValue("later");
  await page.getByRole("button", { name: "Time zone", exact: true }).click();
  await search.fill("London");
  await page.getByRole("listbox", { name: "Time zones" }).getByRole("option").first().click();
  await expect(page.locator('input[name="editingTimezone"]')).toHaveValue("Europe/London");
  await expect(hidden).toHaveValue("America/New_York");
  await expect(page.locator('[name="Starts"]')).toHaveValue("2026-11-01T06:30");
});


test("keyboard navigation scrolls active results into view and commits once", async ({ page }) => {
  await page.goto("/playwright/event-intake?timezone=controls");
  const picker = page.getByTestId("picker-probe");
  await picker.getByRole("button", { name: "Time zone", exact: true }).click();
  const search = picker.getByRole("combobox");
  await search.fill("America");
  for (let index = 0; index < 22; index++) await search.press("ArrowDown");
  const activeId = await search.getAttribute("aria-activedescendant");
  const visible = await page.evaluate(id => {
    const option = document.getElementById(id!);
    const list = option?.parentElement;
    if (!option || !list) return false;
    const a = option.getBoundingClientRect(), b = list.getBoundingClientRect();
    return a.top >= b.top && a.bottom <= b.bottom && list.scrollTop > 0;
  }, activeId);
  expect(visible).toBe(true);
  await expect(picker.getByTestId("selection-count")).toHaveText("0");
  await search.press("Enter");
  await expect(picker.getByTestId("selection-count")).toHaveText("1");
  await expect(picker.getByRole("button", { name: "Time zone", exact: true })).toBeFocused();
});

test("late preferences yield to manual and imported zones", async ({ page }) => {
  await page.goto("/playwright/event-intake?timezone=controls");
  const form = page.locator("form");
  await form.getByRole("button", { name: "Time zone", exact: true }).click();
  await form.getByRole("combobox", { name: "Time zone", exact: true }).fill("Tokyo");
  await form.getByRole("option").first().click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-timezone-preference", { detail: "Europe/London" })));
  await expect(page.getByTestId("account-preference").locator('[name="defaultEventTimezone"]')).toHaveValue("Europe/London");
  await expect(form.locator('[name="timezone"]')).toHaveValue("Asia/Tokyo");
  await page.reload();
  await page.getByRole("button", { name: "Import poster or text", exact: true }).click();
  await page.getByLabel("Source text", { exact: true }).fill("Fixture Eastern event");
  await page.getByRole("button", { name: "Extract details", exact: true }).click();
  await expect(form.locator('[name="timezone"]')).toHaveValue("America/New_York");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-timezone-preference", { detail: "Europe/London" })));
  await expect(page.getByTestId("account-preference").locator('[name="defaultEventTimezone"]')).toHaveValue("Europe/London");
  await expect(form.locator('[name="timezone"]')).toHaveValue("America/New_York");
});

test("account save survives reload and clear restores browser defaults", async ({ page, context }, testInfo) => {
  await context.addInitScript(() => { sessionStorage.removeItem("event-intake-fixture"); });
  await page.goto("/playwright/event-intake?timezone=controls");
  const account = page.getByTestId("account-preference");
  await account.getByRole("button", { name: "Time zone", exact: true }).click();
  await account.getByRole("combobox").fill("New York");
  await account.getByRole("option").first().click();
  await account.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(account.locator('[name="defaultEventTimezone"]')).toHaveValue("America/New_York");
  await account.screenshot({ path: testInfo.outputPath("account-preference.png") });
  await expect(page.locator('form [name="timezone"]')).toHaveValue("America/New_York");
  await account.getByRole("button", { name: "Clear", exact: true }).click();
  await page.reload();
  const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await expect(account.locator('[name="defaultEventTimezone"]')).toHaveValue("");
  await expect(page.locator('form [name="timezone"]')).toHaveValue(browserZone);
});


test("a late preference cannot reinterpret an authored start", async ({ page }) => {
  await page.goto("/playwright/event-intake?timezone=controls");
  const form = page.locator("form");
  await expect(form.locator('[name="timezone"]')).not.toHaveValue("");
  const zone = await form.locator('[name="timezone"]').inputValue();
  await form.getByLabel("Starts", { exact: true }).fill("2026-11-01T01:30");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-timezone-preference", { detail: "Asia/Tokyo" })));
  await expect(page.getByTestId("account-preference").locator('[name="defaultEventTimezone"]')).toHaveValue("Asia/Tokyo");
  await expect(form.locator('[name="timezone"]')).toHaveValue(zone);
  await expect(form.getByLabel("Starts", { exact: true })).toHaveValue("2026-11-01T01:30");
});


test("staff creation initializes from preference and keeps authored times", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fixture-timezone-preference", "America/New_York"));
  await page.goto("/playwright/event-intake?timezone=staff");
  const form = page.locator("form");
  await expect(form.locator('[name="timezone"]')).toHaveValue("America/New_York");
  await form.getByLabel("Starts", { exact: true }).fill("2026-11-01T01:30");
  await form.getByLabel("Start occurrence").selectOption("later");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-timezone-preference", { detail: "Asia/Tokyo" })));
  await expect(page.getByTestId("account-preference").locator('[name="defaultEventTimezone"]')).toHaveValue("Asia/Tokyo");
  await expect(form.locator('[name="timezone"]')).toHaveValue("America/New_York");
  await expect(form.getByLabel("Start occurrence")).toHaveValue("later");
});

test("persisted drafts without a zone preserve validation instead of defaulting", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=draft");
  await expect(page.locator('input[name="timezone"]')).toHaveValue("");
});


test("accepting imported timing locks the browser zone against late defaults", async ({ page }) => {
  await page.goto("/playwright/event-intake?timezone=controls");
  const form = page.locator("form");
  await expect(form.locator('[name="timezone"]')).not.toHaveValue("");
  const zone = await form.locator('[name="timezone"]').inputValue();
  await page.getByRole("button", { name: "Import poster or text", exact: true }).click();
  await page.getByLabel("Source text", { exact: true }).fill("Tentative timing");
  await page.getByRole("button", { name: "Extract details", exact: true }).click();
  await page.getByRole("button", { name: "Accept Date", exact: true }).click();
  await page.getByRole("button", { name: "Accept Start time", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-timezone-preference", { detail: "Asia/Tokyo" })));
  await expect(page.getByTestId("account-preference").locator('[name="defaultEventTimezone"]')).toHaveValue("Asia/Tokyo");
  await expect(form.locator('[name="timezone"]')).toHaveValue(zone);
  await expect(form.getByLabel("Starts", { exact: true })).toHaveValue("2026-11-01T03:30");
});


test("saving a new partial draft preserves its persisted zone against late defaults", async ({ page }) => {
  await page.goto("/playwright/event-intake?timezone=controls");
  const form = page.locator("form");
  await expect(form.locator('[name="timezone"]')).not.toHaveValue("");
  const zone = await form.locator('[name="timezone"]').inputValue();
  await form.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(form.getByRole("status")).toHaveText("Draft saved");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-timezone-preference", { detail: "Asia/Tokyo" })));
  await expect(page.getByTestId("account-preference").locator('[name="defaultEventTimezone"]')).toHaveValue("Asia/Tokyo");
  await expect(form.locator('[name="timezone"]')).toHaveValue(zone);
});
