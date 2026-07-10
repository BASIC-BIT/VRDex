import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  apiRateLimitPolicyForRouteClass,
  checkMemoryApiRateLimit,
  checkRedisRestApiRateLimit,
  clientIpForRequest,
  createMemoryApiRateLimitStore,
  listDefaultApiRateLimitPolicies,
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

        return new Response(
          JSON.stringify([
            { result: 3 },
            { result: 1 },
            { result: 43_000 },
            { result: 1 },
            { result: 1 },
          ]),
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
