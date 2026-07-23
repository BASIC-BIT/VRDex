import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computePopulationMetrics,
  randomPollDelayMs as backendPollDelay,
  redactProviderText,
  retryDelayMs as backendRetryDelay,
} from "../../convex/_communityTelemetry";
import { RequestBudget, failureDisposition, randomPollDelayMs } from "../../workers/group-telemetry/runtime.mjs";
import { VrchatClient, VrchatProviderError } from "../../workers/group-telemetry/vrchat-client.mjs";
import { VrchatOperatorLogin, VrchatSessionValidationError } from "../../workers/group-telemetry/vrchat-login.mjs";
import { VrchatKeychainSessionStore, VrchatSessionStoreError } from "../../workers/group-telemetry/vrchat-session-store.mjs";

function jsonResponse(value: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function loginSubmitUrl(loginUrl: string) {
  const url = new URL(loginUrl);
  url.pathname = "/submit";
  return url;
}

async function postLoginForm(url: URL, fields: Record<string, string>, origin = url.origin) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: new URLSearchParams(fields),
  });
}

describe("group telemetry operator login", () => {
  for (const factor of ["totp", "emailOtp"] as const) {
    it(`keeps ${factor} credentials local and returns only the verified session`, async () => {
      const providerRequests: Array<{ url: string; authorization: string; cookie: string; body?: string }> = [];
      const responses = [
        jsonResponse(
          { requiresTwoFactorAuth: [factor] },
          200,
          { "set-cookie": "auth=auth-session-secret; Path=/; HttpOnly" },
        ),
        jsonResponse(
          { verified: true },
          200,
          { "set-cookie": "twoFactorAuth=two-factor-secret; Path=/; HttpOnly" },
        ),
        jsonResponse({ id: "usr_00000000-0000-4000-8000-000000000001" }),
      ];
      const login = new VrchatOperatorLogin({
        userAgent: "VRDex/0.1 telemetry@example.com",
        expectedUserId: "usr_00000000-0000-4000-8000-000000000001",
        accountAlias: "VRDex_Oak",
        fetcher: async (request: string | URL | Request, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          providerRequests.push({
            url: String(request),
            authorization: headers.get("authorization") ?? "",
            cookie: headers.get("cookie") ?? "",
            body: typeof init?.body === "string" ? init.body : undefined,
          });
          return responses.shift()!;
        },
      });
      const { url } = await login.start();
      const loginPage = await fetch(url);
      assert.equal(loginPage.status, 200);
      const loginHtml = await loginPage.text();
      assert.match(loginHtml, /VRDex service-account login/);
      assert.match(loginHtml, /VRDex_Oak/);
      assert.match(loginHtml, /directly to VRChat/);
      const submitUrl = loginSubmitUrl(url);
      const challenge = await postLoginForm(submitUrl, { username: "service@example.com", password: "never-persist" });
      assert.equal(challenge.status, 200);
      assert.match(await challenge.text(), factor === "totp" ? /Authenticator code/ : /Email verification code/);
      const success = await postLoginForm(submitUrl, { factorKind: factor, code: "123456" });
      assert.equal(success.status, 200);
      assert.match(await success.text(), /VRChat authentication succeeded/);
      const session = await login.waitForLogin();
      assert.deepEqual(session, {
        userId: "usr_00000000-0000-4000-8000-000000000001",
        authCookie: "auth-session-secret",
        twoFactorAuthCookie: "two-factor-secret",
      });
      assert.match(providerRequests[0]!.authorization, /^Basic /);
      assert.equal(providerRequests[1]!.authorization, "");
      assert.equal(providerRequests[1]!.cookie, "auth=auth-session-secret");
      assert.equal(providerRequests[1]!.body, JSON.stringify({ code: "123456" }));
      assert.equal(providerRequests[2]!.cookie, "auth=auth-session-secret; twoFactorAuth=two-factor-secret");
      assert.equal(JSON.stringify(providerRequests).includes("never-persist"), false);
    });
  }

  it("accepts an opaque sandbox origin while rejecting cross-origin posts, invalid tokens, and a different account", async () => {
    const login = new VrchatOperatorLogin({
      userAgent: "VRDex/0.1 telemetry@example.com",
      expectedUserId: "usr_00000000-0000-4000-8000-000000000001",
      fetcher: async () => jsonResponse(
        { id: "usr_00000000-0000-4000-8000-000000000002" },
        200,
        { "set-cookie": "auth=wrong-account-session; Path=/; HttpOnly" },
      ),
    });
    const { url } = await login.start();
    const submitUrl = loginSubmitUrl(url);
    const forbidden = await postLoginForm(submitUrl, { username: "service", password: "secret" }, "https://example.com");
    assert.equal(forbidden.status, 403);
    const invalidTokenUrl = new URL(submitUrl);
    invalidTokenUrl.searchParams.set("token", "invalid");
    const invalidToken = await postLoginForm(invalidTokenUrl, { username: "service", password: "secret" }, "null");
    assert.equal(invalidToken.status, 403);
    const mismatch = await postLoginForm(submitUrl, { username: "service", password: "secret" }, "null");
    assert.equal(mismatch.status, 200);
    assert.match(await mismatch.text(), /does not match VRDEX_VRCHAT_PROOF_USER_ID/);
    await login.close();
  });
});

