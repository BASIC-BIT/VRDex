import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkMemoryApiRateLimit,
  checkRedisRestApiRateLimit,
  clientIpForRequest,
  createMemoryApiRateLimitStore,
  listDefaultApiRateLimitPolicies,
} from "../../apps/web/src/lib/server/api-rate-limit";
import { apiRouteClasses } from "../../packages/api-contracts/src/auth";

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
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 0);
    assert.equal(third.allowed, false);
    assert.equal(third.retryAfterSeconds, 1);
    assert.equal(reset.allowed, true);
    assert.equal(reset.remaining, 1);
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
  });

  it("extracts the first forwarded IP before falling back to x-real-ip", () => {
    assert.equal(
      clientIpForRequest(
        new Request("https://example.test", {
          headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.4" },
        }),
      ),
      "203.0.113.10",
    );

    assert.equal(
      clientIpForRequest(
        new Request("https://example.test", {
          headers: { "x-real-ip": "198.51.100.7" },
        }),
      ),
      "198.51.100.7",
    );

    assert.equal(clientIpForRequest(new Request("https://example.test")), "unknown");
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
        resetAt: 53_000,
        retryAfterSeconds: 43,
      });
    } finally {
      restoreEnv("VRDEX_RATE_LIMIT_REDIS_REST_URL", previousUrl);
      restoreEnv("VRDEX_RATE_LIMIT_REDIS_REST_TOKEN", previousToken);
      restoreEnv("VRDEX_RATE_LIMIT_REDIS_PREFIX", previousPrefix);
    }
  });
});
