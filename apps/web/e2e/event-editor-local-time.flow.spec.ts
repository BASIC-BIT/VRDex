import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "America/Indiana/Indianapolis" });
const intake = { communitySlug: "playwright-afterglow-social", title: "Local night", eventDate: "2026-10-15", timezone: "America/Los_Angeles", timeTba: false, start: { time: "23:00", dayOffset: 0 }, end: { time: "02:00", dayOffset: 1 }, doors: { time: "22:30", dayOffset: 0 }, lineup: [{ clientKey: "a", position: 0, performerLabel: "Guest", start: { time: "23:00", dayOffset: 0 }, end: { time: "00:00", dayOffset: 1 } }] };
async function openIntake(page: Page) {
  await page.addInitScript(fields => sessionStorage.setItem("event-intake-fixture", JSON.stringify(fields)), intake);
  await page.goto("/playwright/event-intake");
}
async function zone(page: Page, query: string) {
  await page.getByRole("button", { name: "Time zone", exact: true }).first().click();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill(query);
  await page.getByRole("option").first().click();
}
async function saveIntake(page: Page) {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  return page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!));
}
test("contributor display conversions and title-only save preserve canonical schedule", async ({ page }, info) => {
  await openIntake(page);
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-16T02:00");
  await expect(page.getByLabel("Doors open", { exact: true })).toHaveValue("2026-10-16T01:30");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-16T05:00");
  await page.screenshot({ path: info.outputPath("contributor-local-desktop.png"), fullPage: true });
  await zone(page, "Tokyo");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-16T15:00");
  await page.getByLabel("Event title", { exact: true }).fill("Changed title");
  expect(await saveIntake(page)).toEqual({ ...intake, title: "Changed title" });
});
test("contributor TBA uses local date and restores canonical schedule", async ({ page }) => {
  await openIntake(page);
  await page.getByLabel("Time TBA", { exact: true }).check();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-16");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  expect(await saveIntake(page)).toEqual(intake);
});
test("contributor TBA date edit cascades once and keeps explicit end", async ({ page }) => {
  await openIntake(page);
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-17");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  const saved = await saveIntake(page);
  expect(saved.eventDate).toBe("2026-10-16");
  expect(saved.start).toEqual({ time: "23:00", dayOffset: 0 });
  expect(saved.end).toEqual({ time: "02:00", dayOffset: 0 });
  expect(saved.lineup[0].start).toEqual({ time: "23:00", dayOffset: 0 });
});
test("staff local view preserves precise canonical instants on title save", async ({ page }, info) => {
  const startAt = Date.UTC(2026, 9, 16, 6, 0, 12, 123), endAt = startAt + 7200333;
  await page.addInitScript(({ startAt, endAt }) => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({ id: "local-night", slug: "local-night", title: "Local night", startAt, endAt, timezone: "America/Los_Angeles", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "published", source: { sourceType: "community", label: "Afterglow" }, watchSurfaceEnabled: false, watchMode: "event_stream", mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [], lineup: [], preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [] })), { startAt, endAt });
  await page.goto("/playwright/event-lineup?editor");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-16T02:00");
  await page.screenshot({ path: info.outputPath("staff-local-desktop.png"), fullPage: true });
  await page.getByLabel("Time TBA", { exact: true }).check();
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2026-10-16");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("staff-local-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await zone(page, "Tokyo");
  await page.getByLabel("Event title", { exact: true }).fill("Changed title");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(saved.timezone).toBe("America/Los_Angeles"); expect(saved.startAt).toBe(startAt); expect(saved.endAt).toBe(endAt);
});

