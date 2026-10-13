import { expect, test, type Page } from "@playwright/test";

const storedStart = Date.UTC(2026, 10, 1, 5, 15);
const storedEnd = Date.UTC(2026, 10, 1, 6, 45);

async function editWithRepeatedEnd(page: Page) {
  await page.addInitScript(({ startAt, endAt }) => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "event-end-fixture", slug: "repeated-night", title: "Repeated night", startAt, endAt,
    timezone: "America/New_York", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "published",
    source: { sourceType: "community", label: "Afterglow" }, watchSurfaceEnabled: false, watchMode: "event_stream",
    mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [], lineup: [],
    preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [],
  })), { startAt: storedStart, endAt: storedEnd });
  await page.goto("/playwright/event-lineup?editor");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details" }).click();
}

async function saveEdit(page: Page) {
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  return page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
}

test("staff edit preserves a later repeated-hour end when untouched @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page);
  await expect(page.getByLabel("End occurrence")).toHaveValue("later");
  await page.getByLabel("Event title", { exact: true }).fill("Changed title");
  const payload = await saveEdit(page);
  expect(payload.startAt).toBe(storedStart);
  expect(payload.endAt).toBe(storedEnd);
});

test("staff edit applies an occurrence-only end change @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page);
  await page.getByLabel("End occurrence").selectOption("earlier");
  const payload = await saveEdit(page);
  expect(payload.endAt).toBe(Date.UTC(2026, 10, 1, 5, 45));
});

test("staff edit applies an occurrence-only start change @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page);
  await page.getByLabel("Start occurrence").selectOption("later");
  const payload = await saveEdit(page);
  expect(payload.startAt).toBe(Date.UTC(2026, 10, 1, 6, 15));
  expect(payload.endAt).toBe(storedEnd + 60 * 60_000);
});

test("staff edit clears its authored end explicitly @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page);
  await page.getByLabel("Ends (optional)", { exact: true }).fill("");
  const payload = await saveEdit(page);
  expect(payload.endAt).toBeNull();
});

test("staff edit accepts an explicit end and rejects ordering errors @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page);
  const end = page.getByLabel("Ends (optional)", { exact: true });
  await end.fill("2026-11-01T01:00");
  await page.getByLabel("End occurrence").selectOption("earlier");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(end).toBeFocused();
  await expect(page.getByText("Event end time must be after the start time.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
  await end.fill("2026-11-01T01:50");
  await page.getByLabel("End occurrence").selectOption("later");
  const payload = await saveEdit(page);
  expect(payload.endAt).toBe(Date.UTC(2026, 10, 1, 6, 50));
});

test("staff create omits an unknown end without slots @fixture", async ({ page }) => {
  await page.goto("/playwright/event-lineup?editor&mode=create");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details" }).click();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Lineup" }).click();
  await page.getByLabel("Slots", { exact: true }).fill("0");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.endAt).toBeUndefined();
  expect(payload.slotLinks).toEqual([]);
});
