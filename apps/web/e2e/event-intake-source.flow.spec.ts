import { expect, test } from "@playwright/test";

test("text extraction stays tentative, survives save, accepts explicitly, and keeps questions @flow @fixture", async ({ page }, info) => {
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
  await page.getByLabel("Community", { exact: true }).fill("playwright-afterglow-social");
  await page.getByLabel("Date", { exact: true }).fill("2027-10-15");
  await page.getByRole("checkbox", { name: "Time TBA", exact: true }).check();
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-published")!).title)).toBe("Afterglow Night revised");
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions", exact: true })).toBeVisible();
});

test("poster remains private until separate artwork choice and manual fallback remains editable @flow @fixture", async ({ page }, info) => {
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
  await page.getByRole("checkbox", { name: "Time TBA", exact: true }).check();
  await page.getByRole("button",{name:"Publish event",exact:true}).click();
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
});

test("stale extraction never applies candidate fields @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=stale");
  await page.getByLabel("Source text",{exact:true}).fill("Original source");
  await page.getByRole("button",{name:"Extract details"}).click();
  await expect(page.getByRole("status")).toContainText("This draft changed elsewhere.");
  await expect(page.getByLabel("Event title",{exact:true})).toHaveValue("");
  await expect(page.getByRole("heading",{name:"Tentative details"})).toHaveCount(0);
});


test("uploaded source remains usable when preview fails @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=preview-failure");
  await page.getByLabel("Poster",{exact:true}).setInputFiles("public/test-media/event-poster.png");
  await expect(page.getByRole("button",{name:"Use as event artwork"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Extract details"})).toBeEnabled();
  await expect(page.getByLabel("Event title",{exact:true})).toBeEditable();
});


test("replacement poster remains unselected after resume until explicit selection @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?source=replacement");
  const upload = page.getByLabel("Poster", { exact: true });
  const select = page.getByRole("button", { name: "Use as event artwork" });
  await upload.setInputFiles("public/test-media/event-poster.png");
  await expect(page.getByAltText("Source poster")).toBeVisible();
  await page.getByRole("button", { name: "Extract details" }).click();
  await expect(page.getByRole("heading", { name: "Tentative details" })).toBeVisible();
  await select.click();
  await expect(page.getByText("Artwork selected", { exact: true })).toBeVisible();
  await upload.setInputFiles("public/test-media/event-poster.png");
  await expect(page.getByAltText("Source poster")).toHaveAttribute("src", /#poster-2$/);
  await expect(page.getByRole("heading", { name: "Tentative details" })).toHaveCount(0);
  await expect(page.getByText("timezone: Which time zone?", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source evidence", { exact: true })).toHaveCount(0);
  await page.goto("/playwright/event-intake?source=replacement");
  await expect(page.getByAltText("Source poster")).toHaveAttribute("src", /#poster-2$/);
  await expect(page.getByText("Artwork selected", { exact: true })).toHaveCount(0);
  await expect(select).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("fixture-artwork-source"))).toBe("poster-1");
  await select.click();
  expect(await page.evaluate(() => sessionStorage.getItem("fixture-artwork-source"))).toBe("poster-2");
});

test("changing source text clears extracted candidates and evidence @flow @fixture", async ({ page }, info) => {
  test.slow();
  await page.goto("/playwright/event-intake?source=text");
  await page.getByLabel("Source text", { exact: true }).fill("Old event poster text");
  await page.getByRole("button", { name: "Extract details" }).click();
  await expect(page.getByRole("heading", { name: "Tentative details" })).toBeVisible();
  await page.goto("/playwright/event-intake?source=text");
  await expect(page.getByRole("heading", { name: "Tentative details" })).toBeVisible();
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Different event poster text");
  await expect(page.getByRole("heading", { name: "Tentative details" })).toHaveCount(0);
  await expect(page.getByText("timezone: Which time zone?", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source evidence", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("changed-source.png"), fullPage: true });
});

test("replacement preview never shows the old source or enables artwork before the new image @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=replacement-delay");
  const upload = page.getByLabel("Poster", { exact: true });
  await upload.setInputFiles("public/test-media/event-poster.png");
  await expect(page.getByAltText("Source poster")).toHaveAttribute("src", /#poster-1$/);
  await upload.setInputFiles("public/test-media/event-poster.png");
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.posterSourceId)).toBe("poster-2");
  await expect(page.getByAltText("Source poster")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use as event artwork" })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("replacement-pending.png"), fullPage: true });
  await page.evaluate(() => window.dispatchEvent(new Event("release-poster-preview")));
  await expect(page.getByAltText("Source poster")).toHaveAttribute("src", /#poster-2$/);
  await expect(page.getByRole("button", { name: "Use as event artwork" })).toBeEnabled();
});
