import { expect, test, type Page } from "@playwright/test";

const step = async (page: Page, name: string) => {
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  const button = page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "step");
};
const selectCommunity = async (page: Page, slug: string) => {
  const selected = page.getByRole("group", { name: "Selected community", exact: true });
  if (await selected.isVisible()) await selected.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("combobox", { name: "Community", exact: true }).fill(slug);
  await page.getByRole("option", { name: slug === "afterglow" ? /^Afterglow afterglow$/ : /Afterglow Social.*playwright-afterglow-social/ }).click();
};
const openImport = async (page: Page) => {
  await page.getByRole("button", { name: "Import poster or text", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Import event info" })).toBeVisible();
};
const upload = "public/test-media/event-poster.png";

test("loaded Time TBA draft clears hidden times without restoring them @flow @fixture", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { communitySlug: "afterglow", title: "Date only", eventDate: "2027-10-15", timeTba: true, timezone: "UTC", start: { time: "23:00" }, end: { time: "22:00" } } })));
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await expect(page.getByLabel("Time TBA", { exact: true })).toBeChecked();
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("");
  await page.getByLabel("Time TBA", { exact: true }).check();
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveCount(0);
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-published")!))).toMatchObject({ timeTba: true, start: null, end: null });
});

test("incomplete draft bypasses native date and publish ordering validation @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
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
  expect(saved.timezone).toBeUndefined();
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
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Time TBA", exact: true }).check();
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer", exact: true }).click();
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Performer", exact: true })).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
  await page.screenshot({ path: info.outputPath("blank-performer-focus.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("textbox", { name: "Performer", exact: true }).fill("  ");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Performer", exact: true })).toBeFocused();
  await page.getByLabel("Person profile", { exact: true }).fill("aurora");
  for (const blankName of ["", "  "]) {
    await page.getByRole("textbox", { name: "Performer", exact: true }).fill(blankName);
    await step(page, "Review");
    await page.getByRole("button", { name: "Publish event", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Performer", exact: true })).toBeFocused();
    expect(await page.evaluate(() => sessionStorage.getItem("fixture-published"))).toBeNull();
  }
  await page.screenshot({ path: info.outputPath("selected-profile-name-focus.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("textbox", { name: "Performer", exact: true }).fill("Aurora");
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
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Time TBA", exact: true }).check();
  await page.screenshot({ path: info.outputPath("details.png"), fullPage: true, animations: "disabled" });
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer" }).click();
  await page.getByRole("textbox", { name: "Performer", exact: true }).fill("Guest DJ");
  await expect(page.getByRole("img", { name: "Guest DJ" })).toBeVisible();
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
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer" }).click();
  await page.getByRole("textbox", { name: "Performer", exact: true }).fill("Aurora");
  await page.getByLabel("Person profile", { exact: true }).fill("aurora");
  await expect(page.getByRole("img", { name: "Aurora", exact: true }).locator("img")).toHaveAttribute("src", "/test-media/event-poster.png");
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
  await expect(page.getByLabel("Community", { exact: true })).toBeFocused();
  await page.getByLabel("Event title", { exact: true }).fill("Repeated hour");
  await selectCommunity(page, "afterglow");
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-11-07");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
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
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.start.occurrence)).toBe("later");
});

test("similar events appear only when publish preflight returns a match @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=duplicates");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("Afterglow Night");
  await selectCommunity(page, "afterglow");
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Time TBA", exact: true }).check();
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
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-15");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await page.getByLabel("Starts", { exact: true }).fill("2027-10-16T00:30");
  await step(page, "Review");
  await expect(page.locator('[data-step="Review"]')).toContainText("2027-10-16");
  await expect(page.locator('[data-step="Review"]')).not.toContainText("2027-10-15");
  await expect(page.getByRole("complementary", { name: "Event preview" })).toContainText("2027-10-16");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("review-start-date.png"), fullPage: true, animations: "disabled" });
});


test("publish focuses invalid lineup time and hidden native field @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await openImport(page);
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("Spring event");
  await selectCommunity(page, "afterglow");
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-03-14");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("America/New_York");
  await page.getByRole("option").first().click();
  await page.getByLabel("Starts", { exact: true }).fill("2027-03-14T01:00");
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer" }).click();
  await page.getByRole("textbox", { name: "Performer", exact: true }).fill("Guest DJ");
  await page.getByLabel("Slot 1 start", { exact: true }).fill("2027-03-14T02:30");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toBeFocused();
  await step(page, "Details");
  await page.getByLabel("Source URL", { exact: true }).fill("invalid-url");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Source URL", { exact: true })).toBeFocused();
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
      if (String(input) === "/api/event-intake" && JSON.parse(String(init?.body)).operation === "extract") return Response.json({ event: { title: null, communitySlug: null, eventDate: "2026-10-11", start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null }, lineup: [], evidence: [], questions: [] });
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
  await page.getByLabel("Time TBA", { exact: true }).check();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-11");
});

