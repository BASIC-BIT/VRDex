import { expect, test, type Locator, type Page } from "@playwright/test";
test.use({ timezoneId: "UTC" });
async function choosePerformer(row: Locator, text: string, manual = false) {
  await row.getByRole("combobox", { name: "Performer", exact: true }).fill(text);
  await (manual ? row.getByRole("button", { name: "Add manual entry", exact: true }) : row.getByRole("option").first()).click();
}
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
      await choosePerformer(row, editor === "staff" ? "Aurora" : `Guest ${index + 1}`, editor !== "staff");
    }
    await page.getByRole("button", { name: "Add slot at position 2", exact: true }).click();
    await page.getByLabel("Slot duration", { exact: true }).fill("15");
    await page.getByRole("button", { name: "Insert slot", exact: true }).click();
    const rows = page.locator('[data-lineup-row]');
    await expect(rows).toHaveCount(5);
    await choosePerformer(rows.nth(1), editor === "staff" ? "Lumen" : "Inserted", editor !== "staff");
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
      expect(payload.lineup[2].startAt).toBe(Date.UTC(2027,9,15,21));
      expect(payload.lineup[1].personSlug).toBe("lumen");
    } else { expect(payload.lineup[2].start.time).toBe("21:00"); expect(payload.lineup[1].performerLabel).toBe("Inserted"); }
    await nav(page, "Lineup");
    await rows.nth(1).getByRole("button", { name: "Remove slot", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove slot", exact: true }).click();
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
  await page.getByRole("dialog").getByRole("button", { name: "Remove slot", exact: true }).click();
  await nav(page, "Details"); await page.getByLabel("Time TBA", { exact: true }).uncheck(); await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row]')).toHaveCount(1);
  await expect(page.locator('[data-lineup-row]').getByRole("combobox", { name: "Performer", exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Reset lineup", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear lineup", exact: true }).click();
  await nav(page, "Details"); await page.getByLabel("Time TBA", { exact: true }).check(); await page.getByLabel("Time TBA", { exact: true }).uncheck(); await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row]')).toHaveCount(0);
});

async function canonicalStaff(page: Page, partial = false) {
  await page.addInitScript(partial => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "precise", slug: "precise", title: "Precise night", usesCanonicalLineup: true,
    startAt: Date.UTC(2027,9,15,20,0,10,123), endAt: Date.UTC(2027,9,15,21), timezone: "UTC", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "published",
    source: { sourceType: "contributor", label: "Afterglow" }, watchSurfaceEnabled: true, watchMode: "performer_sequence",
    mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [],
    slots: [{ clientKey: "exact-row", position: 0, startAt: Date.UTC(2027,9,15,20,0,10,123), endAt: partial ? undefined : Date.UTC(2027,9,15,21,0,30,456), displayLabel: "Aurora", roleLabel: "DJ", performer: { slug: "aurora", displayName: "Aurora", trustLabel: "claimed_verified" }, source: { sourceType: "contributor", label: "Original source" }, selectedStreamId: "vrcdn:aurora" }],
    lineup: [], preservedParticipantAssociationIds: ["protected-person"], preservedSlotAssociationIds: ["protected-slot"], preservedWorldAssociationIds: ["protected-world"],
  })), partial);
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
  await page.getByRole("dialog").getByRole("button", { name: "Remove slot", exact: true }).click();
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
  await choosePerformer(page.locator('[data-lineup-row]').first(), "First guest", true);
  const names = page.locator('aside').locator('div.border-t > div > p:first-child');
  await expect(names).toHaveText(["First guest", "Aurora"]);
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup.map((row: { performerLabel: string }) => row.performerLabel)).toEqual(["First guest", "Aurora"]);
  expect(payload.lineup[0].startAt).toBeUndefined();
  expect(payload.lineup[1].clientKey).toBe("exact-row");
});


