import { manualPerformer, linkedPerformer } from "./event-performer-helpers";
import { expect, test, type Page } from "@playwright/test";
import { selectEventLocalTime } from "../../../packages/api-contracts/src/event-intake";
import { readIntakeLineupTimings } from "../src/lib/calendar/event-lineup-adapters";

const step = async (page: Page, name: string) => {
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  const button = page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "step");
};
const selectCommunity = async (page: Page, slug: string) => {
  const selected = page.locator('[data-step="Details"] [data-testid="selected-identity"]').first().locator("..");
  if (await selected.isVisible()) await selected.getByRole("button", { name: "Clear community", exact: true }).click();
  await page.getByRole("combobox", { name: "Community", exact: true }).fill(slug);
  await page.getByRole("option", { name: slug === "afterglow" ? /^Afterglow$/ : /^Afterglow Social$/ }).click();
};
const openImport = async (page: Page) => {
  await page.getByRole("button", { name: "Import poster or text", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Import event info" })).toBeVisible();
};
const upload = "public/test-media/event-poster.png";

test("loaded date-only draft clears hidden times and requires an authored start to publish @flow @fixture", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { communitySlug: "afterglow", title: "Date only", eventDate: "2027-10-15", timeTba: true, timezone: "UTC", start: { time: "23:00" }, end: { time: "22:00" } } })));
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await expect(page.getByLabel("Time TBA", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields)).toMatchObject({ timeTba: true, eventDate: "2027-10-15", start: null, end: null });
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-published")!))).toMatchObject({ timeTba: false, start: { time: "20:00", dayOffset: 0 }, end: null });
});

test("incomplete draft bypasses native date and publish ordering validation @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-16T23:00");
  await page.getByText("Add end time", { exact: true }).click();
  await page.getByLabel("Ends (optional)", { exact: true }).fill("2027-10-16T22:00");
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer", exact: true }).click();
  await step(page, "Review");
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields);
  expect(saved).toMatchObject({ eventDate: "2027-10-16", start: { time: "23:00", dayOffset: 0 }, end: { time: "22:00", dayOffset: 0 }, lineup: [{ position: 0 }] });
  expect(saved.title).toBeUndefined();
  expect(saved.timezone).toBe(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2027-10-16T23:00");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2027-10-16T22:00");
});

test("review publish reveals a blank lineup performer @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("Night");
  await selectCommunity(page, "afterglow");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer", exact: true }).click();
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  const performer = page.getByRole("combobox", { name: "Performer", exact: true });
  await expect(performer).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
  await page.screenshot({ path: info.outputPath("blank-performer-focus.png"), fullPage: true, animations: "disabled" });
  for (const query of ["  ", "Aurora"]) {
    await performer.fill(query);
    await step(page, "Review");
    await page.getByRole("button", { name: "Publish event", exact: true }).click();
    await expect(performer).toBeFocused();
    expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
  }
  await linkedPerformer(page.locator("[data-performer-field]").first(), "Aurora");
  await page.locator("summary").filter({ hasText: "Display name as" }).click();
  const billing = page.getByRole("textbox", { name: "Display name as", exact: true });
  await billing.fill("  ");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(billing).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
  await page.screenshot({ path: info.outputPath("selected-profile-name-focus.png"), fullPage: true, animations: "disabled" });
  // Clearing the override intentionally restores the selected profile's name.
  await billing.fill("");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
});

test("manual partial draft survives steps and resume then publishes directly @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("Afterglow Night");
  await selectCommunity(page, "playwright-afterglow-social");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  await page.screenshot({ path: info.outputPath("details.png"), fullPage: true, animations: "disabled" });
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer" }).click();
  await manualPerformer(page.locator("[data-performer-field]").nth(0), "Guest DJ");
  await expect(page.getByRole("textbox", { name: "Performer", exact: true })).toHaveValue("Guest DJ");
  await step(page, "Review");
  await expect(page.getByRole("heading", { name: "Similar events" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("review.png"), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Afterglow Night");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-published")!).lineup[0].performerLabel)).toBe("Guest DJ");
});

