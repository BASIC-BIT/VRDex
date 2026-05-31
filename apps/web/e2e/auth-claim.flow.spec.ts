import { expect, test } from "@playwright/test";

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
    const profileResponse = await request.post("/api/e2e/profile-submissions", {
      headers: { "x-vrdex-e2e-token": e2eToken },
      data: {
        runId,
        profileType: "person",
        displayName,
        aliases: [`Claim ${runSuffix}`],
        tags: ["playwright", "claim-flow"],
        roleTags: ["Claim test profile"],
      },
    });
    await expect(profileResponse).toBeOK();
    const profile = (await profileResponse.json()) as { slug?: string };
    createdSlug = profile.slug;
    expect(createdSlug).toBeTruthy();

    await page.goto("/sign-in");
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
    await expect(page.getByRole("heading", { name: email })).toBeVisible();
    await expect(page.getByText("Verified", { exact: true })).toBeVisible();

    const linkResponse = await request.post("/api/e2e/auth", {
      headers: { "x-vrdex-e2e-token": e2eToken },
      data: { action: "link-discord", email, providerAccountId: `discord-${runSuffix}` },
    });
    await expect(linkResponse).toBeOK();

    await page.goto("/account");
    await expect(page.getByText("discord", { exact: true })).toBeVisible();
    await page.getByLabel("Person slug").fill(createdSlug!);
    await page.getByRole("button", { name: "Claim with Discord" }).click();
    await expect(page.getByText(/Person profile claimed as claimed unverified/i)).toBeVisible();

    await page.goto(`/p/${createdSlug}`);
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
    await expect(page.getByText("Claimed", { exact: true })).toBeVisible();
  } finally {
    if (createdSlug || runId) {
      await request.delete("/api/e2e/profile-submissions", {
        headers: { "x-vrdex-e2e-token": e2eToken },
        data: createdSlug ? { slug: createdSlug, runId } : { runId },
      });
    }

    await request.delete("/api/e2e/auth", {
      headers: { "x-vrdex-e2e-token": e2eToken },
      data: { email },
    });
  }
});
