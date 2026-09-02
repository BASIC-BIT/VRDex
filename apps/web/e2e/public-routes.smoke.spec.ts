import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

import type { PublicEventShareCard } from "../../../convex/_eventShareCard";
import { eventShareRevision } from "../src/lib/event-share-card";
import {
  capturedRoutes,
  expectEventPage,
  expectSearchPage,
  prepareVisualPage,
  productionSmokeRoutes,
  visualProfilePaths,
} from "./public-routes";

const routes = process.env.PLAYWRIGHT_BASE_URL ? productionSmokeRoutes : capturedRoutes;
const isHostedRun = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const eventShareImageFixtures = [
  {
    name: "event-open-graph-image-no-artwork",
    event: {
      slug: "playwright-event-share-no-artwork",
      communitySlug: "playwright-afterglow-social",
      communityName: "Afterglow Social",
      title: "Night Shift",
      startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
      timezone: "America/New_York",
      status: "scheduled",
    },
  },
  {
    name: "event-open-graph-image-cancelled-long",
    event: {
      slug: "playwright-event-share-cancelled-long",
      communitySlug: "playwright-afterglow-social",
      communityName: "Afterglow Social",
      title: "Afterglow Harbor Sessions Presents an Extra Long Community Showcase Night",
      startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
      timezone: "America/New_York",
      status: "cancelled",
    },
  },
  {
    name: "event-open-graph-image-long-community",
    event: {
      slug: "playwright-event-share-long-community",
      communitySlug: "playwright-afterglow-social",
      communityName: "A".repeat(80),
      title: "Night Shift",
      startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
      timezone: "America/New_York",
      status: "scheduled",
    },
  },
] as const satisfies ReadonlyArray<{ name: string; event: PublicEventShareCard }>;

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

for (const route of routes) {
  test(`${route.name} renders`, async ({ page }) => {
    await page.goto(route.path);
    await route.expectPage(page);
  });
}

test("sign-in offers a route to create an account", async ({ page }) => {
  await page.goto("/sign-in");

  // The credential fields and the progressive-disclosure button belonged to the
  // removed VRDex form; Clerk's identifier-first UI owns them now and asserting
  // its markup would break on any upstream change. What is still VRDex's, and
  // still worth guarding, is that a visitor can reach account creation — the
  // action Clerk routes to `/sign-up`, which needs its own catch-all route to
  // exist rather than 404.
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();

  await page.goto("/sign-up");
  await expect(
    page.getByRole("heading", { name: "Create account", exact: true }),
  ).toBeVisible();
});

test("legacy discovery query redirects to search", async ({ page }) => {
  await page.goto("/discover?q=aurora");
  await expect(page).toHaveURL(/\/search\?q=aurora$/);

  if (process.env.PLAYWRIGHT_BASE_URL) {
    await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Results for aurora/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
    return;
  }

  await expectSearchPage(page);
});

test("legacy media contribution route rejects claimed profiles", async ({ page }) => {
  test.skip(isHostedRun, "The Playwright-only media contribution flag is local-only.");

  const response = await page.goto(`${visualProfilePaths.verifiedPersonPath}/contribute-media`);

  expect(response?.status()).toBe(404);
});

test("private profile claim actions stay on owner-aware routes", async ({ page }) => {
  test.skip(isHostedRun, "The Playwright-only claim fixture is not enabled on hosted targets.");

  await page.goto("/playwright/claim?private=1");

  await expect(page.getByRole("link", { name: "Back to account" })).toHaveAttribute("href", "/account");
  await expect(page.getByRole("link", { name: "Manage profile" })).toHaveAttribute(
    "href",
    "/account/appearance?profileId=playwright-profile",
  );
  await expect(page.getByRole("link", { name: "View profile" })).toHaveCount(0);
  await expect(page.getByText("vrdex.net/basicbit")).toHaveCount(0);

  await page.getByRole("link", { name: "Manage profile" }).click();
  await expect(page).toHaveURL(/\/account\/appearance\?profileId=playwright-profile$/);
  await expect(page.getByRole("link", { name: "View profile" })).toHaveCount(0);
});