test("text and one poster extract together then replacement and removal preserve accepted fields @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Afterglow Night");
  await expect(page.getByLabel("Poster", { exact: true })).not.toHaveAttribute("multiple");
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByAltText("Source poster", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
  await expect(page.getByRole("button", { name: "Use artwork", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("source.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Extract details" }).click();
  await expect(page.getByRole("button", { name: "Accept Event title" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-extraction")!))).toMatchObject({ sourceText: "Afterglow Night", posterAssetId: "poster-1" });
  await page.getByRole("button", { name: "Accept Event title" }).click();
  await openImport(page);
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByAltText("Source poster", { exact: true })).toHaveAttribute("src", /#poster-2$/);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-2$/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.posterSourceId)).toBe("poster-2");
  await step(page, "Details");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Afterglow Night");
  await expect(page.getByText("Source evidence", { exact: true })).toHaveCount(0);
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await expect(page.getByAltText("Source poster", { exact: true })).toHaveAttribute("src", /#poster-2$/);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-2$/);
  await page.getByRole("button", { name: "Remove poster", exact: true }).click();
  await expect(page.getByAltText("Source poster", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveCount(0);
  await step(page, "Details");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Afterglow Night");
});

test("evidence resumes and source edits invalidate suggestions without losing accepted fields @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Original source");
  await page.getByRole("button", { name: "Extract details" }).click();
  await expect(page.getByRole("button", { name: "Accept Event title" })).toBeVisible();
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await page.getByText("Source evidence", { exact: true }).click();
  await expect(page.getByText(/Afterglow Night \(explicit/)).toBeVisible();
  await page.getByRole("button", { name: "Accept Event title" }).click();
  await openImport(page);
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("New source");
  await step(page, "Details");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Afterglow Night");
  await expect(page.getByText("Source evidence", { exact: true })).toHaveCount(0);
  await expect(page.getByText("timezone: Which time zone?", { exact: true })).toHaveCount(0);
});

test("lineup uses local dates across midnight and matched avatars @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T23:00");
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer" }).click();
  await manualPerformer(page.locator("[data-performer-field]").nth(0), "Aurora");
  await linkedPerformer(page.locator("[data-performer-field]").first(), "Aurora");
  await expect(page.locator("[data-performer-field]").getByTestId("selected-identity").locator("img")).toHaveAttribute("src", new URL("/test-media/event-poster.png", page.url()).href);
  await page.locator('[data-lineup-row]').first().locator("summary").filter({ hasText: "Details" }).click();
  await page.getByLabel("Slot 1 start", { exact: true }).fill("2027-10-16T00:30");
  await expect(page.getByText("Day offset", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("lineup.png"), fullPage: true, animations: "disabled" });
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.lineup[0].start)).toEqual({ time: "00:30", dayOffset: 1 });
});

for (const mode of ["stale", "upload-stale"]) test(`${mode} preserves external edits @flow @fixture`, async ({ page }) => {
  await page.goto(`/playwright/event-intake?source=${mode}`);
  await openImport(page);
  if (mode === "stale") {
    await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Original source");
    await page.getByRole("button", { name: "Extract details" }).click();
  } else await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("status")).toContainText("This draft changed elsewhere.");
  if (mode === "upload-stale") {
    await page.getByRole("button", { name: "Retry poster", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("This draft changed elsewhere.");
  }
  await step(page, "Details");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Accept Event title" })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.venueLabel)).toBe("Changed elsewhere");
});

test("review routes missing fields back to details and repeated times require occurrence @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Event title", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Community", exact: true })).toBeFocused();
  await page.getByLabel("Event title", { exact: true }).fill("Repeated hour");
  await selectCommunity(page, "afterglow");
  await page.getByRole("button", { name: "Time zone", exact: true }).click();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("America/New_York");
  await page.getByRole("option").first().click();
  await page.getByLabel("Starts", { exact: true }).fill("2027-11-07T01:30");
  await expect(page.getByLabel("Starts occurrence")).toBeVisible();
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Starts occurrence")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Ambiguous local time");
  await expect(page.getByLabel("Starts occurrence")).toBeFocused();
  await page.getByLabel("Starts occurrence").selectOption("later");
  await expect(page.getByLabel("Starts occurrence")).toHaveValue("later");
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields);
  expect(saved.timezone).toBe("UTC");
  expect(selectEventLocalTime(saved.eventDate, saved.start, saved.timezone)).toBe(Date.UTC(2027, 10, 7, 6, 30));
});

test("similar events appear only when publish preflight returns a match @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=duplicates");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("Afterglow Night");
  await selectCommunity(page, "afterglow");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  await step(page, "Review");
  await expect(page.getByRole("heading", { name: "Similar events" })).toHaveCount(0);
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByRole("link", { name: "Another Afterglow Night" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Different event" }).check();
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
});

test("pending replacement preview never shows old artwork and removal stays empty @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=replacement-delay");
  await openImport(page);
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("button", { name: "Remove poster", exact: true })).toBeEnabled();
  await expect(page.getByAltText("Source poster", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("release-poster-preview")));
  await expect(page.getByAltText("Source poster", { exact: true })).toHaveAttribute("src", /#poster-2$/);
  await page.getByRole("button", { name: "Remove poster", exact: true }).click();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Extract details" })).toBeDisabled();
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await expect(page.getByAltText("Source poster", { exact: true })).toHaveCount(0);
});

test("image-only drafts upload before any manual details @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=image-only");
  await openImport(page);
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByAltText("Source poster", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await openImport(page);
  await page.getByRole("button", { name: "Remove poster", exact: true }).click();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Extract details" })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields)).toMatchObject({posterSourceId:null,posterDeclaration:null});
});


