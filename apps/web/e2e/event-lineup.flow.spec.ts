import { expect, test } from "@playwright/test";

test("roster exposes links and copy actions without stream requests", async ({ page }) => {
  const streams: string[] = [];
  page.on("request", request => { if (/vrcdn|\.live\.ts/.test(request.url())) streams.push(request.url()); });
  await page.goto("/playwright/event-lineup");
  await expect(page.getByRole("link", { name: "SoundCloud", exact: true })).toHaveCount(2);
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
  await expect(page.getByRole("link", { name: /^View \/afterglow/ })).toBeVisible();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.watchMode).toBe("performer_sequence");
  expect(payload.slotLinks[2].selectedStreamId).toBe("lumen-visuals");
  expect(payload.slotLinks[3].personSlug).toBeUndefined();
  await page.reload();
  await expect(page.getByLabel("Stream", { exact: true }).nth(2)).toHaveValue("lumen-visuals");
});

test("unavailable choices survive unrelated saves and changing performer clears them", async ({ page }) => {
  await page.goto("/playwright/event-lineup?editor");
  await page.getByLabel("Event title", { exact: true }).fill("Afterglow updated");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("link", { name: /^View \/afterglow/ })).toBeVisible();
  await page.reload();
  const source = page.getByLabel("Stream", { exact: true }).nth(2);
  await expect(source).toHaveValue("removed-source");
  await source.selectOption("");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).slotLinks[2].selectedStreamId)).toBe(null);
  await page.reload();
  await expect(page.getByLabel("Stream", { exact: true }).nth(2)).toHaveValue("");
  await page.getByLabel("Stream", { exact: true }).nth(2).selectOption("lumen-main");
  await page.getByLabel("Person", { exact: true }).nth(2).fill("nova");
  await expect(page.getByLabel("Stream", { exact: true }).nth(2).getByRole("option", { name: "Automatic: nova" })).toHaveCount(1);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).slotLinks[2].personSlug)).toBe("nova");
  await page.reload();
  await expect(page.getByLabel("Person", { exact: true }).nth(2)).toHaveValue("nova");
  await expect(page.getByLabel("Stream", { exact: true }).nth(2)).toHaveValue("");
});

test("roster copy controls work with keyboard without navigating", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/playwright/event-lineup");
  const copy = page.getByRole("button", { name: "Copy PC", exact: true }).first();
  await copy.focus();
  await expect(copy).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("rtspt://stream.vrcdn.live/live/aurora");
  const quest = page.getByRole("button", { name: "Copy Quest", exact: true }).first();
  await quest.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("https://stream.vrcdn.live/live/aurora.live.ts");
  await page.getByRole("button", { name: "Copy Discord", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("nova.fixture");
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
  await expect(page.getByRole("link", { name: /^View \/afterglow/ })).toBeVisible();
  await page.reload();
  await page.locator("summary").filter({ hasText: "Media and links" }).click();
  await expect(page.getByLabel("Watch mode", { exact: true })).toHaveValue("event_stream");
});
