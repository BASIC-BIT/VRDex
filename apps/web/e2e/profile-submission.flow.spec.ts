import { expect, test } from "@playwright/test";

import { captureRouteScreenshot } from "./public-routes";

test("profile submission writes through to public profile and discovery @flow", async ({ page, request, baseURL }, testInfo) => {
  const e2eToken = process.env.VRDEX_E2E_BROWSER_TOKEN ?? "local-playwright-token";
  const runSuffix = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const displayName = `Playwright Flow ${runSuffix}`;
  let createdSlug: string | undefined;

  await page.context().addCookies([
    {
      name: "vrdex_e2e_token",
      value: e2eToken,
      url: baseURL ?? "http://127.0.0.1:3002",
    },
  ]);

  try {
    await page.goto("/submit");
    await expect(page.getByText(/server-side test gate/i)).toBeVisible();

    await page.getByLabel("Display name").fill(displayName);
    await page.getByLabel("Aliases").fill(`Flow ${runSuffix}`);
    await page.getByLabel("Shared tags").fill("playwright, data-flow");
    await page.getByLabel("Person roles").fill("Test profile");
    await page.getByRole("button", { name: "Submit profile" }).click();

    const profileLink = page.locator('a[href^="/p/"]').filter({ hasText: /View \/p\// }).first();
    await expect(profileLink).toBeVisible();
    const href = await profileLink.getAttribute("href");
    createdSlug = href?.split("/").filter(Boolean).at(-1);
    expect(createdSlug).toBeTruthy();
    await captureRouteScreenshot(page, testInfo, "profile-submission-flow-submit-success");

    await profileLink.click();
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
    await expect(page.getByText(/Source: Community submitted/i)).toBeVisible();
    await captureRouteScreenshot(page, testInfo, "profile-submission-flow-profile");

    await page.goto(`/discover?q=${encodeURIComponent(displayName)}`);
    await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible();
    await captureRouteScreenshot(page, testInfo, "profile-submission-flow-discovery");
  } finally {
    if (createdSlug) {
      const cleanupResponse = await request.delete("/api/e2e/profile-submissions", {
        headers: { "x-vrdex-e2e-token": e2eToken },
        data: { slug: createdSlug },
      });

      await expect(cleanupResponse).toBeOK();
    }
  }
});

test("E2E profile helper stays gated without the browser token @flow", async ({ page, request }) => {
  const e2eToken = process.env.VRDEX_E2E_BROWSER_TOKEN ?? "local-playwright-token";
  const payload = {
    runId: "playwright-negative-gate",
    profileType: "person",
    displayName: "Playwright Negative Gate",
    aliases: [],
    tags: [],
    roleTags: [],
  };

  const missingTokenResponse = await request.post("/api/e2e/profile-submissions", {
    data: payload,
  });
  expect(missingTokenResponse.status()).toBe(403);

  const wrongTokenResponse = await request.post("/api/e2e/profile-submissions", {
    headers: { "x-vrdex-e2e-token": "wrong-token" },
    data: payload,
  });
  expect(wrongTokenResponse.status()).toBe(403);

  const malformedPostResponse = await request.post("/api/e2e/profile-submissions", {
    headers: { "content-type": "application/json", "x-vrdex-e2e-token": e2eToken },
    data: "{not-json",
  });
  expect(malformedPostResponse.status()).toBe(400);

  const missingDeleteTokenResponse = await request.delete("/api/e2e/profile-submissions", {
    data: { slug: "playwright-negative-gate" },
  });
  expect(missingDeleteTokenResponse.status()).toBe(403);

  const malformedDeleteResponse = await request.delete("/api/e2e/profile-submissions", {
    headers: { "content-type": "application/json", "x-vrdex-e2e-token": e2eToken },
    data: "{not-json",
  });
  expect(malformedDeleteResponse.status()).toBe(400);

  await page.goto("/submit");
  await expect(page.getByRole("heading", { name: "Sign-in required" })).toBeVisible();
  await expect(page.getByText(/server-side test gate/i)).toHaveCount(0);
});
