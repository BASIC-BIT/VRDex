import { expect, test } from "@playwright/test";

import { captureRouteScreenshot } from "./public-routes";

function e2eBrowserToken() {
  const token = process.env.VRDEX_E2E_BROWSER_TOKEN ?? (process.env.PLAYWRIGHT_BASE_URL ? undefined : "local-playwright-token");

  if (!token) {
    throw new Error("VRDEX_E2E_BROWSER_TOKEN must be set for hosted Playwright data-flow runs.");
  }

  return token;
}

function e2eRunId(testInfo: { project: { name: string }; workerIndex: number; repeatEachIndex: number }) {
  const prefix = process.env.VRDEX_E2E_RUN_ID ?? "playwright";

  return `${prefix}-${testInfo.project.name}-${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 120);
}

test("profile submission writes through to public profile and discovery @flow", async ({ page, request, baseURL }, testInfo) => {
  const e2eToken = e2eBrowserToken();
  const runId = e2eRunId(testInfo);
  const runSuffix = runId.replace(/^playwright-?/, "").slice(0, 48);
  const displayName = `Playwright Flow ${runSuffix}`;
  let createdSlug: string | undefined;

  await page.context().addCookies([
    {
      name: "vrdex_e2e_token",
      value: e2eToken,
      url: baseURL ?? "http://127.0.0.1:3002",
    },
    {
      name: "vrdex_e2e_run_id",
      value: runId,
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
    if (createdSlug || runId) {
      const cleanupResponse = await request.delete("/api/e2e/profile-submissions", {
        headers: { "x-vrdex-e2e-token": e2eToken },
        data: createdSlug ? { slug: createdSlug, runId } : { runId },
      });

      await expect(cleanupResponse).toBeOK();
    }
  }
});

test("profile field visibility keeps unlisted fields on profiles and out of discovery @flow", async ({ page, request }, testInfo) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_EXTENDED_PROFILE_FLOW !== "true",
    "Hosted extended profile flow is not enabled for this target.",
  );

  const e2eToken = e2eBrowserToken();
  const runId = e2eRunId(testInfo);
  const runSuffix = runId.replace(/^playwright-?/, "").slice(0, 48);
  const displayName = `Playwright Visibility ${runSuffix}`;
  const directOnlyToken = runSuffix.replace(/-/g, "").split("").reverse().join("").slice(0, 20);
  const directOnlyAlias = `AliasOnly ${directOnlyToken}`;
  const directOnlyBio = `DirectOnlyBio ${directOnlyToken}`;
  const privateRole = `role-${runSuffix.slice(0, 20)}`;
  const publicTag = `vis-${runSuffix.slice(0, 20)}`;
  let createdSlug: string | undefined;

  try {
    const profileResponse = await request.post("/api/e2e/profile-submissions", {
      headers: { "x-vrdex-e2e-token": e2eToken },
      data: {
        runId,
        profileType: "person",
        displayName,
        aliases: [directOnlyAlias],
        tags: [publicTag],
        roleTags: [privateRole],
        bio: directOnlyBio,
        fieldVisibility: {
          aliases: "unlisted",
          bio: "unlisted",
          personRoleTags: "private",
        },
      },
    });
    await expect(profileResponse).toBeOK();
    const profile = (await profileResponse.json()) as { slug?: string };
    createdSlug = profile.slug;
    expect(createdSlug).toBeTruthy();

    await page.goto(`/p/${createdSlug}`);
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
    await expect(page.getByText(directOnlyAlias)).toBeVisible();
    await expect(page.getByText(directOnlyBio).first()).toBeVisible();
    await expect(page.getByText(privateRole)).toHaveCount(0);

    await page.goto(`/discover?q=${encodeURIComponent(directOnlyAlias)}`);
    await expect(page.getByText("No public results matched that search yet.")).toBeVisible();
    await expect(page.getByText(displayName, { exact: true })).toHaveCount(0);

    await page.goto(`/discover?q=${encodeURIComponent(directOnlyBio)}`);
    await expect(page.getByText("No public results matched that search yet.")).toBeVisible();
    await expect(page.getByText(displayName, { exact: true })).toHaveCount(0);

    await page.goto(`/discover?q=${encodeURIComponent(publicTag)}`);
    await expect(page.getByText(displayName, { exact: true })).toBeVisible();
    await expect(page.getByText(directOnlyBio)).toHaveCount(0);
    await expect(page.getByText(privateRole)).toHaveCount(0);
  } finally {
    if (createdSlug || runId) {
      const cleanupResponse = await request.delete("/api/e2e/profile-submissions", {
        headers: { "x-vrdex-e2e-token": e2eToken },
        data: createdSlug ? { slug: createdSlug, runId } : { runId },
      });

      await expect(cleanupResponse).toBeOK();
    }
  }
});

test("E2E profile helper stays gated without the browser token @flow", async ({ page, request }) => {
  const e2eToken = e2eBrowserToken();
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