describe("group telemetry keychain sessions", () => {
  it("scopes validated sessions by alias and removes malformed vault records without a plaintext fallback", async () => {
    const credentials = new Map<string, string>();
    const keytar = {
      getPassword: async (service: string, account: string) => credentials.get(`${service}|${account}`) ?? null,
      setPassword: async (service: string, account: string, value: string) => {
        credentials.set(`${service}|${account}`, value);
      },
      deletePassword: async (service: string, account: string) => credentials.delete(`${service}|${account}`),
    };
    const store = new VrchatKeychainSessionStore({
      keytarLoader: async () => keytar,
      clock: () => Date.parse("2026-07-22T12:00:00.000Z"),
    });
    await store.save("VRDex_Oak", {
      userId: "usr_00000000-0000-4000-8000-000000000001",
      authCookie: "auth-session-secret",
      twoFactorAuthCookie: "two-factor-secret",
    });
    assert.equal(credentials.size, 1);
    const [vaultKey] = credentials.keys();
    assert.match(vaultKey!, /vrchat:vrdex_oak$/);
    assert.doesNotMatch(vaultKey!, /auth-session-secret/);
    assert.deepEqual(await store.load("VRDex_Oak"), {
      schemaVersion: 1,
      userId: "usr_00000000-0000-4000-8000-000000000001",
      authCookie: "auth-session-secret",
      twoFactorAuthCookie: "two-factor-secret",
      savedAt: "2026-07-22T12:00:00.000Z",
    });
    assert.equal(await store.load("VRDex_Elm"), undefined);

    credentials.set(vaultKey!, "{malformed");
    await assert.rejects(
      store.load("VRDex_Oak"),
      (error: unknown) => error instanceof VrchatSessionStoreError && error.code === "invalid_session_removed",
    );
    assert.equal(credentials.size, 0);
  });

  it("validates a cached session against the immutable account and keeps transient failures", async () => {
    const providerCookies: string[] = [];
    const login = new VrchatOperatorLogin({
      userAgent: "VRDex/0.1 telemetry@example.com",
      expectedUserId: "usr_00000000-0000-4000-8000-000000000001",
      fetcher: async (_request, init) => {
        providerCookies.push(new Headers(init?.headers).get("cookie") ?? "");
        return jsonResponse(
          { id: "usr_00000000-0000-4000-8000-000000000001" },
          200,
          { "set-cookie": "auth=refreshed-auth-session; Path=/; HttpOnly" },
        );
      },
    });
    assert.deepEqual(await login.validateSession({
      userId: "usr_00000000-0000-4000-8000-000000000001",
      authCookie: "cached-auth-session",
      twoFactorAuthCookie: "cached-two-factor",
    }), {
      userId: "usr_00000000-0000-4000-8000-000000000001",
      authCookie: "refreshed-auth-session",
      twoFactorAuthCookie: "cached-two-factor",
    });
    assert.equal(providerCookies[0], "auth=cached-auth-session; twoFactorAuth=cached-two-factor");

    const expired = new VrchatOperatorLogin({
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async () => jsonResponse({}, 401),
    });
    await assert.rejects(
      expired.validateSession({ userId: "usr_00000000-0000-4000-8000-000000000001", authCookie: "expired-auth-session" }),
      (error: unknown) => error instanceof VrchatSessionValidationError && error.status === 401 && error.clearable,
    );

    const transient = new VrchatOperatorLogin({
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async () => { throw new Error("offline"); },
    });
    await assert.rejects(
      transient.validateSession({ userId: "usr_00000000-0000-4000-8000-000000000001", authCookie: "cached-auth-session" }),
      (error: unknown) => error instanceof VrchatSessionValidationError && !error.clearable,
    );
  });

  it("marks immutable-account mismatches as clearable", async () => {
    const login = new VrchatOperatorLogin({
      userAgent: "VRDex/0.1 telemetry@example.com",
      expectedUserId: "usr_00000000-0000-4000-8000-000000000001",
      fetcher: async () => jsonResponse({ id: "usr_00000000-0000-4000-8000-000000000002" }),
    });
    await assert.rejects(
      login.validateSession({
        userId: "usr_00000000-0000-4000-8000-000000000001",
        authCookie: "cached-auth-session",
      }),
      (error: unknown) => error instanceof VrchatSessionValidationError && error.clearable,
    );
  });
});

