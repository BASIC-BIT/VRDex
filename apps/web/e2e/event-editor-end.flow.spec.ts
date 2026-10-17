import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

const storedStart = Date.UTC(2026, 10, 1, 5, 15);
const storedEnd = Date.UTC(2026, 10, 1, 6, 45);

async function editWithRepeatedEnd(page: Page, startAt = storedStart, endAt = storedEnd, doorsOpenAt?: number) {
  await page.addInitScript(({ startAt, endAt, doorsOpenAt }) => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "event-end-fixture", slug: "repeated-night", title: "Repeated night", startAt, endAt, doorsOpenAt,
    timezone: "America/New_York", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "published",
    source: { sourceType: "community", label: "Afterglow" }, watchSurfaceEnabled: false, watchMode: "event_stream",
    mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [], lineup: [],
    preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [],
  })), { startAt, endAt, doorsOpenAt });
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

test("staff edit preserves subminute start and end instants in its displayed end @fixture", async ({ page }) => {
  const startAt = Date.UTC(2026, 10, 1, 5, 15, 50);
  const endAt = Date.UTC(2026, 10, 1, 6, 45, 20);
  await editWithRepeatedEnd(page, startAt, endAt);
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-11-01T01:45");
  await expect(page.getByLabel("End occurrence")).toHaveValue("later");
  const payload = await saveEdit(page);
  expect(payload.startAt).toBe(startAt);
  expect(payload.endAt).toBe(endAt);
});

test("staff legacy date-only draft retains its date without inventing a start @fixture", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "event-date-only-fixture", slug: "date-only-night", title: "Date-only night", eventDate: "2026-11-01",
    timezone: "America/New_York", scheduleKind: "date_only", status: "scheduled", communitySlug: "afterglow", publicationState: "draft_private",
    source: { sourceType: "community", label: "Afterglow" }, watchSurfaceEnabled: false, watchMode: "event_stream",
    mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [], lineup: [],
    preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [],
  })));
  await page.goto("/playwright/event-lineup?editor");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Time TBA", { exact: true })).toHaveCount(0);
  await page.getByLabel("Event title", { exact: true }).fill("Updated legacy night");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.scheduleKind).toBe("date_only");
  expect(payload.eventDate).toBe("2026-11-01");
  expect(payload.startAt).toBeUndefined();
});

for (const invalidEnd of ["2026-11-01T01:45", "2026-03-08T02:30"]) {
  test(`staff legacy date-only migration rejects pending ${invalidEnd} end @fixture`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
      id: "event-date-only-fixture", slug: "date-only-night", title: "Date-only night", eventDate: "2026-11-01",
      timezone: "America/New_York", scheduleKind: "date_only", status: "scheduled", communitySlug: "afterglow", publicationState: "draft_private",
      source: { sourceType: "community", label: "Afterglow" }, watchSurfaceEnabled: false, watchMode: "event_stream",
      mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [], lineup: [],
      preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [],
    })));
    await page.goto("/playwright/event-lineup?editor");
    await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details" }).click();
    await page.getByText("Add start time", { exact: true }).click();
    await page.getByLabel("Starts", { exact: true }).fill("2026-11-01T00:15");
    await page.getByText("Add end time", { exact: true }).click();
    await page.getByLabel("Ends (optional)", { exact: true }).fill(invalidEnd);
    await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue(invalidEnd);
    await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText(invalidEnd.startsWith("2026-11")
      ? "Ambiguous local time requires an earlier or later occurrence."
      : "Local time does not exist in this timezone.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
    await page.getByLabel("Ends (optional)", { exact: true }).press("Escape");
    await page.getByLabel("Ends (optional)", { exact: true }).fill("2026-11-01T02:00");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
    const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
    expect(payload.startAt).toBe(Date.UTC(2026, 10, 1, 4, 15));
    expect(payload.endAt).toBe(Date.UTC(2026, 10, 1, 7));
    expect(payload.scheduleKind).toBe("timed");
  });
}

test("staff edit applies an occurrence-only end change @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page);
  await page.getByLabel("End occurrence").selectOption("earlier");
  const payload = await saveEdit(page);
  expect(payload.endAt).toBe(Date.UTC(2026, 10, 1, 5, 45));
});

test("staff edit applies an occurrence-only start change while keeping the stored end fixed @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page);
  await page.getByLabel("Start occurrence").selectOption("later");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-11-01T01:45");
  await expect(page.getByText("Nov 1, 1:45 AM", { exact: false })).toBeVisible();
  const payload = await saveEdit(page);
  expect(payload.startAt).toBe(Date.UTC(2026, 10, 1, 6, 15));
  expect(payload.endAt).toBe(storedEnd);
});

