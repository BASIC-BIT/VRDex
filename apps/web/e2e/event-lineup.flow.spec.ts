import { expect, test } from "@playwright/test";

test("staff editor preserves Time TBA and artwork while correcting or removing contributed names", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("event-lineup-fixture-v1")) return;
    localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
      id: "event-contributed", slug: "contributed", title: "Contributed night", scheduleKind: "date_only", eventDate: "2027-10-15",
      venueLabel: "Harbor", status: "scheduled", communitySlug: "afterglow", publicationState: "published",
      source: { sourceType: "contributor", label: "Community-submitted" }, posterImageUrl: "/api/v0/events/event-contributed/artwork/artwork-owned",
      watchSurfaceEnabled: false, watchMode: "event_stream", mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [],
      lineup: [{ key: "guest", position: 0, displayLabel: "Unmatched guest" }],
      preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [],
    }));
  });
  await page.goto("/playwright/event-lineup?editor");
  await expect(page.getByRole("checkbox", { name: "Time TBA", exact: true })).toBeChecked();
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2027-10-15");
  await page.getByLabel("Event title", { exact: true }).fill("Corrected night");
  await page.getByLabel("Venue", { exact: true }).fill("New harbor");
  await page.getByLabel("Performer", { exact: true }).fill("Corrected guest");
  await page.screenshot({ path: testInfo.outputPath("staff-date-only-editor.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/);
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.scheduleKind).toBe("date_only");
  expect(payload.startAt).toBeUndefined();
  expect(payload.venueLabel).toBe("New harbor");
  expect(payload.posterImageUrl).toBe("/api/v0/events/event-contributed/artwork/artwork-owned");
  expect(payload.lineup[0].performerLabel).toBe("Corrected guest");
  await page.goto("/playwright/event-lineup?editor");
  await page.getByRole("button", { name: "Remove performer", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).lineup)).toEqual([]);
  await page.goto("/playwright/event-lineup?editor");
  await page.getByRole("checkbox", { name: "Time TBA", exact: true }).uncheck();
  await page.getByLabel("Start", { exact: true }).fill("2027-10-15T19:00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).scheduleKind)).toBe("timed");
});

test("lineup keeps provider links collapsed without stream requests", async ({ page }) => {
  const streams: string[] = [];
  page.on("request", request => { if (/vrcdn|\.live\.ts/.test(request.url())) streams.push(request.url()); });
  await page.goto("/playwright/event-lineup");
  await expect(page.getByRole("heading", { name: "Lineup", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "SoundCloud", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy PC", exact: true }).first()).not.toBeVisible();
  await expect(page.getByRole("link", { name: "Tickets", exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Repeated Twitch", exact: false })).toHaveCount(0);
  await expect(page.locator("summary", { hasText: /event-only$/ })).not.toBeVisible();
  await page.locator("summary").filter({ hasText: "DJ links" }).click();
  await expect(page.locator("summary", { hasText: /event-only$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Twitch", exact: true })).toHaveCount(1);
  await page.locator("summary").filter({ hasText: "VRCDN · aurora" }).click();
  await expect(page.getByRole("button", { name: "Copy PC", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Private fixture link" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Echo", exact: false })).toHaveCount(1);
  expect(streams).toEqual([]);
});

test("editor submits and reloads selected mode and source", async ({ page }) => {
  await page.goto("/playwright/event-lineup?editor");
  await page.locator("summary").filter({ hasText: "Media and links" }).click();
  await expect(page.getByLabel("Watch mode", { exact: true })).toHaveValue("performer_sequence");
  const sources = page.getByLabel("Stream", { exact: true });
  await expect(sources.nth(2)).toHaveValue("removed-source");
  await sources.nth(2).selectOption("lumen-visuals");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/);
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.watchMode).toBe("performer_sequence");
  expect(payload.slotLinks[2].selectedStreamId).toBe("lumen-visuals");
  expect(payload.slotLinks[3].personSlug).toBeUndefined();
  await page.goto("/playwright/event-lineup?editor");
  await expect(page.getByLabel("Stream", { exact: true }).nth(2)).toHaveValue("lumen-visuals");
});

test("unavailable choices survive unrelated saves and changing performer clears them", async ({ page }) => {
  await page.goto("/playwright/event-lineup?editor");
  await page.getByLabel("Event title", { exact: true }).fill("Afterglow updated");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/);
  await page.goto("/playwright/event-lineup?editor");
  const source = page.getByLabel("Stream", { exact: true }).nth(2);
  await expect(source).toHaveValue("removed-source");
  await source.selectOption("");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).slotLinks[2].selectedStreamId)).toBe(null);
  await page.goto("/playwright/event-lineup?editor");
  await expect(page.getByLabel("Stream", { exact: true }).nth(2)).toHaveValue("");
  await page.getByLabel("Stream", { exact: true }).nth(2).selectOption("lumen-main");
  await page.getByLabel("Person", { exact: true }).nth(2).fill("nova");
  await expect(page.getByLabel("Stream", { exact: true }).nth(2).getByRole("option", { name: "Automatic: nova" })).toHaveCount(1);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).slotLinks[2].personSlug)).toBe("nova");
  await page.reload();
  await expect(page.getByLabel("Person", { exact: true }).nth(2)).toHaveValue("nova");
  await expect(page.getByLabel("Stream", { exact: true }).nth(2)).toHaveValue("");
  await page.getByLabel("Person", { exact: true }).nth(2).fill("");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).slotLinks[2].selectedStreamId)).toBe(null);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).slotLinks[2].personSlug)).toBeUndefined();
});

test("roster copy controls work with keyboard without navigating", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/playwright/event-lineup");
  await page.locator("summary").filter({ hasText: "DJ links" }).click();
  await page.locator("summary").filter({ hasText: "VRCDN · aurora" }).click();
  const copy = page.getByRole("button", { name: "Copy PC", exact: true }).first();
  await copy.focus();
  await expect(copy).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("rtspt://stream.vrcdn.live/live/aurora");
  const quest = page.getByRole("button", { name: "Copy Quest", exact: true }).first();
  await quest.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("https://stream.vrcdn.live/live/aurora.live.ts");
  await expect(page.getByRole("button", { name: "Copy Discord", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/playwright\/event-lineup$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("performer sequence hides output operations and event stream restores them", async ({ page }) => {
  await page.goto("/playwright/event-lineup?editor");
  await page.locator("summary").filter({ hasText: "Media and links" }).click();
  await expect(page.getByRole("heading", { name: "VRCDN output", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Worker status", exact: true })).toHaveCount(0);
  await page.getByLabel("Watch mode", { exact: true }).selectOption("event_stream");
  await expect(page.getByRole("heading", { name: "VRCDN output", exact: true })).toBeVisible();
  await expect(page.getByLabel("Stream", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/);
  await page.goto("/playwright/event-lineup?editor");
  await page.locator("summary").filter({ hasText: "Media and links" }).click();
  await expect(page.getByLabel("Watch mode", { exact: true })).toHaveValue("event_stream");
});