for (const insert of [false, true]) test(`legacy deferred save retains surviving keys with insertion=${insert} before a second save @fixture`, async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("event-lineup-fixture-defer-save", "true");
    localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
      id: "legacy", slug: "legacy", title: "Legacy night", startAt: Date.UTC(2027,9,15,20), endAt: Date.UTC(2027,9,16,0), timezone: "UTC", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "draft",
      source: { sourceType: "community", label: "Afterglow" }, mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], lineup: [],
      slots: ["a", "b"].map((key, position) => ({ playbackKey: `slot-${key}`, position, startAt: Date.UTC(2027,9,15,20 + position), endAt: Date.UTC(2027,9,15,21 + position), displayLabel: key.toUpperCase(), roleLabel: "DJ", source: { sourceType: "community", label: key }, selectedStreamId: `private-${key}` })),
      preservedParticipantAssociationIds: [], preservedSlotAssociationIds: ["slot-a", "slot-b"], preservedWorldAssociationIds: [],
    }));
  });
  await page.goto("/playwright/event-lineup?editor"); await nav(page, "Review");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  await nav(page, "Lineup");
  await page.locator('[data-lineup-row]').first().getByRole("button", { name: "Remove slot", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove slot", exact: true }).click();
  if (insert) {
    await page.getByRole("button", { name: "Add slot at position 1", exact: true }).click();
    await page.getByRole("button", { name: "Insert slot", exact: true }).click();
  }
  await page.evaluate(() => { localStorage.removeItem("event-lineup-fixture-defer-save"); window.dispatchEvent(new Event("event-lineup-fixture-release-save")); });
  await nav(page, "Review"); await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup[insert ? 1 : 0].clientKey).toBe("slot-b");
  expect(payload.lineup[insert ? 1 : 0].performerLabel).toBe("B");
  expect(payload.lineup[insert ? 1 : 0].selectedStreamId).toBe("private-b");
});

for (const cascade of [false, true]) test(`advanced offset preserves exact duration after cascade=${cascade} and rejects invalid offset @fixture`, async ({ page }) => {
  await canonicalStaff(page);
  if (cascade) await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:15");
  await nav(page, "Lineup");
  await page.locator('[data-lineup-row] summary').filter({ hasText: "Details" }).click();
  const offset = page.getByLabel("Slot offset minutes", { exact: true });
  await offset.fill("15");
  await expect(page.getByLabel("Duration", { exact: true })).toHaveValue(String(3_620_333 / 60_000));
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).first().click();
  await offset.fill("bad");
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(offset).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
  await offset.fill("15");
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup[0].endAt - payload.lineup[0].startAt).toBe(3_620_333);
  expect(payload.lineup[0].startAt).toBe(cascade ? Date.UTC(2027,9,15,20,30) : Date.UTC(2027,9,15,20,15,10,123));
  expect(payload.lineup[0].clientKey).toBe("exact-row");
  expect(payload.lineup[0].selectedStreamId).toBe("vrcdn:aurora");
});

test("legacy fixture allocates unique identities across repeated inserted saves @fixture", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "legacy", slug: "legacy", title: "Legacy night", startAt: Date.UTC(2027,9,15,20), endAt: Date.UTC(2027,9,16,0), timezone: "UTC", status: "scheduled", communitySlug: "afterglow", publicationState: "draft",
    source: { sourceType: "community", label: "Afterglow" }, mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [], preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [],
  })));
  await page.goto("/playwright/event-lineup?editor");
  await nav(page, "Lineup"); await page.getByLabel("Slots", { exact: true }).fill("1"); await page.getByRole("button", { name: "Generate", exact: true }).click();
  const save = async () => { await nav(page, "Review"); await page.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled(); };
  const insert = async () => { await nav(page, "Lineup"); await page.getByRole("button", { name: "Add slot at position 2", exact: true }).click(); await page.getByRole("button", { name: "Insert slot", exact: true }).click(); };
  await save(); await insert(); await save();
  const firstIds: string[] = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1")!).slots.map((slot: { playbackKey: string }) => slot.playbackKey));
  await insert(); await save();
  const nextIds: string[] = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1")!).slots.map((slot: { playbackKey: string }) => slot.playbackKey));
  expect(new Set(nextIds).size).toBe(3);
  expect(nextIds[0]).toBe(firstIds[0]); expect(nextIds[2]).toBe(firstIds[1]);
  await save();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1")!).slots.map((slot: { playbackKey: string }) => slot.playbackKey))).toEqual(nextIds);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).lineup.map((row: { clientKey: string }) => row.clientKey))).toEqual(await page.locator("[data-lineup-row]").evaluateAll(rows => rows.map(row => row.getAttribute("data-lineup-row"))));
});


