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

async function smallSyntheticPng() {
  return await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: "#663399",
    },
  }).png().toBuffer();
}

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

test("owner media-kit editor @visual @fixture", async ({ page }, testInfo) => {
  await page.goto("/account/media-kit");
  await expect(page.getByRole("heading", { name: "Media kit", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public gallery" })).toBeVisible();
  await expect(page.getByText("Aurora press portrait", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Accessibility description", { exact: true }).first()).toHaveValue(
    "DJ Aurora framed by violet light and a warm orange glow.",
  );
  await expect(page.getByRole("button", { name: "Move Aurora press portrait down" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore Old square mark" })).toBeVisible();
  await captureRouteScreenshot(page, testInfo, "media-kit-editor");
});

test("owner repeated asset actions have distinct keyboard names @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  const first = page.locator('[data-asset-id="aurora-primary"]');
  const second = page.locator('[data-asset-id="aurora-logo"]');
  await expect(first.getByRole("button", { name: "Save Aurora press portrait" })).toBeVisible();
  await expect(second.getByRole("button", { name: "Save Aurora wordmark" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Remove Aurora press portrait" })).toBeVisible();
  await expect(second.getByRole("button", { name: "Remove Aurora wordmark" })).toBeVisible();
  await expect(first.getByRole("link", { name: "Download Aurora press portrait" })).toBeVisible();
  await expect(second.getByRole("link", { name: "Download Aurora wordmark" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Old square mark" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Legacy banner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore Old square mark" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore Removed banner" })).toBeVisible();
  const replace = second.getByLabel("Replace Aurora wordmark");
  await replace.focus();
  await expect(replace).toBeFocused();
  await expect(replace.locator("..")).toHaveClass(/focus-within:ring-2/);
});

test("owner upload failure stays beside the publish control @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: await smallSyntheticPng(),
  });
  const publish = page.getByRole("button", { name: "Publish" });
  const uploadForm = publish.locator("xpath=ancestor::form");
  await expect(uploadForm.getByLabel("Title")).toHaveValue("synthetic");
  await expect(uploadForm.getByLabel("Accessibility description", { exact: true })).not.toHaveAttribute("required");

  await publish.click();

  await expect(uploadForm.getByRole("alert")).toHaveText(
    "Synthetic preview storage does not accept new files.",
  );
});

test("owner upload metadata includes caption, linked credit, and editable generated text @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  const file = {
    name: "metadata.png",
    mimeType: "image/png",
    buffer: await smallSyntheticPng(),
  };
  await page.getByLabel("Add image").setInputFiles(file);
  const uploadForm = page.getByRole("button", { name: "Publish" }).locator("xpath=ancestor::form");
  await uploadForm.getByLabel("Caption").fill("Synthetic caption");
  await uploadForm.getByLabel("Credit", { exact: true }).fill("Example Photographer");
  await uploadForm.getByLabel("Credit link").fill("https://example.test/credit");
  await uploadForm.getByLabel("Accessibility description", { exact: true }).fill("Manual description");
  const generate = uploadForm.getByRole("button", {
    name: "Generate accessibility description for upload",
  });
  await expect(generate).toBeDisabled();
  await uploadForm.getByLabel("Accessibility description", { exact: true }).fill("");
  await generate.focus();
  await expect(generate).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(uploadForm.getByLabel("Accessibility description", { exact: true })).toHaveValue(
    "A performer stands in violet and orange light.",
  );
  await expect(uploadForm.getByText("Generated.", { exact: true })).toBeVisible();
  await uploadForm.getByLabel("Accessibility description", { exact: true }).fill("Edited suggestion");
  await uploadForm.getByRole("button", { name: "Cancel" }).click();

  await page.getByLabel("Add image").setInputFiles(file);
  const resetForm = page.getByRole("button", { name: "Publish" }).locator("xpath=ancestor::form");
  await expect(resetForm.getByLabel("Caption")).toHaveValue("");
  await expect(resetForm.getByLabel("Credit link")).toHaveValue("");
  await expect(resetForm.getByLabel("Accessibility description", { exact: true })).toHaveValue("");
});

test("owner generation is blank-only and preserves text on failure @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.evaluate(() => {
    (window as typeof window & { vrdexGenerationFailure?: boolean }).vrdexGenerationFailure = true;
  });
  const asset = page.locator('[data-asset-id="aurora-logo"]');
  const description = asset.getByLabel("Accessibility description", { exact: true });
  await description.fill("Manual text stays here.");
  const generate = asset.getByRole("button", {
    name: "Generate accessibility description for Aurora wordmark",
  });
  await expect(generate).toBeDisabled();
  await description.fill("");
  await generate.click();

  await expect(asset.getByRole("alert")).toHaveText("Generation failed. Try again.");
  await expect(description).toHaveValue("");
});

test("owner upload generation locks target-changing controls @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "generation-race.png",
    mimeType: "image/png",
    buffer: await smallSyntheticPng(),
  });
  await page.evaluate(() => {
    (window as typeof window & { vrdexGenerationSlow?: boolean }).vrdexGenerationSlow = true;
  });
  const publish = page.getByRole("button", { name: "Publish" });
  const uploadForm = publish.locator("xpath=ancestor::form");
  await uploadForm.getByRole("button", {
    name: "Generate accessibility description for upload",
  }).click();
  await expect(page.getByLabel("Profile", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Add image")).toBeDisabled();
  await expect(uploadForm.getByLabel("Accessibility description", { exact: true })).toBeDisabled();
  await expect(publish).toBeDisabled();
  await expect(uploadForm.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(uploadForm.getByLabel("Accessibility description", { exact: true })).toHaveValue(
    "A performer stands in violet and orange light.",
  );
});

test("owner asset generation locks edits until the matching result returns @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.evaluate(() => {
    (window as typeof window & { vrdexGenerationSlow?: boolean }).vrdexGenerationSlow = true;
  });
  const asset = page.locator('[data-asset-id="aurora-logo"]');
  const description = asset.getByLabel("Accessibility description", { exact: true });
  await asset.getByRole("button", {
    name: "Generate accessibility description for Aurora wordmark",
  }).click();
  await expect(description).toBeDisabled();
  await expect(asset.getByLabel("Title")).toBeDisabled();
  await expect(asset.getByRole("button", { name: "Save Aurora wordmark" })).toBeDisabled();
  await expect(asset.getByLabel("Replace Aurora wordmark")).toBeDisabled();
  await expect(description).toHaveValue("A performer stands in violet and orange light.");
});

test("owner replace failure keeps the existing gallery asset @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  const asset = page.locator('[data-asset-id="aurora-primary"]');
  await asset.getByLabel("Replace Aurora press portrait").setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: await smallSyntheticPng(),
  });

  await expect(asset.getByRole("alert")).toHaveText(
    "Synthetic preview storage does not accept new files.",
  );
  await expect(asset.getByText("Aurora press portrait", { exact: true }).first()).toBeVisible();
});