test("staff edit keeps the later repeated-hour end when the start moves earlier @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page);
  await page.getByLabel("Starts", { exact: true }).fill("2026-11-01T00:15");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-11-01T01:45");
  await expect(page.getByLabel("End occurrence")).toHaveValue("later");
  await expect(page.getByText("Nov 1, 1:45 AM", { exact: false })).toBeVisible();
  const payload = await saveEdit(page);
  expect(payload.startAt).toBe(Date.UTC(2026, 10, 1, 4, 15));
  expect(payload.endAt).toBe(storedEnd);
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
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.endAt).toBeUndefined();
  expect(payload.lineup).toEqual([]);
});


test("staff doors disclosure preserves its value on collapse and clearing removes it @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page);
  const disclosure = page.getByText("Add doors-open time", { exact: true });
  await expect(page.getByLabel("Doors open", { exact: true })).toBeHidden();
  await disclosure.click();
  await page.getByLabel("Doors open", { exact: true }).fill("2026-11-01T01:00");
  await page.getByLabel("Doors open occurrence").selectOption("earlier");
  await disclosure.click();
  expect((await saveEdit(page)).doorsOpenAt).toBe(storedStart - 15 * 60_000);
});

test("staff stored doors start expanded and can be explicitly cleared @fixture", async ({ page }) => {
  await editWithRepeatedEnd(page, storedStart, storedEnd, storedStart - 15 * 60_000);
  await expect(page.getByLabel("Doors open", { exact: true })).toHaveValue("2026-11-01T01:00");
  await page.getByLabel("Doors open", { exact: true }).fill("");
  expect((await saveEdit(page)).doorsOpenAt).toBeNull();
});

for (const unavailable of [false, true]) test(`staff explicit manual location preserves unrepresented associations when public hydration is ${unavailable ? "unavailable" : "available"} @fixture`, async ({ page }) => {
  await page.addInitScript(({ startAt, unavailable }) => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "event-location-fixture", slug: "location-night", title: "Location night", startAt, timezone: "UTC", status: "scheduled", communitySlug: "afterglow", communityName: "Afterglow", publicationState: "published",
    source: { sourceType: "community", label: "Afterglow", url: "https://example.com/original-post" }, venueLabel: "Custom pier", watchSurfaceEnabled: false, watchMode: "event_stream", mediaLinks: [], authoredMediaLinks: [], participants: [], slots: [], lineup: [],
    worlds: unavailable ? [] : [{ slug: "harbor-world", displayName: "Harbor World", tags: [], association: { sourceType: "community", confirmationState: "confirmed" } }],
    editableWorldAssociation: unavailable ? undefined : { associationId: "editable-world", worldSlug: "harbor-world" },
    preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: ["editable-world", "extra-public", "private-world"],
  })), { startAt: storedStart, unavailable });
  await page.goto("/playwright/event-lineup?editor");
  await page.getByLabel("Event title", { exact: true }).fill("Updated title");
  let payload = await saveEdit(page);
  expect(payload.worldSlug).toBeUndefined();
  expect(payload.preservedWorldAssociationIds).toEqual(["editable-world", "extra-public", "private-world"]);
  expect(payload.venueLabel).toBe("Custom pier");
  expect(payload.sourceUrl).toBe("https://example.com/original-post");
  if (!unavailable) {
    await page.waitForURL("**/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions");
    await page.goto("/playwright/event-lineup?editor");
    await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details" }).click();
    await page.getByRole("button", { name: "Clear", exact: true }).last().click();
    payload = await saveEdit(page);
    expect(payload.worldSlug).toBeNull();
    expect(payload.preservedWorldAssociationIds).toEqual(["extra-public", "private-world"]);
    expect(payload.venueLabel).toBe("Custom pier");
  }
});


test("staff world-only presentation appears in preview and Review without saving a venue override @fixture", async ({ page }) => {
  await page.addInitScript(({ startAt, endAt }) => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "staff-world-only", slug: "world-only", title: "World-only night", startAt, endAt, timezone: "UTC", status: "scheduled", communitySlug: "afterglow", publicationState: "published",
    source: { sourceType: "community", label: "Afterglow" }, watchSurfaceEnabled: false, watchMode: "event_stream", mediaLinks: [], authoredMediaLinks: [], participants: [], slots: [], lineup: [],
    worlds: [{ slug: "harbor-world", displayName: "Harbor World", tags: [], association: { sourceType: "community", confirmationState: "confirmed" } }],
    editableWorldAssociation: { associationId: "editable-world", worldSlug: "harbor-world" }, preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: ["editable-world"],
  })), { startAt: storedStart, endAt: storedEnd });
  await page.goto("/playwright/event-lineup?editor");
  await expect(page.getByRole("complementary", { name: "Event preview" })).toContainText("Harbor World");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
  await expect(page.locator('[data-editor-step="Review"]')).toContainText("Harbor World");
  const payload = await saveEdit(page);
  expect(payload.venueLabel).toBe("");
  expect(payload.worldSlug).toBeUndefined();
  expect(payload.preservedWorldAssociationIds).toEqual(["editable-world"]);
});