test("OpenAPI YAML document is served", async ({ page }) => {
  const response = await page.request.get("/api/v0/openapi.yaml");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/yaml");

  const body = await response.text();

  expect(body).toContain("openapi: 3.1.0");
  expect(body).toContain("/api/v0/openapi.yaml:");
});

test("profile links expose Discord-ready metadata and a generated image", async ({ page }, testInfo) => {
  test.skip(isHostedRun, "The deterministic profile metadata fixture is local-only.");

  await page.goto("/playwright-dj-aurora");

  await expect(page).toHaveTitle("DJ Aurora | VRDex");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "DJ Aurora | VRDex",
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    "Melodic house sets for late-night VRChat floors.",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    /\/playwright-dj-aurora$/,
  );

  const imageUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(imageUrl).not.toBeNull();

  const rasterFixture = await page.request.get(
    "/api/e2e/fixture-assets/fixture-aurora-profile-image-raster",
  );
  expect(rasterFixture.ok()).toBe(true);
  expect(rasterFixture.headers()["content-type"]).toContain("image/jpeg");
  expect(Array.from((await rasterFixture.body()).subarray(0, 3))).toEqual([
    0xff, 0xd8, 0xff,
  ]);

  const imageRequestUrl = new URL(imageUrl!);
  imageRequestUrl.searchParams.set("fixture", "raster-avatar");
  const imageResponse = await page.request.get(imageRequestUrl.href);
  expect(imageResponse.ok()).toBe(true);
  expect(imageResponse.headers()["content-type"]).toContain("image/png");
  const imageBody = await imageResponse.body();
  expect(imageBody.byteLength).toBeGreaterThan(1_000);
  const profileOpenGraphImagePath = testInfo.outputPath("profile-open-graph-image.png");
  await writeFile(profileOpenGraphImagePath, imageBody);
  await testInfo.attach("profile-open-graph-image", {
    path: profileOpenGraphImagePath,
    contentType: "image/png",
  });
  const renderedPixels = await sharp(imageBody).ensureAlpha().raw().toBuffer();
  let rasterFixturePixelCount = 0;
  for (let offset = 0; offset < renderedPixels.length; offset += 4) {
    if (
      Math.abs(renderedPixels[offset]! - 0xd6) <= 12 &&
      Math.abs(renderedPixels[offset + 1]! - 0x6a) <= 12 &&
      Math.abs(renderedPixels[offset + 2]! - 0x4d) <= 12
    ) {
      rasterFixturePixelCount += 1;
    }
  }
  expect(rasterFixturePixelCount).toBeGreaterThan(1_000);

  const maxContentImage = await page.request.get("/playwright-max-share-card/opengraph-image");
  expect(maxContentImage.ok()).toBe(true);
  await testInfo.attach("profile-open-graph-image-max-content", {
    body: await maxContentImage.body(),
    contentType: "image/png",
  });

  const invalidSlugImage = await page.request.get("/not_valid/opengraph-image");
  expect(invalidSlugImage.status()).toBe(404);

  const missingSlugImage = await page.request.get("/scanner-unique-123/opengraph-image");
  expect(missingSlugImage.status()).toBe(404);

  for (const entitySlug of [
    "playwright-neon-harbor",
    "playwright-afterglow-harbor-sessions",
  ]) {
    const entityImage = await page.request.get(`/${entitySlug}/opengraph-image`);
    expect(entityImage.status()).toBe(200);
    expect(entityImage.headers()["content-type"]).toContain("image/png");
  }
});

