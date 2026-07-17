import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { gotoFlowPage } from "./flow-navigation";

test.describe.configure({ mode: "serial" });

const hostedActionExpectOptions = { timeout: process.env.PLAYWRIGHT_BASE_URL ? 20_000 : 5_000 };

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

async function expectCurrentOrHostedLagTrustCopy(currentCopy: Locator, hostedLagCopy: Locator) {
  await expect(currentCopy.or(hostedLagCopy).first()).toBeVisible(hostedActionExpectOptions);
}

async function prepareDiscordPersonClaim(page: Page, profileSlug: string) {
  const legacySlugInput = page.getByLabel("Person slug");
  const currentSlugInput = page.getByLabel("Profile slug");

  await expect(legacySlugInput.or(currentSlugInput).first()).toBeVisible(hostedActionExpectOptions);

  if (await legacySlugInput.isVisible()) {
    await legacySlugInput.fill(profileSlug);
    return;
  }

  await expect(currentSlugInput).toHaveValue(profileSlug);
}

async function prepareVrchatProof(
  page: Page,
  profileSlug: string,
  targetType: "vrchat_user" | "vrclinking",
  targetExternalId: string,
) {
  const methodButton = page.getByRole("button", { name: "VRChat proof" });
  const legacyTargetType = page.getByLabel("Target type");

  await expect(methodButton.or(legacyTargetType).first()).toBeVisible(hostedActionExpectOptions);

  if (await methodButton.isVisible()) {
    await methodButton.click();
    await expect(page.getByLabel("Profile slug")).toHaveValue(profileSlug);
    await page.getByLabel("Verification service").selectOption(targetType);
    await page.getByLabel("VRChat user ID").fill(targetExternalId);
    return;
  }

  await page.getByLabel("Profile slug").fill(profileSlug);
  await legacyTargetType.selectOption(targetType);
  await page.getByLabel("Target ID").fill(targetExternalId);
}

function profileStatusCopy(page: Page, label: string) {
  return page.getByText(new RegExp(`^${label}(?: /|$)`)).first();
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

test("verified email account with linked Discord can claim an E2E person profile @flow", async ({ page, request }, testInfo) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );

  const e2eToken = e2eBrowserToken();
  const runId = e2eRunId(testInfo);
  const runSuffix = runId.replace(/^playwright-auth-?/, "").slice(0, 48);
  const displayName = `Playwright Claim ${runSuffix}`;
  const email = `${runSuffix}@e2e.vrdex.local`;
  const password = `VRDex-${runSuffix}-password-12345`;
  let createdSlug: string | undefined;

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
    await createVerifiedE2eAccount({ page, request, e2eToken, email, password });
    await linkDiscordAccount(request, e2eToken, email, `discord-${runSuffix}`);

    await gotoFlowPage(page, `/account?claim=${encodeURIComponent(createdSlug!)}`);
    await expect(page.getByText("discord", { exact: true })).toBeVisible();
    await prepareDiscordPersonClaim(page, createdSlug!);
    await page.getByRole("button", { name: "Claim with Discord" }).click();
    await expect(page.getByText(/(?:Profile|Person profile) claimed as claimed unverified/i)).toBeVisible(hostedActionExpectOptions);

    await gotoFlowPage(page, `/p/${createdSlug}`);
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible(hostedActionExpectOptions);
    await expectCurrentOrHostedLagTrustCopy(
      profileStatusCopy(page, "Claimed"),
      page.getByRole("heading", { name: "Claimed", exact: true }).or(page.getByText("Person profile / Claimed", { exact: true })),
    );
  } finally {
    await cleanupAuthAndProfiles(request, e2eToken, email, [createdSlug], runId);
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
  let vrcLinkingPersonSlug: string | undefined;

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
    vrcLinkingPersonSlug = await createE2eProfile({
      request,
      e2eToken,
      runId,
      profileType: "person",
      displayName: `Playwright VRCLinking Proof ${runSuffix}`,
      tags: ["playwright", "vrclinking-proof"],
      roleTags: ["Proof test profile"],
    });

    await createVerifiedE2eAccount({ page, request, e2eToken, email, password });
    await gotoFlowPage(page, `/account?claim=${encodeURIComponent(vrchatPersonSlug!)}`);
    await prepareVrchatProof(page, vrchatPersonSlug!, "vrchat_user", `e2e-vrchat-${runSuffix}`);
    await page.getByRole("button", { name: "Create proof code" }).click();
    await expect(page.getByText(/Proof code created/i)).toBeVisible(hostedActionExpectOptions);
    await expect(page.getByText(/VRDEX-/)).toBeVisible(hostedActionExpectOptions);
    await page.getByRole("button", { name: "Check proof now" }).click();
    await expect(page.getByText(/Proof verified as claimed verified/i)).toBeVisible(hostedActionExpectOptions);

    await gotoFlowPage(page, `/p/${vrchatPersonSlug}`);
    await expect(page.getByRole("heading", { name: `Playwright VRChat Proof ${runSuffix}` })).toBeVisible(hostedActionExpectOptions);
    await expectCurrentOrHostedLagTrustCopy(
      profileStatusCopy(page, "Verified"),
      page.getByRole("heading", { name: "Verified owner", exact: true }).or(page.getByText("Person profile / Verified", { exact: true })),
    );

    await gotoFlowPage(page, `/account?claim=${encodeURIComponent(vrcLinkingPersonSlug!)}`);
    await prepareVrchatProof(page, vrcLinkingPersonSlug!, "vrclinking", `e2e-vrclinking-${runSuffix}`);
    await page.getByRole("button", { name: "Create proof code" }).click();
    await expect(page.getByText(/Proof code created/i)).toBeVisible(hostedActionExpectOptions);
    await expect(page.getByText(/VRDEX-/)).toBeVisible(hostedActionExpectOptions);
    await page.getByRole("button", { name: "Check proof now" }).click();
    await expect(page.getByText(/Proof verified as claimed verified/i)).toBeVisible(hostedActionExpectOptions);

    await gotoFlowPage(page, `/p/${vrcLinkingPersonSlug}`);
    await expect(page.getByRole("heading", { name: `Playwright VRCLinking Proof ${runSuffix}` })).toBeVisible(hostedActionExpectOptions);
    await expectCurrentOrHostedLagTrustCopy(
      profileStatusCopy(page, "Verified"),
      page.getByRole("heading", { name: "Verified owner", exact: true }).or(page.getByText("Person profile / Verified", { exact: true })),
    );
  } finally {
    await cleanupAuthAndProfiles(
      request,
      e2eToken,
      email,
      [vrchatPersonSlug, vrcLinkingPersonSlug],
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