test("owner oversized raster stays in its original format before direct upload @fixture", async ({ page }) => {
  const { image } = await oversizedSyntheticPng();

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
  await expect(uploadForm.getByLabel("Caption")).toBeVisible();
  await expect(uploadForm.getByLabel("Credit link")).toBeVisible();
  await publish.click();

  await expect(uploadForm.getByRole("alert")).toHaveText(
    "Synthetic preview storage does not accept new files.",
  );
  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { mediaUploadAttempt?: unknown }).mediaUploadAttempt,
  )).toMatchObject({
    name: "oversized-synthetic.png",
    type: "image/png",
    size: image.length,
  });
});

test("owner oversized raster dimensions are bounded before decode @fixture", async ({ page }) => {
  const image = Buffer.alloc(4 * 1024 * 1024 + 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(image);
  image.writeUInt32BE(9_000, 16);
  image.writeUInt32BE(1_000, 20);

  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "oversized-dimensions.png",
    mimeType: "image/png",
    buffer: image,
  });

  await expect(page.getByRole("alert")).toHaveText("Image dimensions are too large.");
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
});

test("owner oversized animated rasters are rejected before upload @fixture", async ({ page }) => {
  const png = Buffer.alloc(4 * 1024 * 1024 + 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(1_600, 16);
  png.writeUInt32BE(1_600, 20);
  png.writeUInt32BE(8, 33);
  png.write("acTL", 37, "ascii");

  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "animated.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByRole("alert")).toHaveText("Profile media must be one valid, still image.");
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);

  const webp = Buffer.alloc(4 * 1024 * 1024 + 1);
  webp.write("RIFF", 0, "ascii");
  webp.writeUInt32LE(webp.length - 8, 4);
  webp.write("WEBPVP8X", 8, "ascii");
  webp.writeUInt32LE(10, 16);
  webp[20] = 0x02;
  webp.writeUIntLE(1_599, 24, 3);
  webp.writeUIntLE(1_599, 27, 3);
  await page.getByLabel("Add image").setInputFiles({
    name: "animated.webp",
    mimeType: "image/webp",
    buffer: webp,
  });
  await expect(page.getByRole("alert")).toHaveText("Profile media must be one valid, still image.");
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
});