test("lost completion response permits retry with a visible preview and later edits @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=completion-response-lost");
  await openImport(page);
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByAltText("Source poster", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry poster", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("completion-retry.png"), fullPage: true, animations: "disabled" });
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("Edited after completion");
  await openImport(page);
  await page.getByRole("button", { name: "Retry poster", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry poster", exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.title)).toBe("Edited after completion");
});

test("resumed failed artwork keeps the poster preview and completion retry @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=derivative-failure");
  await openImport(page);
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByAltText("Source poster", { exact: true })).toBeVisible();
  await page.goto("/playwright/event-intake?source=derivative-failure");
  await openImport(page);
  await expect(page.getByAltText("Source poster", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry poster", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("resumed-artwork-retry.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Retry poster", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry poster", exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
});

test("unavailable extraction keeps visible feedback and manual continuation @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=poster");
  await openImport(page);
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Extract details" }).click();
  await expect(page.getByRole("status")).toHaveText("Extraction unavailable");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("extraction-unavailable.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByLabel("Event title", { exact: true })).toBeVisible();
  await page.getByLabel("Event title", { exact: true }).fill("Manual event");
});

test("review shows the confirmed start date after midnight @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("After midnight");
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-16T00:30");
  await step(page, "Review");
  await expect(page.locator('[data-step="Review"]')).toContainText("2027-10-16");
  await expect(page.locator('[data-step="Review"]')).not.toContainText("2027-10-15");
  await expect(page.getByRole("complementary", { name: "Event preview" })).toContainText("Oct 16");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("review-start-date.png"), fullPage: true, animations: "disabled" });
});


test("publish focuses invalid lineup time and hidden native field @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("Spring event");
  await selectCommunity(page, "afterglow");
  await page.getByRole("button", { name: "Time zone", exact: true }).click();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("America/New_York");
  await page.getByRole("option").first().click();
  await page.getByLabel("Starts", { exact: true }).fill("2027-03-14T01:00");
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer" }).click();
  await manualPerformer(page.locator("[data-performer-field]").nth(0), "Guest DJ");
  await page.locator('[data-lineup-row]').first().locator("summary").filter({ hasText: "Details" }).click();
  await page.getByLabel("Slot 1 start", { exact: true }).fill("2027-03-14T02:30");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toBeFocused();
  await step(page, "Details");
  await page.locator("summary").filter({ hasText: "Announcement link" }).click();
  await page.getByLabel("Announcement link", { exact: true }).fill("invalid-url");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Announcement link", { exact: true })).toBeFocused();
});


