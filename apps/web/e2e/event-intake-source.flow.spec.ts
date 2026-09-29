import { expect, test, type Page } from "@playwright/test";

const step = async (page: Page, name: string) => {
  const button = page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "step");
};
const upload = "public/test-media/event-poster.png";

test("manual partial draft survives steps and resume then publishes directly @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("Afterglow Night");
  await page.getByLabel("Community", { exact: true }).fill("playwright-afterglow-social");
  await page.getByLabel("Date", { exact: true }).fill("2027-10-15");
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
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.goto("/playwright/event-intake?source=text");
  await step(page, "Details");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Afterglow Night");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-published")!).lineup[0].performerLabel)).toBe("Guest DJ");
});

test("text and ordered images extract together with automatic art, primary switch and removal @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Afterglow Night");
  await page.getByLabel("Poster", { exact: true }).setInputFiles([upload, upload]);
  await expect(page.getByAltText("Source poster 1", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Source poster 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
  await page.screenshot({ path: info.outputPath("source.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Extract details" }).click();
  await expect(page.getByRole("button", { name: "Accept Event title" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-extraction")!))).toMatchObject({ sourceText: "Afterglow Night", posterAssetIds: ["poster-1", "poster-2"] });
  await page.getByRole("button", { name: "Accept Event title" }).click();
  await step(page, "Source");
  await page.getByRole("button", { name: "Use image 2 as artwork" }).click();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-2$/);
  await page.getByRole("button", { name: "Remove image 2" }).click();
  await expect(page.getByAltText("Source poster 2", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
  await step(page, "Details");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Afterglow Night");
  await expect(page.getByText("Source evidence", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.goto("/playwright/event-intake?source=text");
  await expect(page.getByAltText("Source poster 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
});

test("evidence resumes and source edits invalidate suggestions without losing accepted fields @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Original source");
  await page.getByRole("button", { name: "Extract details" }).click();
  await expect(page.getByRole("button", { name: "Accept Event title" })).toBeVisible();
  await page.goto("/playwright/event-intake?source=text");
  await step(page, "Details");
  await page.getByText("Source evidence", { exact: true }).click();
  await expect(page.getByText(/Afterglow Night \(explicit/)).toBeVisible();
  await page.getByRole("button", { name: "Accept Event title" }).click();
  await step(page, "Source");
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("New source");
  await step(page, "Details");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Afterglow Night");
  await expect(page.getByText("Source evidence", { exact: true })).toHaveCount(0);
  await expect(page.getByText("timezone: Which time zone?", { exact: true })).toHaveCount(0);
});

test("lineup uses local dates across midnight and matched avatars @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await step(page, "Details");
  await page.getByLabel("Date", { exact: true }).fill("2027-10-15");
  await step(page, "Lineup");
  await page.getByRole("button", { name: "Add performer" }).click();
  await page.getByRole("textbox", { name: "Performer", exact: true }).fill("Aurora");
  await page.getByLabel("Person profile", { exact: true }).fill("aurora");
  await expect(page.getByRole("img", { name: "Aurora", exact: true }).locator("img")).toHaveAttribute("src", "/test-media/event-poster.png");
  await page.getByLabel("Slot 1 start", { exact: true }).fill("00:30");
  await page.getByLabel("Slot 1 start date", { exact: true }).fill("2027-10-16");
  await expect(page.getByText("Day offset", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("lineup.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.lineup[0].start)).toEqual({ time: "00:30", dayOffset: 1 });
});

for (const mode of ["stale", "upload-stale"]) test(`${mode} preserves external edits @flow @fixture`, async ({ page }) => {
  await page.goto(`/playwright/event-intake?source=${mode}`);
  if (mode === "stale") {
    await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Original source");
    await page.getByRole("button", { name: "Extract details" }).click();
  } else await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("status")).toContainText("This draft changed elsewhere.");
  await step(page, "Details");
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Accept Event title" })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.venueLabel)).toBe("Changed elsewhere");
});

test("removing a secondary image preserves the explicit primary @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.getByLabel("Poster", { exact: true }).setInputFiles([upload, upload, upload]);
  await expect(page.getByAltText("Source poster 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use image 3 as artwork" }).click();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-3$/);
  await page.getByRole("button", { name: "Remove image 2" }).click();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-3$/);
});

test("review routes missing fields back to details and repeated times require occurrence @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Event title", { exact: true })).toBeVisible();
  await page.getByLabel("Event title", { exact: true }).fill("Repeated hour");
  await page.getByLabel("Community", { exact: true }).fill("afterglow");
  await page.getByLabel("Date", { exact: true }).fill("2027-11-07");
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("America/New_York");
  await page.getByRole("option").first().click();
  await page.getByLabel("Start time", { exact: true }).fill("01:30");
  await expect(page.getByLabel("Start time occurrence")).toBeVisible();
  await step(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByLabel("Start time occurrence")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Ambiguous local time");
  await page.getByLabel("Start time occurrence").selectOption("later");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.start.occurrence)).toBe("later");
});

test("similar events appear only when publish preflight returns a match @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=duplicates");
  await step(page, "Details");
  await page.getByLabel("Event title", { exact: true }).fill("Afterglow Night");
  await page.getByLabel("Community", { exact: true }).fill("afterglow");
  await page.getByLabel("Date", { exact: true }).fill("2027-10-15");
  await page.getByRole("checkbox", { name: "Time TBA", exact: true }).check();
  await step(page, "Review");
  await expect(page.getByRole("heading", { name: "Similar events" })).toHaveCount(0);
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByRole("link", { name: "Another Afterglow Night" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Different event" }).check();
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
});

test("pending preview cannot choose the wrong image and removing all sources clears artwork @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=replacement-delay");
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByRole("button", { name: "Use image 2 as artwork" })).toBeDisabled();
  await expect(page.getByAltText("Source poster 2", { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("release-poster-preview")));
  await expect(page.getByAltText("Source poster 2", { exact: true })).toHaveAttribute("src", /#poster-2$/);
  await page.getByRole("button", { name: "Remove image 2" }).click();
  await page.getByRole("button", { name: "Remove image 1" }).click();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Extract details" })).toBeDisabled();
});

test("source selection is capped at five images @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.getByLabel("Poster", { exact: true }).setInputFiles(Array(6).fill(upload));
  await expect(page.getByRole("status")).toHaveText("Maximum 5 images");
  expect(await page.evaluate(() => sessionStorage.getItem("fixture-upload-count"))).toBeNull();
  await page.getByLabel("Poster", { exact: true }).setInputFiles(Array(5).fill(upload));
  await expect(page.getByAltText("Source poster 5", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Poster", { exact: true })).toBeDisabled();
});

test("image-only drafts upload before any manual details @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=image-only");
  await page.getByLabel("Poster", { exact: true }).setInputFiles(upload);
  await expect(page.getByAltText("Source poster 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Event artwork", exact: true })).toHaveAttribute("src", /#poster-1$/);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
});
