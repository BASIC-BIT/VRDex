import { expect, test } from "@playwright/test";
import { PublicProfileMediaDetailsSchema } from "@vrdex/api-contracts";
import { prepareVisualPage } from "./public-routes";
test.beforeEach(async ({ page }) => { await prepareVisualPage(page); });

const slug = "playwright-dj-aurora";
const assetId = "fixture-aurora-profile-image";
const endpoint = `/api/v0/profiles/${slug}/assets/${assetId}`;
const uploadedAt = Date.UTC(2026, 9, 1, 12, 30);
const details = PublicProfileMediaDetailsSchema.parse({
  profileSlug: slug,
  asset: { assetId, label: "Aurora press portrait", imageUrl: "/api/e2e/fixture-assets/fixture-aurora-profile-image", downloadUrl: "/file", mimeType: "image/png", byteSize: 1024 },
  referenceUrl: "https://example.invalid/afterglow-studio", credit: "Shared by Karly",
  uploadedBy: { displayName: "BASICBIT", profileSlug: "basicbit", profileUrl: "/basicbit" },
  history: [{ kind: "uploaded", at: uploadedAt, actor: { displayName: "BASICBIT", profileSlug: "basicbit", profileUrl: "/basicbit" } }, { kind: "published", at: null, actor: null }],
});

test("anonymous connected disclosure loads once and keeps attribution collapsed @flow @fixture", async ({ page }, testInfo) => {
  let reads = 0;
  await page.route(`**${endpoint}`, async route => { reads++; await route.fulfill({ json: details }); });
  await page.goto(`/${slug}`);
  const card = page.locator(`article#media-${assetId}`);
  await expect(card.getByRole("link", { name: "View source" })).toHaveAttribute("href", "https://example.invalid/afterglow-studio");
  await expect(card.getByText("Shared by Karly")).toHaveCount(0);
  expect(reads).toBe(0);
  await expect(card.locator("img")).toHaveClass(/opacity-100/);
  await card.screenshot({ path: testInfo.outputPath("public-media-collapsed.png") });
  const toggle = card.locator("summary");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("link", { name: "BASICBIT" }).first()).toHaveAttribute("href", "/basicbit");
  await expect(card.getByText("Shared by Karly")).toBeVisible();
  await expect(card.getByText("Published", { exact: true })).toBeVisible();
  const localized = await page.evaluate(at => new Date(at).toLocaleString(), uploadedAt);
  await expect(card.locator("time")).toHaveText(localized);
  await card.screenshot({ path: testInfo.outputPath("public-media-expanded.png") });
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await toggle.click(); await toggle.click();
  expect(reads).toBe(1);
});

test("matching anchor opens only its visible card and refusal reveals no stale attribution @flow @fixture", async ({ page }) => {
  let reads = 0;
  await page.route(`**${endpoint}`, async route => { reads++; await route.fulfill({ status: 404, json: { title: "Not found" } }); });
  await page.goto(`/${slug}#media-foreign-asset`);
  await expect(page.locator("details[open]")).toHaveCount(0);
  expect(reads).toBe(0);
  await expect(page.locator(`article#media-${assetId} summary`)).toBeVisible();
  await expect(page.locator(`article#media-${assetId} img`)).toHaveClass(/opacity-100/);
  await page.evaluate(id => { window.location.hash = `media-${id}`; }, assetId);
  await expect(page).toHaveURL(new RegExp(`#media-${assetId}$`));
  const card = page.locator(`article#media-${assetId}`);
  await expect(card.locator("details")).toHaveAttribute("open", "");
  await expect(card.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(card.getByText("BASICBIT")).toHaveCount(0);
  await expect(card.getByText("Shared by Karly")).toHaveCount(0);
  expect(reads).toBe(1);
  await expect(page.locator("details[open]")).toHaveCount(1);
});

test("missing actor stays unavailable without a fabricated contributor link @flow @fixture", async ({ page }) => {
  await page.route(`**${endpoint}`, route => route.fulfill({ json: { ...details, uploadedBy: null, history: [{ kind: "uploaded", at: uploadedAt, actor: null }] } }));
  await page.goto(`/${slug}#media-${assetId}`);
  const card = page.locator(`article#media-${assetId}`);
  await expect(card.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: "BASICBIT" })).toHaveCount(0);
});