describe("group telemetry provider adapter", () => {
  it("handles request-to-join without collecting person-level presence", async () => {
    const responses = [
      jsonResponse({ id: "grp_example", memberCount: 50, membershipStatus: "inactive", joinState: "request", privacy: "private" }),
      jsonResponse({}),
      jsonResponse({ id: "grp_example", memberCount: 51, membershipStatus: "requested", joinState: "request", privacy: "private" }),
    ];
    const requests: RequestInfo[] = [];
    const client = new VrchatClient({
      authCookie: "cookie-value",
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async (request: RequestInfo | URL) => { requests.push(request); return responses.shift()!; },
    });
    const result = await client.connectGroup("grp_example");
    assert.equal(result.state, "awaiting_approval");
    assert.equal(result.transition, "requested");
    assert.equal(requests.length, 3);

    const pendingRequests: RequestInfo[] = [];
    const pending = new VrchatClient({
      authCookie: "cookie-value",
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async (request: RequestInfo | URL) => {
        pendingRequests.push(request);
        return jsonResponse({ id: "grp_example", memberCount: 51, membershipStatus: "requested", joinState: "request", privacy: "private" });
      },
    });
    const pendingResult = await pending.connectGroup("grp_example");
    assert.equal(pendingResult.state, "awaiting_approval");
    assert.equal(pendingResult.transition, "request_pending");
    assert.equal(pendingRequests.length, 1);
  });

  it("waits for invite-only groups and accepts a provider invitation once present", async () => {
    const waitingRequests: RequestInfo[] = [];
    const waiting = new VrchatClient({
      authCookie: "cookie-value",
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async (request: RequestInfo | URL) => {
        waitingRequests.push(request);
        return jsonResponse({ id: "grp_example", memberCount: 50, membershipStatus: "inactive", joinState: "invite", privacy: "private" });
      },
    });
    assert.equal((await waiting.connectGroup("grp_example")).state, "awaiting_invite");
    assert.equal(waitingRequests.length, 1);

    const invitedResponses = [
      jsonResponse({ id: "grp_example", memberCount: 50, membershipStatus: "invited", joinState: "invite", privacy: "private" }),
      jsonResponse({}),
      jsonResponse({ id: "grp_example", memberCount: 51, membershipStatus: "member", joinState: "invite", privacy: "private" }),
    ];
    const invited = new VrchatClient({
      authCookie: "cookie-value",
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async () => invitedResponses.shift()!,
    });
    assert.equal((await invited.connectGroup("grp_example")).transition, "accepted_invite");
  });

  it("treats an already-absent group membership as successful disconnect cleanup", async () => {
    const client = new VrchatClient({
      authCookie: "cookie-value",
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async () => jsonResponse({}, 404),
    });
    assert.equal(await client.leaveGroup("grp_example"), null);
  });

  it("accepts documented instance identifiers, projects aggregates, and caches slow group metadata", async () => {
    const cookies: string[] = [];
    let now = 1_000;
    const responses = [
      jsonResponse({ id: "grp_example", memberCount: 50, membershipStatus: "member", joinState: "open", privacy: "default" }),
      jsonResponse([{
        instanceId: "12345~hidden(usr_example)~region(eu)",
        location: "wrld_example:12345~hidden(usr_example)~region(eu)",
        memberCount: 7,
        world: { id: "wrld_example", name: "Example" },
        users: [{ id: "usr_must_not_escape" }],
      }]),
      jsonResponse([]),
      jsonResponse({ id: "grp_example", memberCount: 51, membershipStatus: "member", joinState: "open", privacy: "default" }),
      jsonResponse([]),
    ];
    const client = new VrchatClient({
      authCookie: "cookie-value",
      twoFactorAuthCookie: "two-factor",
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async (_request, init) => {
        cookies.push(new Headers(init?.headers).get("cookie") ?? "");
        return responses.shift()!;
      },
      clock: () => now,
    });
    const snapshot = await client.readAggregateSnapshot("grp_example");
    assert.deepEqual(snapshot.instances[0], {
      providerInstanceId: "12345~hidden(subject-redacted)~region(eu)",
      providerLocation: "wrld_example:12345~hidden(subject-redacted)~region(eu)",
      vrchatWorldId: "wrld_example",
      population: 7,
    });
    assert.equal("users" in snapshot.instances[0]!, false);
    assert.equal(JSON.stringify(snapshot).includes("usr_"), false);
    now += 4 * 60_000;
    assert.equal((await client.readAggregateSnapshot("grp_example")).group.memberCount, 50);
    now += 2 * 60_000;
    assert.equal((await client.readAggregateSnapshot("grp_example")).group.memberCount, 51);
    assert.equal(client.requestCounts.total, 5);
    assert.equal(cookies.length, 5);
  });

  it("honors request budgets and Retry-After without a retry storm", () => {
    const budget = new RequestBudget(2, 60_000);
    assert.equal(budget.tryConsume(2, 10_000), true);
    assert.equal(budget.tryConsume(1, 10_001), false);
    assert.equal(budget.retryAfterMs(1, 10_001), 59_999);
    assert.equal(budget.tryConsume(1, 70_001), true);
    assert.equal(budget.retryAfterMs(1, 70_001), 0);

    const failure = failureDisposition(
      new VrchatProviderError("limited", { status: 429, category: "rate_limit", retryAfterMs: 120_000 }),
      1,
      1_000,
      () => 0.5,
    );
    assert.equal(failure.statusClass, "429");
    assert.equal(failure.backoffUntil, 121_000);
    assert.equal(failure.nextPollAt, 121_000);

    const minimumFailure = failureDisposition(
      new VrchatProviderError("limited", { status: 429, category: "rate_limit", retryAfterMs: 120_000 }),
      1,
      1_000,
      () => 0,
    );
    assert.equal(minimumFailure.backoffUntil, 121_000);
    assert.equal(minimumFailure.nextPollAt, 121_000);
    assert.equal(backendRetryDelay(1, 120_000, () => 0), 120_000);
  });

  it("classifies provider failures, schema drift, and timeouts without leaking payloads", async () => {
    for (const [status, category] of [[401, "authentication"], [404, "visibility"], [500, "transient"]] as const) {
      const client = new VrchatClient({
        authCookie: "cookie-value",
        userAgent: "VRDex/0.1 telemetry@example.com",
        fetcher: async () => jsonResponse({ private: "must-not-escape" }, status),
      });
      await assert.rejects(client.getGroup("grp_example"), (error: unknown) => error instanceof VrchatProviderError && error.category === category && !error.message.includes("must-not-escape"));
    }
    const malformed = new VrchatClient({
      authCookie: "cookie-value",
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async () => jsonResponse({ id: "grp_example", memberCount: -1, membershipStatus: "member", joinState: "open", privacy: "default" }),
    });
    await assert.rejects(malformed.getGroup("grp_example"), (error: unknown) => error instanceof VrchatProviderError && error.category === "schema_drift");

    const wrongGroupResponses = [
      jsonResponse({ id: "grp_example", memberCount: 1, membershipStatus: "member", joinState: "open", privacy: "default" }),
      jsonResponse([{ instanceId: "1~group(grp_other)", location: "wrld_example:1~group(grp_other)", memberCount: 1, world: { id: "wrld_example" } }]),
    ];
    const wrongGroup = new VrchatClient({
      authCookie: "cookie-value",
      userAgent: "VRDex/0.1 telemetry@example.com",
      fetcher: async () => wrongGroupResponses.shift()!,
    });
    await assert.rejects(wrongGroup.readAggregateSnapshot("grp_example"), (error: unknown) => error instanceof VrchatProviderError && error.category === "schema_drift");

    const timeout = new VrchatClient({
      authCookie: "cookie-value",
      userAgent: "VRDex/0.1 telemetry@example.com",
      timeoutMs: 1,
      fetcher: async (_request: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    });
    await assert.rejects(timeout.getGroup("grp_example"), (error: unknown) => error instanceof VrchatProviderError && error.category === "timeout");
  });
});

describe("group telemetry metrics and safety helpers", () => {
  it("keeps active and quiet cadence jitter within their documented windows", () => {
    assert.equal(randomPollDelayMs(true, () => 0), 60_000);
    assert.equal(backendPollDelay(true, () => 0), 60_000);
    assert.equal(backendPollDelay(false, () => 0), 180_000);
    assert.equal(backendPollDelay(false, () => 0.999999), 300_000);
    assert.equal(backendRetryDelay(1, 120_000, () => 0.5), 120_000);
  });

  it("does not interpolate player-hours across missing coverage", () => {
    const points = [
      { observedAt: 0, population: 10, coverageState: "observed" as const, instanceKey: "a", worldId: "wrld_a" },
      { observedAt: 60_000, population: 20, coverageState: "observed" as const, instanceKey: "a", worldId: "wrld_a" },
      { observedAt: 10 * 60_000, population: 30, coverageState: "observed" as const, instanceKey: "a", worldId: "wrld_a" },
    ];
    const metrics = computePopulationMetrics(points, 0, 10 * 60_000);
    assert.equal(metrics.playerMinutes, 15);
    assert.equal(metrics.peakConcurrency, 30);
    assert.equal(metrics.coverageRatio, 0.1);
  });

  it("redacts credentials from provider diagnostics", () => {
    const redacted = redactProviderText("authorization=Bearer abc123 secret=hunter2");
    assert.doesNotMatch(redacted, /abc123|hunter2/);
    assert.match(redacted, /redacted/);
  });
});