test("Time TBA restores only surviving lineup keys and reload discards the backup @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.evaluate(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { eventDate: "2026-10-10", start: { time: "23:00" }, end: { time: "02:00", dayOffset: 1 }, lineup: [{ clientKey: "first", position: 0, performerLabel: "First", start: { time: "23:30" } }, { clientKey: "second", position: 1, performerLabel: "Second", start: { time: "01:00", dayOffset: 1 } }] } })));
  await page.goto("/playwright/event-intake?source=text");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeVisible();
  await page.getByLabel("Time TBA", { exact: true }).check();
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Remove slot", exact: true }).first().click();
  await page.getByRole("button", { name: "Add performer", exact: true }).click();
  await page.getByRole("textbox", { name: "Performer", exact: true }).nth(1).fill("New performer");
  await step(page, "Details");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await step(page, "Lineup");
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("2026-10-11T01:00");
  await expect(page.getByLabel("Slot 2 start", { exact: true })).toHaveValue("");
  await step(page, "Details");
  await page.getByLabel("Time TBA", { exact: true }).check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  const fields = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields);
  expect(fields).toMatchObject({ eventDate: "2026-10-10", timeTba: true, start: null, end: null });
  expect(fields.lineup).toHaveLength(2);
  expect(fields.lineup.map((row: { clientKey: string; start: unknown; end: unknown }) => ({ clientKey: row.clientKey, start: row.start, end: row.end ?? null }))).toEqual([{ clientKey: "second", start: null, end: null }, { clientKey: expect.any(String), start: null, end: null }]);
  await page.goto("/playwright/event-intake?source=text");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-10");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("");
  await step(page, "Lineup");
  await expect(page.getByLabel("Slot 1 start", { exact: true })).toHaveValue("");
});

test.describe("event timezone differs from browser timezone", () => {
  test.use({ timezoneId: "Pacific/Honolulu" });
  test("unchanged later occurrence survives resume and title edits @flow @fixture", async ({ page }) => {
    await page.goto("/playwright/event-intake?source=text");
    await page.evaluate(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { communitySlug: "afterglow", title: "Repeated hour", eventDate: "2026-11-01", timezone: "America/New_York", start: { time: "01:30", occurrence: "later" }, end: { time: "02:30" } } })));
    await page.goto("/playwright/event-intake?source=text");
    await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-11-01T01:30");
    await expect(page.getByLabel("Starts occurrence", { exact: true })).toHaveValue("later");
    await page.getByLabel("Event title", { exact: true }).fill("Edited title");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved");
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.start)).toEqual({ time: "01:30", occurrence: "later" });
    await page.goto("/playwright/event-intake?source=text");
    await expect(page.getByLabel("Starts occurrence", { exact: true })).toHaveValue("later");
    await page.getByLabel("Starts", { exact: true }).fill("2026-11-01T01:45");
    await expect(page.getByLabel("Starts occurrence", { exact: true })).toHaveValue("");
    await page.getByLabel("Starts occurrence", { exact: true }).selectOption("later");
    await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("UTC");
    await page.getByRole("option", { name: /^UTC / }).click();
    await expect(page.getByLabel("Starts occurrence", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved");
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.start.occurrence)).toBeUndefined();
  });
});


for (const method of ["suggestion", "picker"] as const) {
  test(`${method} timezone edit clears remembered repeated-hour choices under Time TBA @flow @fixture`, async ({ page }) => {
    await page.goto("/playwright/event-intake?source=text");
    await page.evaluate(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: {
      communitySlug: "afterglow", title: "Repeated hour", eventDate: "2026-11-01", timezone: "America/New_York",
      start: { time: "01:30", occurrence: "later" }, end: { time: "01:45", occurrence: "later" }, doors: { time: "01:00", occurrence: "earlier" },
      lineup: [{ clientKey: "remembered", position: 0, performerLabel: "Guest", start: { time: "01:15", occurrence: "later" }, end: { time: "01:30", occurrence: "later" } }],
      tentative: { timezone: "America/Chicago" },
    } })));
    await page.goto("/playwright/event-intake?source=text");
    await expect(page.getByLabel("Starts occurrence", { exact: true })).toHaveValue("later");
    await page.getByLabel("Time TBA", { exact: true }).check();
    if (method === "suggestion") await page.getByRole("button", { name: "Accept Time zone", exact: true }).click();
    else {
      await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("America/Chicago");
      await page.getByRole("option").first().click();
    }
    await expect(page.getByRole("combobox", { name: "Time zone", exact: true })).toHaveValue("America/Chicago");
    await page.getByLabel("Time TBA", { exact: true }).uncheck();
    await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-11-01T01:30");
    for (const label of ["Starts", "Ends (optional)", "Doors open"]) await expect(page.getByLabel(`${label} occurrence`, { exact: true })).toHaveValue("");
    await step(page, "Lineup");
    for (const label of ["Slot 1 start", "Slot 1 end"]) await expect(page.getByLabel(`${label} occurrence`, { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved");
    const fields = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields);
    expect(fields).toMatchObject({ eventDate: "2026-11-01", timezone: "America/Chicago", start: { time: "01:30" }, end: { time: "01:45" }, doors: { time: "01:00" }, lineup: [{ clientKey: "remembered", start: { time: "01:15" }, end: { time: "01:30" } }] });
    expect([fields.start, fields.end, fields.doors, fields.lineup[0].start, fields.lineup[0].end].map((time: { occurrence?: string }) => time.occurrence)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    await step(page, "Review");
    await page.getByRole("button", { name: "Publish event", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Ambiguous local time");
    await expect(page.getByLabel("Starts occurrence", { exact: true })).toBeFocused();
  });
}
