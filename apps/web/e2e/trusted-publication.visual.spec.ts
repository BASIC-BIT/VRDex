import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { gotoComponentStory, prepareStorybookVisualPage, captureStorybookScreenshot } from "./storybook-components";

test.beforeEach(async ({ page }) => {
  await prepareStorybookVisualPage(page);
  await page.evaluate(() => sessionStorage.clear()).catch(() => undefined);
  const image = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#173e35" } }).png().toBuffer();
  await page.route("**/api/**/file*", route => route.fulfill({ contentType: "image/png", body: image }));
});

test("kit publication has one primary action and no declarations @storybook-visual", async ({ page }, testInfo) => {
  await gotoComponentStory(page, "account-trusted-publication--explicit-commands");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm evidence" })).toHaveCount(0);
  await expect(page.getByText("Media kit", { exact: true })).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(1);
  await page.getByRole("button", { name: "Publish", exact: true }).focus();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeFocused();
  await captureStorybookScreenshot(page, testInfo, "publication-pending");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Independent review required", { exact: true })).toBeVisible();
  expect(JSON.parse((await page.getByTestId("commands").textContent())!)).toHaveLength(1);
  await captureStorybookScreenshot(page, testInfo, "publication-refused");
  await page.getByRole("button", { name: "Independent review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
});

test("publication recovers exact command after reload and lost response @storybook-visual", async ({ page }, testInfo) => {
  await gotoComponentStory(page, "account-trusted-publication--uncertain");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Outcome unknown", { exact: true })).toBeVisible();
  const first = JSON.parse((await page.getByTestId("commands").textContent())!)[0];
  await captureStorybookScreenshot(page, testInfo, "publication-unknown");
  await page.reload();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  const retry = JSON.parse((await page.getByTestId("commands").textContent())!)[0];
  expect(retry).toEqual(first);
});

test("parent retains publication recovery when inventory becomes approved @storybook-visual", async ({ page }) => {
  await gotoComponentStory(page, "account-trusted-publication--reactive-inventory");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Outcome unknown", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  const calls = JSON.parse((await page.getByTestId("inventory-commands").textContent())!);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  await expect(page.getByText("Trusted publication", { exact: true })).toBeVisible();
});

test("published actions follow capabilities and retain corrections on conflict @storybook-visual", async ({ page }, testInfo) => {
  await gotoComponentStory(page, "account-trusted-publication--published");
  await expect(page.getByRole("button", { name: "Select picture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await captureStorybookScreenshot(page, testInfo, "contribution-published");
  await page.getByRole("button", { name: "Select picture" }).click();
  await expect(page.getByRole("button", { name: "Clear picture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear picture" }).click();
  await page.getByRole("button", { name: "Edit metadata" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Corrected portrait");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Review changed. Inspect the current images before deciding again.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Corrected portrait");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Corrected portrait" })).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Removed", { exact: true })).toBeVisible();
});

test("protected contribution offers reviewed replacement only @storybook-visual", async ({ page }, testInfo) => {
  await gotoComponentStory(page, "account-trusted-publication--protected");
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit metadata" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select picture" })).toHaveCount(0);
  await captureStorybookScreenshot(page, testInfo, "contribution-protected");
  await page.getByRole("button", { name: "Request replacement" }).click();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  const commands = JSON.parse((await page.getByTestId("published-commands").textContent())!);
  expect(commands[0].kind).toBe("propose");
  expect(commands[0].input).not.toHaveProperty("metadata");
});

test("published correction replays exact payload after reload @storybook-visual", async ({ page }, testInfo) => {
  await gotoComponentStory(page, "account-trusted-publication--published-uncertain");
  await page.getByRole("button", { name: "Edit metadata" }).click();
  await page.getByLabel("Credit", { exact: true }).fill("New photographer");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Outcome unknown", { exact: true })).toBeVisible();
  const first = JSON.parse((await page.getByTestId("published-commands").textContent())!)[0];
  await captureStorybookScreenshot(page, testInfo, "contribution-unknown");
  await page.reload();
  await expect(page.getByLabel("Credit", { exact: true })).toHaveValue("New photographer");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  const retry = JSON.parse((await page.getByTestId("published-commands").textContent())!)[0];
  expect(retry).toEqual(first);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("kit approval previews one image and replacement compares two @storybook-visual", async ({ page }, testInfo) => {
  await gotoComponentStory(page, "account-assigned-media-review--local-provenance");
  await expect(page.getByRole("img")).toHaveCount(1);
  await expect(page.getByText("Media kit", { exact: true })).toBeVisible();
  await captureStorybookScreenshot(page, testInfo, "review-kit-approval");
  await gotoComponentStory(page, "account-assigned-media-review--published-replacement");
  await expect(page.getByRole("img")).toHaveCount(2);
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await expect(page.getByText("Candidate", { exact: true })).toBeVisible();
  await captureStorybookScreenshot(page, testInfo, "review-published-replacement");
});


test("logical removal recovery survives unavailable detail and reload @storybook-visual", async ({ page }) => {
  await gotoComponentStory(page, "account-trusted-publication--removed-uncertain");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Outcome unknown", { exact: true })).toBeVisible();
  const first = JSON.parse((await page.getByTestId("removal-commands").textContent())!)[0];
  await expect(page.getByRole("img")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Removed", { exact: true })).toBeVisible();
  expect(JSON.parse((await page.getByTestId("removal-commands").textContent())!)[0]).toEqual(first);
});
