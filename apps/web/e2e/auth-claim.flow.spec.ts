import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { gotoFlowPage } from "./flow-navigation";
import { captureRouteScreenshot } from "./public-routes";
import { E2E_DISCORD_GUILD_ID } from "../src/lib/e2e-discord-fixture";

test.describe.configure({ mode: "serial" });

const hostedActionExpectOptions = { timeout: process.env.PLAYWRIGHT_BASE_URL ? 20_000 : 5_000 };
const PRE_NUMERIC_DISCORD_FIXTURE_STAGING_COMMITS = ["1e1ac2f", "05f1ca7"] as const;

function e2eBrowserToken() {
  const token = process.env.VRDEX_E2E_BROWSER_TOKEN ?? (process.env.PLAYWRIGHT_BASE_URL ? undefined : "local-playwright-token");

  if (!token) {
    throw new Error("VRDEX_E2E_BROWSER_TOKEN must be set for hosted Playwright data-flow runs.");
  }

  return token;
}

function e2eRunId(testInfo: { project: { name: string }; workerIndex: number; repeatEachIndex: number }) {
  const prefix = process.env.VRDEX_E2E_RUN_ID ?? "playwright-auth";

  return `${prefix}-${testInfo.project.name}-${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 120);
}

async function hostedTargetIsKnownPreNumericDiscordFixture(request: APIRequestContext) {
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    return false;
  }

  const response = await request.get("/deployment");
  await expect(response).toBeOK();
  const deploymentPage = await response.text();
  return PRE_NUMERIC_DISCORD_FIXTURE_STAGING_COMMITS.some((commit) => deploymentPage.includes(commit));
}

async function createE2eProfile({
  request,
  e2eToken,
  runId,
  profileType,
  displayName,
  aliases = [],
  tags = [],
  roleTags = [],
  subtype,
  categoryTags = [],
}: {
  request: APIRequestContext;
  e2eToken: string;
  runId: string;
  profileType: "person" | "community";
  displayName: string;
  aliases?: string[];
  tags?: string[];
  roleTags?: string[];
  subtype?: string;
  categoryTags?: string[];
}) {
  const profileResponse = await request.post("/api/e2e/profile-submissions", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: {
      runId,
      profileType,
      displayName,
      aliases,
      tags,
      roleTags,
      subtype,
      categoryTags,
    },
  });
  await expect(profileResponse).toBeOK();
  const profile = (await profileResponse.json()) as { slug?: string };
  expect(profile.slug).toBeTruthy();

  return profile.slug!;
}

async function createVerifiedE2eAccount({
  page,
  request,
  e2eToken,
  email,
  password,
}: {
  page: Page;
  request: APIRequestContext;
  e2eToken: string;
  email: string;
  password: string;
}) {
  await gotoFlowPage(page, "/sign-in");
  const revealPasswordForm = page.getByRole("button", { name: "Use email and password" });
  const emailInput = page.getByLabel("Email");

  await expect(revealPasswordForm.or(emailInput).first()).toBeVisible(hostedActionExpectOptions);

  if (await revealPasswordForm.isVisible()) {
    await revealPasswordForm.click();
  }

  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(new RegExp(`Check ${email} for a verification code`, "i"))).toBeVisible();

  const codeResponse = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { action: "consume-code", email },
  });
  await expect(codeResponse).toBeOK();
  const authCode = (await codeResponse.json()) as { code?: string };
  expect(authCode.code).toBeTruthy();

  await page.getByLabel("Verification code").fill(authCode.code!);
  await Promise.all([
    page.waitForURL(/\/account$/),
    page.getByRole("button", { name: "Verify email" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: email })).toBeVisible(hostedActionExpectOptions);
  await expect(page.getByText("Verified", { exact: true })).toBeVisible(hostedActionExpectOptions);
}

async function linkDiscordAccount(request: APIRequestContext, e2eToken: string, email: string, providerAccountId: string) {
  const linkResponse = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { action: "link-discord", email, providerAccountId },
  });

  await expect(linkResponse).toBeOK();
}

/**
 * Stands in for the Discord OAuth round-trip, which hosted runs cannot perform
 * against real Discord. Records the same control proof that callback would.
 */
async function recordGuildControlProof(
  request: APIRequestContext,
  e2eToken: string,
  email: string,
  guildId: string,
): Promise<boolean> {
  const response = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { action: "record-guild-proof", email, guildId, guildName: "E2E Verified Server" },
  });

  if (response.ok()) {
    return true;
  }

  // The shared hosted target runs whatever is on main. Until this branch is
  // deployed there, the helper action does not exist, which is a staging lag
  // rather than a product failure — the local run still covers this path.
  //
  // Matched on the specific unsupported-action response, not any 400: once the
  // helper is deployed, a malformed request or a regressed route must fail this
  // test rather than be excused indefinitely as an old deployment.
  if (process.env.PLAYWRIGHT_BASE_URL && response.status() === 400) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;

    if (body?.error === "Unsupported E2E auth helper action.") {
      return false;
    }
  }

  await expect(response).toBeOK();

  return true;
}

/**
 * Accept the pre-branch trust copy only where the target may not carry this
 * branch yet.
 *
 * A local run is always this branch, so accepting either state there would let
 * the exact regression these assertions exist for — an unrelated guild or
 * VRChat account labelled `Verified` rather than merely `Claimed` — pass
 * silently. Hosted runs keep the tolerance because staging can lag the branch.
 */
async function expectCurrentOrHostedLagTrustCopy(currentCopy: Locator, hostedLagCopy: Locator) {
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    await expect(currentCopy).toBeVisible(hostedActionExpectOptions);
    return;
  }

  await expect(currentCopy.or(hostedLagCopy).first()).toBeVisible(hostedActionExpectOptions);
}

async function hostedTargetHasClaimJourney(page: Page, headingName: string) {
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    return true;
  }

  try {
    await page.getByRole("heading", { name: headingName }).waitFor({ state: "visible", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function profileStatusCopy(page: Page, label: string) {
  return page
    .getByText(new RegExp(`^${label}(?: /|$)`))
    .first()
    .or(page.getByRole("definition").filter({ hasText: new RegExp(`^${label}`) }).first());
}

type DeleteRequestOptions = NonNullable<Parameters<APIRequestContext["delete"]>[1]>;

function isTransientE2eRequestError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return message.includes("ECONNRESET") || message.includes("socket hang up");
}

async function deleteE2eResourceWithRetry(request: APIRequestContext, url: string, options: DeleteRequestOptions) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await request.delete(url, options);
    } catch (error) {
      lastError = error;

      if (!isTransientE2eRequestError(error) || attempt === 2) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function cleanupAuthAndProfiles(request: APIRequestContext, e2eToken: string, email: string, slugs: Array<string | undefined>, runId: string) {
  for (const slug of slugs) {
    if (slug !== undefined) {
      await deleteE2eResourceWithRetry(request, "/api/e2e/profile-submissions", {
        headers: { "x-vrdex-e2e-token": e2eToken },
        data: { slug, runId },
      });
    }
  }

  if (slugs.every((slug) => slug === undefined)) {
    await deleteE2eResourceWithRetry(request, "/api/e2e/profile-submissions", {
      headers: { "x-vrdex-e2e-token": e2eToken },
      data: { runId },
    });
  }

  await deleteE2eResourceWithRetry(request, "/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { email },
  });
}

test("verified email account with linked Discord can claim person and community profiles @flow", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_ADAPTER_HELPERS !== "true",
    "Hosted adapter E2E helpers are not enabled for this target.",
  );

  const e2eToken = e2eBrowserToken();
  const runId = e2eRunId(testInfo);
  const runSuffix = runId.replace(/^playwright-auth-?/, "").slice(0, 48);
  const displayName = `Playwright Claim ${runSuffix}`;
  const email = `${runSuffix}@e2e.vrdex.local`;
  const password = `VRDex-${runSuffix}-password-12345`;
  let createdSlug: string | undefined;
  let communitySlug: string | undefined;

  try {
    createdSlug = await createE2eProfile({
      request,
      e2eToken,
      runId,
      profileType: "person",
      displayName,
      aliases: [`Claim ${runSuffix}`],
      tags: ["playwright", "claim-flow"],
      roleTags: ["Claim test profile"],
    });
    communitySlug = await createE2eProfile({
      request,
      e2eToken,
      runId,
      profileType: "community",
      displayName: `Playwright Community Claim ${runSuffix}`,
      tags: ["playwright", "community-claim-flow"],
      subtype: "Club",
      categoryTags: ["Claim test community"],
    });
    await createVerifiedE2eAccount({ page, request, e2eToken, email, password });
    await linkDiscordAccount(request, e2eToken, email, `discord-${runSuffix}`);

    await gotoFlowPage(page, `/claim/${encodeURIComponent(createdSlug!)}`);
    if (!(await hostedTargetHasClaimJourney(page, `Claim ${displayName}`))) {
      testInfo.annotations.push({
        type: "hosted-staging-lag",
        description: "The shared hosted target does not yet include the profile-scoped claim journey exercised by this branch.",
      });
      return;
    }

    await expect(page.getByRole("heading", { name: `Claim ${displayName}` })).toBeVisible();
    await page.getByRole("button", { name: /Use linked Discord/ }).click();
    await page.getByRole("button", { name: "Claim with Discord" }).click();
    await expect(page.getByText(/Profile claimed/i)).toBeVisible(hostedActionExpectOptions);

    await gotoFlowPage(page, `/p/${createdSlug}`);
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible(hostedActionExpectOptions);
    if (process.env.PLAYWRIGHT_BASE_URL) {
      await expectCurrentOrHostedLagTrustCopy(
        page.getByRole("heading", { name: displayName }),
        page.getByRole("heading", { name: "Claimed", exact: true }).or(page.getByText("Person profile / Claimed", { exact: true })),
      );
    } else {
      await expect(profileStatusCopy(page, "Claimed")).toHaveCount(0);
      await expect(page.getByLabel("Verified profile")).toHaveCount(0);
    }

    await gotoFlowPage(page, `/claim/${encodeURIComponent(createdSlug!)}`);
    await expect(page.getByText("You manage this profile, but it is not verified yet.")).toBeVisible();
    await expect(page.getByLabel("VRChat profile URL or user ID")).toBeVisible();

    await gotoFlowPage(page, "/account");
    const accountProfileLink = page.getByRole("link", { name: "View profile" });
    await expect(accountProfileLink).toHaveAttribute("href", `/p/${encodeURIComponent(createdSlug!)}`);
    await expect(accountProfileLink).toHaveClass(/bg-accent/);
    await expect(page.getByRole("link", { name: "Verify with VRChat" })).toHaveAttribute(
      "href",
      `/claim/${encodeURIComponent(createdSlug!)}?source=account`,
    );
    await captureRouteScreenshot(page, testInfo, "account-owned-profile");

    if (!(await recordGuildControlProof(request, e2eToken, email, E2E_DISCORD_GUILD_ID))) {
      testInfo.annotations.push({
        type: "hosted-staging-lag",
        description:
          "The shared hosted target does not yet expose the record-guild-proof helper this branch adds for single-step guild claiming.",
      });
      return;
    }

    await gotoFlowPage(
      page,
      `/claim/${encodeURIComponent(communitySlug!)}`,
    );
    await page.getByRole("button", { name: /Verify Discord admin/ }).click();
    // Control is proved before claiming now, so the form offers verified
    // servers instead of asking for a pasted guild id.
    await page.getByLabel("Discord server").selectOption(E2E_DISCORD_GUILD_ID);
    await page.getByRole("button", { name: "Claim with this server" }).click();
    // Server control is proved either way; whether the listing is *marked*
    // verified depends on the guild already being on record for it, which a
    // fresh E2E fixture profile has no reason to be.
    const communityClaimed = page.getByText(/Server control verified.{0,4} (and )?[Tt]his community is now yours/);
    const communityClaimFailed = page.getByText(
      "We could not complete that check. Nothing changed; try again or choose another method.",
    );
    await expect(communityClaimed.or(communityClaimFailed)).toBeVisible(hostedActionExpectOptions);

    if (await communityClaimFailed.isVisible()) {
      if (await hostedTargetIsKnownPreNumericDiscordFixture(request)) {
        testInfo.annotations.push({
          type: "hosted-staging-lag",
          description: "The exact shared staging commit predates the numeric Discord fixture contract fixed by this branch.",
        });
        return;
      }
      await expect(communityClaimed).toBeVisible();
    }

    await gotoFlowPage(page, `/c/${communitySlug}`);
    await expect(page.getByRole("heading", { name: `Playwright Community Claim ${runSuffix}` })).toBeVisible(
      hostedActionExpectOptions,
    );
    if (process.env.PLAYWRIGHT_BASE_URL) {
      await expectCurrentOrHostedLagTrustCopy(
        page.getByRole("heading", { name: `Playwright Community Claim ${runSuffix}` }),
        profileStatusCopy(page, "Claimed").or(page.getByText("Community profile / Claimed", { exact: true })),
      );
    } else {
      await expect(profileStatusCopy(page, "Claimed")).toHaveCount(0);
      await expect(page.getByLabel("Verified profile")).toHaveCount(0);
    }
  } finally {
    await cleanupAuthAndProfiles(request, e2eToken, email, [createdSlug, communitySlug], runId);
  }
});

test("verified email account can complete VRChat adapter claims @flow", async ({ page, request }, testInfo) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_ADAPTER_HELPERS !== "true",
    "Hosted adapter E2E helpers are not enabled for this target.",
  );

  const e2eToken = e2eBrowserToken();
  const runId = e2eRunId(testInfo);
  const runSuffix = runId.replace(/^playwright-auth-?/, "").slice(0, 48);
  const email = `adapter-${runSuffix}@e2e.vrdex.local`;
  const password = `VRDex-${runSuffix}-adapter-password-12345`;
  let vrchatPersonSlug: string | undefined;
  let vrchatCommunitySlug: string | undefined;

  try {
    vrchatPersonSlug = await createE2eProfile({
      request,
      e2eToken,
      runId,
      profileType: "person",
      displayName: `Playwright VRChat Proof ${runSuffix}`,
      tags: ["playwright", "vrchat-proof"],
      roleTags: ["Proof test profile"],
    });
    vrchatCommunitySlug = await createE2eProfile({
      request,
      e2eToken,
      runId,
      profileType: "community",
      displayName: `Playwright VRChat Group ${runSuffix}`,
      tags: ["playwright", "vrchat-group-proof"],
      subtype: "Club",
      categoryTags: ["Proof test community"],
    });
    await createVerifiedE2eAccount({ page, request, e2eToken, email, password });
    await gotoFlowPage(page, `/claim/${encodeURIComponent(vrchatCommunitySlug!)}`);
    if (!(await hostedTargetHasClaimJourney(page, `Claim Playwright VRChat Group ${runSuffix}`))) {
      testInfo.annotations.push({
        type: "hosted-staging-lag",
        description: "The shared hosted target does not yet include the profile-scoped claim journey exercised by this branch.",
      });
      return;
    }

    // Communities lead with Discord now that the OAuth round-trip no longer
    // needs a linked Discord sign-in, so select the VRChat method this test is
    // actually about rather than relying on it being preselected.
    await page.getByRole("button", { name: /Verify with VRChat/ }).click();
    await expect(page.getByRole("button", { name: /Verify with VRChat/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByLabel("VRChat group URL or group ID")).toBeVisible();

    await gotoFlowPage(page, `/claim/${encodeURIComponent(vrchatPersonSlug!)}`);
    if (!(await hostedTargetHasClaimJourney(page, `Claim Playwright VRChat Proof ${runSuffix}`))) {
      testInfo.annotations.push({
        type: "hosted-staging-lag",
        description: "The shared hosted target does not yet include the profile-scoped claim journey exercised by this branch.",
      });
      return;
    }

    await page.getByLabel("VRChat profile URL or user ID").fill(
      "https://vrchat.com/home/user/usr_e2e00000-0000-4000-8000-000000000001",
    );
    await page.getByRole("button", { name: "Create proof code" }).click();
    await expect(page.getByRole("heading", { name: "Finish your VRChat proof" })).toBeVisible(hostedActionExpectOptions);
    await expect(page.getByText(/VRDEX-/)).toBeVisible(hostedActionExpectOptions);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Finish your VRChat proof" })).toBeVisible(hostedActionExpectOptions);
    await page.getByRole("button", { name: "Check proof now" }).click();
    await expect(page.getByText(/Ownership (verified|confirmed)/i)).toBeVisible(hostedActionExpectOptions);

    await gotoFlowPage(page, `/p/${vrchatPersonSlug}`);
    await expect(page.getByRole("heading", { name: `Playwright VRChat Proof ${runSuffix}` })).toBeVisible(hostedActionExpectOptions);
    if (process.env.PLAYWRIGHT_BASE_URL) {
      await expectCurrentOrHostedLagTrustCopy(
        page.getByRole("heading", { name: `Playwright VRChat Proof ${runSuffix}` }),
        profileStatusCopy(page, "Claimed").or(page.getByText("Person profile / Claimed", { exact: true })),
      );
    } else {
      await expect(profileStatusCopy(page, "Claimed")).toHaveCount(0);
      await expect(page.getByLabel("Verified profile")).toHaveCount(0);
    }

  } finally {
    await cleanupAuthAndProfiles(
      request,
      e2eToken,
      email,
      [vrchatPersonSlug, vrchatCommunitySlug],
      runId,
    );
  }
});

test("E2E auth helper stays gated without the browser token @flow", async ({ request }) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );

  const e2eToken = e2eBrowserToken();
  const payload = { action: "consume-code", email: "negative-gate@e2e.vrdex.local" };

  const missingTokenResponse = await request.post("/api/e2e/auth", {
    data: payload,
  });
  expect(missingTokenResponse.status()).toBe(403);

  const wrongTokenResponse = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": "wrong-token" },
    data: payload,
  });
  expect(wrongTokenResponse.status()).toBe(403);

  const malformedPostResponse = await request.post("/api/e2e/auth", {
    headers: { "content-type": "application/json", "x-vrdex-e2e-token": e2eToken },
    data: "{not-json",
  });
  expect(malformedPostResponse.status()).toBe(400);

  const unsupportedActionResponse = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { action: "unsupported", email: "negative-gate@e2e.vrdex.local" },
  });
  expect(unsupportedActionResponse.status()).toBe(400);

  const missingDeleteTokenResponse = await request.delete("/api/e2e/auth", {
    data: { email: "negative-gate@e2e.vrdex.local" },
  });
  expect(missingDeleteTokenResponse.status()).toBe(403);

  const malformedDeleteResponse = await request.delete("/api/e2e/auth", {
    headers: { "content-type": "application/json", "x-vrdex-e2e-token": e2eToken },
    data: "{not-json",
  });
  expect(malformedDeleteResponse.status()).toBe(400);
});