test("three direct stages preserve import text and restore focus after Escape @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  const navigation = page.getByRole("navigation", { name: "Event editor" });
  await expect(navigation.getByRole("button")).toHaveText(["Details", "Lineup", "Review"]);
  await expect(navigation.getByRole("button", { name: "Details", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { name: "Add event", exact: true })).toHaveCount(1);
  const markers = await navigation.evaluate(nav => Array.from(nav.querySelectorAll("button")).map(button => {
    const marker = button.querySelector("svg")!.parentElement!;
    const markerBox = marker.getBoundingClientRect();
    const labelBox = button.lastElementChild!.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const connector = button.parentElement!.querySelector(":scope > span");
    const connectorBox = connector?.getBoundingClientRect();
    return { markerWidth: markerBox.width, markerHeight: markerBox.height, radius: getComputedStyle(marker).borderRadius === "50%" ? markerBox.width / 2 : parseFloat(getComputedStyle(marker).borderRadius), buttonBackground: getComputedStyle(button).backgroundColor, buttonWidth: buttonBox.width, buttonHeight: buttonBox.height, labelBelow: labelBox.top >= markerBox.bottom, connectorOffset: connectorBox ? Math.abs(connectorBox.top + connectorBox.height / 2 - markerBox.top - markerBox.height / 2) : 0 };
  }));
  for (const marker of markers) {
    expect(marker.markerWidth).toBe(44);
    expect(marker.markerHeight).toBe(44);
    expect(marker.radius).toBeGreaterThanOrEqual(marker.markerWidth / 2);
    expect(marker.buttonBackground).toBe("rgba(0, 0, 0, 0)");
    expect(marker.buttonWidth).toBeGreaterThanOrEqual(44);
    expect(marker.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(marker.labelBelow).toBe(true);
    expect(marker.connectorOffset).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath("wizard-markers.png"), fullPage: true, animations: "disabled" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Event title", { exact: true }).fill("Partial event");
  await page.getByLabel("Event title", { exact: true }).press("Enter");
  await expect(navigation.getByRole("button", { name: "Lineup", exact: true })).toHaveAttribute("aria-current", "step");
  await openImport(page);
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Keep this source");
  await page.screenshot({ path: info.outputPath("import-dialog.png"), fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Import poster or text", exact: true })).toBeFocused();
  await expect(navigation.getByRole("button", { name: "Lineup", exact: true })).toHaveAttribute("aria-current", "step");
  await openImport(page);
  await expect(page.getByRole("textbox", { name: "Source text", exact: true })).toHaveValue("Keep this source");
  await page.getByRole("button", { name: "Extract details", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept Event title", exact: true })).toBeFocused();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Partial event");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await step(page, "Review");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "Lineup", exact: true })).toHaveAttribute("aria-current", "step");
});

test("closing during poster completion preserves busy guard and retry state @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=completion-delay");
  await openImport(page);
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("button", { name: "Extract details", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Import poster or text", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await openImport(page);
  await expect(page.getByLabel("Poster", { exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("release-poster-completion")));
  await expect(page.getByRole("button", { name: "Remove poster", exact: true })).toBeEnabled();
  await expect(page.getByAltText("Source poster", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await openImport(page);
  await expect(page.getByRole("button", { name: "Retry poster", exact: true })).toHaveCount(0);
});


test("extraction completed after closing import focuses Details suggestions @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=extraction-delay");
  await step(page, "Lineup");
  await openImport(page);
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Source while closed");
  await page.getByRole("button", { name: "Extract details", exact: true }).click();
  await expect(page.getByLabel("Poster", { exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Import poster or text", exact: true })).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event("release-extraction")));
  await expect(page.getByRole("button", { name: "Accept Event title", exact: true })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});


test("partial combined input saves its base date and date-only extraction stays untimed @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.evaluate(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { eventDate: "2026-10-10", start: { time: "23:00" } } })));
  await page.goto("/playwright/event-intake?source=text");
  await page.getByLabel("Starts", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields)).toMatchObject({ eventDate: "2026-10-10", start: null });
  await openImport(page);
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      if (String(input) === "/api/event-intake" && JSON.parse(String(init?.body)).operation === "extract") return Response.json({ event: { title: null, communitySlug: null, eventDate: "2026-10-11", start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null }, lineup: [], evidence: [], questions: [], decision: { kind: "new" } });
      return original(input, init);
    };
  });
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("October 11 gathering");
  await page.getByRole("button", { name: "Extract details", exact: true }).click();
  await page.getByRole("button", { name: "Accept Date", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields)).toMatchObject({ eventDate: "2026-10-11", start: null });
  await page.goto("/playwright/event-intake?source=text");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("");
  await expect(page.getByRole("complementary", { name: "Event preview" })).toContainText("2026-10-11");
});

test("lineup removal survives resume and later Starts edits without restoring deleted keys @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.evaluate(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { eventDate: "2026-10-10", timezone: "UTC", start: { time: "23:00" }, end: { time: "02:00", dayOffset: 1 }, lineup: [{ clientKey: "first", position: 0, performerLabel: "First", start: { time: "23:30" } }, { clientKey: "second", position: 1, performerLabel: "Second", start: { time: "01:00", dayOffset: 1 } }] } })));
  await page.goto("/playwright/event-intake?source=text");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeVisible();
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Remove slot", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove slot", exact: true }).click();
  await page.getByRole("button", { name: "Add slot at position 2", exact: true }).click();
  await page.getByRole("button", { name: "Add performer", exact: true }).click();
  await manualPerformer(page.locator("[data-performer-field]").nth(1), "New performer");
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("2026-10-11T01:00");
  await expect(page.getByLabel("Slot 2 start", { exact: true })).toHaveValue("");
  await step(page, "Details");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  const fields = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields);
  expect(fields).toMatchObject({ eventDate: "2026-10-10", start: { time: "23:00" }, end: { time: "02:00", dayOffset: 1 } });
  expect(fields.lineup).toHaveLength(2);
  expect(fields.lineup[0]).toMatchObject({ clientKey: "second", start: { time: "01:00", dayOffset: 1 } });
  expect(fields.lineup.some((row: { clientKey: string }) => row.clientKey === "first")).toBe(false);
  await page.goto("/playwright/event-intake?source=text");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-10T23:00");
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-11T00:00");
  await step(page, "Lineup");
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("2026-10-11T02:00");
  await expect(page.getByLabel("Slot 2 start", { exact: true })).toHaveValue("");
  await expect(page.locator('[data-lineup-row="first"]')).toHaveCount(0);
});

