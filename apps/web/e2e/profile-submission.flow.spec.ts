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
