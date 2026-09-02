import { expect, test, type Page } from "@playwright/test";

import { hostedTargetRunsCurrentRevision } from "./clerk-auth";
import { gotoFlowPage } from "./flow-navigation";
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

function searchResultsSection(page: Page) {
  return page
    .locator('section[aria-label="Search results"]')
    .or(page.locator("section").filter({ hasText: "Search results" }))
    .first();
}

test("profile submission writes through to public profile and discovery @flow", async ({ page, request, baseURL }, testInfo) => {
  const e2eToken = e2eBrowserToken();
  const runId = e2eRunId(testInfo);
  const runSuffix = runId.replace(/^playwright-?/, "").slice(0, 48);
  const displayName = `Playwright Flow ${runSuffix}`;
  const streamId = `flow${runSuffix.replace(/[^a-z0-9]+/gi, "")}`.slice(0, 60);
  // Set only when the stream input was actually on the page, so the readback
  // below asserts nothing on a target that never offered it.
  let submittedStreamId: string | undefined;
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
    await gotoFlowPage(page, "/submit");
    await expect(
      page
        .getByRole("heading", { name: "Add a profile" })
        .or(page.getByRole("heading", { name: "Add a missing VRChat scene profile." }))
        .first(),
    ).toBeVisible();

    await page.getByLabel("Display name").fill(displayName);
    await page.getByLabel("Aliases").fill(`Flow ${runSuffix}`);
    await page.getByLabel("Tags", { exact: true }).or(page.getByLabel("Shared tags", { exact: true })).first().fill("playwright, data-flow");

    // Driven by what the page actually renders, not by which revision the target
    // is meant to be on.
    //
    // This branched on `hostedTargetRunsCurrentRevision` alone and fell back to
    // the freeform input, on the reasoning that the helper is false exactly while
    // staging is behind. It is not: it is false on every branch that is not the
    // deployed revision, which is every pull request. So the moment the role
    // checkboxes reached staging the fallback stopped being a safety net and
    // became a guaranteed 30s wait for a control that no longer exists anywhere.
    //
    // The revision check still earns its place, one line down: once the target
    // provably runs this commit, the old shape is not tolerated at all, so this
    // cannot quietly go on accepting a regression.
    const roleCheckbox = page.getByRole("checkbox", { name: "DJ", exact: true });
    const rendersRoleCheckboxes = (await roleCheckbox.count()) > 0;

    if (await hostedTargetRunsCurrentRevision(request)) {
      expect(
        rendersRoleCheckboxes,
        "target runs this revision, so it must render the role checkboxes",
      ).toBe(true);
    }

    if (rendersRoleCheckboxes) {
      // Roles are checkboxes over a fixed vocabulary with a freeform field
      // beside it. Checking DJ is also what reveals the stream inputs, which is
      // why roles are asked for before links.
      const streamUrl = page.getByLabel("Stream");
      await expect(streamUrl).toHaveCount(0);
      await roleCheckbox.check();
      await expect(streamUrl).toBeVisible();
      await page.getByLabel("Other roles").fill("Test profile");

      // The URL VRCDN hands someone looking for their own stream, so it is what
      // they paste. It has to reach the profile as the public page URL: the seed
      // lane stored this shape verbatim and put VRCDN's operator console on
      // hundreds of public profiles.
      // Run-scoped like every other value here: two projects submit concurrently
      // against one backend, and a shared stream id would have them writing the
      // same derived values at the same time.
      await streamUrl.fill(`https://panel.vrcdn.live/preview/${streamId}`);
      submittedStreamId = streamId;
    } else {
      // Only reachable against a target that predates the checkboxes.
      await page.getByLabel("Person roles").fill("Test profile");
    }

    await page.getByRole("button", { name: "Submit profile" }).click();

    // The pre-dialog fallback keyed off `/p/`-prefixed hrefs, which no longer exist
    // now that profiles render from the site root.
    const profileLink = page.getByRole("dialog", { name: "Profile added" }).getByRole("link", {
      name: "View profile",
    });
    await expect(profileLink).toBeVisible();
    const href = await profileLink.getAttribute("href");
    createdSlug = href?.split("/").filter(Boolean).at(-1);
    expect(createdSlug).toBeTruthy();
    await captureRouteScreenshot(page, testInfo, "profile-submission-flow-submit-success");

    await profileLink.click();
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
    if (!process.env.PLAYWRIGHT_BASE_URL) {
      // Provenance is rendered now, in the ownership aside rather than above the
      // display name where it read as a label on the person. This asserted its
      // absence while nothing rendered it at all.
      await expect(
        page.getByRole("complementary", { name: "Profile ownership" }).getByText("Community submitted"),
      ).toBeVisible();
    }
    await expect(page.getByLabel("Verified profile")).toHaveCount(0);

    // Canonicalized on the way in: the panel preview URL that was typed is read
    // for its stream id and stored as the `vrcdn:<id>` identifier. A community
    // submission cannot support a liveness claim, so it remains an ordinary
    // outbound link instead of entering the live-only Watch surface.
    if (submittedStreamId !== undefined) {
      await expect(page.getByRole("link", { name: "VRCDN", exact: true })).toHaveAttribute(
        "href",
        `https://stream.vrcdn.live/live/${submittedStreamId}.live.ts`,
      );
    }
    await captureRouteScreenshot(page, testInfo, "profile-submission-flow-profile");

    await gotoFlowPage(page, `/search?q=${encodeURIComponent(displayName)}`);
    await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible();
    await captureRouteScreenshot(page, testInfo, "profile-submission-flow-search");
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

    await gotoFlowPage(page, `/${createdSlug}`);
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
    await expect(page.getByText(directOnlyAlias)).toBeVisible();
    await expect(page.getByText(directOnlyBio).first()).toBeVisible();
    await expect(page.getByText(privateRole)).toHaveCount(0);

    await gotoFlowPage(page, `/search?q=${encodeURIComponent(directOnlyAlias)}`);
    let searchResults = searchResultsSection(page);
    await expect(searchResults.getByText("No public results matched that search yet.")).toBeVisible();
    await expect(searchResults.getByText(displayName, { exact: true })).toHaveCount(0);

    await gotoFlowPage(page, `/search?q=${encodeURIComponent(directOnlyBio)}`);
    searchResults = searchResultsSection(page);
    await expect(searchResults.getByText("No public results matched that search yet.")).toBeVisible();
    await expect(searchResults.getByText(displayName, { exact: true })).toHaveCount(0);

    await gotoFlowPage(page, `/search?q=${encodeURIComponent(publicTag)}`);
    searchResults = searchResultsSection(page);
    await expect(searchResults.getByText(displayName, { exact: true })).toBeVisible();
    await expect(searchResults.getByText(directOnlyBio)).toHaveCount(0);
    await expect(searchResults.getByText(privateRole)).toHaveCount(0);
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

  await gotoFlowPage(page, "/submit");
  const currentUrl = new URL(page.url());

  if (currentUrl.pathname === "/sign-in") {
    expect(currentUrl.searchParams.get("returnTo")).toBe("/submit");
    await expect(page.getByRole("heading", { name: "Add a profile" })).toHaveCount(0);
  } else {
    await expect(page).toHaveURL(/\/submit$/);
    await expect(page.getByRole("heading", { name: "Sign-in required" })).toBeVisible();
    await expect(page.getByText(/server-side test gate/i)).toHaveCount(0);
  }
});
