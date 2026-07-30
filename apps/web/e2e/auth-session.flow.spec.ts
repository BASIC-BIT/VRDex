import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { authSessionMatrixIdentity } from "./auth-session-matrix-identity";


// Skipped, not deleted: the coverage is still wanted once these run against
// Clerk testing tokens rather than a sign-in form.
test.skip(
  true,
  "Hosted E2E auth is not wired to Clerk yet: these specs signed in by driving the removed email/password form, and CI has no Clerk credentials. Tracked in #226.",
);
test.describe.configure({ mode: "serial" });

const DAY_SECONDS = 24 * 60 * 60;

function e2eBrowserToken() {
  const token =
    process.env.VRDEX_E2E_BROWSER_TOKEN ??
    (process.env.PLAYWRIGHT_BASE_URL
      ? undefined
      : "local-playwright-token");

  if (!token) {
    throw new Error(
      "VRDEX_E2E_BROWSER_TOKEN must be set for hosted auth-session runs.",
    );
  }

  return token;
}

function e2eIdentity(testInfo: {
  project: { name: string };
  workerIndex: number;
  repeatEachIndex: number;
}) {
  const sharedRunId = process.env.VRDEX_AUTH_MATRIX_RUN_ID?.trim();
  if (sharedRunId) {
    return authSessionMatrixIdentity(sharedRunId);
  }

  const suffix = [
    "session",
    testInfo.project.name,
    testInfo.workerIndex,
    testInfo.repeatEachIndex,
    Date.now(),
  ]
    .join("-")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 80);

  return {
    email: `${suffix}@e2e.vrdex.local`,
    password: `VRDex-${suffix}-password-12345`,
  };
}

async function createVerifiedAccount({
  page,
  request,
  token,
  email,
  password,
}: {
  page: Page;
  request: APIRequestContext;
  token: string;
  email: string;
  password: string;
}) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Use email and password" }).click();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText(new RegExp(`Check ${email} for a verification code`, "i")),
  ).toBeVisible();

  const codeResponse = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": token },
    data: { action: "consume-code", email },
  });
  await expect(codeResponse).toBeOK();
  const { code } = (await codeResponse.json()) as { code: string };

  await page.getByLabel("Verification code").fill(code);
  await Promise.all([
    page.waitForURL(/\/account$/),
    page.getByRole("button", { name: "Verify email" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: email })).toBeVisible();
}

async function cleanupAccount(
  request: APIRequestContext,
  token: string,
  email: string,
) {
  const response = await request.delete("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": token },
    data: { email },
  });
  await expect(response).toBeOK();
}

async function setSessionState(
  request: APIRequestContext,
  token: string,
  email: string,
  state:
    | "absolute_expired"
    | "inactive_expired"
    | "invalid_refresh"
    | "revoked",
  now: number,
) {
  const response = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": token },
    data: {
      action: "set-session-state",
      email,
      state,
      now,
    },
  });
  await expect(response).toBeOK();
}

/**
 * The invalidated-session cases below hand the page a dead session and then ask
 * it to refresh. The app notices that on its own and navigates to `/sign-in`,
 * which tears down the execution context an in-flight `page.evaluate` is
 * running in — the behaviour under test arriving early, not a failure. The
 * `page.goto` below already tolerates the same redirect for the same reason.
 */
function isNavigationAbort(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("The operation was aborted") ||
    error.message.includes("Execution context was destroyed") ||
    error.message.includes("net::ERR_ABORTED") ||
    error.message.includes("NS_BINDING_ABORTED")
  );
}

async function forceRefresh(page: Page) {
  // Bounded: a genuine hang still fails rather than retrying forever, and the
  // assertions on the result are unchanged either way — the endpoint must
  // refuse the refresh and no browser credentials may survive it.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await evaluateRefresh(page);
    } catch (error) {
      if (attempt >= 2 || !isNavigationAbort(error)) {
        throw error;
      }

      await page.waitForLoadState("domcontentloaded");
    }
  }
}

async function evaluateRefresh(page: Page) {
  return await page.evaluate(async () => {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "auth:signIn",
        args: { refreshToken: "dummy" },
      }),
    });

    return {
      ok: response.ok,
      body: (await response.json()) as {
        tokens: { token: string; refreshToken: string } | null;
      },
    };
  });
}

