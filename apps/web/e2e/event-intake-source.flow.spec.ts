import { expect, test } from "@playwright/test";

test("text extraction stays tentative, survives save, accepts explicitly, and keeps questions @flow", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.getByLabel("Source text", { exact: true }).fill("Afterglow Night on October 15. Time TBA. Aurora plays.");
  await page.getByRole("button", { name: "Extract details" }).click();
  await expect(page.getByRole("heading", { name: "Tentative details" })).toBeVisible();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("");
  await expect(page.getByText("timezone: Which time zone?", { exact: true })).toBeVisible();
  await page.screenshot({path: info.outputPath("tentative-review.png"),fullPage:true});
  await page.getByRole("button", { name: "Accept Event title", exact: true }).click();
  await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Afterglow Night");
  await page.getByLabel("Event title", { exact: true }).fill("Afterglow Night revised");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status").filter({hasText:"Draft saved"})).toHaveText("Draft saved");
  const fields = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch);
  expect(fields.title).toBe("Afterglow Night revised"); expect(fields.tentative.title).toBeUndefined(); expect(fields.questions).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath("text-review.png"),fullPage:true});
  await page.goto("/playwright/event-intake?source=text");
  await expect(page.getByLabel("Event title", {exact:true})).toHaveValue("Afterglow Night revised");
  await expect(page.getByText("timezone: Which time zone?", {exact:true})).toBeVisible();
});

test("poster remains private until separate artwork choice and manual fallback remains editable @flow", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=poster");
  await page.getByLabel("Poster", {exact:true}).setInputFiles("public/test-media/event-poster.png");
  await expect(page.getByAltText("Source poster")).toBeVisible();
  await expect(page.getByRole("button", {name:"Use as event artwork"})).toBeEnabled();
  await page.screenshot({path:info.outputPath("poster-private.png"),fullPage:true});
  await page.getByRole("button", {name:"Extract details"}).click();
  await expect(page.getByText("Extraction unavailable",{exact:true})).toBeVisible();
  await expect(page.getByLabel("Event title",{exact:true})).toBeEditable();
  expect(await page.evaluate(() => sessionStorage.getItem("fixture-artwork"))).toBeNull();
  await page.getByRole("button", {name:"Use as event artwork"}).click();
  await expect(page.getByText("Artwork selected",{exact:true})).toBeVisible();
  await page.getByLabel("Event title",{exact:true}).fill("Manual poster event");
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Draft saved"})).toHaveText("Draft saved");
  await page.screenshot({path:info.outputPath("poster-manual.png"),fullPage:true});
  await page.goto("/playwright/event-intake?source=poster");
  await expect(page.getByAltText("Source poster")).toBeVisible();
  await expect(page.getByLabel("Event title",{exact:true})).toHaveValue("Manual poster event");
  await expect(page.getByText("Extraction unavailable",{exact:true})).toBeVisible();
  await expect(page.getByText("Artwork selected",{exact:true})).toBeVisible();
  await page.getByLabel("Community",{exact:true}).fill("playwright-afterglow-social");
  await page.getByLabel("Date",{exact:true}).fill("2027-10-15");
  await page.getByLabel("Time TBA").check();
  await page.getByRole("button",{name:"Publish event",exact:true}).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
});

test("stale extraction never applies candidate fields @flow", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=stale");
  await page.getByLabel("Source text",{exact:true}).fill("Original source");
  await page.getByRole("button",{name:"Extract details"}).click();
  await expect(page.getByRole("status")).toContainText("This draft changed elsewhere.");
  await expect(page.getByLabel("Event title",{exact:true})).toHaveValue("");
  await expect(page.getByRole("heading",{name:"Tentative details"})).toHaveCount(0);
});


test("uploaded source remains usable when preview fails @flow", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=preview-failure");
  await page.getByLabel("Poster",{exact:true}).setInputFiles("public/test-media/event-poster.png");
  await expect(page.getByRole("button",{name:"Use as event artwork"})).toBeEnabled();
  await expect(page.getByRole("button",{name:"Extract details"})).toBeEnabled();
  await expect(page.getByLabel("Event title",{exact:true})).toBeEditable();
});
