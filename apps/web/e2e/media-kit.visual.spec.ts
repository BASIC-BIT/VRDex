import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { captureRouteScreenshot, prepareVisualPage } from "./public-routes";

async function oversizedSyntheticPng() {
  const width = 1_600;
  const height = 1_600;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 31 + Math.floor(index / 97)) % 256;
  }
  const image = await sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).png({ compressionLevel: 0 }).toBuffer();
  expect(image.length).toBeGreaterThan(4 * 1024 * 1024);
  expect(image.length).toBeLessThanOrEqual(12 * 1024 * 1024);
  return { height, image, width };
}

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

test("owner media-kit editor @visual @fixture", async ({ page }, testInfo) => {
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

test("owner upload failure stays beside the publish control @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic image"),
  });
  const publish = page.getByRole("button", { name: "Publish" });
  const uploadForm = publish.locator("xpath=ancestor::form");
  await expect(uploadForm.getByLabel("Title")).toHaveValue("synthetic");
  await expect(uploadForm.getByLabel("Accessibility description")).not.toHaveAttribute("required");

  await publish.click();

  await expect(uploadForm.getByRole("alert")).toHaveText(
    "Synthetic preview storage does not accept new files.",
  );
});

test("owner oversized raster is prepared before upload @fixture", async ({ page }) => {
  const { height, image, width } = await oversizedSyntheticPng();

  await page.goto("/account/media-kit");
  await page.evaluate(() => {
    window.addEventListener("vrdex:media-upload-attempt", (event) => {
      (window as typeof window & { mediaUploadAttempt?: unknown }).mediaUploadAttempt =
        (event as CustomEvent).detail;
    });
  });
  await page.getByLabel("Add image").setInputFiles({
    name: "oversized-synthetic.png",
    mimeType: "image/png",
    buffer: image,
  });
  const publish = page.getByRole("button", { name: "Publish" });
  const uploadForm = publish.locator("xpath=ancestor::form");
  await expect(uploadForm.getByLabel("Title", { exact: true })).toHaveValue("oversized-synthetic");
  await expect(uploadForm.locator("img")).toBeVisible();
  await expect(uploadForm.getByText(/PNG · .* → WEBP · .* · 1600 × 1600/)).toBeVisible();
  await publish.click();

  await expect(uploadForm.getByRole("alert")).toHaveText(
    "Synthetic preview storage does not accept new files.",
  );
  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { mediaUploadAttempt?: unknown }).mediaUploadAttempt,
  )).toMatchObject({
    name: "oversized-synthetic.webp",
    type: "image/webp",
    width,
    height,
  });
  const attempt = await page.evaluate(
    () => (window as typeof window & {
      mediaUploadAttempt?: { size?: number };
    }).mediaUploadAttempt,
  );
  expect(attempt?.size).toBeGreaterThan(0);
  expect(attempt?.size).toBeLessThanOrEqual(4 * 1024 * 1024);
});

test("owner oversized raster dimensions are bounded before decode @fixture", async ({ page }) => {
  const image = Buffer.alloc(4 * 1024 * 1024 + 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(image);
  image.writeUInt32BE(9_000, 16);
  image.writeUInt32BE(4_000, 20);

  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "oversized-dimensions.png",
    mimeType: "image/png",
    buffer: image,
  });

  await expect(page.getByRole("alert")).toHaveText("Image dimensions are too large.");
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
});

test("owner profile switch clears an unsubmitted upload @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic image"),
  });
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();

  await page.getByLabel("Profile", { exact: true }).selectOption("demo-community");

  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expect(page.getByText("synthetic.png", { exact: true })).toHaveCount(0);
});

test("removed profile cannot inherit a staged upload @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "transfer.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic image"),
  });
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  const uploadForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Publish" }) });
  await uploadForm.getByLabel("Title", { exact: true }).focus();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("vrdex:toggle-media-profile", {
      detail: { profileId: "demo-profile", present: false },
    }));
  });

  await expect(page.getByLabel("Profile", { exact: true })).toHaveValue("demo-community");
  await expect(page.getByLabel("Profile", { exact: true })).toBeFocused();
  await expect(page.getByText("No profiles", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expect(page.getByText("transfer.png", { exact: true })).toHaveCount(0);

  await page.getByLabel("Add image").setInputFiles({
    name: "last-profile.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic image"),
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("vrdex:toggle-media-profile", {
      detail: { profileId: "demo-community", present: false },
    }));
  });
  await expect(page.getByText("No profiles", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("vrdex:toggle-media-profile", {
      detail: { profileId: "demo-community", present: true },
    }));
  });
  await expect(page.getByLabel("Profile", { exact: true })).toHaveValue("demo-community");
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expect(page.getByText("last-profile.png", { exact: true })).toHaveCount(0);
});

test("removed profile cannot inherit an upload still being prepared @fixture", async ({ page }) => {
  const { image } = await oversizedSyntheticPng();
  await page.goto("/account/media-kit");
  await page.evaluate(() => {
    (window as typeof window & { mediaPreparationSettled?: boolean }).mediaPreparationSettled = false;
    window.addEventListener("vrdex:media-preparation-settled", () => {
      (window as typeof window & { mediaPreparationSettled?: boolean }).mediaPreparationSettled = true;
    }, { once: true });
  });
  await page.getByLabel("Add image").setInputFiles({
    name: "preparing-transfer.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("vrdex:toggle-media-profile", {
      detail: { profileId: "demo-profile", present: false },
    }));
  });

  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { mediaPreparationSettled?: boolean }).mediaPreparationSettled,
  )).toBe(true);
  await expect(page.getByLabel("Profile", { exact: true })).toHaveValue("demo-community");
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expect(page.getByText("preparing-transfer.png", { exact: true })).toHaveCount(0);
});

test("owner profile switch stays locked during upload @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "slow.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic image"),
  });
  await page.getByRole("button", { name: "Publish" }).click();

  await expect(page.getByLabel("Profile", { exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText(
    "Synthetic preview storage does not accept new files.",
  );
  await expect(page.getByLabel("Profile", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Profile", { exact: true })).toHaveValue("demo-profile");
});

test("owner restore keeps status and focus in the active gallery @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByRole("button", { name: "Restore" }).click();

  await expect(page.getByText("Restored.", { exact: true })).toBeVisible();
  await expect(page.locator("#active-aurora-removed")).toBeFocused();
});

test("owner preview failure can retry @fixture", async ({ page }) => {
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

test("public profile media kit @visual @fixture", async ({ page }, testInfo) => {
  await page.goto("/p/playwright-dj-aurora");
  const mediaKit = page.getByRole("heading", { name: "Media kit" }).locator("xpath=ancestor::section");
  await expect(mediaKit.getByRole("heading", { name: "Profile image" })).toHaveCount(1);
  await expect(
    mediaKit.getByRole("img", { name: "DJ Aurora framed by violet light and a warm orange glow." }),
  ).toHaveCount(1);
  await expect(mediaKit.getByRole("img", { name: "Aurora wordmark" })).toHaveCount(1);
  await expect(mediaKit.getByText("Artwork by Afterglow Studio", { exact: true })).toBeVisible();
  await expect(mediaKit.getByRole("link", { name: "Download Profile image" })).toBeVisible();
  await expect(mediaKit.locator("article")).toHaveCount(3);
  await captureRouteScreenshot(page, testInfo, "profile-media-kit");
});
