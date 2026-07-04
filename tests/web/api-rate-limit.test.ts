import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkMemoryApiRateLimit,
  clientIpForRequest,
  createMemoryApiRateLimitStore,
} from "../../apps/web/src/lib/server/api-rate-limit";

describe("public API rate limiting", () => {
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

    assert.equal(anonymous.allowed, true);
    assert.equal(authenticated.allowed, true);
    assert.notEqual(anonymous.key, authenticated.key);
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
});