test("event links expose community-scoped metadata and a poster share image", async ({ page }, testInfo) => {
  test.skip(isHostedRun, "The deterministic event metadata fixture is local-only.");

  await page.goto(visualProfilePaths.eventPath);

  await expect(page).toHaveTitle("Afterglow Harbor Sessions | VRDex");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Afterglow Harbor Sessions | VRDex",
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    "Late-night harbor club session with house, trance, and warm social energy.",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    /\/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/,
  );

  const imageUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(imageUrl).not.toBeNull();
  expect(imageUrl).toMatch(/\/opengraph-image\?revision=[0-9a-f]{16}$/);

  const imageResponse = await page.request.get(imageUrl!);
  expect(imageResponse.ok()).toBe(true);
  expect(imageResponse.headers()["content-type"]).toContain("image/png");
  expect(imageResponse.headers()["cache-control"]).toBe("no-store");
  const imageBody = await imageResponse.body();
  const metadata = await sharp(imageBody).metadata();
  expect(metadata.width).toBe(1200);
  expect(metadata.height).toBe(630);

  const imagePath = testInfo.outputPath("event-open-graph-image.png");
  await writeFile(imagePath, imageBody);
  await testInfo.attach("event-open-graph-image", {
    path: imagePath,
    contentType: "image/png",
  });

  const renderedPixels = await sharp(imageBody).ensureAlpha().raw().toBuffer();
  let posterPixelCount = 0;
  for (let offset = 0; offset < renderedPixels.length; offset += 4) {
    if (
      renderedPixels[offset]! > 40 &&
      renderedPixels[offset + 2]! > 80 &&
      renderedPixels[offset + 2]! > renderedPixels[offset + 1]!
    ) {
      posterPixelCount += 1;
    }
  }
  expect(posterPixelCount).toBeGreaterThan(1_000);

  for (const fixture of eventShareImageFixtures) {
    const fixtureResponse = await page.request.get(
      `/playwright-afterglow-social/events/${fixture.event.slug}/opengraph-image?revision=${eventShareRevision(fixture.event)}`,
    );
    expect(fixtureResponse.ok()).toBe(true);
    const fixtureBody = await fixtureResponse.body();
    const fixturePath = testInfo.outputPath(`${fixture.name}.png`);
    await writeFile(fixturePath, fixtureBody);
    await testInfo.attach(fixture.name, {
      path: fixturePath,
      contentType: "image/png",
    });
  }

  const fabricatedRevisionUrl = new URL(imageUrl!);
  fabricatedRevisionUrl.searchParams.set("revision", "0000000000000000");
  const fabricatedRevision = await page.request.get(fabricatedRevisionUrl.href);
  expect(fabricatedRevision.status()).toBe(404);
  expect(fabricatedRevision.headers()["cache-control"]).toBe("no-store");

  const extraQueryUrl = new URL(imageUrl!);
  extraQueryUrl.searchParams.set("cache-buster", "1");
  expect((await page.request.get(extraQueryUrl.href)).status()).toBe(404);

  const wrongCommunityImage = await page.request.get(
    "/playwright-dj-aurora/events/playwright-afterglow-harbor-sessions/opengraph-image",
  );
  expect(wrongCommunityImage.status()).toBe(404);

  const missingEventImage = await page.request.get(
    "/playwright-afterglow-social/events/missing-event/opengraph-image",
  );
  expect(missingEventImage.status()).toBe(404);
});

test("public API supports browser CORS and preflight", async ({ page }) => {
  const origin = "https://developer.example.test";
  const response = await page.request.get("/api/v0/openapi.json", {
    headers: { Origin: origin },
  });

  expect(response.ok()).toBe(true);
  expect(response.headers()["access-control-allow-origin"]).toBe("*");
  expect(response.headers()["access-control-allow-credentials"]).toBeUndefined();
  expect(response.headers()["access-control-expose-headers"]).toContain("RateLimit-Limit");

  const preflight = await page.request.fetch("/api/v0/developer/oauth-apps/example", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Headers": "authorization, content-type",
      "Access-Control-Request-Method": "PATCH",
    },
  });

  expect(preflight.ok()).toBe(true);
  expect(preflight.headers()["access-control-allow-origin"]).toBe("*");
  expect(preflight.headers()["access-control-allow-credentials"]).toBeUndefined();
  expect(preflight.headers()["access-control-allow-methods"]).toContain("PATCH");
  expect(preflight.headers()["access-control-allow-headers"]).toContain("Authorization");
  expect(preflight.headers()["access-control-allow-headers"]).not.toContain("Cookie");
  expect(preflight.headers()["access-control-allow-headers"]).not.toContain("X-CSRF-Token");
  expect(preflight.headers()["access-control-allow-headers"]).not.toContain("X-Arbitrary-Client-Header");
  expect(preflight.headers()["access-control-max-age"]).toBe("600");
});