test("owner oversized JPEG accepts legal marker fill bytes @fixture", async ({ page }) => {
  const { image } = await oversizedSyntheticPng();
  const jpeg = await sharp(image).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  const frameMarker = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  expect(frameMarker).toBeGreaterThan(0);
  const withFillByte = Buffer.concat([
    jpeg.subarray(0, frameMarker + 1),
    Buffer.from([0xff]),
    jpeg.subarray(frameMarker + 1),
  ]);
  expect(withFillByte.length).toBeGreaterThan(4 * 1024 * 1024);

  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "marker-fill.jpg",
    mimeType: "image/jpeg",
    buffer: withFillByte,
  });
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
});

test("owner oversized raster rejects a mismatched selected type @fixture", async ({ page }) => {
  const { image } = await oversizedSyntheticPng();
  const jpeg = await sharp(image).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  expect(jpeg.length).toBeGreaterThan(4 * 1024 * 1024);

  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "mismatched.png",
    mimeType: "image/png",
    buffer: jpeg,
  });

  await expect(page.getByRole("alert")).toHaveText(
    "The file contents do not match the selected image type.",
  );
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
});

test("owner oversized EXIF portrait uploads exact selected bytes @fixture", async ({ page }) => {
  const source = await sharp({
    create: {
      width: 8_000,
      height: 4_000,
      channels: 3,
      background: { r: 90, g: 40, b: 160 },
    },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const image = Buffer.concat([
    source,
    Buffer.alloc(4 * 1024 * 1024 + 1 - source.length),
  ]);
  expect(image.length).toBe(4 * 1024 * 1024 + 1);

  await page.goto("/account/media-kit");
  await page.evaluate(() => {
    window.addEventListener("vrdex:media-upload-attempt", (event) => {
      (window as typeof window & { mediaUploadAttempt?: unknown }).mediaUploadAttempt =
        (event as CustomEvent).detail;
    });
  });
  await page.getByLabel("Add image").setInputFiles({
    name: "exif-portrait.jpg",
    mimeType: "image/jpeg",
    buffer: image,
  });
  await page.getByRole("button", { name: "Publish" }).click();

  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { mediaUploadAttempt?: unknown }).mediaUploadAttempt,
  )).toMatchObject({
    name: "exif-portrait.jpg",
    type: "image/jpeg",
    size: image.length,
  });
});

test("owner oversized PNG and WebP remain unchanged before upload @fixture", async ({ page }) => {
  const width = 2_400;
  const height = 1_200;
  const pixels = Buffer.alloc(width * height * 3);
  const colors = {
    bottomLeft: Buffer.from([0, 0, 255]),
    bottomRight: Buffer.from([255, 255, 0]),
    topLeft: Buffer.from([255, 0, 0]),
    topRight: Buffer.from([0, 255, 0]),
  };
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 3;
    const left = y < height / 2 ? colors.topLeft : colors.bottomLeft;
    const right = y < height / 2 ? colors.topRight : colors.bottomRight;
    pixels.fill(left, rowOffset, rowOffset + (width / 2) * 3);
    pixels.fill(right, rowOffset + (width / 2) * 3, rowOffset + width * 3);
  }
  const source = sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).withMetadata({ orientation: 6 });
  const oversized = (buffer: Buffer) =>
    buffer.length > 4 * 1024 * 1024
      ? buffer
      : Buffer.concat([buffer, Buffer.alloc(4 * 1024 * 1024 + 1 - buffer.length)]);
  const images = [
    {
      buffer: oversized(await source.clone().png({ compressionLevel: 0 }).toBuffer()),
      mimeType: "image/png",
      name: "exif-portrait.png",
    },
    {
      buffer: oversized(await source.clone().webp({ lossless: true }).toBuffer()),
      mimeType: "image/webp",
      name: "exif-portrait.webp",
    },
  ];
  for (const image of images) {
    expect(image.buffer.length).toBeGreaterThan(4 * 1024 * 1024);
    expect(image.buffer.length).toBeLessThanOrEqual(12 * 1024 * 1024);
  }

  await page.goto("/account/media-kit");
  await page.evaluate(() => {
    window.addEventListener("vrdex:media-upload-attempt", (event) => {
      (window as typeof window & { mediaUploadAttempt?: unknown }).mediaUploadAttempt =
        (event as CustomEvent).detail;
    });
  });

  for (const image of images) {
    await page.evaluate(() => {
      delete (window as typeof window & { mediaUploadAttempt?: unknown }).mediaUploadAttempt;
    });
    await page.getByLabel("Add image").setInputFiles(image);
    await page.getByRole("button", { name: "Publish" }).click();

    await expect.poll(() => page.evaluate(
      () => (window as typeof window & { mediaUploadAttempt?: unknown }).mediaUploadAttempt,
    )).toMatchObject({
      name: image.name,
      type: image.mimeType,
      size: image.buffer.length,
    });
  }
});

