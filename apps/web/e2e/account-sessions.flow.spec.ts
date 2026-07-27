import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

test.describe.configure({ mode: "serial" });

function e2eBrowserToken() {
  const token =
    process.env.VRDEX_E2E_BROWSER_TOKEN ??
    (process.env.PLAYWRIGHT_BASE_URL
      ? undefined
      : "local-playwright-token");

  if (!token) {
    throw new Error(
      "VRDEX_E2E_BROWSER_TOKEN must be set for hosted account-session runs.",
    );
  }

  return token;
}

function accountIdentity(testInfo: {
  project: { name: string };
  workerIndex: number;
}) {
  const suffix = [
    "account-sessions",
    testInfo.project.name,
    testInfo.workerIndex,
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

async function openPasswordForm(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Use email and password" }).click();
}

async function completePasswordReauthentication(
  page: Page,
  identity: { email: string; password: string },
) {
  await expect(
    page.getByRole("heading", { name: "Sign in again" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use email and password" })
    .click();
  await page.getByLabel("Email").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
}

function sameOriginPath(page: Page, path: string) {
  return new URL(path, page.url()).toString();
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
  await openPasswordForm(page);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText(
      new RegExp(`Check ${email} for a verification code`, "i"),
    ),
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
}

async function signIn({
  page,
  email,
  password,
}: {
  page: Page;
  email: string;
  password: string;
}) {
  await openPasswordForm(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL(/\/account$/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

async function newSignedInContext({
  browser,
  email,
  password,
}: {
  browser: Browser;
  email: string;
  password: string;
}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn({ page, email, password });
  return { context, page };
}

test("reauthentication cancellation preserves the session and password completion returns safely @flow @fixture", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
      process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );
  const token = e2eBrowserToken();
  const identity = accountIdentity(testInfo);
  let context: BrowserContext | undefined;

  try {
    context = await browser.newContext();
    const page = await context.newPage();
    await createVerifiedAccount({
      page,
      request,
      token,
      ...identity,
    });
    await page.goto(
      sameOriginPath(
        page,
        "/auth/reauth/fail?returnTo=%2Faccount%2Fsecurity",
      ),
    );
    await expect(page).toHaveURL(/\/account\/security$/);
    await expect(
      page.getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();
    expect(
      (await context.cookies()).filter((cookie) =>
        cookie.name.includes("convexAuth")
      ),
    ).not.toHaveLength(0);
    await page.goto(
      sameOriginPath(
        page,
        "/auth/reauth/start?returnTo=%2Faccount%2Fsecurity",
      ),
    );
    await expect(
      page.getByRole("heading", { name: "Sign in again" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Discord" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/account\/security$/);
    await expect(
      page.getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();

    await page.goto(
      sameOriginPath(
        page,
        "/auth/reauth/start?returnTo=%2Faccount%2Fsecurity",
      ),
    );
    await page.getByRole("button", { name: "Use email and password" }).click();
    await page.getByLabel("Email").fill(identity.email);
    await page.getByLabel("Password").fill(identity.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account\/security$/);
    await expect(
      page.getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        (await context!.cookies())
          .filter((cookie) =>
            cookie.name.includes("vrdexReauthBinding"),
          )
          .map((cookie) => cookie.name),
      )
      .toEqual([]);
    await expect(
      page.getByRole("button", { name: "Sign out this session" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /^Sign out session from / }),
    ).toHaveCount(0);
  } finally {
    await context?.close();
    const cleanupResponse = await request.delete("/api/e2e/auth", {
      headers: { "x-vrdex-e2e-token": token },
      data: { email: identity.email },
    });
    await expect(cleanupResponse).toBeOK();
  }
});

test("concurrent reauthentication challenges complete without signing out or leaving superseded sessions @flow @fixture", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
      process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );
  const token = e2eBrowserToken();
  const identity = accountIdentity(testInfo);
  let context: BrowserContext | undefined;

  try {
    context = await browser.newContext();
    const firstPage = await context.newPage();
    await createVerifiedAccount({
      page: firstPage,
      request,
      token,
      ...identity,
    });
    const secondPage = await context.newPage();
    const reauthenticationUrl = sameOriginPath(
      firstPage,
      "/auth/reauth/start?returnTo=%2Faccount%2Fsecurity",
    );

    for (const page of [firstPage, secondPage]) {
      await page.goto(reauthenticationUrl);
      await expect(
        page.getByRole("heading", { name: "Sign in again" }),
      ).toBeVisible();
    }

    for (const page of [firstPage, secondPage]) {
      await page
        .getByRole("button", { name: "Use email and password" })
        .click();
      await page.getByLabel("Email").fill(identity.email);
      await page.getByLabel("Password").fill(identity.password);
    }
    const completionArrivals: number[] = [];
    const completionBodies: string[] = [];
    const completionDestinations: string[] = [];
    await context.route(/\/auth\/reauth\/complete$/, async (route) => {
      completionArrivals.push(Date.now());
      completionBodies.push(route.request().postData() ?? "");
      if (completionArrivals.length === 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      const response = await route.fetch();
      const body = (await response.json()) as {
        destination?: unknown;
      };
      completionDestinations.push(
        typeof body.destination === "string" ? body.destination : "",
      );
      await route.fulfill({ response });
    });
    await Promise.all(
      [firstPage, secondPage].map((page) =>
        page.getByRole("button", { name: "Sign in" }).click(),
      ),
    );
    await expect
      .poll(() => completionBodies.length, { timeout: 15_000 })
      .toBe(2);
    expect(completionBodies).toHaveLength(2);
    for (const body of completionBodies) {
      expect(JSON.parse(body)).toMatchObject({
        returnTo: "/account/security",
      });
    }
    for (const destination of completionDestinations) {
      expect(destination).toMatch(
        /^\/auth\/reauth\/finish\?returnTo=%2Faccount%2Fsecurity&challenge=/,
      );
    }
    for (const page of [firstPage, secondPage]) {
      await expect(page).toHaveURL(/\/account\/security$/);
    }
    expect(completionArrivals).toHaveLength(2);
    expect(completionArrivals[1] - completionArrivals[0]).toBeGreaterThanOrEqual(
      250,
    );
    await context.unroute(/\/auth\/reauth\/complete$/);

    for (const page of [firstPage, secondPage]) {
      await page.goto(sameOriginPath(page, "/account/security"));
      await expect(
        page.getByRole("heading", { name: "Sessions" }),
      ).toBeVisible();
    }
    await expect(
      secondPage.getByRole("button", { name: "Sign out this session" }),
    ).toHaveCount(1);
    await expect(
      secondPage.getByRole("button", {
        name: /^Sign out session from /,
      }),
    ).toHaveCount(0);
    await expect
      .poll(async () =>
        (await context!.cookies())
          .filter((cookie) =>
            cookie.name.includes("vrdexReauthBinding"),
          )
          .map((cookie) => cookie.name),
      )
      .toEqual([]);
  } finally {
    await context?.close();
    const cleanupResponse = await request.delete("/api/e2e/auth", {
      headers: { "x-vrdex-e2e-token": token },
      data: { email: identity.email },
    });
    await expect(cleanupResponse).toBeOK();
  }
});

test("reauthentication refuses a different principal without revoking separate sessions @flow @fixture", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
      process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );
  const token = e2eBrowserToken();
  const firstIdentity = accountIdentity(testInfo);
  const secondIdentity = {
    email: firstIdentity.email.replace("@", "-different@"),
    password: `${firstIdentity.password}-different`,
  };
  let firstContext: BrowserContext | undefined;
  let firstRemoteContext: BrowserContext | undefined;
  let secondContext: BrowserContext | undefined;

  try {
    firstContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    await createVerifiedAccount({
      page: firstPage,
      request,
      token,
      ...firstIdentity,
    });

    secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await createVerifiedAccount({
      page: secondPage,
      request,
      token,
      ...secondIdentity,
    });

    ({ context: firstRemoteContext } = await newSignedInContext({
      browser,
      ...firstIdentity,
    }));
    const firstRemotePage = firstRemoteContext.pages()[0]!;

    await firstPage.goto(
      sameOriginPath(
        firstPage,
        "/auth/reauth/start?returnTo=%2Faccount%2Fsecurity",
      ),
    );
    await firstPage
      .getByRole("button", { name: "Use email and password" })
      .click();
    await firstPage.getByLabel("Email").fill(secondIdentity.email);
    await firstPage.getByLabel("Password").fill(secondIdentity.password);
    await firstPage.getByRole("button", { name: "Sign in" }).click();

    await expect(
      firstPage.getByText(
        "Sign-in failed. Check your details and try again.",
      ),
    ).toBeVisible();
    await firstPage.goto(sameOriginPath(firstPage, "/account/security"));
    await expect(
      firstPage.getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();

    await firstRemotePage.goto("/account/security");
    await expect(
      firstRemotePage.getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();
    await secondPage.goto("/account/security");
    await expect(
      secondPage.getByRole("heading", { name: "Sessions" }),
    ).toBeVisible();
    await expect(
      secondPage.getByRole("button", { name: "Sign out this session" }),
    ).toHaveCount(1);
    await expect(
      secondPage.getByRole("button", {
        name: /^Sign out session from /,
      }),
    ).toHaveCount(0);
  } finally {
    await firstContext?.close();
    await firstRemoteContext?.close();
    await secondContext?.close();
    for (const identity of [firstIdentity, secondIdentity]) {
      const cleanupResponse = await request.delete("/api/e2e/auth", {
        headers: { "x-vrdex-e2e-token": token },
        data: { email: identity.email },
      });
      await expect(cleanupResponse).toBeOK();
    }
  }
});

test("reauthentication transport failure revokes the replacement session without affecting another account @flow @fixture", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
      process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );
  const token = e2eBrowserToken();
  const firstIdentity = accountIdentity(testInfo);
  const secondIdentity = {
    email: firstIdentity.email.replace("@", "-replacement@"),
    password: `${firstIdentity.password}-replacement`,
  };
  let firstContext: BrowserContext | undefined;
  let secondContext: BrowserContext | undefined;

  try {
    firstContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    await createVerifiedAccount({
      page: firstPage,
      request,
      token,
      ...firstIdentity,
    });
    secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await createVerifiedAccount({
      page: secondPage,
      request,
      token,
      ...secondIdentity,
    });

    await firstPage.goto(
      sameOriginPath(
        firstPage,
        "/auth/reauth/start?returnTo=%2Faccount%2Fsecurity",
      ),
    );
    await firstPage
      .getByRole("button", { name: "Use email and password" })
      .click();
    await firstPage.getByLabel("Email").fill(firstIdentity.email);
    await firstPage.getByLabel("Password").fill(firstIdentity.password);
    await firstContext.route(
      /\/auth\/reauth\/complete$/,
      (route) => route.abort("failed"),
    );
    await firstPage.getByRole("button", { name: "Sign in" }).click();

    await expect(firstPage).toHaveURL(
      /\/sign-in\?returnTo=%2Faccount%2Fsecurity$/,
    );
    await expect
      .poll(async () =>
        (await firstContext!.cookies(firstPage.url()))
          .filter((cookie) => cookie.name.includes("convexAuth"))
          .map((cookie) => cookie.name),
      )
      .toEqual([]);
    await secondPage.goto("/account/security");
    await expect(
      secondPage.getByRole("button", { name: "Sign out this session" }),
    ).toHaveCount(1);
    await expect(
      secondPage.getByRole("button", {
        name: /^Sign out session from /,
      }),
    ).toHaveCount(0);
  } finally {
    await firstContext?.close();
    await secondContext?.close();
    for (const identity of [firstIdentity, secondIdentity]) {
      const cleanupResponse = await request.delete("/api/e2e/auth", {
        headers: { "x-vrdex-e2e-token": token },
        data: { email: identity.email },
      });
      await expect(cleanupResponse).toBeOK();
    }
  }
});

test("manages separate sessions and converges revoked browsers cleanly @flow @fixture", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
      process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );

  const token = e2eBrowserToken();
  const identity = accountIdentity(testInfo);
  let firstContext: BrowserContext | undefined;
  let secondContext: BrowserContext | undefined;

  try {
    firstContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    await createVerifiedAccount({
      page: firstPage,
      request,
      token,
      ...identity,
    });

    ({ context: secondContext } = await newSignedInContext({
      browser,
      ...identity,
    }));
    const secondPage = secondContext.pages()[0]!;

    await Promise.all([
      firstPage.goto("/account/security"),
      secondPage.goto("/account"),
    ]);
    await expect(firstPage.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await expect(firstPage.getByRole("listitem")).toHaveCount(2);

    const remoteRow = firstPage
      .getByRole("listitem")
      .filter({ hasNotText: "This session" });
    await remoteRow
      .getByRole("button", { name: /Sign out session from/ })
      .click();
    await completePasswordReauthentication(firstPage, identity);
    await firstPage
      .getByRole("listitem")
      .filter({ hasNotText: "This session" })
      .getByRole("button", { name: /Sign out session from/ })
      .click();
    await expect(firstPage.getByRole("listitem")).toHaveCount(1);
    await expect(secondPage).toHaveURL(/\/sign-in\?returnTo=/);

    await secondContext.close();
    secondContext = undefined;
    ({ context: secondContext } = await newSignedInContext({
      browser,
      ...identity,
    }));
    const replacementPage = secondContext.pages()[0]!;
    await replacementPage.goto("/account/security");
    await expect(firstPage.getByRole("listitem")).toHaveCount(2);

    firstPage.once("dialog", (dialog) => dialog.accept());
    await firstPage.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(firstPage).toHaveURL(/\/sign-in$/);
    await expect(replacementPage).toHaveURL(/\/sign-in\?returnTo=/);
  } finally {
    await firstContext?.close();
    await secondContext?.close();
    const cleanupResponse = await request.delete("/api/e2e/auth", {
      headers: { "x-vrdex-e2e-token": token },
      data: { email: identity.email },
    });
    await expect(cleanupResponse).toBeOK();
  }
});