function authCookies(context: BrowserContext) {
  return context
    .cookies()
    .then((cookies) =>
      cookies.filter((cookie) => cookie.name.includes("__convexAuth")),
    );
}

async function createAuthenticatedContext({
  browser,
  request,
  token,
  email,
  password,
}: {
  browser: Browser;
  request: APIRequestContext;
  token: string;
  email: string;
  password: string;
}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await createVerifiedAccount({
    page,
    request,
    token,
    email,
    password,
  });
  return { context, page };
}

async function signInVerifiedAccount({
  page,
  email,
  password,
}: {
  page: Page;
  email: string;
  password: string;
}) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Use email and password" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL(/\/account$/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

async function launchPersistentAuthContext(
  browserType: BrowserType,
  userDataDir: string,
) {
  return await browserType.launchPersistentContext(userDataDir, {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL?.trim().replace(/\/+$/, "") ??
      `http://127.0.0.1:${process.env.PLAYWRIGHT_TEST_PORT ?? "3002"}`,
    locale: "en-US",
    serviceWorkers: "block",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 900 },
  });
}

async function closePersistentAuthContext(
  context: BrowserContext | undefined,
) {
  if (!context) {
    return;
  }

  const browser = context.browser();
  await context.close();
  if (browser?.isConnected()) {
    await browser.close();
  }
}

test(
  "remembered session survives a persistent-profile restart, deployment hydration, rotation, concurrent tabs, and sign-out @flow @fixture @auth-session-matrix @auth-session-staging",
  async ({ browserName, playwright, request }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(
      Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
        process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
      "Hosted auth E2E helpers are not enabled for this target.",
    );

    const token = e2eBrowserToken();
    const { email, password } = e2eIdentity(testInfo);
    const browserType = playwright[browserName];
    const userDataDir = await mkdtemp(
      path.join(tmpdir(), "vrdex-auth-session-"),
    );
    let firstContext: BrowserContext | undefined;
    let restartedContext: BrowserContext | undefined;

    try {
      firstContext = await launchPersistentAuthContext(
        browserType,
        userDataDir,
      );
      const firstPage = firstContext.pages()[0] ?? await firstContext.newPage();
      if (
        process.env.VRDEX_AUTH_MATRIX_RUN_ID &&
        browserName !== "chromium"
      ) {
        await signInVerifiedAccount({ page: firstPage, email, password });
      } else {
        await createVerifiedAccount({
          page: firstPage,
          request,
          token,
          email,
          password,
        });
      }

      const cookiesBeforeRefresh = await authCookies(firstContext);
      expect(cookiesBeforeRefresh).toHaveLength(2);
      // Playwright's Windows WebKit port reports Lax response cookies as None.
      // Linux WebKit in CI and the hosted browsers retain the actual attribute.
      const expectedSameSite =
        browserName === "webkit" && process.platform === "win32"
          ? "None"
          : "Lax";
      for (const cookie of cookiesBeforeRefresh) {
        expect(cookie.httpOnly).toBe(true);
        expect(cookie.sameSite).toBe(expectedSameSite);
        expect(cookie.path).toBe("/");
        expect(cookie.expires).toBeGreaterThan(
          Date.now() / 1_000 + 29 * DAY_SECONDS,
        );
        expect(cookie.expires).toBeLessThan(
          Date.now() / 1_000 + 31 * DAY_SECONDS,
        );
      }

      const refreshCookieBefore = cookiesBeforeRefresh.find((cookie) =>
        cookie.name.includes("RefreshToken"),
      )?.value;
      await firstPage.route("**/api/auth", (route) =>
        route.abort("failed"),
      );
      const transientRefreshFailed = await forceRefresh(firstPage).then(
        () => false,
        () => true,
      );
      expect(transientRefreshFailed).toBe(true);
      const cookiesAfterTransientFailure = await authCookies(firstContext);
      expect(cookiesAfterTransientFailure).toHaveLength(2);
      for (const cookie of cookiesAfterTransientFailure) {
        expect(cookie.value).toBeTruthy();
        expect(cookie.expires).toBeGreaterThan(
          Date.now() / 1_000 + 29 * DAY_SECONDS,
        );
      }
      await firstPage.unroute("**/api/auth");
      await firstPage.reload();
      await expect(
        firstPage.getByRole("heading", { name: email }),
      ).toBeVisible();

      const refreshResult = await forceRefresh(firstPage);
      expect(refreshResult.ok).toBe(true);
      expect(refreshResult.body.tokens).not.toBeNull();
      const refreshCookieAfter = (await authCookies(firstContext)).find(
        (cookie) => cookie.name.includes("RefreshToken"),
      )?.value;
      expect(refreshCookieAfter).toBeTruthy();
      expect(refreshCookieAfter).not.toBe(refreshCookieBefore);

      await closePersistentAuthContext(firstContext);
      firstContext = undefined;

      restartedContext = await launchPersistentAuthContext(
        browserType,
        userDataDir,
      );
      const restoredPage =
        restartedContext.pages()[0] ?? await restartedContext.newPage();
      await restoredPage.goto("/account");
      await expect(
        restoredPage.getByRole("heading", { name: email }),
      ).toBeVisible();

      const siblingPage = await restartedContext.newPage();
      await siblingPage.goto("/");
      await expect(
        siblingPage.getByRole("link", { name: "Account" }),
      ).toBeVisible();

      await restoredPage.getByRole("button", { name: "Sign out" }).click();
      await expect(restoredPage).toHaveURL(/\/sign-in$/);
      await expect(siblingPage).toHaveURL(/\/sign-in(?:\?|$)/);
      await expect(
        siblingPage.getByRole("heading", { name: "Sign in" }),
      ).toBeVisible();

      await restoredPage.goto("/account");
      await expect(restoredPage).toHaveURL(/\/sign-in\?returnTo=/);
      expect(await authCookies(restartedContext)).toHaveLength(0);
    } finally {
      await closePersistentAuthContext(firstContext);
      await closePersistentAuthContext(restartedContext);
      if (!process.env.VRDEX_AUTH_MATRIX_RUN_ID) {
        await cleanupAccount(request, token, email);
      }
      await rm(userDataDir, { force: true, recursive: true });
    }
  },
);