test("owner profile switch clears an unsubmitted upload @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByLabel("Add image").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: await smallSyntheticPng(),
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
    buffer: await smallSyntheticPng(),
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
    buffer: await smallSyntheticPng(),
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
    buffer: await smallSyntheticPng(),
  });
  await page.getByRole("button", { name: "Publish" }).click();

  await expect(page.getByLabel("Profile", { exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText(
    "Synthetic preview storage does not accept new files.",
  );
  await expect(page.getByLabel("Profile", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Profile", { exact: true })).toHaveValue("demo-profile");
});

test("removed profile upload cannot overwrite a new staged upload @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.evaluate(() => {
    (window as typeof window & { mediaUploadSettled?: boolean }).mediaUploadSettled = false;
    window.addEventListener("vrdex:media-upload-settled", () => {
      (window as typeof window & { mediaUploadSettled?: boolean }).mediaUploadSettled = true;
    }, { once: true });
  });
  await page.getByLabel("Add image").setInputFiles({
    name: "slow.png",
    mimeType: "image/png",
    buffer: await smallSyntheticPng(),
  });
  await page.getByRole("button", { name: "Publish" }).click();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("vrdex:toggle-media-profile", {
      detail: { profileId: "demo-profile", present: false },
    }));
  });
  await expect(page.getByLabel("Profile", { exact: true })).toHaveValue("demo-community");
  await page.getByLabel("Add image").setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: await smallSyntheticPng(),
  });

  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { mediaUploadSettled?: boolean }).mediaUploadSettled,
  )).toBe(true);
  await expect(page.getByText("replacement.png", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("owner restore keeps status and focus in the active gallery @fixture", async ({ page }) => {
  await page.goto("/account/media-kit");
  await page.getByRole("button", { name: "Restore Old square mark" }).click();

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
  await expect(mediaKit.getByRole("heading", { name: "Aurora press portrait" })).toHaveCount(1);
  await expect(
    mediaKit.getByText("Warm-room portrait for lineups and editorial coverage.", { exact: true }),
  ).toHaveCount(1);
  await expect(
    mediaKit.getByRole("img", { name: "DJ Aurora framed by violet light and a warm orange glow." }),
  ).toHaveCount(1);
  await expect(mediaKit.getByRole("img", { name: "Aurora wordmark" })).toHaveCount(1);
  await expect(
    mediaKit.getByRole("link", { name: "Artwork by Afterglow Studio" }),
  ).toHaveAttribute("href", "https://example.invalid/afterglow-studio");
  await expect(
    mediaKit.getByRole("link", { name: "https://example.invalid/aurora-source" }),
  ).toHaveAttribute("href", "https://example.invalid/aurora-source");
  for (const title of [
    "Aurora press portrait",
    "Primary logo",
    "Square mark",
    "Uncredited mark",
  ]) {
    await expect(mediaKit.getByRole("link", { name: `Download ${title}` })).toHaveCount(1);
  }
  const nameOnlyCredit = mediaKit.getByRole("heading", { name: "Square mark" })
    .locator("xpath=ancestor::article");
  await expect(nameOnlyCredit.getByText("Aurora Studio", { exact: true })).toBeVisible();
  await expect(nameOnlyCredit.getByRole("link")).toHaveCount(1);
  const noCredit = mediaKit.getByRole("heading", { name: "Uncredited mark" })
    .locator("xpath=ancestor::article");
  await expect(noCredit.getByRole("link")).toHaveCount(1);
  await expect(mediaKit.getByRole("link", { name: "Download" }).first()).toBeVisible();
  await expect(mediaKit.getByText("PNG / 180 KB", { exact: true })).toBeVisible();
  await expect(mediaKit.locator("article")).toHaveCount(4);
  await captureRouteScreenshot(page, testInfo, "profile-media-kit");
});