test.describe("event timezone differs from browser timezone", () => {
  test.use({ timezoneId: "Pacific/Honolulu" });
  test("unchanged later occurrence survives resume, local edits and display-zone changes @flow @fixture", async ({ page }) => {
    await page.goto("/playwright/event-intake?source=text");
    await page.evaluate(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { communitySlug: "afterglow", title: "Repeated hour", eventDate: "2026-11-01", timezone: "America/New_York", start: { time: "01:30", occurrence: "later" }, end: { time: "02:30" } } })));
    await page.goto("/playwright/event-intake?source=text");
    await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-31T20:30");
    await page.getByLabel("Event title", { exact: true }).fill("Edited title");
    await saveTimingDraft(page);
    expect((await savedTimingDraft(page)).start).toEqual({ time: "01:30", occurrence: "later" });
    await page.goto("/playwright/event-intake?source=text");
    await page.getByLabel("Starts", { exact: true }).fill("2026-10-31T20:45");
    await page.getByRole("button", { name: "Time zone", exact: true }).click();
    await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("UTC");
    await page.getByRole("option", { name: /^UTC(?: |$)/ }).click();
    await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-11-01T06:45");
    await saveTimingDraft(page);
    expect((await savedTimingDraft(page)).start).toEqual({ time: "01:45", dayOffset: 0, occurrence: "later" });
  });
});

for (const method of ["suggestion", "picker"] as const) {
  test(`${method} timezone choice preserves authored instants @flow @fixture`, async ({ page }) => {
    await seedTimingDraft(page, {
      communitySlug: "afterglow", title: "Repeated hour", eventDate: "2026-11-01", timezone: "America/New_York",
      start: { time: "01:30", occurrence: "later" }, end: { time: "01:45", occurrence: "later" }, doors: { time: "01:00", occurrence: "earlier" },
      lineup: [{ clientKey: "remembered", position: 0, performerLabel: "Guest", start: { time: "01:15", occurrence: "later" }, end: { time: "01:30", occurrence: "later" } }],
      tentative: { timezone: "America/Chicago" },
    });
    if (method === "suggestion") await page.getByRole("button", { name: "Accept Time zone", exact: true }).click();
    else {
      await page.getByRole("button", { name: "Time zone", exact: true }).click();
      await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("America/Chicago");
      await page.getByRole("listbox").getByRole("option").first().click();
    }
    await saveTimingDraft(page);
    const fields = await savedTimingDraft(page);
    if (method === "suggestion") {
      expect(fields).toMatchObject({ timezone: "America/Chicago", start: { time: "01:30", occurrence: "earlier" }, end: { time: "01:45", occurrence: "earlier" }, doors: { time: "00:00" } });
    } else {
      expect(fields).toMatchObject({ timezone: "America/New_York", start: { time: "01:30", occurrence: "later" }, end: { time: "01:45", occurrence: "later" }, doors: { time: "01:00", occurrence: "earlier" } });
      await expect(page.getByLabel("Starts occurrence")).toHaveValue("earlier");
    }
  });
}