test("canonical scheduling requests surviving-match preservation on every save @fixture", async ({ page }) => {
  await canonicalStaff(page);
  page.on("dialog", dialog => dialog.accept());
  await page.getByLabel("Ends (optional)", { exact: true }).fill("2027-10-16T00:00");
  const save = async () => {
    await page.evaluate(() => localStorage.removeItem("event-lineup-fixture-v1-submission"));
    await nav(page, "Review");
    await page.getByRole("button", { name: /^(Unpublish and save draft|Save draft)$/ }).click();
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
    const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
    expect(payload.preserveLineupConfirmation).toBe(true);
    expect(payload.lineup.some((row: { clientKey: string; personSlug?: string }) => row.clientKey === "exact-row" && row.personSlug === "aurora")).toBe(true);
  };
  await nav(page, "Lineup");
  const duration = page.locator('[data-lineup-row]').first().getByLabel("Duration", { exact: true });
  await duration.fill("45"); await duration.press("Enter");
  await save(); await save();
  await nav(page, "Lineup");
  await page.getByRole("button", { name: "Add slot at position 1", exact: true }).click();
  await page.getByRole("button", { name: "Insert slot", exact: true }).click();
  await save();
  await nav(page, "Lineup");
  await page.locator('[data-lineup-row]').first().getByRole("button", { name: "Remove slot", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove slot", exact: true }).click();
  await save();
  await nav(page, "Details"); await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:15");
  await save(); await save();
});

for (const editor of ["staff", "intake"]) test(`${editor} retains the last start through a timezone change while Starts is empty @fixture`, async ({ page }) => {
  if (editor === "staff") await canonicalStaff(page);
  else await intake(page, { end: { time: "21:00" }, lineup: [{ clientKey: "a", position: 0, performerLabel: "A", start: { time: "20:00" }, end: { time: "21:00" } }] });
  await page.getByLabel("Starts", { exact: true }).fill("");
  await page.getByRole("button", { name: "Time zone", exact: true }).click();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("Tokyo");
  await page.getByRole("option").first().click();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:15");
  await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row]')).toContainText("20:15");
  await nav(page, "Details");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:30");
  await nav(page, "Lineup");
  await expect(page.locator('[data-lineup-row]')).toContainText("20:30");
  await nav(page, "Review");
  await page.getByRole("button", { name: editor === "staff" ? "Save changes" : "Save draft", exact: true }).click();
  if (editor === "staff") {
    const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
    expect(payload.lineup[0].startAt).toBe(Date.UTC(2027, 9, 15, 11, 30));
    expect(payload.lineup[0].endAt).toBe(Date.UTC(2027, 9, 15, 12, 30, 20, 333));
  } else {
    const payload = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!));
    expect(payload.lineup[0].start).toEqual({ time: "11:30", dayOffset: 0 });
  }
});

for (const editor of ["staff", "intake"]) test(`${editor} rejected durations remain pending until cancellation restores committed timing @fixture`, async ({ page }, testInfo) => {
  if (editor === "staff") await canonicalStaff(page);
  else await intake(page, { lineup: [{ clientKey: "a", position: 0, performerLabel: "A", start: { time: "20:00" }, end: { time: "21:00" } }] });
  await nav(page, "Lineup");
  const duration = page.locator('[data-lineup-row]').first().getByLabel("Duration", { exact: true });
  const committed = editor === "staff" ? String(3_620_333 / 60_000) : "60";
  for (const invalid of ["", "   ", "45.5", "0", "abc"]) {
    await duration.fill(invalid); await duration.press("Enter");
    await expect(duration).toHaveValue(invalid);
    await duration.press("Tab");
    await expect(duration).toHaveValue(invalid);
    await expect(page.locator("form[data-event-dirty]")).toHaveAttribute("data-event-dirty", "true");
    await duration.press("Escape");
    await expect(duration).toHaveValue(committed);
    await expect(page.locator("form[data-event-dirty]")).toHaveAttribute("data-event-dirty", "false");
  }
  await duration.fill("45"); await duration.press("Escape"); await duration.press("Tab");
  await expect(duration).toHaveValue(committed);
  await duration.fill("45"); await duration.press("Enter"); await duration.press("Tab");
  await expect(duration).toHaveValue("45");
  await expect(page.locator('[data-lineup-row]').first()).toContainText("20:45");
  await page.screenshot({ path: testInfo.outputPath(`${editor}-rejected-duration.png`), fullPage: true });
});

test("advanced known duration commits one cascade and preserves precise clocks until edited @fixture", async ({ page }, testInfo) => {
  await canonicalStaff(page); await nav(page, "Lineup");
  await page.getByRole("button", { name: "Add slot at position 2", exact: true }).click();
  await page.getByRole("button", { name: "Insert slot", exact: true }).click();
  const rows = page.locator('[data-lineup-row]');
  await choosePerformer(rows.nth(1), "Lumen");
  await rows.first().locator("summary").filter({ hasText: "Details" }).click();
  const duration = rows.first().getByLabel("Slot duration minutes", { exact: true });
  await duration.focus(); await duration.press("Tab");
  await expect(rows.first().getByLabel("Duration", { exact: true })).toHaveValue(String(3_620_333 / 60_000));
  await duration.fill("45");
  await expect(rows.first().getByLabel("Duration", { exact: true })).toHaveValue(String(3_620_333 / 60_000));
  await expect(rows.nth(1)).toContainText("21:00:30.456");
  await duration.press("Enter"); await duration.press("Tab");
  await expect(rows.nth(1)).toContainText("20:45:10.123");
  await expect(rows.first().getByLabel("Duration", { exact: true })).toHaveValue("45");
  await page.screenshot({ path: testInfo.outputPath("advanced-duration.png"), fullPage: true });
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).first().click();
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup[1].startAt).toBe(Date.UTC(2027, 9, 15, 20, 45, 10, 123));
  expect(payload.lineup[0].selectedStreamId).toBe("vrcdn:aurora");
});