for (const state of [
  "inactive_expired",
  "absolute_expired",
  "invalid_refresh",
  "revoked",
] as const) {
  const matrixTag =
    state === "invalid_refresh" ? " @auth-session-matrix" : "";
  test(`${state} session fails closed without retaining browser credentials @flow @fixture${matrixTag}`, async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    test.skip(
      Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
        process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
      "Hosted auth E2E helpers are not enabled for this target.",
    );

    const token = e2eBrowserToken();
    const identity = e2eIdentity(testInfo);
    let context: BrowserContext | undefined;

    try {
      const authenticated = process.env.VRDEX_AUTH_MATRIX_RUN_ID
        ? await (async () => {
            const signedInContext = await browser.newContext();
            const signedInPage = await signedInContext.newPage();
            await signInVerifiedAccount({
              page: signedInPage,
              ...identity,
            });
            return {
              context: signedInContext,
              page: signedInPage,
            };
          })()
        : await createAuthenticatedContext({
            browser,
            request,
            token,
            ...identity,
          });
      context = authenticated.context;

      await setSessionState(
        request,
        token,
        identity.email,
        state,
        Date.UTC(2020, 0, 1),
      );
      const refreshResult = await forceRefresh(authenticated.page);
      expect(refreshResult.ok).toBe(true);
      expect(refreshResult.body.tokens).toBeNull();
      expect(await authCookies(context)).toHaveLength(0);

      await authenticated.page.goto("/account").catch((error: unknown) => {
        const expectedRedirectAbort =
          isNavigationAbort(error) ||
          (error instanceof Error &&
            error.message.includes("is interrupted by another navigation to") &&
            error.message.includes("/sign-in?returnTo="));
        if (!expectedRedirectAbort) {
          throw error;
        }
      });
      await expect(authenticated.page).toHaveURL(/\/sign-in\?returnTo=/);
    } finally {
      await context?.close();
      if (!process.env.VRDEX_AUTH_MATRIX_RUN_ID) {
        await cleanupAccount(request, token, identity.email);
      }
    }
  });
}
