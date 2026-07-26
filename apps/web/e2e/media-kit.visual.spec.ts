import { expect, test } from "@playwright/test";

import { captureRouteScreenshot, prepareVisualPage } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

test("owner media-kit editor @visual", async ({ page }, testInfo) => {
  await page.goto("/account/media-kit");
  await expect(page.getByRole("heading", { name: "Media kit", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public gallery" })).toBeVisible();
  await expect(page.getByText("Aurora press portrait", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Accessibility description").first()).toHaveValue(
    "DJ Aurora framed by violet light and a warm orange glow.",
  );
  await expect(page.getByRole("button", { name: "Move Aurora press portrait down" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  await captureRouteScreenshot(page, testInfo, "media-kit-editor");
});

test("owner upload failure stays beside the publish control", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic image"),
  });
  const publish = page.getByRole("button", { name: "Publish" });
  const uploadForm = publish.locator("xpath=ancestor::form");
  await uploadForm.getByLabel("Accessibility description").fill("Synthetic upload test image.");

  await publish.click();

  await expect(uploadForm.getByRole("alert")).toHaveText(
    "Synthetic preview storage does not accept new files.",
  );
});

test("owner preview failure can retry", async ({ page }) => {
  await page.goto("/account/media-kit");

  const preview = page.getByRole("img", {
    name: "DJ Aurora framed by violet light and a warm orange glow.",
  });
  await preview.scrollIntoViewIfNeeded();
  await preview.evaluate((image: HTMLImageElement) => {
    image.src = "/api/e2e/fixture-assets/missing-preview";
  });
  await expect(page.getByText("Preview unavailable.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("img", { name: "DJ Aurora framed by violet light and a warm orange glow." }),
  ).toBeVisible();
});

test("public profile media kit @visual", async ({ page }, testInfo) => {
  await page.goto("/p/playwright-dj-aurora");
  const mediaKit = page.getByRole("heading", { name: "Media kit" }).locator("xpath=ancestor::section");
  await expect(mediaKit.getByRole("heading", { name: "Profile image" })).toHaveCount(1);
  await expect(
    mediaKit.getByRole("img", { name: "DJ Aurora framed by violet light and a warm orange glow." }),
  ).toHaveCount(1);
  await expect(mediaKit.getByText("Artwork by Afterglow Studio", { exact: true })).toBeVisible();
  await expect(mediaKit.getByRole("link", { name: "Download Profile image" })).toBeVisible();
  await expect(mediaKit.locator("article")).toHaveCount(3);
  await captureRouteScreenshot(page, testInfo, "profile-media-kit");
});
