import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

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
  await request.delete("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": token },
    data: { email },
  });
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

async function forceRefresh(page: Page) {
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

test(
  "remembered session survives restart, deployment hydration, rotation, concurrent tabs, and sign-out @flow @fixture",
  async ({ browser, request }, testInfo) => {
    test.setTimeout(90_000);
    test.skip(
      Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
        process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
      "Hosted auth E2E helpers are not enabled for this target.",
    );

    const token = e2eBrowserToken();
    const { email, password } = e2eIdentity(testInfo);
    let firstContext: BrowserContext | undefined;
    let restartedContext: BrowserContext | undefined;

    try {
      ({ context: firstContext } = await createAuthenticatedContext({
        browser,
        request,
        token,
        email,
        password,
      }));

      const cookiesBeforeRefresh = await authCookies(firstContext);
      expect(cookiesBeforeRefresh).toHaveLength(2);
      for (const cookie of cookiesBeforeRefresh) {
        expect(cookie.httpOnly).toBe(true);
        expect(cookie.sameSite).toBe("Lax");
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
      const firstPage = firstContext.pages()[0]!;
      await firstPage.route("**/api/auth", (route) =>
        route.abort("failed"),
      );
      const transientRefreshFailed = await forceRefresh(firstPage).then(
        () => false,
        () => true,
      );
      expect(transientRefreshFailed).toBe(true);
      expect(await authCookies(firstContext)).toEqual(cookiesBeforeRefresh);
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

      const persistentCookies = await authCookies(firstContext);
      await firstContext.close();
      firstContext = undefined;

      restartedContext = await browser.newContext({
        storageState: {
          cookies: persistentCookies,
          origins: [],
        },
      });
      const restoredPage = await restartedContext.newPage();
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
      await expect(
        siblingPage.getByRole("link", { name: "Sign in" }),
      ).toBeVisible();

      await restoredPage.goto("/account");
      await expect(restoredPage).toHaveURL(/\/sign-in\?returnTo=/);
      expect(await authCookies(restartedContext)).toHaveLength(0);
    } finally {
      await firstContext?.close();
      await restartedContext?.close();
      await cleanupAccount(request, token, email);
    }
  },
);

for (const state of [
  "inactive_expired",
  "absolute_expired",
  "invalid_refresh",
  "revoked",
] as const) {
  test(`${state} session fails closed without retaining browser credentials @flow @fixture`, async ({
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
      const authenticated = await createAuthenticatedContext({
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

      await authenticated.page.goto("/account");
      await expect(authenticated.page).toHaveURL(/\/sign-in\?returnTo=/);
    } finally {
      await context?.close();
      await cleanupAccount(request, token, identity.email);
    }
  });
}