test("advanced partial duration establishes an end only on explicit commit @fixture", async ({ page }) => {
  await canonicalStaff(page, true); await nav(page, "Lineup");
  const row = page.locator('[data-lineup-row]').first();
  await expect(row.getByLabel("Duration", { exact: true })).toBeDisabled();
  await row.locator("summary").filter({ hasText: "Details" }).click();
  const duration = row.getByLabel("Slot duration minutes", { exact: true });
  await duration.fill("45");
  await expect(row.getByLabel("Duration", { exact: true })).toBeDisabled();
  await duration.press("Enter"); await duration.press("Tab");
  await expect(row.getByLabel("Duration", { exact: true })).toHaveValue("45");
  await expect(row).toContainText("20:45:10.123");
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup[0].endAt).toBe(Date.UTC(2027, 9, 15, 20, 45, 10, 123));
});

test("unresolved offset recovery preserves exact duration through untouched, rejected and cancelled commits @fixture", async ({ page }) => {
  await canonicalStaff(page); await nav(page, "Lineup");
  await page.locator('[data-lineup-row] summary').filter({ hasText: "Details" }).click();
  const offset = page.getByLabel("Slot offset minutes", { exact: true });
  const duration = page.getByLabel("Slot duration minutes", { exact: true });
  for (const action of ["untouched blur", "untouched Enter", "invalid", "cancelled"]) {
    await offset.fill("bad");
    await expect(page.getByLabel("Duration", { exact: true })).toBeDisabled();
    await duration.focus();
    if (action === "invalid") await duration.fill("45.5");
    if (action === "cancelled") { await duration.fill("45"); await duration.press("Escape"); }
    if (action !== "untouched blur") await duration.press("Enter");
    await duration.press("Tab");
    await offset.fill("15");
    await expect(page.getByLabel("Duration", { exact: true })).toHaveValue(String(3_620_333 / 60_000));
  }
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).first().click();
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup[0].startAt).toBe(Date.UTC(2027, 9, 15, 20, 15, 10, 123));
  expect(payload.lineup[0].endAt).toBe(Date.UTC(2027, 9, 15, 21, 15, 30, 456));
});

for (const minutes of [45, 60]) test(`unresolved offset accepts an explicit ${minutes}-minute duration before recovery @fixture`, async ({ page }) => {
  await canonicalStaff(page); await nav(page, "Lineup");
  await page.locator('[data-lineup-row] summary').filter({ hasText: "Details" }).click();
  const offset = page.getByLabel("Slot offset minutes", { exact: true });
  const duration = page.getByLabel("Slot duration minutes", { exact: true });
  await offset.fill("bad");
  await duration.fill(""); await duration.fill(String(minutes));
  await duration.press("Enter"); await duration.press("Tab");
  await offset.fill("15");
  await expect(page.getByLabel("Duration", { exact: true })).toHaveValue(String(minutes));
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).first().click();
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup[0].startAt).toBe(Date.UTC(2027, 9, 15, 20, 15, 10, 123));
  expect(payload.lineup[0].endAt).toBe(minutes === 45 ? Date.UTC(2027, 9, 15, 21, 0, 10, 123) : Date.UTC(2027, 9, 15, 21, 15, 10, 123));
});

