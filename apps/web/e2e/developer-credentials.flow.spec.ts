import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";

import { gotoFlowPage } from "./flow-navigation";

test.describe.configure({ mode: "serial" });

type JsonResponse = {
  body: unknown;
  ok: boolean;
  status: number;
};

function problemSummary(body: unknown) {
  if (body === null || typeof body !== "object") {
    return "no structured problem details";
  }

  const problem = body as Record<string, unknown>;
  const details = [problem.title, problem.detail, problem.error, problem.error_description].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  return details.length > 0 ? details.join(": ") : "no structured problem details";
}

function expectJsonResponseOk(response: JsonResponse, operation: string) {
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}: ${problemSummary(response.body)}`);
  }

  expect(response.status).toBe(200);
}

async function expectApiResponseOk(response: APIResponse, operation: string) {
  if (response.ok()) {
    return;
  }

  const body = await response.json().catch(() => null);

  throw new Error(`${operation} failed with HTTP ${response.status()}: ${problemSummary(body)}`);
}

function e2eBrowserToken() {
  const token = process.env.VRDEX_E2E_BROWSER_TOKEN ?? (process.env.PLAYWRIGHT_BASE_URL ? undefined : "local-playwright-token");

  if (!token) {
    throw new Error("VRDEX_E2E_BROWSER_TOKEN must be set for hosted Playwright data-flow runs.");
  }

  return token;
}

function e2eRunId(testInfo: { project: { name: string }; workerIndex: number; repeatEachIndex: number }) {
  const prefix = process.env.VRDEX_E2E_RUN_ID ?? "playwright-developer";

  return `${prefix}-${testInfo.project.name}-${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 120);
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
  await page.getByRole("button", { name: "Use email and password" }).click();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(new RegExp(`Check ${email} for a verification code`, "i"))).toBeVisible();

  const codeResponse = await request.post("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { action: "consume-code", email },
  });
  await expectApiResponseOk(codeResponse, "E2E verification-code lookup");
  const authCode = (await codeResponse.json()) as { code?: string };

  expect(authCode.code).toBeTruthy();

  await page.getByLabel("Verification code").fill(authCode.code!);
  await Promise.all([
    page.waitForURL(/\/account$/),
    page.getByRole("button", { name: "Verify email" }).click(),
  ]);
}

async function cleanupE2eAccount(request: APIRequestContext, e2eToken: string, email: string) {
  await request.delete("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { email },
  });
}