test.describe("hosted lookup smoke", () => {
  test.skip(!isHostedRun, "Hosted-only smoke coverage.");

  test("anonymous public API search succeeds", async ({ page }) => {
    const response = await page.request.get("/api/v0/search?q=basicbit&limit=1");
    const responseText = await response.text();

    expect(response.status(), responseText).toBe(200);

    const body = JSON.parse(responseText) as { results?: unknown };
    expect(Array.isArray(body.results)).toBe(true);
  });

  test("lookup route and suggest endpoint render", async ({ page }) => {
    await page.goto("/lookup");
    await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
    await expect(page).toHaveURL(/\/search\?view=dj$/);
    await expect(page.getByLabel("DJ name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Lookup", exact: true })).toBeVisible();

    const suggestResponse = await page.request.get("/lookup/suggest?q=a");
    expect(suggestResponse.ok()).toBe(true);
    const suggestBody = await suggestResponse.json();
    expect(Array.isArray(suggestBody.results)).toBe(true);
  });
});

test.describe("fixture lookup smoke", () => {
  test.skip(isHostedRun, "Fixture-specific lookup suggestions are local-only.");

  test("VRCDN live state recovers after the profile renders without a reload", async ({ page }) => {
    let attempts = 0;
    let releaseFirstResponse: () => void = () => {};
    const firstResponseHold = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });

    await page.route("**/api/profile-live/basicbit/vrcdn?attempt=*", async (route) => {
      attempts += 1;

      if (attempts === 1) {
        await firstResponseHold;
        await route.fulfill({ contentType: "application/json", json: { states: { basicbit: "unavailable" } } });
        return;
      }

      await route.fulfill({ contentType: "application/json", json: { states: { basicbit: "live" } } });
    });

    await page.goto("/basicbit");
    await expect(page.getByRole("heading", { name: "BASICBIT" })).toBeVisible();
    await expect.poll(() => attempts).toBe(1);
    await expect(page.getByRole("heading", { name: "Watch" })).toBeVisible();
    await expect(page.getByText("VRCDN stream", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Live now", { exact: true })).toHaveCount(0);

    releaseFirstResponse();

    await expect(page.getByText("VRCDN stream", { exact: true })).toBeVisible();
    await expect(page.getByText("Live now", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play VRCDN stream" })).toBeVisible();
    await expect(page.locator("video")).toHaveCount(0);
    expect(attempts).toBe(2);
  });

  test("VRCDN-only profile does not render an empty Watch surface while offline", async ({ page }) => {
    let attempts = 0;

    await page.route("**/api/profile-live/playwright-dj-night-market/vrcdn?attempt=*", async (route) => {
      attempts += 1;
      await route.fulfill({ contentType: "application/json", json: { states: { "dj-night-market": "offline" } } });
    });

    await page.goto("/playwright-dj-night-market");
    await expect(page.getByRole("heading", { name: "DJ Night Market" })).toBeVisible();
    await expect.poll(() => attempts).toBe(1);
    await expect(page.getByRole("heading", { name: "Watch" })).toHaveCount(0);
    await expect(page.getByText("VRCDN stream", { exact: true })).toHaveCount(0);
  });

  test("confirmed VRCDN player stays mounted while a failed retry is pending", async ({ page }) => {
    let attempts = 0;
    let releaseFirstResponse: () => void = () => {};
    let releaseSecondResponse: () => void = () => {};
    const firstResponseHold = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    const secondResponseHold = new Promise<void>((resolve) => {
      releaseSecondResponse = resolve;
    });

    await page.route("**/api/profile-live/playwright-dj-aurora/vrcdn?attempt=*", async (route) => {
      attempts += 1;

      if (attempts === 1) {
        await firstResponseHold;
        await route.fulfill({ contentType: "application/json", json: { states: { "dj-aurora": "unavailable" } } });
        return;
      }

      await secondResponseHold;
      await route.fulfill({ status: 503 });
    });

    await page.goto("/playwright-dj-aurora");
    const player = page.getByRole("button", { name: "Play VRCDN" });
    await expect(player).toBeVisible();
    await expect(page.getByRole("link", { name: "Suggested VRCDN" })).toBeVisible();
    await player.evaluate((element) => {
      element.setAttribute("data-lifecycle-marker", "original");
    });

    releaseFirstResponse();

    await expect.poll(() => attempts).toBe(2);
    await expect(player).toHaveAttribute("data-lifecycle-marker", "original");
    await expect(player).toBeVisible();

    releaseSecondResponse();

    await expect(player).toHaveCount(0);
    await expect(page.getByText("VRCDN", { exact: true })).toHaveCount(0);
  });

  test("confirmed VRCDN player survives two profile-live route failures", async ({ page }) => {
    let attempts = 0;
    let releaseFirstResponse: () => void = () => {};
    const firstResponseHold = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });

    await page.route("**/api/profile-live/playwright-dj-aurora/vrcdn?attempt=*", async (route) => {
      attempts += 1;

      if (attempts === 1) {
        await firstResponseHold;
      }

      await route.fulfill({ status: 503 });
    });

    await page.goto("/playwright-dj-aurora");
    const player = page.getByRole("button", { name: "Play VRCDN" });
    await expect(player).toBeVisible();
    await player.evaluate((element) => {
      element.setAttribute("data-lifecycle-marker", "original");
    });

    releaseFirstResponse();

    await expect.poll(() => attempts).toBe(2);
    await expect(player).toHaveAttribute("data-lifecycle-marker", "original");
    await expect(player).toBeVisible();
  });

  test("VRCDN live endpoint stays profile-scoped and private", async ({ page }) => {
    const response = await page.request.get("/api/profile-live/playwright-dj-aurora/vrcdn");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ states: { "dj-aurora": "live" } });
  });

  test("profile claim actions stay separate and keyboard focusable", async ({ page }) => {
    await page.goto("/playwright-afterglow-social");

    const communityCard = page.getByRole("region", { name: "Afterglow Social" });
    const communityClaim = page
      .getByRole("complementary", { name: "Profile ownership" })
      .getByRole("link", { name: "Claim profile" });

    await expect(communityCard.getByRole("link", { name: "Claim profile" })).toHaveCount(0);
    await communityClaim.focus();
    await expect(communityClaim).toBeFocused();

    await page.goto("/playwright-dj-aurora");

    const personCard = page.getByRole("region", { name: "DJ Aurora" });
    const personClaim = page
      .getByRole("complementary", { name: "Profile ownership" })
      .getByRole("link", { name: "Claim profile" });

    await expect(personCard.getByRole("link", { name: "Claim profile" })).toHaveCount(0);
    await personClaim.focus();
    await expect(personClaim).toBeFocused();

    await page.goto("/basicbit");
    await expect(page.getByRole("complementary", { name: "Profile ownership" })).toHaveCount(0);
  });

  test("event short link redirects to its public event", async ({ page }) => {
    await page.goto("/l/afh2x67");
    await expect(page).toHaveURL(
      /\/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/,
    );
    await expectEventPage(page);
  });

  test("lookup suggestions select a public person row", async ({ page }) => {
    await page.goto("/lookup");
    await page.getByLabel("DJ name").fill("b");
    const basicBitOption = page.getByRole("option", { name: /BASICBIT/i });
    await expect(basicBitOption).toHaveCount(1);
    await expect(basicBitOption).not.toContainText("Private seed");
    await page.getByLabel("DJ name").press("ArrowDown");
    await expect(page.getByRole("option", { selected: true })).toHaveClass(/bg-surface-strong/);
    await basicBitOption.click();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
    await expect(page.getByRole("link", { name: "BASICBIT", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Website: basicbit.net", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "VRCDN preview", exact: true })).toBeVisible();
    await expect(page.locator('input[value="basic_bit"]')).toHaveCount(2);
    await expect(page.getByRole("link", { name: /Discord:/ })).toHaveCount(0);
    await expect(page.locator('input[value="https://stream.vrcdn.live/live/basicbit.live.ts"]')).toHaveCount(2);
    await expect(page.locator('input[value="rtspt://stream.vrcdn.live/live/basicbit"]')).toHaveCount(2);
    await expect(page.locator('input[value="https://www.twitch.tv/basic_bit"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Twitch: twitch.tv", exact: true })).toBeVisible();
    await expect(page.getByText("BASIC", { exact: true })).toHaveCount(2);
    const copyButton = page.getByRole("button", { name: "Copy" }).first();
    const copyButtonWidth = await copyButton.evaluate((element) => (element as HTMLElement).offsetWidth);
    await copyButton.click();
    const copiedButton = page.getByRole("button", { name: "Copied" }).first();
    await expect(copiedButton).toBeVisible();
    const copiedButtonWidth = await copiedButton.evaluate((element) => (element as HTMLElement).offsetWidth);
    expect(copiedButtonWidth).toBe(copyButtonWidth);
    await expect.poll(async () => await page.evaluate(() => JSON.parse(window.localStorage.getItem("vrdex.lookup.recentSearches") ?? "[]")[0])).toBe("BASICBIT");
    await page.getByRole("button", { name: "Clear lookup" }).click();
    await page.getByLabel("DJ name").focus();
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toBeVisible();
  });

  test("lookup hides stale suggestions as soon as the visible query changes", async ({ page }) => {
    await page.goto("/search?view=dj");
    const lookupInput = page.getByLabel("DJ name");

    await lookupInput.fill("b");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toBeVisible();
    await lookupInput.fill("unrelated query");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toHaveCount(0);
  });

  test("lookup promotes Shift+Enter and multiline paste into bulk mode", async ({ page }) => {
    await page.goto("/search?view=dj");
    const lookupInput = page.getByLabel("DJ name");

    await lookupInput.fill("BASICBIT");
    await lookupInput.press("Shift+Enter");

    const shiftedBulkEditor = page.getByLabel("Lineup text");
    await expect(shiftedBulkEditor).toBeFocused();
    await expect(shiftedBulkEditor).toHaveValue("BASICBIT\n");
    await expect(page.getByRole("button", { name: "Single" })).toHaveAttribute("aria-pressed", "true");

    await page.goto("/search?view=dj");
    const pasteTarget = page.getByLabel("DJ name");

    await pasteTarget.evaluate((element) => {
      const clipboardData = new DataTransfer();

      clipboardData.setData("text/plain", "BASICBIT\nDJ Aurora");
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    });

    const pastedBulkEditor = page.getByLabel("Lineup text");
    await expect(pastedBulkEditor).toBeFocused();
    await expect(pastedBulkEditor).toHaveValue("BASICBIT\nDJ Aurora");
    await expect(page.getByText("2 pasted entries")).toBeVisible();
  });

  test("standard search hides stale suggestions as soon as the visible query changes", async ({ page }) => {
    await page.goto("/search");
    const searchInput = page.getByRole("combobox", { name: /Search/i });

    await searchInput.fill("basic");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toBeVisible();
    await searchInput.fill("unrelated query");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toHaveCount(0);
  });

  test("standard search keeps typeahead and submission within the active entity filter", async ({ page }) => {
    await page.goto("/search?q=BASICBIT&type=person");
    const searchInput = page.getByRole("combobox", { name: /Search/i });
    const suggestionResponse = page.waitForResponse((response) =>
      response.url().includes("/search/suggest?q=Afterglow&type=person"),
    );

    await searchInput.fill("Afterglow");
    await suggestionResponse;
    await expect(page.getByRole("option", { name: /Afterglow Harbor Sessions/i })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /Afterglow Social/i })).toHaveCount(0);

    await searchInput.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=Afterglow&type=person$/);
    await expect(page.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
  });

  test("unified search preserves BASICBIT identity across standard and DJ views", async ({ page }) => {
    await page.goto("/search?q=BASICBIT");

    await expect(page.getByRole("link", { name: "All VRDex" })).toHaveAttribute("aria-current", "page");
    const standardResults = page.getByRole("region", { name: "Search results" });
    await expect(standardResults.getByRole("link", { name: /BASICBIT/ })).toHaveCount(1);
    await expect(standardResults.getByText("BASICBIT", { exact: true })).toBeVisible();
    await expect(standardResults.getByText("Software Dev | 3D Designer | VRDJ")).toBeVisible();
    await expect(standardResults.getByRole("img", { name: "BASICBIT" })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT$/);
    await expect(page.getByRole("link", { name: "All VRDex" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: "Search results" }).getByText("BASICBIT", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "DJ links" }).click();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
    await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
    await expect(page.getByRole("link", { name: "DJ links" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "BASICBIT", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Website: basicbit.net", exact: true })).toBeVisible();
    const djAvatar = page.locator(".lookup-avatar img").first();
    await expect(djAvatar).toBeVisible();
    await expect(djAvatar).toHaveAttribute("src", /fixture-avatar-velvet-circuit\.svg/);

    await page.reload();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
    await expect(page.getByRole("link", { name: "DJ links" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "BASICBIT", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "All VRDex" }).click();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT$/);
    await expect(page.getByRole("link", { name: "All VRDex" })).toHaveAttribute("aria-current", "page");

    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
    await expect(page.getByRole("link", { name: "DJ links" })).toHaveAttribute("aria-current", "page");

    await page.goForward();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT$/);
    await expect(page.getByRole("link", { name: "All VRDex" })).toHaveAttribute("aria-current", "page");
  });

  test("search views share empty states and legacy lookup preserves its query", async ({ page }) => {
    await page.goto("/lookup?q=No%20Matching%20Fixture");
    await expect(page).toHaveURL(/\/search\?q=No(?:%20|\+)Matching(?:%20|\+)Fixture&view=dj$/);
    await expect(page.getByText("No matches found.", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "All VRDex" }).click();
    await expect(page).toHaveURL(/\/search\?q=No(?:%20|\+)Matching(?:%20|\+)Fixture$/);
    await expect(page.getByText("No public results matched that search yet.", { exact: true })).toBeVisible();

    await page.goto("/search?q=BASICBIT&view=dj&type=world");
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
    await expect(page.getByRole("link", { name: "DJ links" })).toHaveAttribute("aria-current", "page");
  });

  test("standard search supports keyboard typeahead and sparse profile fallbacks", async ({ page }) => {
    await page.goto("/search");
    const searchInput = page.getByRole("combobox", { name: /Search/i });

    await searchInput.fill("basic");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toBeVisible();
    await searchInput.press("ArrowDown");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toHaveClass(/bg-surface-strong/);
    await searchInput.press("Enter");
    await expect(page).toHaveURL(/\/basicbit$/);

    await page.goto("/search?q=Sparse%20Import");
    const sparseResult = page.getByRole("region", { name: "Search results" });
    await expect(sparseResult.getByText("Sparse Import", { exact: true })).toBeVisible();
    await expect(sparseResult.getByRole("img", { name: "Sparse Import" })).toHaveCount(0);
    await expect(sparseResult.getByRole("link", { name: "Claim this profile" })).toHaveAttribute(
      "href",
      "/claim/playwright-sparse-import?source=search",
    );
    await expect(sparseResult.getByText("Imported profile seed", { exact: true })).toHaveCount(0);

    await page.goto("/search?q=Sparse%20Import&view=dj");
    await expect(page.getByRole("link", { name: "Sparse Import", exact: true })).toBeVisible();
    await expect(page.getByText(/Imported profile seed|Unclaimed/, { exact: true })).toHaveCount(0);

    await page.goto("/search?q=DJ%20Aurora&view=dj");
    await expect(page.getByText("Community submitted", { exact: true })).toHaveCount(0);
  });

  test("lookup suggestions include authorized private seed rows", async ({ page }) => {
    await page.goto("/lookup");
    await page.getByLabel("DJ name").fill("nwinn");

    const privateOption = page.getByRole("option", { name: "DJ Northstar", exact: true });

    await expect(privateOption).toBeVisible();
    await expect(privateOption).not.toContainText(/Private seed|NWinn/);
    await privateOption.click();
    await expect(page).toHaveURL((url) =>
      url.pathname === "/search" &&
      url.searchParams.get("q") === "DJ Northstar" &&
      url.searchParams.get("view") === "dj",
    );
    const privateResult = page.locator(".lookup-result-card.ph-no-capture").filter({ hasText: "DJ Northstar" });
    await expect(privateResult).toBeVisible();
    await expect(privateResult).not.toContainText(/Private seed|Source|Reviewed|Freshness|Jul 9, 2026|Checked Jul 8, 2026/);
  });

  test("logo-only DJ suggestions stay contained and unframed", async ({ page }) => {
    await page.route("**/lookup/suggest?q=logo-only", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          privateResults: [],
          results: [{
            aliases: [],
            avatarImageKind: "logo",
            avatarImageUrl: "/seed/fixture-avatar-luma.svg",
            displayName: "Logo Only",
            genres: [],
            outboundLinks: [],
            profilePath: "/logo-only",
            roleTags: ["DJ"],
            slug: "logo-only",
            tags: [],
            trustLabel: "claimed_unverified",
          }],
          viewerAccess: { allowed: false, source: "signed_out" },
        },
      });
    });

    await page.goto("/search?view=dj");
    await page.getByLabel("DJ name").fill("logo-only");
    const option = page.getByRole("option", { name: /Logo Only/ });
    const logo = option.locator(".lookup-avatar--logo");

    await expect(option).toBeVisible();
    await expect(logo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(logo).toHaveCSS("border-top-width", "0px");
    await expect(logo).toHaveCSS("border-radius", "0px");
    await expect(logo.locator("img")).toHaveCSS("object-fit", "contain");
  });

  test("verified profiles use the same compact mark across profile and search views", async ({ page }, testInfo) => {
    await page.goto("/basicbit");
    const profileMark = page.getByLabel("Verified profile");
    await expect(profileMark).toBeVisible();
    const profileBox = await profileMark.boundingBox();

    await page.goto("/search?q=BASICBIT");
    const searchRegion = page.getByRole("region", { name: "Search results" });
    const searchResult = searchRegion.getByRole("link", { name: /BASICBIT Verified profile/ });
    const searchMark = searchRegion.getByLabel("Verified profile");
    const resultTypeIcon = searchRegion.getByRole("img", { name: "Person" });
    const resultTypeTooltip = searchRegion.getByText("Person", { exact: true });
    await expect(searchMark).toBeVisible();
    await expect(resultTypeIcon).toBeVisible();
    await expect(resultTypeTooltip).toHaveCSS("opacity", "0");
    if (testInfo.project.name === "desktop-chromium") {
      await searchResult.hover({ position: { x: 200, y: 45 } });
      await expect(resultTypeTooltip).toHaveCSS("opacity", "0");
      await resultTypeIcon.hover();
      await expect(resultTypeTooltip).toHaveCSS("opacity", "1");
    }
    await searchResult.focus();
    await expect(resultTypeTooltip).toHaveCSS("opacity", "1");
    const searchBox = await searchMark.boundingBox();

    await page.goto("/search?q=BASICBIT&view=dj");
    const lookupMark = page.getByLabel("Verified profile").first();
    await expect(lookupMark).toBeVisible();
    const lookupBox = await lookupMark.boundingBox();

    expect(profileBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    expect(lookupBox).not.toBeNull();
    expect(profileBox!.width).toBeLessThanOrEqual(18);
    expect(profileBox!.width).toBe(searchBox!.width);
    expect(profileBox!.height).toBe(searchBox!.height);
    expect(profileBox!.width).toBe(lookupBox!.width);
    expect(profileBox!.height).toBe(lookupBox!.height);
  });

  test("bulk lookup summaries dedupe overlapping public and private rows", async ({ page }) => {
    await page.goto("/lookup");
    await page.getByRole("button", { name: "Bulk" }).click();
    await page.getByLabel("Lineup text").fill("BASICBIT");
    await page.getByRole("button", { name: "Lookup lineup" }).click();

    const summaryRow = page.locator(".lookup-bulk-row").filter({ hasText: "BASICBIT" });

    await expect(summaryRow).toBeVisible();
    await expect(summaryRow.locator(".text-sm")).toHaveText("BASICBIT");
  });
});
