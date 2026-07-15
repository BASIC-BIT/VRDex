import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  apiRateLimitPolicyForRouteClass,
  checkApiRateLimit,
  checkFailedApiAuthenticationRateLimit,
  checkFailedMcpAuthenticationRateLimit,
  checkMemoryApiRateLimit,
  checkOAuthAccessTokenRateLimit,
  checkRedisRestApiRateLimit,
  clientIpForRequest,
  createMemoryApiRateLimitStore,
  hashedApiRateLimitIdentityValue,
  listDefaultApiRateLimitPolicies,
  oauthClientAggregateRateLimitMultiplier,
  oauthOwnerAggregateRateLimitMultiplier,
  oauthRateLimitOwnerForCredential,
  trustedClientIpHeaderName,
  trustedPartnerApiRateLimitMultiplier,
} from "../../apps/web/src/lib/server/api-rate-limit";
import { apiRateLimitBlockedEventInput } from "../../apps/web/src/lib/server/api-rate-limit-events";
import { apiRouteClasses } from "../../packages/api-contracts/src/auth";

function runRateLimitRouteProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      VERCEL: "1",
      VRDEX_RATE_LIMIT_STORE: "memory",
    },
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("public API rate limiting", () => {
  it("exports a default policy for every route class", () => {
    const policies = listDefaultApiRateLimitPolicies();

    assert.deepEqual(
      policies.map((policy) => policy.routeClass),
      apiRouteClasses,
    );

    for (const policy of policies) {
      assert.equal(Number.isInteger(policy.limit), true);
      assert.equal(policy.limit > 0, true);
      assert.equal(Number.isInteger(policy.windowMs), true);
      assert.equal(policy.windowMs > 0, true);
    }
  });

  it("boosts trusted partner quotas only for authenticated traffic classes", () => {
    assert.equal(
      apiRateLimitPolicyForRouteClass("authenticated_public_read", "trusted_partner").limit,
      apiRateLimitPolicyForRouteClass("authenticated_public_read").limit * trustedPartnerApiRateLimitMultiplier,
    );
    assert.equal(
      apiRateLimitPolicyForRouteClass("authenticated_mcp", "trusted_partner").limit,
      apiRateLimitPolicyForRouteClass("authenticated_mcp").limit * trustedPartnerApiRateLimitMultiplier,
    );
    assert.equal(
      apiRateLimitPolicyForRouteClass("asset_upload_intent", "trusted_partner").limit,
      apiRateLimitPolicyForRouteClass("asset_upload_intent").limit * trustedPartnerApiRateLimitMultiplier,
    );
    assert.equal(
      apiRateLimitPolicyForRouteClass("public_write", "trusted_partner").limit,
      apiRateLimitPolicyForRouteClass("public_write").limit * trustedPartnerApiRateLimitMultiplier,
    );
    assert.equal(
      apiRateLimitPolicyForRouteClass("anonymous_public_read", "trusted_partner").limit,
      apiRateLimitPolicyForRouteClass("anonymous_public_read").limit,
    );
    assert.equal(
      apiRateLimitPolicyForRouteClass("oauth_token", "trusted_partner").limit,
      apiRateLimitPolicyForRouteClass("oauth_token").limit,
    );
    assert.equal(
      apiRateLimitPolicyForRouteClass("oauth_dynamic_client_registration", "trusted_partner").limit,
      apiRateLimitPolicyForRouteClass("oauth_dynamic_client_registration").limit,
    );
  });

  it("tracks fixed-window limits by route class and identity", () => {
    const store = createMemoryApiRateLimitStore();
    const policy = { limit: 2, windowMs: 1_000 };
    const first = checkMemoryApiRateLimit({
      store,
      policy,
      routeClass: "anonymous_public_read",
      identity: { kind: "ip", value: "203.0.113.10" },
      now: 1_000,
    });
    const second = checkMemoryApiRateLimit({
      store,
      policy,
      routeClass: "anonymous_public_read",
      identity: { kind: "ip", value: "203.0.113.10" },
      now: 1_100,
    });
    const third = checkMemoryApiRateLimit({
      store,
      policy,
      routeClass: "anonymous_public_read",
      identity: { kind: "ip", value: "203.0.113.10" },
      now: 1_200,
    });
    const reset = checkMemoryApiRateLimit({
      store,
      policy,
      routeClass: "anonymous_public_read",
      identity: { kind: "ip", value: "203.0.113.10" },
      now: 2_001,
    });

    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 1);
    assert.equal(first.routeClassWindowCount, 1);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 0);
    assert.equal(second.routeClassWindowCount, 2);
    assert.equal(third.allowed, false);
    assert.equal(third.routeClassWindowCount, 3);
    assert.equal(third.retryAfterSeconds, 1);
    assert.equal(reset.allowed, true);
    assert.equal(reset.remaining, 1);
    assert.equal(reset.routeClassWindowCount, 1);
  });

  it("inspects the next fixed-window attempt without consuming it", () => {
    const store = createMemoryApiRateLimitStore();
    const args = {
      store,
      policy: { limit: 2, windowMs: 1_000 },
      routeClass: "anonymous_public_read" as const,
      identity: { kind: "ip" as const, value: "203.0.113.20" },
      now: 1_000,
    };

    assert.equal(checkMemoryApiRateLimit(args).allowed, true);

    const inspected = checkMemoryApiRateLimit({ ...args, increment: false });
    const second = checkMemoryApiRateLimit({ ...args, now: 1_100 });
    const third = checkMemoryApiRateLimit({ ...args, now: 1_200 });

    assert.equal(inspected.allowed, true);
    assert.equal(inspected.remaining, 0);
    assert.equal(inspected.routeClassWindowCount, undefined);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false);
  });

  it("separates anonymous IP and authenticated token identities", () => {
    const store = createMemoryApiRateLimitStore();
    const policy = { limit: 1, windowMs: 1_000 };
    const anonymous = checkMemoryApiRateLimit({
      store,
      policy,
      routeClass: "anonymous_public_read",
      identity: { kind: "ip", value: "203.0.113.10" },
      now: 1_000,
    });
    const authenticated = checkMemoryApiRateLimit({
      store,
      policy,
      routeClass: "authenticated_public_read",
      identity: { kind: "api_token", value: "token123" },
      now: 1_000,
    });
    const oauthClient = checkMemoryApiRateLimit({
      store,
      policy,
      routeClass: "authenticated_public_read",
      identity: { kind: "oauth_client", value: "client123" },
      now: 1_000,
    });
    const dynamicRegistration = checkMemoryApiRateLimit({
      store,
      policy,
      routeClass: "oauth_dynamic_client_registration",
      identity: { kind: "ip", value: "203.0.113.10" },
      now: 1_000,
    });

    assert.equal(anonymous.allowed, true);
    assert.equal(authenticated.allowed, true);
    assert.equal(oauthClient.allowed, true);
    assert.equal(dynamicRegistration.allowed, true);
    assert.notEqual(anonymous.key, authenticated.key);
    assert.notEqual(authenticated.key, oauthClient.key);
    assert.notEqual(anonymous.key, dynamicRegistration.key);
    assert.equal(anonymous.routeClassWindowCount, 1);
    assert.equal(authenticated.routeClassWindowCount, 1);
    assert.equal(oauthClient.routeClassWindowCount, 2);
    assert.equal(dynamicRegistration.routeClassWindowCount, 1);
  });

  it("isolates OAuth access-token buckets and retains a separate client-wide cap", async () => {
    const calls: Array<Parameters<typeof checkApiRateLimit>[0]> = [];
    const result = await checkOAuthAccessTokenRateLimit({
      clientId: "client-123",
      tokenId: "token-456",
      quotaTier: "standard",
      routeClass: "authenticated_public_read",
      checkRateLimit: async (args) => {
        calls.push(args);
        return {
          allowed: true,
          key: `test:${args.identity.value}`,
          limit: 600,
          remaining: 599,
          resetAt: 60_000,
          retryAfterSeconds: 60,
        };
      },
    });

    assert.equal(result.identity.value, "token-456");
    assert.deepEqual(calls, [
      {
        identity: { kind: "oauth_client", value: "token-456" },
        quotaTier: "standard",
        routeClass: "authenticated_public_read",
      },
      {
        identity: { kind: "oauth_client", value: "client-123" },
        limitMultiplier: oauthClientAggregateRateLimitMultiplier,
        quotaTier: "standard",
        routeClass: "authenticated_public_read",
        trackRouteClassRequest: false,
      },
    ]);
  });

  it("shares a hashed owner-wide cap across OAuth apps", async () => {
    const calls: Array<Parameters<typeof checkApiRateLimit>[0]> = [];
    const checkRateLimit = async (args: Parameters<typeof checkApiRateLimit>[0]) => {
      calls.push(args);
      return {
        allowed: true,
        key: `test:${args.identity.value}`,
        limit: 600,
        remaining: 599,
        resetAt: 60_000,
        retryAfterSeconds: 60,
      };
    };
    const firstResult = await checkOAuthAccessTokenRateLimit({
      clientId: "client-123",
      owner: { id: "user-789", kind: "user" },
      tokenId: "token-456",
      quotaTier: "standard",
      routeClass: "authenticated_public_read",
      checkRateLimit,
    });
    await checkOAuthAccessTokenRateLimit({
      clientId: "client-999",
      owner: { id: "user-789", kind: "user" },
      tokenId: "token-888",
      quotaTier: "standard",
      routeClass: "authenticated_public_read",
      checkRateLimit,
    });

    const ownerHash = await hashedApiRateLimitIdentityValue("oauth-owner", "user:user-789");

    assert.equal(firstResult.identity.value, "token-456");
    assert.equal(ownerHash.includes("user-789"), false);
    assert.deepEqual(calls[2], {
      identity: { kind: "oauth_owner", value: ownerHash },
      limitMultiplier: oauthOwnerAggregateRateLimitMultiplier,
      quotaTier: "standard",
      routeClass: "authenticated_public_read",
      trackRouteClassRequest: false,
    });
    assert.equal(calls[1]?.identity.value, "client-123");
    assert.equal(calls[4]?.identity.value, "client-999");
    assert.deepEqual(calls[5]?.identity, calls[2]?.identity);
  });

  it("maps user-delegated and client OAuth credentials to owner aggregate buckets", () => {
    assert.deepEqual(
      oauthRateLimitOwnerForCredential({ subjectType: "user", userId: "user-123" }),
      { id: "user-123", kind: "user" },
    );
    assert.deepEqual(
      oauthRateLimitOwnerForCredential({
        ownerCommunityProfileId: "community-123",
        ownerKind: "community",
        ownerUserId: "user-456",
        subjectType: "client",
      }),
      { id: "community-123", kind: "community" },
    );
    assert.equal(oauthRateLimitOwnerForCredential({ subjectType: "user" }), undefined);
  });

  it("returns the owner bucket when an OAuth app owner's aggregate cap is blocked", async () => {
    const result = await checkOAuthAccessTokenRateLimit({
      clientId: "client-123",
      owner: { id: "community-789", kind: "community" },
      tokenId: "token-456",
      quotaTier: "standard",
      routeClass: "authenticated_mcp",
      checkRateLimit: async (args) => ({
        allowed: args.identity.kind !== "oauth_owner",
        key: `test:${args.identity.value}`,
        limit: 300,
        remaining: args.identity.kind === "oauth_owner" ? 0 : 299,
        resetAt: 60_000,
        retryAfterSeconds: 60,
      }),
    });

    assert.equal(result.identity.kind, "oauth_owner");
    assert.equal(result.rateLimit.allowed, false);
  });

  it("short-circuits the client-wide cap when the access-token bucket is blocked", async () => {
    let calls = 0;
    const result = await checkOAuthAccessTokenRateLimit({
      clientId: "client-123",
      tokenId: "token-456",
      quotaTier: "standard",
      routeClass: "authenticated_mcp",
      checkRateLimit: async (args) => {
        calls += 1;
        return {
          allowed: false,
          key: `test:${args.identity.value}`,
          limit: 300,
          remaining: 0,
          resetAt: 60_000,
          retryAfterSeconds: 60,
        };
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.identity.value, "token-456");
    assert.equal(result.rateLimit.allowed, false);
  });

  it("fails closed when production does not use a shared rate-limit store", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDeploymentEnv = process.env.VRDEX_DEPLOYMENT_ENV;
    const previousVercelEnv = process.env.VERCEL_ENV;
    const previousStore = process.env.VRDEX_RATE_LIMIT_STORE;

    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    delete process.env.VRDEX_DEPLOYMENT_ENV;
    delete process.env.VRDEX_RATE_LIMIT_STORE;

    try {
      await assert.rejects(
        checkApiRateLimit({ identity: { kind: "ip", value: "203.0.113.10" }, routeClass: "anonymous_public_read" }),
        /must configure VRDEX_RATE_LIMIT_STORE/,
      );

      process.env.VRDEX_RATE_LIMIT_STORE = "memory";
      await assert.rejects(
        checkApiRateLimit({ identity: { kind: "ip", value: "203.0.113.10" }, routeClass: "anonymous_public_read" }),
        /cannot use the memory/,
      );

      process.env.VERCEL_ENV = "preview";
      assert.equal(
        (await checkApiRateLimit({ identity: { kind: "ip", value: "203.0.113.10" }, routeClass: "anonymous_public_read" })).allowed,
        true,
      );

      delete process.env.VERCEL_ENV;
      process.env.VRDEX_DEPLOYMENT_ENV = "staging";
      assert.equal(
        (await checkApiRateLimit({ identity: { kind: "ip", value: "203.0.113.10" }, routeClass: "anonymous_public_read" })).allowed,
        true,
      );
    } finally {
      restoreEnv("NODE_ENV", previousNodeEnv);
      restoreEnv("VRDEX_DEPLOYMENT_ENV", previousDeploymentEnv);
      restoreEnv("VERCEL_ENV", previousVercelEnv);
      restoreEnv("VRDEX_RATE_LIMIT_STORE", previousStore);
    }
  });

  it("charges failed bearer authentication attempts to the anonymous IP bucket", async () => {
    const previousDeploymentEnv = process.env.VRDEX_DEPLOYMENT_ENV;
    const previousPrefix = process.env.VRDEX_RATE_LIMIT_REDIS_PREFIX;
    const previousStore = process.env.VRDEX_RATE_LIMIT_STORE;
    const previousVercel = process.env.VERCEL;
    const previousVercelEnv = process.env.VERCEL_ENV;

    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.VRDEX_DEPLOYMENT_ENV = "preview";
    process.env.VRDEX_RATE_LIMIT_STORE = "memory";
    process.env.VRDEX_RATE_LIMIT_REDIS_PREFIX = `vrdex:test:failed-auth:${Date.now()}`;

    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const evaluation = await checkFailedApiAuthenticationRateLimit(
          new Request("https://app.example.test/api/v0/profiles", {
            headers: {
              "x-vercel-forwarded-for": "203.0.113.44",
            },
          }),
        );

        assert.equal(evaluation.rateLimit.allowed, true);
      }

      const blocked = await checkFailedApiAuthenticationRateLimit(
        new Request("https://app.example.test/api/v0/profiles", {
          headers: {
            "x-vercel-forwarded-for": "203.0.113.44",
          },
        }),
      );

      assert.equal(blocked.identity.kind, "ip");
      assert.equal(blocked.identity.value, "203.0.113.44");
      assert.equal(blocked.rateLimit.allowed, false);
      assert.equal(blocked.rateLimit.remaining, 0);

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const evaluation = await checkFailedMcpAuthenticationRateLimit(
          new Request("https://app.example.test/mcp", {
            headers: {
              "x-vercel-forwarded-for": "203.0.113.45",
            },
          }),
        );

        assert.equal(evaluation.rateLimit.allowed, true);
      }

      const blockedMcp = await checkFailedMcpAuthenticationRateLimit(
        new Request("https://app.example.test/mcp", {
          headers: {
            "x-vercel-forwarded-for": "203.0.113.45",
          },
        }),
      );

      assert.equal(blockedMcp.routeClass, "anonymous_mcp_public_read");
      assert.equal(blockedMcp.rateLimit.allowed, false);
      assert.equal(blockedMcp.rateLimit.remaining, 0);
    } finally {
      restoreEnv("VRDEX_DEPLOYMENT_ENV", previousDeploymentEnv);
      restoreEnv("VRDEX_RATE_LIMIT_REDIS_PREFIX", previousPrefix);
      restoreEnv("VRDEX_RATE_LIMIT_STORE", previousStore);
      restoreEnv("VERCEL", previousVercel);
      restoreEnv("VERCEL_ENV", previousVercelEnv);
    }
  });

  it("rejects an exhausted failed-auth bucket before API token verification", () => {
    const output = runRateLimitRouteProbe(`
      import { evaluateOptionalApiBearerRequest } from "./apps/web/src/lib/server/api-v0.ts";
      import { checkFailedApiAuthenticationRateLimit } from "./apps/web/src/lib/server/api-rate-limit.ts";

      process.env.VERCEL_ENV = "preview";
      process.env.VRDEX_RATE_LIMIT_REDIS_PREFIX = "vrdex:test:failed-auth-preflight";

      const request = new Request("https://app.example.test/api/v0/profiles", {
        headers: {
          authorization: "Bearer vrdx_0123456789abcdef01234567.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          "x-vercel-forwarded-for": "203.0.113.46",
        },
      });

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await checkFailedApiAuthenticationRateLimit(request);
      }

      delete process.env.VRDEX_API_TOKEN_PEPPER;
      const evaluation = await evaluateOptionalApiBearerRequest(request);
      console.log(evaluation.ok ? "unexpected-ok" : evaluation.response.status);
    `);

    assert.equal(output.trim(), "429");
  });

  it("uses only the Vercel edge header on Vercel and ignores spoofable forwarding headers", () => {
    const previousVercel = process.env.VERCEL;
    const previousTrustedHeader = process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER;
    process.env.VERCEL = "1";
    process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER = "x-self-host-client-ip";

    try {
      const request = new Request("https://example.test", {
        headers: {
          "x-forwarded-for": "203.0.113.10",
          "x-real-ip": "198.51.100.7",
          "x-self-host-client-ip": "192.0.2.8",
          "x-vercel-forwarded-for": "8.8.8.8",
        },
      });

      assert.equal(trustedClientIpHeaderName(), "x-vercel-forwarded-for");
      assert.equal(clientIpForRequest(request), "8.8.8.8");
    } finally {
      restoreEnv("VERCEL", previousVercel);
      restoreEnv("VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER", previousTrustedHeader);
    }
  });

  it("requires explicit self-host proxy trust and rejects lists or malformed addresses", () => {
    const previousVercel = process.env.VERCEL;
    const previousTrustedHeader = process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER;
    delete process.env.VERCEL;
    delete process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER;

    try {
      const spoofed = new Request("https://example.test", {
        headers: { "x-forwarded-for": "8.8.8.8", "x-real-ip": "1.1.1.1" },
      });

      assert.equal(clientIpForRequest(spoofed), "unknown");

      process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER = "x-vrdex-client-ip";
      assert.equal(
        clientIpForRequest(new Request("https://example.test", { headers: { "x-vrdex-client-ip": "2001:4860:4860::8888" } })),
        "2001:4860:4860::8888",
      );
      assert.equal(
        clientIpForRequest(new Request("https://example.test", { headers: { "x-vrdex-client-ip": "8.8.8.8, 1.1.1.1" } })),
        "unknown",
      );
      assert.equal(
        clientIpForRequest(new Request("https://example.test", { headers: { "x-vrdex-client-ip": "not-an-ip" } })),
        "unknown",
      );
    } finally {
      restoreEnv("VERCEL", previousVercel);
      restoreEnv("VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER", previousTrustedHeader);
    }
  });

  it("uses Redis REST pipeline TTLs for hosted high-volume counters", async () => {
    const previousUrl = process.env.VRDEX_RATE_LIMIT_REDIS_REST_URL;
    const previousToken = process.env.VRDEX_RATE_LIMIT_REDIS_REST_TOKEN;
    const previousPrefix = process.env.VRDEX_RATE_LIMIT_REDIS_PREFIX;
    const requests: Array<{ authorization: string | null; body: unknown; contentType: string | null; url: string }> = [];

    function restoreEnv(name: string, value: string | undefined) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }

    process.env.VRDEX_RATE_LIMIT_REDIS_REST_URL = "https://redis.example.test";
    process.env.VRDEX_RATE_LIMIT_REDIS_REST_TOKEN = "redis-rest-token";
    process.env.VRDEX_RATE_LIMIT_REDIS_PREFIX = "test-prefix";

    try {
      const fetcher: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);

        requests.push({
          authorization: headers.get("authorization"),
          body: JSON.parse(String(init?.body)),
          contentType: headers.get("content-type"),
          url: String(input),
        });

        const body = requests.at(-1)?.body as string[][];
        const payload = body[0]?.[0] === "GET"
          ? [{ result: 2 }, { result: 43_000 }]
          : [
              { result: 3 },
              { result: 1 },
              { result: 43_000 },
              { result: 1 },
              { result: 1 },
            ];

        return new Response(
          JSON.stringify(payload),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };
      const result = await checkRedisRestApiRateLimit({
        fetcher,
        identity: { kind: "ip", value: "203.0.113.10" },
        now: 10_000,
        policy: { limit: 2, windowMs: 60_000 },
        routeClass: "anonymous_public_read",
      });
      const inspected = await checkRedisRestApiRateLimit({
        fetcher,
        identity: { kind: "ip", value: "203.0.113.10" },
        increment: false,
        now: 10_000,
        policy: { limit: 2, windowMs: 60_000 },
        routeClass: "anonymous_public_read",
      });

      assert.deepEqual(requests, [
        {
          body: [
            ["INCR", "test-prefix:anonymous_public_read:ip:203.0.113.10"],
            ["PEXPIRE", "test-prefix:anonymous_public_read:ip:203.0.113.10", "60000", "NX"],
            ["PTTL", "test-prefix:anonymous_public_read:ip:203.0.113.10"],
            ["INCR", "test-prefix:anonymous_public_read:requests"],
            ["PEXPIRE", "test-prefix:anonymous_public_read:requests", "60000", "NX"],
          ],
          authorization: "Bearer redis-rest-token",
          contentType: "application/json",
          url: "https://redis.example.test/pipeline",
        },
        {
          body: [
            ["GET", "test-prefix:anonymous_public_read:ip:203.0.113.10"],
            ["PTTL", "test-prefix:anonymous_public_read:ip:203.0.113.10"],
          ],
          authorization: "Bearer redis-rest-token",
          contentType: "application/json",
          url: "https://redis.example.test/pipeline",
        },
      ]);
      assert.deepEqual(result, {
        allowed: false,
        key: "test-prefix:anonymous_public_read:ip:203.0.113.10",
        limit: 2,
        remaining: 0,
        routeClassWindowCount: 1,
        resetAt: 53_000,
        retryAfterSeconds: 43,
      });
      assert.deepEqual(inspected, {
        allowed: false,
        key: "test-prefix:anonymous_public_read:ip:203.0.113.10",
        limit: 2,
        remaining: 0,
        resetAt: 53_000,
        retryAfterSeconds: 43,
      });
    } finally {
      restoreEnv("VRDEX_RATE_LIMIT_REDIS_REST_URL", previousUrl);
      restoreEnv("VRDEX_RATE_LIMIT_REDIS_REST_TOKEN", previousToken);
      restoreEnv("VRDEX_RATE_LIMIT_REDIS_PREFIX", previousPrefix);
    }
  });

  it("builds redacted durable metadata for rate-limit block events", () => {
    assert.deepEqual(
      apiRateLimitBlockedEventInput({
        identity: { kind: "ip", value: "203.0.113.10" },
        quotaTier: "standard",
        rateLimit: {
          allowed: false,
          key: "test-prefix:anonymous_public_read:ip:203.0.113.10",
          limit: 120,
          remaining: 0,
          resetAt: 10_000,
          retryAfterSeconds: 42,
        },
        routeClass: "anonymous_public_read",
        windowMs: 60_000,
      }),
      {
        identityKind: "ip",
        limit: 120,
        quotaTier: "standard",
        remaining: 0,
        resetAt: 10_000,
        retryAfterSeconds: 42,
        routeClass: "anonymous_public_read",
        windowMs: 60_000,
      },
    );
  });

  it("serves anonymous rate-limit usage through the public API", () => {
    const output = runRateLimitRouteProbe(`
      import { GET } from "./apps/web/src/app/api/v0/usage/rate-limit/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/usage/rate-limit", {
        headers: { "x-vercel-forwarded-for": "8.8.8.8" },
      }));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"credentialKind":"anonymous"/);
    assert.match(output, /"quotaTier":"standard"/);
    assert.match(output, /"routeClass":"anonymous_public_read"/);
    assert.match(output, /"policies":\[/);
    assert.match(output, /"routeClass":"authenticated_public_read"/);
  });

  it("rejects bearer-token query parameters on rate-limit usage", () => {
    const output = runRateLimitRouteProbe(`
      import { GET } from "./apps/web/src/app/api/v0/usage/rate-limit/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/usage/rate-limit?access_token=secret"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });
});