const nav = (page: Page, step: string) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step, exact: true }).click();
test("display-zone changes refuse pending invalid buffers until cancelled", async ({ page }) => {
  await openIntake(page);
  const end = page.getByLabel("Ends (optional)", { exact: true });
  await end.fill("2026-10-30T05:00");
  await expect(end).toHaveAttribute("data-time-pending", "true");
  await zone(page, "Tokyo");
  await expect(page.locator('[name="editingTimezone"]')).toHaveValue(/America\/(Indiana\/)?Indianapolis/);
  await expect(end).toHaveValue("2026-10-30T05:00"); await expect(end).toBeFocused();
  await page.getByLabel("Time TBA", { exact: true }).click();
  await expect(page.getByLabel("Time TBA", { exact: true })).not.toBeChecked();
  await expect(end).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await end.fill("2026-10-30T05:00"); await end.press("Escape");
  await page.getByLabel("Time TBA", { exact: true }).check(); await page.getByLabel("Time TBA", { exact: true }).uncheck();
  expect(await saveIntake(page)).toEqual(intake);
});
test("missing-zone authored clocks survive display switch then resolve only by explicit source selection", async ({ page }) => {
  const partial = { ...intake, timezone: null };
  await page.addInitScript(fields => sessionStorage.setItem("event-intake-fixture", JSON.stringify(fields)), partial);
  await page.goto("/playwright/event-intake");
  await page.locator('[name="editingTimezone"]').locator("..").getByRole("button", { name: "Time zone", exact: true }).click();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("Tokyo"); await page.getByRole("option").first().click();
  expect(await saveIntake(page)).toEqual(partial);
  await nav(page, "Details");
  await page.locator('[name="sourceTimezone"]').locator("..").getByRole("button", { name: "Time zone", exact: true }).click();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("Los Angeles"); await page.getByRole("option").first().click();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-16T15:00");
  expect(await saveIntake(page)).toEqual(intake);
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-16T16:00");
  const moved = await saveIntake(page);
  expect(moved.lineup[0].start).toEqual({ time: "00:00", dayOffset: 0 });
  expect(moved.lineup[0].end).toEqual({ time: "01:00", dayOffset: 0 });
});
test("unresolved repeated-hour saved clock remains in source context until selected", async ({ page }, info) => {
  const partial = { ...intake, eventDate: "2026-11-01", timezone: "America/Los_Angeles", start: { time: "01:30" }, end: null, doors: null, lineup: [] };
  await page.addInitScript(fields => sessionStorage.setItem("event-intake-fixture", JSON.stringify(fields)), partial);
  await page.goto("/playwright/event-intake");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-11-01T01:30");
  await expect(page.getByText(/Unresolved time/)).toBeVisible();
  expect(await saveIntake(page)).toEqual(partial);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("unresolved-repeated-hour.png"), fullPage: true });
  await page.getByLabel("Starts occurrence").selectOption("later");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-11-01T04:30");
  const saved = await saveIntake(page); expect(saved.start).toEqual({ time: "01:30", dayOffset: 0, occurrence: "later" });
});
test("ordinary local Starts edit shifts lineup once and retains explicit end", async ({ page }) => {
  await openIntake(page);
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-16T03:00");
  const saved = await saveIntake(page);
  expect(saved.start).toEqual({ time: "00:00", dayOffset: 0 }); expect(saved.eventDate).toBe("2026-10-16");
  expect(saved.end).toEqual({ time: "02:00", dayOffset: 0 });
  expect(saved.lineup[0].start).toEqual({ time: "00:00", dayOffset: 0 });
  expect(saved.lineup[0].end).toEqual({ time: "01:00", dayOffset: 0 });
});
test("unrepresentable Starts update keeps every canonical field intact", async ({ page }) => {
  await openIntake(page);
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-25T02:00");
  await expect(page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Lineup", exact: true })).toHaveAttribute("aria-current", "step");
  await nav(page, "Details"); await page.getByLabel("Starts", { exact: true }).press("Escape");
  expect(await saveIntake(page)).toEqual(intake);
});
test("removed TBA rows never return on restoration", async ({ page }) => {
  await openIntake(page); await page.getByLabel("Time TBA", { exact: true }).check();
  await nav(page, "Lineup"); await page.getByRole("button", { name: "Remove slot", exact: true }).click();
  await nav(page, "Details"); await page.getByLabel("Time TBA", { exact: true }).uncheck();
  expect((await saveIntake(page)).lineup).toEqual([]);
});
test("accepted LA import resolves all clocks locally without matching people", async ({ page }) => {
  await page.addInitScript(fields => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { communitySlug: fields.communitySlug, title: fields.title, eventDate: fields.eventDate, timezone: fields.timezone, tentative: { start: fields.start, end: fields.end, doors: fields.doors, lineup: [{ ...fields.lineup[0], personSlug: "aurora" }] }, questions: ["lineup: confirm identity"], evidence: [{ fieldPath: "event.start", origin: "source_text", excerpt: "11 PM Pacific", assessment: "explicit" }] } })), intake);
  await page.goto("/playwright/event-intake?source=text");
  for (const label of ["Start time", "End time", "doors"]) await page.getByRole("button", { name: `Accept ${label}`, exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-16T02:00");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-16T05:00");
  await expect(page.getByLabel("Doors open", { exact: true })).toHaveValue("2026-10-16T01:30");
  await nav(page, "Lineup"); await page.getByRole("button", { name: "Accept Lineup", exact: true }).click();
  await expect(page.locator('[data-lineup-row="a"]')).toContainText("02:00 - 03:00");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields);
  expect(saved.lineup[0].personSlug).toBeUndefined(); expect(saved.questions).toEqual(["lineup: confirm identity"]);
  expect(saved.start).toEqual(intake.start); expect(saved.lineup[0].start).toEqual(intake.lineup[0].start);
});
test("local schedule and timezone search fit mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openIntake(page);
  await expect(page.getByRole("complementary", { name: "Event preview" }).getByLabel("Loading community")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("contributor-local-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Time zone", exact: true }).click();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("Eastern");
  await page.screenshot({ path: info.outputPath("local-zone-search-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("staff TBA date edit preserves precise slot duration and fixed-end conflict", async ({ page }, info) => {
  const startAt = Date.UTC(2026, 9, 16, 6, 0, 12, 123), slotEnd = startAt + 3_620_333;
  await page.addInitScript(({ startAt, slotEnd }) => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "local-precise", slug: "local-precise", title: "Precise local night", startAt, endAt: startAt + 7200000, timezone: "America/Los_Angeles", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "published", source: { sourceType: "community", label: "Afterglow" }, watchSurfaceEnabled: false, watchMode: "event_stream", mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [],
    slots: [{ clientKey: "precise", position: 0, displayLabel: "Guest", roleLabel: "DJ", startAt, endAt: slotEnd }],
    usesCanonicalLineup: true, lineup: [{ key: "precise", position: 0, displayLabel: "Guest", roleLabel: "DJ", startAt, endAt: slotEnd }],
    preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [],
  })), { startAt, slotEnd });
  await page.goto("/playwright/event-lineup?editor");
  await page.getByLabel("Ends (optional)", { exact: true }).fill("2026-03-08T02:30");
  await zone(page, "Tokyo");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-03-08T02:30");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Date", { exact: true }).fill("2026-10-17");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-17T02:00");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-16T04:00");
  await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row="precise"]')).toContainText("02:00:12.123 - 03:00:32.456");
  await expect(page.locator('[data-lineup-conflict]').first()).toContainText("2026-10-16 04:00:12.123");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("precise-duration-local.png"), fullPage: true });
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).first().click();
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(saved.startAt).toBe(startAt + 86400000); expect(saved.lineup[0].startAt).toBe(startAt + 86400000); expect(saved.lineup[0].endAt).toBe(slotEnd + 86400000);
});
for (const source of [
  { eventDate: "2026-03-08", timezone: "America/New_York", start: { time: "02:30", dayOffset: 0 } },
  { eventDate: "2026-11-01", timezone: "America/New_York", start: { time: "01:30", dayOffset: 0 } },
  { eventDate: "2026-10-15", timezone: null, start: { time: "23:00", dayOffset: 0 } },
]) test(`unresolved import ${source.eventDate} ${source.timezone} remains tentative`, async ({ page }) => {
  await page.addInitScript(tentative => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { title: "Unresolved import", eventDate: tentative.eventDate, timezone: "UTC", tentative, questions: ["event.start: confirm source"] } })), source);
  await page.goto("/playwright/event-intake?source=text");
  await expect(page.getByRole("button", { name: "Accept Start time", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields);
  expect(saved.tentative).toEqual(source); expect(saved.start).toBeUndefined(); expect(saved.questions).toEqual(["event.start: confirm source"]);
});

