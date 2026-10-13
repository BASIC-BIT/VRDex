import { expect, test, type Page } from "@playwright/test";
test.use({ timezoneId: "UTC" });
const nav = (page: Page, step: string) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step, exact: true }).click();
async function intake(page: Page, extra = {}) {
  await page.addInitScript(extra => sessionStorage.setItem("event-intake-fixture", JSON.stringify({ communitySlug: "playwright-afterglow-social", title: "Slot night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, end: { time: "00:00", dayOffset: 1 }, ...extra })), extra);
  await page.goto("/playwright/event-intake");
}
for (const editor of ["staff", "intake"]) {
  test(`${editor} generates, inserts, commits duration once and resets @fixture`, async ({ page }, testInfo) => {
    if (editor === "staff") {
      await page.goto("/playwright/event-lineup?editor&mode=create");
      await nav(page, "Details");
      await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
    } else await intake(page);
    await nav(page, "Lineup");
    await expect(page.getByLabel("Slots", { exact: true })).toHaveValue("4");
    await expect(page.locator('[data-lineup-row]')).toHaveCount(0);
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.locator('[data-lineup-row]')).toHaveCount(4);
    await expect(page.getByLabel("Slots", { exact: true })).toHaveCount(0);
    for (const [index, row] of (await page.locator('[data-lineup-row]').all()).entries()) {
      await row.getByRole(editor === "staff" ? "combobox" : "textbox", { name: editor === "staff" ? "Person" : "Performer", exact: true }).fill(editor === "staff" ? "aurora" : `Guest ${index + 1}`);
    }
    await page.getByRole("button", { name: "Add slot at position 2", exact: true }).click();
    await page.getByLabel("Slot duration", { exact: true }).fill("15");
    await page.getByRole("button", { name: "Insert slot", exact: true }).click();
    const rows = page.locator('[data-lineup-row]');
    await expect(rows).toHaveCount(5);
    await rows.nth(1).getByRole(editor === "staff" ? "combobox" : "textbox", { name: editor === "staff" ? "Person" : "Performer", exact: true }).fill(editor === "staff" ? "lumen" : "Inserted");
    await expect(rows.nth(2)).toContainText("21:15");
    const duration = rows.first().getByLabel("Duration", { exact: true });
    await duration.fill("45"); await duration.press("Enter"); await duration.press("Tab");
    await expect(rows.nth(2)).toContainText("21:00");
    await page.evaluate(() => window.scrollTo(0, 0));
    const layout = await page.evaluate(() => ({ viewport: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, deviceScaleFactor: window.devicePixelRatio }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    await testInfo.attach(`${editor}-layout`, { body: JSON.stringify(layout), contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath(`${editor}-lineup.png`), fullPage: true, animations: "disabled" });
    await nav(page, "Review"); await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const payload = editor === "staff" ? await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!)) : await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!));
    if (editor === "staff") {
      expect(payload.slotLinks[2].startAt).toBe(Date.UTC(2027,9,15,21));
      expect(payload.slotLinks[1].personSlug).toBe("lumen");
    } else { expect(payload.lineup[2].start.time).toBe("21:00"); expect(payload.lineup[1].performerLabel).toBe("Inserted"); }
    await nav(page, "Lineup");
    await rows.nth(1).getByRole("button", { name: "Remove slot", exact: true }).click();
    await expect(rows.nth(1)).toContainText("20:45");
    await page.getByRole("button", { name: "Add slot at position 1", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(rows).toHaveCount(4);
    await page.getByRole("button", { name: "Reset lineup", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(rows).toHaveCount(4);
    await page.getByRole("button", { name: "Reset lineup", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Clear lineup", exact: true }).click();
    await expect(rows).toHaveCount(0);
    await expect(page.getByLabel("Slots", { exact: true })).toHaveValue("4");
    await nav(page, "Details");
    await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2027-10-15T20:00");
  });
}

test("partial intake resumes, preserves overrun through draft save and resolves only the end @fixture", async ({ page }) => {
  await intake(page, { end: { time: "21:00" }, lineup: [{ clientKey: "partial", position: 0, performerLabel: "Guest", start: { time: "22:00" } }] });
  await nav(page, "Lineup");
  await expect(page.getByRole("button", { name: "Generate", exact: true })).toHaveCount(0);
  await expect(page.getByText("The lineup ends after the event.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Set event end to lineup end", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.reload(); await nav(page, "Lineup");
  await expect(page.getByText("The lineup ends after the event.", { exact: true }).first()).toBeVisible();
  await page.locator('[data-lineup-row]').getByText("Details", { exact: true }).click();
  await page.getByLabel("Slot 1 end", { exact: true }).fill("2027-10-15T23:00");
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).first().click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const fields = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!));
  expect(fields.end).toEqual({ time: "23:00", dayOffset: 0 });
  expect(fields.lineup[0].clientKey).toBe("partial");
});

test("Time TBA removal and reset never restore deleted intake rows @fixture", async ({ page }) => {
  await intake(page, { lineup: [{ clientKey: "original", position: 0, performerLabel: "Original", start: { time: "20:00" }, end: { time: "21:00" } }] });
  await page.getByLabel("Time TBA", { exact: true }).check(); await nav(page, "Lineup");
  await page.getByRole("button", { name: "Add slot at position 2", exact: true }).click();
  await page.getByRole("button", { name: "Add performer", exact: true }).click();
  await page.locator('[data-lineup-row]').first().getByRole("button", { name: "Remove slot", exact: true }).click();
  await nav(page, "Details"); await page.getByLabel("Time TBA", { exact: true }).uncheck(); await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row]')).toHaveCount(1);
  await expect(page.locator('[data-lineup-row]').getByRole("textbox", { name: "Performer", exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Reset lineup", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear lineup", exact: true }).click();
  await nav(page, "Details"); await page.getByLabel("Time TBA", { exact: true }).check(); await page.getByLabel("Time TBA", { exact: true }).uncheck(); await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row]')).toHaveCount(0);
});

async function canonicalStaff(page: Page) {
  await page.addInitScript(() => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "precise", slug: "precise", title: "Precise night", usesCanonicalLineup: true,
    startAt: Date.UTC(2027,9,15,20,0,10,123), endAt: Date.UTC(2027,9,15,21), timezone: "UTC", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "published",
    source: { sourceType: "contributor", label: "Afterglow" }, watchSurfaceEnabled: true, watchMode: "performer_sequence",
    mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [],
    slots: [{ clientKey: "exact-row", position: 0, startAt: Date.UTC(2027,9,15,20,0,10,123), endAt: Date.UTC(2027,9,15,21,0,30,456), displayLabel: "Aurora", roleLabel: "DJ", performer: { slug: "aurora", displayName: "Aurora", trustLabel: "claimed_verified" }, source: { sourceType: "contributor", label: "Original source" }, selectedStreamId: "vrcdn:aurora" }],
    lineup: [], preservedParticipantAssociationIds: ["protected-person"], preservedSlotAssociationIds: ["protected-slot"], preservedWorldAssociationIds: ["protected-world"],
  })));
  await page.goto("/playwright/event-lineup?editor");
}

test("canonical staff extends to the exact subminute end and retains assignments and protected snapshots @fixture", async ({ page }) => {
  await canonicalStaff(page); await nav(page, "Review");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
  await expect(page.locator('[data-editor-step="Lineup"] [data-lineup-conflict]')).toBeVisible();
  await expect(page.locator('[data-editor-step="Lineup"] [data-lineup-conflict]')).toContainText("21:00:30.456");
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).first().click();
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.endAt).toBe(Date.UTC(2027,9,15,21,0,30,456));
  expect(payload.lineup).toBeUndefined();
  expect(payload.preservedSlotAssociationIds).toEqual(["protected-slot"]);
  expect(payload.preservedParticipantAssociationIds).toEqual(["protected-person"]);
});

