import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "UTC" });
const step = (page: Page, name: string) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name, exact: true }).click();

async function seedStaff(page: Page, publicationState = "published", lineup = true) {
  await page.addInitScript(({ publicationState, lineup }) => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "event-contributed", slug: "contributed", title: "Contributed night", scheduleKind: "date_only", eventDate: "2027-10-15",
    status: "scheduled", communitySlug: "afterglow", publicationState,
    source: { sourceType: "contributor", label: "Community-submitted" },
    watchSurfaceEnabled: false, watchMode: "event_stream", mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [],
    lineup: lineup ? [{ key: "guest", position: 0, displayLabel: "Unmatched guest" }] : [],
    preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [],
  })), { publicationState, lineup });
  await page.goto("/playwright/event-lineup?editor");
}

test("contributor corrects a legacy date without choosing a time or timezone @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=correction");
  await page.getByRole("button", { name: "Correct event", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toBeHidden();
  await expect(page.getByText("Add end time", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Add doors-open time", { exact: true })).toHaveCount(0);
  await page.getByLabel("Date", { exact: true }).fill("2027-07-16");
  await step(page, "Review");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const submission = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!));
  expect(submission.patch).toEqual({ eventDate: "2027-07-16" });
});

for (const publicationState of ["published", "draft_private"]) test(`staff corrects a legacy ${publicationState} date and retains untimed performers @flow @fixture`, async ({ page }) => {
  await seedStaff(page, publicationState);
  await page.getByLabel("Date", { exact: true }).fill("2027-10-16");
  await expect(page.getByLabel("Starts", { exact: true })).toBeHidden();
  await expect(page.getByText("Add end time", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Add doors-open time", { exact: true })).toHaveCount(0);
  await step(page, "Review");
  await page.getByRole("button", { name: publicationState === "published" ? "Save changes" : "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.eventDate).toBe("2027-10-16");
  expect(payload.scheduleKind).toBe("date_only");
  expect(payload.startAt).toBeUndefined();
  expect(payload.timezone).toBeUndefined();
  expect(payload.lineup).toBeUndefined();
});

for (const editor of ["contributor", "staff"]) test(`${editor} exposes optional clocks only after converting a legacy event to timed @flow @fixture`, async ({ page }) => {
  if (editor === "staff") await seedStaff(page);
  else {
    await page.goto("/playwright/event-intake?revision=correction");
    await page.getByRole("button", { name: "Correct event", exact: true }).click();
  }
  await page.getByText("Add start time", { exact: true }).click();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  await expect(page.getByLabel("Date", { exact: true })).toHaveCount(0);
  await page.getByText("Add end time", { exact: true }).click();
  await page.getByLabel("Ends (optional)", { exact: true }).fill("2027-10-15T22:00");
  await page.getByText("Add doors-open time", { exact: true }).click();
  await page.getByLabel("Doors open", { exact: true }).fill("2027-10-15T19:30");
  await step(page, "Review");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  if (editor === "staff") {
    await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
    const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
    expect(payload.startAt).toBe(Date.UTC(2027, 9, 15, 20));
    expect(payload.endAt).toBe(Date.UTC(2027, 9, 15, 22));
    expect(payload.doorsOpenAt).toBe(Date.UTC(2027, 9, 15, 19, 30));
  } else {
    const { patch } = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!));
    expect(patch.timeTba).toBe(false);
    expect(patch.start).toEqual({ time: "20:00", dayOffset: 0 });
    expect(patch.end).toEqual({ time: "22:00", dayOffset: 0 });
    expect(patch.doors).toEqual({ time: "19:30", dayOffset: 0 });
  }
});

test("relative contributor draft saves without Starts but a legacy correction requires Starts for generated timing @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake");
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!));
  expect(saved.lineup[0].relativeTiming).toEqual({ offsetMinutes: 0, durationMinutes: 60 });
  await page.goto("/playwright/event-intake?revision=correction");
  await page.getByRole("button", { name: "Correct event", exact: true }).click();
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Reset lineup", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear lineup", exact: true }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await step(page, "Review");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem("event-intake-revision-submission"))).toBeNull();
});

test("staff generated timing cannot be discarded by saving without Starts @flow @fixture", async ({ page }) => {
  await seedStaff(page, "published", false);
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await page.getByRole("button", { name: "Unpublish and save draft", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1")!));
  expect(stored.scheduleKind).toBe("date_only");
  expect(stored.lineup).toEqual([]);
});