test("connected correction form uses the saved display preference and preserves its date", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-correction-timezone", "Asia/Tokyo"));
  await page.goto("/playwright/event-intake?revision=correction");
  await page.getByRole("button", { name: "Correct event", exact: true }).click();
  await expect(page.locator('[name="editingTimezone"]')).toHaveValue("Asia/Tokyo");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2027-07-15");
  await zone(page, "London");
  await expect(page.locator('[name="editingTimezone"]')).toHaveValue("Europe/London");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2027-07-15");
});

test("missing-zone partial clocks remain unresolved when an absent Starts is authored", async ({ page }) => {
  const partial = { ...intake, timezone: null, start: null };
  await page.addInitScript(fields => sessionStorage.setItem("event-intake-fixture", JSON.stringify(fields)), partial);
  await page.goto("/playwright/event-intake");
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-15T21:00");
  await expect(page.locator('[name="sourceTimezone"]')).toHaveValue("");
  const saved = await saveIntake(page);
  expect(saved).toEqual({ ...partial, start: { time: "21:00", dayOffset: 0 } });
  await expect(page.getByLabel("Ends (optional)", { exact: true }).locator("xpath=ancestor::*[@data-unresolved-time]")).toBeVisible();
});

for (const clockLabel of ["Ends (optional)", "Slot 1 end"]) test(`missing-zone source selection preserves pending ${clockLabel} until cancellation`, async ({ page }) => {
  const partial = { ...intake, timezone: null };
  await page.addInitScript(fields => sessionStorage.setItem("event-intake-fixture", JSON.stringify(fields)), partial);
  await page.goto("/playwright/event-intake");
  if (clockLabel === "Slot 1 end") { await nav(page, "Lineup"); await page.locator("[data-lineup-row]").first().getByText("Details", { exact: true }).click(); }
  const end = page.getByLabel(clockLabel, { exact: true });
  await end.fill("2026-10-30T05:00");
  await nav(page, "Details");
  await page.locator('[name="sourceTimezone"]').locator("..").getByRole("button", { name: "Time zone", exact: true }).click();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("Los Angeles"); await page.getByRole("option").first().click();
  await expect(page.locator('[name="sourceTimezone"]')).toHaveValue("");
  await expect(end).toHaveValue("2026-10-30T05:00"); await expect(end).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await saveIntake(page)).toEqual(partial);
  await nav(page, "Details");
  await page.locator('[name="sourceTimezone"]').locator("..").getByRole("button", { name: "Time zone", exact: true }).click();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("Los Angeles"); await page.getByRole("option").first().click();
  expect(await saveIntake(page)).toEqual(intake);
});

test("missing-zone rejected Starts retains raw input until Escape restores canonical fields", async ({ page }) => {
  const partial = { ...intake, timezone: null };
  await page.addInitScript(fields => sessionStorage.setItem("event-intake-fixture", JSON.stringify(fields)), partial);
  await page.goto("/playwright/event-intake");
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-25T23:00");
  await nav(page, "Details");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-25T23:00");
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await zone(page, "Tokyo");
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-25T23:00");
  await page.getByLabel("Starts", { exact: true }).press("Escape");
  expect(await saveIntake(page)).toEqual(partial);
});
