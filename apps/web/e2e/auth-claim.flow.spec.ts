import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import {
  clerkTestAuthAvailability,
  createClerkTestAccount,
  deleteClerkTestAccount,
  deleteClerkTestAccountByEmail,
  hostedHelperLagReason,
  hostedTargetRunsCurrentRevision,
  signInClerkTestAccount,
  type ClerkTestAccount,
} from "./clerk-auth";
import { gotoFlowPage } from "./flow-navigation";
import { captureRouteScreenshot } from "./public-routes";
import { E2E_DISCORD_GUILD_ID } from "../src/lib/e2e-discord-fixture";

// Throws rather than returns on a hosted target that asked for auth coverage
// and cannot have it, so a misconfigured deployment fails the file instead of
// reporting a pass over skipped tests.
const clerkTestAuth = clerkTestAuthAvailability();

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

  // Not asserted OK: `/api/deployment` replaces the `/deployment` page and
  // staging serves the page until this merges, so both are read for the length
  // of that overlap. A target that answers neither cannot be a known
  // pre-numeric commit, which is the stricter reading.
  //
  // ponytail: transitional. Drop the `/deployment` fallback once staging carries
  // this branch.
  for (const path of ["/api/deployment", "/deployment"]) {
    const response = await request.get(path);

    if (response.ok()) {
      const body = await response.text();

      return PRE_NUMERIC_DISCORD_FIXTURE_STAGING_COMMITS.some((commit) => body.includes(commit));
    }
  }

  return false;
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

/**
 * Clerk creates the account already verified and signs it in with a one-time
 * ticket, so there is no form to drive and no verification code to intercept.
 * `signInClerkTestAccount` does not return until `/account` renders the
 * identity, which is also when the Convex `users` row exists for the helpers
 * below to find by email.
 */
async function createSignedInClerkAccount(page: Page, runSuffix: string) {
  const account = await createClerkTestAccount(runSuffix);

  // Deleted here rather than left to the caller's `finally`. The caller assigns
  // its `account` from the *return* value, so a throw between creation and
  // return leaves it undefined and the teardown with nothing to delete — and
  // sign-in failures are exactly the auth drift these tests exist to catch, so
  // that path would leak a disposable Clerk user on every occurrence.
  try {
    await signInClerkTestAccount(page, account);
  } catch (error) {
    await deleteClerkTestAccount(account);
    throw error;
  }

  return account;
}

/**
 * Returns the staging-lag reason when the shared hosted target cannot serve this
 * helper yet, or `null` once it ran. Throws on a genuine failure.
 */
async function linkDiscordAccount(
  request: APIRequestContext,
  e2eToken: string,
  email: string,
  providerAccountId: string,
): Promise<string | null> {
  const linkResponse = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { action: "link-discord", email, providerAccountId },
  });

  if (linkResponse.ok()) {
    return null;
  }

  const lagReason = await hostedHelperLagReason(request, linkResponse.status(), await linkResponse.text());

  if (lagReason !== null) {
    return lagReason;
  }

  await expect(linkResponse).toBeOK();

  return null;
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
): Promise<string | null> {
  const response = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { action: "record-guild-proof", email, guildId, guildName: "E2E Verified Server" },
  });

  if (response.ok()) {
    return null;
  }

  const lagReason = await hostedHelperLagReason(request, response.status(), await response.text());

  if (lagReason !== null) {
    return lagReason;
  }

  await expect(response).toBeOK();

  return null;
}

/**
 * Copy this branch changed, as either the new string or the one staging still
 * serves.
 *
 * The hosted lane drives the shared staging deployment, which tracks `main` —
 * so a branch that rewrites user-facing copy asserts against a target that does
 * not have the rewrite yet. Accepting only the new string makes the lane
 * unpassable until merge, which is the wrong order: the lane exists to catch
 * regressions before merge, not to require one.
 *
 * The pairs collapse to a single string once staging carries this branch, and
 * the old half should be deleted then. Same tolerance as
 * `expectCurrentOrHostedLagTrustState` below, for the same reason.
 */
function currentOrLaggingCopy(page: Page, current: string, lagging: string) {
  return page
    .getByRole("heading", { name: current })
    .or(page.getByRole("heading", { name: lagging }));
}