for (const canonical of [true, false]) test(`${canonical ? "canonical" : "legacy"} staff clears only a slot end and preserves rows through two saves @fixture`, async ({ page }) => {
  await page.addInitScript(canonical => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "clear-end", slug: "clear-end", title: "Clear end night", usesCanonicalLineup: canonical,
    startAt: Date.UTC(2027, 9, 15, 20, 0, 10, 123), endAt: Date.UTC(2027, 9, 15, 21), timezone: "UTC", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "draft_private",
    source: { sourceType: canonical ? "contributor" : "community", label: "Original source" }, watchSurfaceEnabled: true, watchMode: "performer_sequence",
    mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], lineup: [],
    slots: [
      { clientKey: canonical ? "exact-row" : undefined, playbackKey: "stored-exact", position: 0, startAt: Date.UTC(2027, 9, 15, 20, 0, 10, 123), endAt: Date.UTC(2027, 9, 15, 21, 0, 30, 456), displayLabel: "Aurora", roleLabel: "DJ", performer: { slug: "aurora", displayName: "Aurora", trustLabel: "claimed_verified" }, source: { sourceType: "community", label: "Slot source" }, selectedStreamId: "vrcdn:aurora" },
      { clientKey: canonical ? "later-row" : undefined, playbackKey: "stored-later", position: 1, startAt: Date.UTC(2027, 9, 15, 21, 15, 30, 456), endAt: Date.UTC(2027, 9, 15, 22, 15, 30, 456), displayLabel: "Lumen", roleLabel: "DJ", performer: { slug: "lumen", displayName: "Lumen", trustLabel: "claimed_verified" }, source: { sourceType: "community", label: "Later source" } },
    ], preservedParticipantAssociationIds: ["protected-person"], preservedSlotAssociationIds: ["stored-exact", "stored-later"], preservedWorldAssociationIds: [],
  })), canonical);
  await page.goto("/playwright/event-lineup?editor"); await nav(page, "Lineup");
  const rows = page.locator('[data-lineup-row]');
  const firstKey = await rows.first().getAttribute("data-lineup-row");
  await rows.first().locator("summary").filter({ hasText: "Details" }).click();
  const duration = rows.first().getByLabel("Slot duration minutes", { exact: true });
  await duration.fill(""); await duration.press("Escape"); await duration.press("Tab");
  await expect(duration).toHaveValue(String(3_620_333 / 60_000));
  await duration.fill("");
  if (canonical) await duration.press("Enter");
  await duration.press("Tab");
  await expect(duration).toHaveValue("");
  await expect(rows.first().getByLabel("Duration", { exact: true })).toBeDisabled();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute("data-lineup-row", firstKey!);
  await expect(rows.nth(1)).toContainText("21:15:30.456 - 22:15:30.456");
  await expect(page.getByText("The lineup ends after the event.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Set event end to lineup end", exact: true })).toHaveCount(0);
  await duration.focus(); await duration.press("Enter"); await duration.press("Tab");
  await nav(page, "Details");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2027-10-15T21:00");
  await page.getByLabel("Ends (optional)", { exact: true }).fill("2027-10-15T22:30");
  for (const count of [1, 2]) {
    await nav(page, "Review"); await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Number(localStorage.getItem("event-lineup-fixture-command-count")))).toBe(count);
    const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
    const saved = payload.lineup;
    expect(saved).toHaveLength(2);
    expect(saved[0].endAt).toBeUndefined();
    expect(saved[0].startAt).toBe(Date.UTC(2027, 9, 15, 20, 0, 10, 123));
    expect(saved[0].personSlug).toBe("aurora");
    expect(saved[0].selectedStreamId).toBe("vrcdn:aurora");
    expect(saved[1].startAt).toBe(Date.UTC(2027, 9, 15, 21, 15, 30, 456));
    expect(saved[1].endAt).toBe(Date.UTC(2027, 9, 15, 22, 15, 30, 456));
    expect(payload.endAt).toBe(Date.UTC(2027, 9, 15, 22, 30));
    if (canonical) expect(saved[0].clientKey).toBe("exact-row");
    else expect(saved[0].clientKey).toBe("stored-exact");
  }
});

test("clearing an end drops its precise duration backup and leaves automatic event end unknown @fixture", async ({ page }) => {
  await canonicalStaff(page); await nav(page, "Lineup");
  const row = page.locator('[data-lineup-row]');
  await row.locator("summary").filter({ hasText: "Details" }).click();
  const offset = page.getByLabel("Slot offset minutes", { exact: true });
  const duration = page.getByLabel("Slot duration minutes", { exact: true });
  await offset.fill("bad");
  await duration.fill(""); await duration.press("Tab");
  await offset.fill("15");
  await expect(row.getByLabel("Duration", { exact: true })).toBeDisabled();
  await expect(duration).toHaveValue("");
  await nav(page, "Details");
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await page.getByLabel("Ends (optional)", { exact: true }).fill("");
  await nav(page, "Lineup");
  await expect(page.getByLabel("Duration", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Set event end to lineup end", exact: true })).toHaveCount(0);
  await nav(page, "Review"); await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup[0].startAt).toBe(Date.UTC(2027, 9, 15, 20, 15, 10, 123));
  expect(payload.lineup[0].endAt).toBeUndefined();
  expect(payload.endAt).toBeNull();
});