test("authored staff start edits cascade once and keep explicit end fixed @fixture", async ({ page }) => {
  await canonicalStaff(page);
  await page.getByLabel("Starts", { exact: true }).fill("");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:15");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2027-10-15T21:00");
  await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row]')).toContainText("20:15");
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).first().click();
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup[0].startAt).toBe(Date.UTC(2027,9,15,20,15));
  expect(payload.lineup[0].endAt).toBe(Date.UTC(2027,9,15,21,15,20,333));
  expect(payload.lineup[0].clientKey).toBe("exact-row");
  expect(payload.lineup[0].selectedStreamId).toBe("vrcdn:aurora");
});

test("intake start changes shift the lineup once and day-offset overflow retains original rows @fixture", async ({ page }) => {
  await intake(page, { lineup: [{ clientKey: "a", position: 0, performerLabel: "A", start: { time: "20:00" }, end: { time: "21:00" } }] });
  await page.getByLabel("Starts", { exact: true }).fill("");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:15");
  await nav(page, "Lineup"); await expect(page.locator('[data-lineup-row]')).toContainText("20:15");
  await page.locator('[data-lineup-row]').getByText("Details", { exact: true }).click();
  await page.getByLabel("Slot 1 start", { exact: true }).fill("2027-10-22T23:00");
  await page.getByLabel("Slot 1 end", { exact: true }).fill("2027-10-22T23:45");
  await page.getByRole("button", { name: "Add slot at position 1", exact: true }).click();
  await page.getByLabel("Slot duration", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Insert slot", exact: true }).click();
  await expect(page.locator('[data-lineup-row]')).toHaveCount(1);
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("2027-10-22T23:00");
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toBeFocused();
});

test("canonical Time TBA rows can be removed without returning on toggle and reset keeps explicit end @fixture", async ({ page }) => {
  await canonicalStaff(page);
  await page.getByLabel("Time TBA", { exact: true }).check(); await nav(page, "Lineup");
  await page.getByRole("button", { name: "Add slot at position 2", exact: true }).click();
  await page.getByRole("button", { name: "Add performer", exact: true }).click();
  await page.locator('[data-lineup-row]').first().getByRole("button", { name: "Remove slot", exact: true }).click();
  await nav(page, "Details"); await page.getByLabel("Time TBA", { exact: true }).uncheck(); await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row]')).toHaveCount(1);
  await page.getByRole("button", { name: "Reset lineup", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear lineup", exact: true }).click();
  await nav(page, "Details");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2027-10-15T21:00");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Precise night");
  await page.getByLabel("Time TBA", { exact: true }).check(); await page.getByLabel("Time TBA", { exact: true }).uncheck(); await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row]')).toHaveCount(0);
});


test("canonical untimed insertion retains order in preview and submitted lineup @fixture", async ({ page }) => {
  await canonicalStaff(page); await nav(page, "Lineup");
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).first().click();
  await page.getByRole("button", { name: "Add slot at position 1", exact: true }).click();
  await page.getByRole("button", { name: "Add performer", exact: true }).click();
  await page.locator('[data-lineup-row]').first().getByRole("textbox", { name: "Performer", exact: true }).fill("First guest");
  const names = page.locator('aside').locator('div.border-t > div > p:first-child');
  await expect(names).toHaveText(["First guest", "Aurora"]);
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup.map((row: { performerLabel: string }) => row.performerLabel)).toEqual(["First guest", "Aurora"]);
  expect(payload.lineup[0].startAt).toBeUndefined();
  expect(payload.lineup[1].clientKey).toBe("exact-row");
});