async function expectCurrentOrHostedLagTrustState(
  page: Page,
  request: APIRequestContext,
  hostedLagCopy: Locator,
) {
  if (await hostedTargetRunsCurrentRevision(request)) {
    await expect(profileStatusCopy(page, "Claimed")).toHaveCount(0);
    await expect(page.getByLabel("Verified profile")).toHaveCount(0);
    return;
  }

  // Shared staging may render a pre-branch trust state *or* the current one.
  //
  // Accepting only the pre-branch states made this unpassable on every feature
  // branch: the revision check matches on main alone, so a branch that has
  // merged main lands here and is then asserted against behaviour its own base
  // no longer has. Staging can be behind this branch, which is what the
  // tolerance is for — but it can equally be level with it, and that is not a
  // failure.
  await expect(async () => {
    const lagState = hostedLagCopy
      .or(page.getByLabel("Owner verified"))
      .or(page.getByLabel("Verified profile"));

    if ((await lagState.count()) > 0) {
      return;
    }

    expect(await profileStatusCopy(page, "Claimed").count()).toBe(0);
    expect(await page.getByLabel("Verified profile").count()).toBe(0);
  }).toPass(hostedActionExpectOptions);
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

async function cleanupAuthAndProfiles(
  request: APIRequestContext,
  e2eToken: string,
  account: ClerkTestAccount | undefined,
  slugs: Array<string | undefined>,
  runId: string,
) {
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

  if (account === undefined) {
    return;
  }

  // Convex rows first, then the Clerk user: `cleanupAuthUserByEmail` resolves
  // the account through the `users` row, which is keyed to the Clerk id. Both
  // sides are needed — Convex never hears about a Clerk deletion, because
  // provisioning is on-demand from the client rather than webhook-driven.
  await deleteE2eResourceWithRetry(request, "/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { email: account.email },
  });
  await deleteClerkTestAccount(account);
}

