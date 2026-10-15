import { expect, test } from "@playwright/test";
import path from "node:path";
import { prepareVisualPage, waitForVisualReady } from "./public-routes";
test.beforeEach(async ({ page }) => { await prepareVisualPage(page); });

for (const state of ["collapsed", "expanded"]) {
  test(`public media card ${state} @storybook-visual`, async ({ page }, testInfo) => {
    await page.goto(`/iframe.html?id=public-media-asset-card--${state}&viewMode=story`);
    const card = page.locator("article");
    await expect(card.getByRole("link", { name: "View source" })).toBeVisible();
    if (state === "expanded") {
      await expect(card.getByText("Uploaded by", { exact: true })).toBeVisible();
      await expect(card.getByText("Shared by Karly", { exact: true })).toBeVisible();
    } else {
      await expect(card.getByText("Shared by Karly", { exact: true })).toHaveCount(0);
    }
    await waitForVisualReady(page);
    await card.locator("img").evaluate(async image => { if (image instanceof HTMLImageElement) await image.decode(); });
    await expect(card.locator("img")).toHaveClass(/opacity-100/);
    await expect(card.getByRole("status", { name: "Loading image" })).toHaveCount(0);
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await card.screenshot({ path: path.resolve(process.cwd(), "../../.cache/artifacts", `public-media-story-${testInfo.project.name}-${state}.png`) });
  });
}


for (const story of ["no-destination", "invalid-destination"]) {
  test(`connected media card ${story} has no unavailable disclosure or reads @storybook-visual`, async ({ page }, testInfo) => {
    let reads = 0;
    await page.route("**/api/v0/profiles/*/assets/*", async route => { reads++; await route.fulfill({ status: 404 }); });
    await page.goto(`/iframe.html?id=public-media-asset-card--${story}&viewMode=story#media-synthetic-portrait`);
    const card = page.locator("article#media-synthetic-portrait");
    await expect(card.getByRole("heading", { name: "Aurora press portrait" })).toBeVisible();
    await expect(card.locator("img")).toHaveClass(/opacity-100/);
    await expect(card.getByRole("link", { name: "View source" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Download Aurora press portrait" })).toBeVisible();
    await expect(card.locator("details, summary")).toHaveCount(0);
    await page.evaluate(() => { window.location.hash = "other"; window.location.hash = "media-synthetic-portrait"; });
    await expect(card.getByRole("status")).toHaveCount(0);
    await expect(card.locator("details, summary")).toHaveCount(0);
    expect(reads).toBe(0);
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (story === "no-destination") {
      if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await card.screenshot({ path: path.resolve(process.cwd(), "../../.cache/artifacts", `public-media-story-${testInfo.project.name}-no-destination.png`) });
    }
  });
}

test("connected media card preserves lazy, single read and matching anchor flow @storybook-visual", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/v0/profiles/aurora/assets/synthetic-portrait", async route => {
    reads++;
    await route.fulfill({ json: { profileSlug: "aurora", asset: { assetId: "synthetic-portrait", downloadUrl: "/file", mimeType: "image/png", byteSize: 128 }, uploadedBy: null, referenceUrl: null, credit: "Shared by Karly", history: [{ kind: "uploaded", at: null, actor: null }] } });
  });
  await page.goto("/iframe.html?id=public-media-asset-card--connected&viewMode=story#media-foreign");
  const card = page.locator("article");
  await expect(card.locator("summary")).toBeVisible();
  await expect(card.locator("details")).not.toHaveAttribute("open");
  expect(reads).toBe(0);
  await card.locator("summary").click();
  await expect(card.getByText("Shared by Karly", { exact: true })).toBeVisible();
  await card.locator("summary").click();
  await page.evaluate(() => { window.location.hash = "media-synthetic-portrait"; });
  await expect(card.locator("details")).toHaveAttribute("open", "");
  await expect(card.getByText("Shared by Karly", { exact: true })).toBeVisible();
  expect(reads).toBe(1);
});
