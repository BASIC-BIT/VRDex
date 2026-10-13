import { expect, type Locator } from "@playwright/test";

export async function expectDecodedImage(image: Locator, timeout = 15_000) {
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout }).toBe(true);
}