async function postSessionJson(page: Page, path: string, payload: Record<string, unknown>): Promise<JsonResponse> {
  return await page.evaluate(
    async ({ path: requestPath, payload: requestPayload }) => {
      const response = await fetch(requestPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const body = await response.json().catch(() => null);

      return { body, ok: response.ok, status: response.status };
    },
    { path, payload },
  );
}

function bearerHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function createPkceVerifier() {
  return randomBytes(32).toString("base64url");
}

function deriveS256CodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

test("developer credentials work with v0 bearer APIs and OAuth PKCE @flow", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_DEVELOPER_CREDENTIALS !== "true",
    "Hosted developer credentials E2E is not enabled for this target.",
  );

  const e2eToken = e2eBrowserToken();
  const runId = e2eRunId(testInfo);
  const runSuffix = runId.replace(/^playwright-developer-?/, "").slice(0, 48);
  const email = `developer-${runSuffix}@e2e.vrdex.local`;
  const password = `VRDex-${runSuffix}-developer-password-12345`;
  let apiTokenValue: string | undefined;
  let accountCreated = false;

  try {
    await createVerifiedE2eAccount({ page, request, e2eToken, email, password });
    accountCreated = true;
    await gotoFlowPage(page, "/account");

    const tokenResult = await postSessionJson(page, "/api/developer/tokens", {
      label: `Playwright developer token ${runSuffix}`,
      scopes: ["public:read", "developer:read", "developer:write"],
    });

    expectJsonResponseOk(tokenResult, "Personal API token creation");
    const tokenBody = tokenResult.body as {
      token?: { id?: string; ownerKind?: string; scopes?: string[]; status?: string };
      tokenValue?: string;
    };

    expect(tokenBody.tokenValue).toMatch(/^vrdx_[0-9a-f]{24}\.[0-9a-f]{64}$/);
    expect(tokenBody.token?.id).toBeTruthy();
    expect(tokenBody.token?.ownerKind).toBe("user");
    expect(tokenBody.token?.status).toBe("active");
    expect(tokenBody.token?.scopes).toEqual(expect.arrayContaining(["public:read", "developer:read", "developer:write"]));
    apiTokenValue = tokenBody.tokenValue;
    const apiTokenId = tokenBody.token?.id;

    const apiMeResponse = await request.get("/api/v0/me", {
      headers: bearerHeaders(apiTokenValue!),
    });

    await expectApiResponseOk(apiMeResponse, "Personal API token introspection");
    const apiMe = (await apiMeResponse.json()) as {
      credential?: { kind?: string; ownerKind?: string; scopes?: string[]; tokenId?: string };
      rateLimit?: { routeClass?: string };
    };

    expect(apiMe.credential?.kind).toBe("api_token");
    expect(apiMe.credential?.ownerKind).toBe("user");
    expect(apiMe.credential?.tokenId).toBe(apiTokenId);
    expect(apiMe.credential?.scopes).toEqual(expect.arrayContaining(["public:read", "developer:read", "developer:write"]));
    expect(apiMe.rateLimit?.routeClass).toBe("authenticated_public_read");

    const apiRateLimitResponse = await request.get("/api/v0/usage/rate-limit", {
      headers: bearerHeaders(apiTokenValue!),
    });

    await expectApiResponseOk(apiRateLimitResponse, "Personal API token rate-limit lookup");
    const apiRateLimit = (await apiRateLimitResponse.json()) as {
      caller?: { authenticated?: boolean; credentialKind?: string; quotaTier?: string; routeClass?: string };
    };

    expect(apiRateLimit.caller).toEqual({
      authenticated: true,
      credentialKind: "personal_api_token",
      quotaTier: "standard",
      routeClass: "authenticated_public_read",
    });

    const origin = await page.evaluate(() => window.location.origin);
    const redirectUri = `${origin}/oauth/e2e-callback`;
    const displayName = `Playwright OAuth ${runSuffix}`;
    const oauthResult = await postSessionJson(page, "/api/developer/oauth-apps", {
      clientType: "public",
      displayName,
      redirectUris: [redirectUri],
      allowedScopes: ["public:read"],
    });

    expectJsonResponseOk(oauthResult, "OAuth application creation");
    const oauthBody = oauthResult.body as {
      application?: { clientId?: string; clientType?: string; status?: string };
      clientSecretValue?: string;
    };

    expect(oauthBody.application?.clientId).toMatch(/^vrdx_app_[0-9a-f]{24}$/);
    expect(oauthBody.application?.clientType).toBe("public");
    expect(oauthBody.application?.status).toBe("active");
    expect(oauthBody.clientSecretValue).toBeUndefined();
    const oauthClientId = oauthBody.application?.clientId;

    const codeVerifier = createPkceVerifier();
    const authorizeParams = new URLSearchParams({
      client_id: oauthClientId!,
      code_challenge: deriveS256CodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
      resource: origin,
      response_type: "code",
      scope: "public:read",
      state: runSuffix,
    });

    await gotoFlowPage(page, `/oauth/authorize?${authorizeParams.toString()}`);
    await expect(page.getByRole("heading", { name: `Authorize ${displayName}` })).toBeVisible();
    const transaction = await page.locator('input[name="transaction"]').inputValue();

    expect(transaction).toMatch(/^vrdx_consent_[A-Za-z0-9_-]{43}$/);

    const consentResponse = await page.request.post("/oauth/authorize/consent", {
      form: {
        decision: "approve",
        transaction,
      },
      maxRedirects: 0,
      timeout: 15_000,
    });
    const callbackLocation = consentResponse.headers().location;

    expect(consentResponse.status()).toBe(303);
    expect(callbackLocation).toBeTruthy();
    const callbackUrl = new URL(callbackLocation!, origin);
    const authorizationCode = callbackUrl.searchParams.get("code");

    expect(callbackUrl.searchParams.get("error")).toBeNull();
    expect(callbackUrl.toString()).toMatch(/[?&]code=vrdx_code_[0-9a-f]{32}/);
    expect(authorizationCode).toMatch(/^vrdx_code_[0-9a-f]{32}$/);
    expect(callbackUrl.searchParams.get("state")).toBe(runSuffix);

    const oauthTokenResponse = await request.post("/oauth/token", {
      form: {
        client_id: oauthClientId!,
        code: authorizationCode!,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        resource: origin,
      },
      timeout: 15_000,
    });

    await expectApiResponseOk(oauthTokenResponse, "OAuth authorization-code exchange");
    const oauthToken = (await oauthTokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      token_type?: string;
    };

    expect(oauthToken.access_token).toBeTruthy();
    expect(oauthToken.refresh_token).toMatch(/^vrdx_rt_[0-9a-f]{48}$/);
    expect(oauthToken.scope).toBe("public:read");
    expect(oauthToken.token_type).toBe("Bearer");

    const oauthMeResponse = await request.get("/api/v0/me", {
      headers: bearerHeaders(oauthToken.access_token!),
    });

    await expectApiResponseOk(oauthMeResponse, "OAuth access-token introspection");
    const oauthMe = (await oauthMeResponse.json()) as {
      credential?: { clientId?: string; kind?: string; scopes?: string[]; subjectType?: string };
      rateLimit?: { routeClass?: string };
    };

    expect(oauthMe.credential?.kind).toBe("oauth");
    expect(oauthMe.credential?.clientId).toBe(oauthClientId);
    expect(oauthMe.credential?.subjectType).toBe("user");
    expect(oauthMe.credential?.scopes).toEqual(["public:read"]);
    expect(oauthMe.rateLimit?.routeClass).toBe("authenticated_public_read");

    const oauthRateLimitResponse = await request.get("/api/v0/usage/rate-limit", {
      headers: bearerHeaders(oauthToken.access_token!),
    });

    await expectApiResponseOk(oauthRateLimitResponse, "OAuth access-token rate-limit lookup");
    const oauthRateLimit = (await oauthRateLimitResponse.json()) as {
      caller?: { authenticated?: boolean; credentialKind?: string; quotaTier?: string; routeClass?: string };
    };

    expect(oauthRateLimit.caller).toEqual({
      authenticated: true,
      credentialKind: "oauth_client",
      quotaTier: "standard",
      routeClass: "authenticated_public_read",
    });

    const refreshTokenResponse = await request.post("/oauth/token", {
      form: {
        client_id: oauthClientId!,
        grant_type: "refresh_token",
        refresh_token: oauthToken.refresh_token!,
        resource: origin,
      },
      timeout: 15_000,
    });

    await expectApiResponseOk(refreshTokenResponse, "OAuth refresh-token exchange");
    const refreshedToken = (await refreshTokenResponse.json()) as { access_token?: string; scope?: string; token_type?: string };

    expect(refreshedToken.access_token).toBeTruthy();
    expect(refreshedToken.scope).toBe("public:read");
    expect(refreshedToken.token_type).toBe("Bearer");
  } finally {
    if (accountCreated) {
      await cleanupE2eAccount(request, e2eToken, email);
    }
  }
});
