import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { expectDecodedImage } from "./image-readiness";

test("image readiness waits for loading then actual decoded pixels @storybook-visual", async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const bytes = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#173e35" } }).png().toBuffer();
  await page.route("https://image.example/slow.png", async route => { await ready; await route.fulfill({ contentType: "image/png", body: bytes }); });
  await page.setContent('<div style="height:2000px"></div><img loading="lazy" src="https://image.example/slow.png">');
  const image = page.locator("img");
  await image.scrollIntoViewIfNeeded();
  expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(false);
  const check = expectDecodedImage(image);
  release();
  await check;
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(48);
});

test("image readiness still fails for broken pixels @storybook-visual", async ({ page }) => {
  await page.route("https://image.example/broken.png", route => route.fulfill({ status: 404, body: "missing" }));
  await page.setContent('<img src="https://image.example/broken.png">');
  let failure: unknown;
  try { await expectDecodedImage(page.locator("img"), 600); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(await page.locator("img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(0);
});