const seedTimingDraft = async (page: Page, fields: import("../../../packages/api-contracts/src/event-intake").EventIntakePatch) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.evaluate(fields => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields })), fields);
  await page.goto("/playwright/event-intake?source=text");
};
const savedTimingDraft = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields);
const saveTimingDraft = async (page: Page) => {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
};
const extractTimingProposal = async (page: Page, eventDate: string | null = "2026-10-11") => {
  await openImport(page);
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("October 11 overnight lineup");
  await page.evaluate(eventDate => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      if (String(input) === "/api/event-intake" && JSON.parse(String(init?.body)).operation === "extract") return Response.json({
        event: { title: null, communitySlug: null, eventDate, start: "23:00", end: "02:00", startDate: eventDate, endDate: eventDate ? "2026-10-12" : null, timezone: "UTC", venueLabel: null, summary: null, sourceUrl: null },
        lineup: [{ performerLabel: "Proposed guest", personSlug: null, roleLabel: null, start: "00:30", end: "01:30", startDate: eventDate ? "2026-10-12" : null, endDate: eventDate ? "2026-10-12" : null }],
        evidence: [], questions: [], decision: { kind: "new" },
      });
      return original(input, init);
    };
  }, eventDate);
  await page.getByRole("button", { name: "Extract details", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
};
const existingTiming = {
  communitySlug: "afterglow", title: "Current event", eventDate: "2026-10-10", timezone: "UTC",
  start: { time: "20:00" }, end: { time: "21:00" }, doors: { time: "19:00" },
  lineup: [{ clientKey: "unrelated", position: 0, performerLabel: "Existing guest", start: { time: "20:15" }, end: { time: "20:45" } }],
};

test("cleared Starts retains mixed lineup timing through extraction and title acceptance @flow @fixture", async ({ page }) => {
  await seedTimingDraft(page, { ...existingTiming, lineup: [
    { clientKey: "complete", position: 0, performerLabel: "Complete", start: { time: "20:00" }, end: { time: "21:00" } },
    { clientKey: "partial", position: 1, performerLabel: "Partial", start: { time: "20:30" } },
  ] });
  await page.getByLabel("Starts", { exact: true }).fill("");
  await openImport(page);
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Updated title");
  await page.getByRole("button", { name: "Extract details", exact: true }).click();
  await page.getByRole("button", { name: "Accept Event title", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("");
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-10T20:15");
  await step(page, "Lineup");
  await expect(page.locator('[data-lineup-row="complete"]')).toContainText("20:15 - 21:15");
  await expect(page.getByLabel("Slot 2 start", { exact: true })).toHaveValue("2026-10-10T20:45");
  await expect(page.getByLabel("Slot 2 end", { exact: true })).toHaveValue("");
  await saveTimingDraft(page);
  const saved = await savedTimingDraft(page);
  expect(saved.lineup[0]).toMatchObject({ start: null, end: null, relativeTiming: { offsetMinutes: 0, durationMinutes: 60 } });
  expect(readIntakeLineupTimings(saved)).toEqual([
    { key: "complete", startAt: Date.UTC(2026, 9, 10, 20, 15), endAt: Date.UTC(2026, 9, 10, 21, 15) },
    { key: "partial", startAt: Date.UTC(2026, 9, 10, 20, 45) },
  ]);
});

for (const selection of ["Start time", "End time", "Lineup"] as const) {
  for (const order of ["timing first", "date first"] as const) {
    test(`proposal timing keeps calendar dates for ${selection} ${order} @flow @fixture`, async ({ page }) => {
      await seedTimingDraft(page, existingTiming);
      await extractTimingProposal(page);
      if (order === "date first") await page.getByRole("button", { name: "Accept Date", exact: true }).click();
      if (selection === "Lineup") await step(page, "Lineup");
      await page.getByRole("button", { name: `Accept ${selection}`, exact: true }).click();
      const label = selection === "Lineup" ? "Slot 1 start" : selection === "Start time" ? "Starts" : "Ends (optional)";
      const expected = selection === "Lineup" ? "2026-10-12T00:30" : selection === "Start time" ? "2026-10-11T23:00" : "2026-10-12T02:00";
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(expected);
      await step(page, "Details");
      if (order === "timing first") await page.getByRole("button", { name: "Accept Date", exact: true }).click();
      await expect(page.getByLabel("Doors open", { exact: true })).toHaveValue("2026-10-10T19:00");
      if (selection === "Lineup") {
        await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-10T21:00");
        await step(page, "Lineup");
      }
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(expected);
      await saveTimingDraft(page);
      const saved = await savedTimingDraft(page);
      expect(saved.eventDate).toBe("2026-10-11");
      expect(saved.doors).toEqual({ time: "19:00", dayOffset: -1 });
      if (selection === "Start time") expect(saved.start).toEqual({ time: "23:00", dayOffset: 0 });
      if (selection === "End time") expect(saved.end).toEqual({ time: "02:00", dayOffset: 1 });
      if (selection === "Lineup") expect(saved.lineup).toEqual([{ clientKey: "extracted-0", position: 0, performerLabel: "Proposed guest", start: { time: "00:30", dayOffset: 1 }, end: { time: "01:30", dayOffset: 1 } }]);
      else expect(saved.lineup[0]).toMatchObject({ clientKey: "unrelated", start: { time: "20:15", dayOffset: -1 }, end: { time: "20:45", dayOffset: -1 } });
    });
  }
}

for (const resume of [false, true]) {
  test(`proposal timing retains remaining dates after manual Starts edit${resume ? " and resume" : ""} @flow @fixture`, async ({ page }) => {
    await seedTimingDraft(page, { communitySlug: "afterglow", title: "Current event", eventDate: "2026-10-10", timezone: "UTC", start: { time: "20:00" } });
    await extractTimingProposal(page);
    await page.getByRole("button", { name: "Accept Date", exact: true }).click();
    await page.getByLabel("Starts", { exact: true }).fill("2026-10-12T20:00");
    if (resume) {
      await saveTimingDraft(page);
      await page.goto("/playwright/event-intake?source=text");
    }
    await page.getByRole("button", { name: "Accept End time", exact: true }).click();
    await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-12T02:00");
    await step(page, "Lineup");
    await page.getByRole("button", { name: "Accept Lineup", exact: true }).click();
    await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("2026-10-12T00:30");
    await saveTimingDraft(page);
    const saved = await savedTimingDraft(page);
    expect(saved).toMatchObject({ eventDate: "2026-10-12", start: { time: "20:00", dayOffset: 0 }, end: { time: "02:00", dayOffset: 0 }, lineup: [{ start: { time: "00:30", dayOffset: 0 }, end: { time: "01:30", dayOffset: 0 } }] });
  });
}

test("proposal timing guards missing bases and undated clocks without consuming suggestions @flow @fixture", async ({ page }) => {
  await seedTimingDraft(page, { title: "No date", timezone: "UTC" });
  await extractTimingProposal(page);
  await expect(page.getByRole("button", { name: "Accept Start time", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Accept End time", exact: true })).toBeDisabled();
  await step(page, "Lineup");
  await expect(page.getByRole("button", { name: "Accept Lineup", exact: true })).toBeDisabled();
  await saveTimingDraft(page);
  expect((await savedTimingDraft(page)).tentative).toMatchObject({ eventDate: "2026-10-11", end: { time: "02:00", dayOffset: 1 } });
  await step(page, "Details");
  await page.getByRole("button", { name: "Accept Date", exact: true }).click();
  await page.getByRole("button", { name: "Accept End time", exact: true }).click();
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-12T02:00");
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Accept Lineup", exact: true }).click();
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("2026-10-12T00:30");
  await saveTimingDraft(page);
  await seedTimingDraft(page, { eventDate: "2026-10-10", timezone: "UTC" });
  await extractTimingProposal(page, null);
  await expect(page.getByRole("button", { name: "Accept End time", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("");
  await step(page, "Lineup");
  await expect(page.getByRole("button", { name: "Accept Lineup", exact: true })).toBeDisabled();
  await saveTimingDraft(page);
  expect((await savedTimingDraft(page)).tentative).toMatchObject({ end: { time: "02:00" }, lineup: [{ start: { time: "00:30" } }] });
});

for (const eventDate of ["2026-10-03", "2026-10-15"]) {
  test(`proposal timing guards translated offsets outside range at ${eventDate} @flow @fixture`, async ({ page }) => {
    await seedTimingDraft(page, { eventDate, timezone: "UTC", start: { time: "20:00" } });
    await extractTimingProposal(page);
    await expect(page.getByRole("button", { name: "Accept End time", exact: true })).toBeDisabled();
    await step(page, "Lineup");
    await expect(page.getByRole("button", { name: "Accept Lineup", exact: true })).toBeDisabled();
    await saveTimingDraft(page);
    expect((await savedTimingDraft(page)).tentative).toMatchObject({ eventDate: "2026-10-11", end: { time: "02:00", dayOffset: 1 } });
    await step(page, "Details");
    await page.getByRole("button", { name: "Accept Date", exact: true }).click();
    await page.getByRole("button", { name: "Accept End time", exact: true }).click();
    await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-12T02:00");
  });
}

for (const loadedTba of [false, true]) {
  test(`proposal timing survives source edits${loadedTba ? " after migrating a date-only draft" : " in a timed draft"} @flow @fixture`, async ({ page }, info) => {
    await seedTimingDraft(page, { ...existingTiming, timeTba: loadedTba });
    await extractTimingProposal(page);
    await page.getByRole("button", { name: "Accept Start time", exact: true }).click();
    await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-11T23:00");
    await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue(loadedTba ? "" : "2026-10-10T21:00");
    await page.getByRole("button", { name: "Accept End time", exact: true }).click();
    await step(page, "Lineup");
    await page.getByRole("button", { name: "Accept Lineup", exact: true }).click();
    await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("2026-10-12T00:30");
    await expect(page.getByLabel("Slot 1 end", { exact: true })).toHaveValue("2026-10-12T01:30");
    await page.getByRole("button", { name: "Remove slot", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove slot", exact: true }).click();
    await page.getByRole("button", { name: "Add performer", exact: true }).click();
    await manualPerformer(page.locator("[data-performer-field]").nth(0), "New guest");
    await step(page, "Details");
    // Source edits cannot erase accepted timing.
    await page.getByRole("button", { name: "Accept Time zone", exact: true }).click();
    await openImport(page);
    await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Edited source");
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-11T23:00");
    await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-12T02:00");
    await expect(page.getByLabel("Doors open", { exact: true })).toHaveValue(loadedTba ? "" : "2026-10-10T19:00");
    await step(page, "Lineup");
    await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("");
    await step(page, "Details");
    await page.screenshot({ path: info.outputPath("accepted-proposal-timing.png"), fullPage: true, animations: "disabled" });
    await saveTimingDraft(page);
    const saved = await savedTimingDraft(page);
    expect(saved).toMatchObject({ eventDate: "2026-10-11", timezone: "UTC", timeTba: false, start: { time: "23:00", dayOffset: 0 }, end: { time: "02:00", dayOffset: 1 }, lineup: [{ performerLabel: "New guest" }] });
    expect(selectEventLocalTime(saved.eventDate, saved.start, saved.timezone)).toBe(Date.UTC(2026, 9, 11, 23));
    expect(selectEventLocalTime(saved.eventDate, saved.end, saved.timezone)).toBe(Date.UTC(2026, 9, 12, 2));
    await step(page, "Review");
    await page.getByRole("button", { name: "Publish event", exact: true }).click();
    await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-published")!))).toMatchObject({ eventDate: "2026-10-11", timezone: "UTC", timeTba: false, start: { time: "23:00", dayOffset: 0 }, end: { time: "02:00", dayOffset: 1 }, lineup: [{ performerLabel: "New guest" }] });
  });
}

for (const progression of ["click", "Enter"] as const) {
  test(`Continue ${progression} bypasses mounted constraints but Publish focuses invalid controls @flow @fixture`, async ({ page }, info) => {
    await seedTimingDraft(page, { communitySlug: "afterglow", title: "Partial event", eventDate: "2026-10-11", timeTba: true, lineup: [{ clientKey: "blank", position: 0 }] });
    const navigation = page.getByRole("navigation", { name: "Event editor" });
    const advance = async () => {
      const button = page.getByRole("button", { name: "Continue", exact: true });
      if (progression === "click") await button.click();
      else await button.press("Enter");
    };
    await advance();
    await expect(navigation.getByRole("button", { name: "Lineup", exact: true })).toHaveAttribute("aria-current", "step");
    if (progression === "Enter") await page.getByRole("button", { name: "Continue", exact: true }).press("Enter");
    else await advance();
    await expect(navigation.getByRole("button", { name: "Review", exact: true })).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Publish event", exact: true }).click();
    await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
    expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
    await page.getByLabel("Starts", { exact: true }).fill("2026-10-11T20:00");
    await step(page, "Review");
    await page.getByRole("button", { name: "Publish event", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Performer", exact: true })).toBeFocused();
    expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
    await manualPerformer(page.locator("[data-performer-field]").nth(0), "Guest");
    await step(page, "Details");
    await page.locator("summary").filter({ hasText: "Announcement link" }).click();
    await page.getByLabel("Announcement link", { exact: true }).fill("invalid-url");
    await step(page, "Lineup");
    await advance();
    await expect(navigation.getByRole("button", { name: "Review", exact: true })).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Publish event", exact: true }).click();
    await expect(page.getByLabel("Announcement link", { exact: true })).toBeFocused();
    expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
    await page.screenshot({ path: info.outputPath("continue-publish-url-focus.png"), fullPage: true, animations: "disabled" });
  });
}

test("proposal timing timezone acceptance preserves newly accepted instants @flow @fixture", async ({ page }) => {
  await seedTimingDraft(page, {
    communitySlug: "afterglow", title: "Repeated hour proposal", eventDate: "2026-11-01", timezone: "America/New_York", start: { time: "00:30" }, doors: { time: "01:00", occurrence: "earlier" },
    tentative: { eventDate: "2026-11-01", start: { time: "01:15", dayOffset: 0, occurrence: "later" }, end: { time: "01:45", dayOffset: 0, occurrence: "later" },
      lineup: [{ clientKey: "new-proposal", position: 0, performerLabel: "Guest", start: { time: "01:20", dayOffset: 0, occurrence: "later" }, end: { time: "01:40", dayOffset: 0, occurrence: "later" } }],
      timezone: "America/Chicago" },
  });
  await page.getByRole("button", { name: "Accept Start time", exact: true }).click();
  await page.getByRole("button", { name: "Accept End time", exact: true }).click();
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Accept Lineup", exact: true }).click();
  await step(page, "Details");
  await page.getByRole("button", { name: "Accept Time zone", exact: true }).click();
  await saveTimingDraft(page);
  const saved = await savedTimingDraft(page);
  expect(saved).toMatchObject({ timezone: "America/Chicago", start: { time: "01:15", dayOffset: 0, occurrence: "later" }, end: { time: "01:45", dayOffset: 0, occurrence: "later" }, lineup: [{ clientKey: "new-proposal", start: { time: "01:20", dayOffset: 0, occurrence: "later" }, end: { time: "01:40", dayOffset: 0, occurrence: "later" } }] });
  expect(saved.doors).toEqual({ time: "00:00", dayOffset: 0 });
});

test("proposal date acceptance after a Starts edit shifts lineup once and preserves fixed ends and doors @flow @fixture", async ({ page }) => {
  await seedTimingDraft(page, { ...existingTiming, tentative: { title: "Proposed title", eventDate: "2026-10-11" } });
  await page.getByRole("button", { name: "Accept Event title", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-10T20:00");
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-11T20:00");
  await page.getByRole("button", { name: "Accept Date", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-11T20:00");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-10T21:00");
  await expect(page.getByLabel("Doors open", { exact: true })).toHaveValue("2026-10-10T19:00");
  await step(page, "Lineup");
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("2026-10-11T20:15");
  await saveTimingDraft(page);
  expect(await savedTimingDraft(page)).toMatchObject({ eventDate: "2026-10-11", title: "Proposed title", start: { time: "20:00", dayOffset: 0 }, end: { time: "21:00", dayOffset: -1 }, lineup: [{ clientKey: "unrelated", start: { time: "20:15", dayOffset: 0 } }] });
});