test("verified email account with linked Discord can claim person and community profiles @flow", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(clerkTestAuth.available === false, clerkTestAuth.available === false ? clerkTestAuth.reason : "");
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
  let account: ClerkTestAccount | undefined;
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
    account = await createSignedInClerkAccount(page, runSuffix);

    const linkLagReason = await linkDiscordAccount(request, e2eToken, account.email, `discord-${runSuffix}`);

    if (linkLagReason !== null) {
      testInfo.annotations.push({
        type: "hosted-staging-lag",
        description: `${linkLagReason} The Discord claim path cannot be exercised there until this branch merges and staging redeploys.`,
      });
      return;
    }

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
    // Current copy or the copy staging still serves, like the VRChat branch.
    await expect(
      page.getByText(/This profile is yours to manage|Profile claimed/i),
    ).toBeVisible(hostedActionExpectOptions);

    await gotoFlowPage(page, `/${createdSlug}`);
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible(hostedActionExpectOptions);
    if (process.env.PLAYWRIGHT_BASE_URL) {
      await expectCurrentOrHostedLagTrustState(
        page,
        request,
        profileStatusCopy(page, "Claimed").or(
          page.getByText("Person profile / Claimed", { exact: true }),
        ),
      );
    } else {
      await expect(profileStatusCopy(page, "Claimed")).toHaveCount(0);
      await expect(page.getByLabel("Verified profile")).toHaveCount(0);
    }

    await gotoFlowPage(page, `/claim/${encodeURIComponent(createdSlug!)}`);
    await expect(
      page.getByText("You already manage this profile.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("VRChat profile URL or user ID")).toBeVisible();

    if (!process.env.PLAYWRIGHT_BASE_URL) {
      await gotoFlowPage(page, "/account");
      const accountProfileLink = page.getByRole("link", { name: "View profile" });
      await expect(accountProfileLink).toHaveAttribute("href", `/${encodeURIComponent(createdSlug!)}`);
      await expect(accountProfileLink).toHaveClass(/bg-accent/);
      await expect(page.getByRole("link", { name: "Verify with VRChat" })).toHaveAttribute(
        "href",
        `/claim/${encodeURIComponent(createdSlug!)}?source=account`,
      );
      await captureRouteScreenshot(page, testInfo, "account-owned-profile");
    }

    const proofLagReason = await recordGuildControlProof(request, e2eToken, account.email, E2E_DISCORD_GUILD_ID);

    if (proofLagReason !== null) {
      testInfo.annotations.push({
        type: "hosted-staging-lag",
        description: `${proofLagReason} Single-step guild claiming cannot be exercised there until this branch merges and staging redeploys.`,
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
    const communityClaimed = page.getByText(
      /This community is yours|Server control verified.{0,4} (and )?[Tt]his community is now yours/,
    );
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

    await gotoFlowPage(page, `/${communitySlug}`);
    await expect(page.getByRole("heading", { name: `Playwright Community Claim ${runSuffix}` })).toBeVisible(
      hostedActionExpectOptions,
    );
    if (process.env.PLAYWRIGHT_BASE_URL) {
      await expectCurrentOrHostedLagTrustState(
        page,
        request,
        profileStatusCopy(page, "Claimed").or(page.getByText("Community profile / Claimed", { exact: true })),
      );
    } else {
      await expect(profileStatusCopy(page, "Claimed")).toHaveCount(0);
      await expect(page.getByLabel("Verified profile")).toHaveCount(0);
    }
  } finally {
    await cleanupAuthAndProfiles(request, e2eToken, account, [createdSlug, communitySlug], runId);
  }
});

test("verified email account can complete VRChat adapter claims @flow", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(clerkTestAuth.available === false, clerkTestAuth.available === false ? clerkTestAuth.reason : "");
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
  let account: ClerkTestAccount | undefined;
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
    account = await createSignedInClerkAccount(page, `adapter-${runSuffix}`);
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
    await expect(currentOrLaggingCopy(page, "Add this code to your VRChat profile", "Finish your VRChat proof")).toBeVisible(hostedActionExpectOptions);
    await expect(page.getByText(/\bVRDEX(?:[0-9]{5}|-[A-Z0-9]{6,32})\b/)).toBeVisible(hostedActionExpectOptions);
    await page.reload();
    await expect(currentOrLaggingCopy(page, "Add this code to your VRChat profile", "Finish your VRChat proof")).toBeVisible(hostedActionExpectOptions);
    await page
      .getByRole("button", { name: "I've added it - check now" })
      // The em-dash spelling is what staging serves until this merges.
      .or(page.getByRole("button", { name: "I've added it — check now" }))
      .or(page.getByRole("button", { name: "Check proof now" }))
      .click();
    await expect(page.getByText(/This profile is yours|Ownership (verified|confirmed)/i)).toBeVisible(hostedActionExpectOptions);

    await gotoFlowPage(page, `/${vrchatPersonSlug}`);
    await expect(page.getByRole("heading", { name: `Playwright VRChat Proof ${runSuffix}` })).toBeVisible(hostedActionExpectOptions);
    if (process.env.PLAYWRIGHT_BASE_URL) {
      await expectCurrentOrHostedLagTrustState(
        page,
        request,
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
      account,
      [vrchatPersonSlug, vrchatCommunitySlug],
      runId,
    );
  }
});

test("two Clerk users keep VRChat claim fixtures isolated @flow", async ({ browser, request, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  test.skip(clerkTestAuth.available === false, clerkTestAuth.available === false ? clerkTestAuth.reason : "");
  // This exercises real Clerk sessions and deployed claim handlers. The existing
  // staging adapter supplies a fixture verdict, not live VRChat identity proof.
  if (process.env.VRDEX_ENABLE_E2E_ADAPTER_HELPERS !== "true") {
    throw new Error("Two-user claim verification requires the isolated staging adapter fixture.");
  }
  const e2eToken = e2eBrowserToken();
  const runId = e2eRunId(testInfo);
  const suffix = runId.slice(-34);
  const contexts = [await browser.newContext({ baseURL }), await browser.newContext({ baseURL })];
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const accounts: Array<ClerkTestAccount | undefined> = [];
  const reservedEmails: string[] = [];
  const authenticatedEmails = new Set<string>();
  let slug: string | undefined;

  try {
    slug = await createE2eProfile({ request, e2eToken, runId, profileType: "person", displayName: `Two-user claim ${suffix}` });
    for (const [index, page] of pages.entries()) {
      const account = await createClerkTestAccount(`claim-${index}-${suffix}`, {
        onEmailReserved: (email) => { reservedEmails[index] = email; },
      });
      accounts[index] = account;
      await signInClerkTestAccount(page, account, {
        onAuthenticated: () => { authenticatedEmails.add(account.email); },
      });
      await gotoFlowPage(page, `/claim/${encodeURIComponent(slug)}`);
      await expect(page.getByLabel("VRChat profile URL or user ID")).toBeVisible(hostedActionExpectOptions);
      await page.getByLabel("VRChat profile URL or user ID").fill(
        `usr_e2e00000-0000-4000-8000-00000000000${index + 1}`,
      );
      await page.getByRole("button", { name: "Create proof code" }).click();
      await expect(page.getByText(/^VRDEX(?:[0-9]{5}|-[A-Z0-9]{6,32})$/)).toBeVisible(hostedActionExpectOptions);
    }
    expect(accounts[0]?.clerkUserId).not.toBe(accounts[1]?.clerkUserId);
    const [first, second] = pages;
    const firstCode = (await first.getByText(/^VRDEX(?:[0-9]{5}|-[A-Z0-9]{6,32})$/).innerText()).trim();
    // Codes are scoped to targets and may legitimately match across accounts.
    // Assert each page's bound target, then prove cancellation/ownership isolation.
    await expect(first.getByText("usr_e2e00000-0000-4000-8000-000000000001", { exact: true })).toBeVisible();
    await expect(first.getByText("usr_e2e00000-0000-4000-8000-000000000002", { exact: true })).toHaveCount(0);
    await expect(second.getByText("usr_e2e00000-0000-4000-8000-000000000002", { exact: true })).toBeVisible();
    await expect(second.getByText("usr_e2e00000-0000-4000-8000-000000000001", { exact: true })).toHaveCount(0);

    await second.getByRole("button", { name: "Start over", exact: true }).click();
    await expect(second.getByRole("button", { name: "Create proof code" })).toBeVisible(hostedActionExpectOptions);
    await first.reload();
    await expect(first.getByText(firstCode, { exact: true })).toBeVisible(hostedActionExpectOptions);
    await first.getByRole("button", { name: "I've added it - check now", exact: true }).click();
    await expect(first.getByText(/This profile is yours|Ownership (verified|confirmed)/i)).toBeVisible(hostedActionExpectOptions);
    await second.reload();
    await expect(second.getByText("This profile already has an owner.", { exact: true })).toBeVisible(hostedActionExpectOptions);
    await expect(second.getByRole("button", { name: "Create proof code" })).toHaveCount(0);
    await expect(second.getByText(firstCode, { exact: true })).toHaveCount(0);
    await first.reload();
    await expect(first.getByText(/You (already )?manage this profile\./)).toBeVisible(hostedActionExpectOptions);
  } finally {
    // Attempt every teardown even if one fails. Each user has separate Convex
    // and Clerk state; one failed cleanup must not strand the other identity.
    const closed = await Promise.allSettled(contexts.map((context) => context.close()));
    const cleanup = await Promise.allSettled([
      (async () => {
        const response = await deleteE2eResourceWithRetry(request, "/api/e2e/profile-submissions", {
          headers: { "x-vrdex-e2e-token": e2eToken },
          data: { slug, runId },
        });
        await expect(response).toBeOK();
      })(),
      ...reservedEmails.map(async (email) => {
        // Retain the email before creation so an interrupted create/sign-in is
        // still recoverable. Delete Convex state before its Clerk identity.
        let drained = false;
        let cleaned = false;
        for (let pass = 0; pass < 3; pass += 1) {
          const response = await deleteE2eResourceWithRetry(request, "/api/e2e/auth", {
            headers: { "x-vrdex-e2e-token": e2eToken }, data: { email },
          });
          await expect(response).toBeOK();
          // A previously accepted provisioning mutation can finish after close.
          // Keep the identity until a subsequent cleanup finds no Convex row.
          const body = await response.json() as { deleted?: boolean };
          if (body.deleted === true) cleaned = true;
          if (body.deleted === false) {
            drained = true;
            break;
          }
        }
        expect(drained).toBe(true);
        // Once authenticated, initial absence can be delayed provisioning.
        // Retain the Clerk identity for recovery unless a row was removed.
        if (authenticatedEmails.has(email)) expect(cleaned).toBe(true);
        const result = await deleteClerkTestAccountByEmail(email);
        expect(result.checked).toBe(true);
        expect(result.failed).toBe(0);
      }),
    ]);
    const failures = [...closed, ...cleanup].filter((result) => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Two-user claim fixture cleanup failed.");
  }
});

test("E2E auth helper stays gated without the browser token @flow", async ({ request }, testInfo) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );

  const e2eToken = e2eBrowserToken();
  // A *supported* action, so a 403 below proves the token gate rejected the
  // request rather than the action dispatcher not recognising it.
  const payload = {
    action: "link-discord",
    email: "negative-gate@e2e.vrdex.net",
    providerAccountId: "negative-gate",
  };

  const missingTokenResponse = await request.post("/api/e2e/auth", {
    data: payload,
  });

  // There is no gate to assert on a route the target does not serve. Checked
  // here rather than skipped up front so a deployed-but-ungated route still
  // fails loudly: only the specific not-deployed shape is excused.
  const lagReason = await hostedHelperLagReason(
    request,
    missingTokenResponse.status(),
    await missingTokenResponse.text(),
  );

  if (lagReason !== null) {
    testInfo.annotations.push({
      type: "hosted-staging-lag",
      description: `${lagReason} Its token gate cannot be exercised there until this branch merges and staging redeploys.`,
    });
    return;
  }

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
    data: { action: "unsupported", email: "negative-gate@e2e.vrdex.net" },
  });
  expect(unsupportedActionResponse.status()).toBe(400);

  const missingDeleteTokenResponse = await request.delete("/api/e2e/auth", {
    data: { email: "negative-gate@e2e.vrdex.net" },
  });
  expect(missingDeleteTokenResponse.status()).toBe(403);

  const malformedDeleteResponse = await request.delete("/api/e2e/auth", {
    headers: { "content-type": "application/json", "x-vrdex-e2e-token": e2eToken },
    data: "{not-json",
  });
  expect(malformedDeleteResponse.status()).toBe(400);
});
