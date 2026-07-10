import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Id } from "../../convex/_generated/dataModel";
import { oauthConsentTransactionDisposition } from "../../convex/_oauthConsentTransactions";
import {
  createOAuthConsentTransactionValue,
  hashOAuthConsentTransactionValue,
  oauthConsentOriginAllowed,
} from "../../apps/web/src/lib/server/oauth-consent-transaction";
import { oauthRateLimitResponse } from "../../apps/web/src/lib/server/oauth-route-rate-limit";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("OAuth edge security", () => {
  it("returns OAuth-compatible 429 responses before endpoint work continues", async () => {
    const previousVercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    const blockedEvents: unknown[] = [];

    try {
      const response = await oauthRateLimitResponse(
        new Request("https://app.example.test/oauth/token", {
          headers: { "x-forwarded-for": "1.1.1.1", "x-vercel-forwarded-for": "8.8.8.8" },
        }),
        "oauth_token",
        {
          checkRateLimit: async (input) => {
            assert.deepEqual(input, {
              identity: { kind: "ip", value: "8.8.8.8" },
              routeClass: "oauth_token",
            });

            return {
              allowed: false,
              key: "test:oauth_token:ip:8.8.8.8",
              limit: 30,
              remaining: 0,
              resetAt: 1_700_000_060_000,
              retryAfterSeconds: 42,
            };
          },
          recordRateLimitBlockedEvent: async (input) => {
            blockedEvents.push(input);
            return null;
          },
        },
      );

      assert.ok(response);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after"), "42");
      assert.equal(response.headers.get("ratelimit-limit"), "30");
      assert.equal(response.headers.get("ratelimit-remaining"), "0");
      assert.equal(response.headers.get("ratelimit-reset"), "1700000060");
      assert.deepEqual(await response.json(), {
        error: "temporarily_unavailable",
        error_description: "Too many OAuth requests were sent from this network.",
      });
      assert.equal(blockedEvents.length, 1);
    } finally {
      restoreEnv("VERCEL", previousVercel);
    }
  });

  it("requires a same-origin production consent POST", () => {
    const previousIssuer = process.env.VRDEX_OAUTH_ISSUER_URL;

    assert.equal(
      oauthConsentOriginAllowed(
        new Request("https://app.example.test/oauth/authorize/consent", {
          headers: { origin: "https://app.example.test" },
          method: "POST",
        }),
        true,
      ),
      true,
    );
    assert.equal(
      oauthConsentOriginAllowed(
        new Request("https://app.example.test/oauth/authorize/consent", {
          headers: { origin: "https://attacker.example" },
          method: "POST",
        }),
        true,
      ),
      false,
    );
    assert.equal(
      oauthConsentOriginAllowed(
        new Request("https://app.example.test/oauth/authorize/consent", { method: "POST" }),
        true,
      ),
      false,
    );

    process.env.VRDEX_OAUTH_ISSUER_URL = "https://issuer.example.test";

    try {
      assert.equal(
        oauthConsentOriginAllowed(
          new Request("https://attacker.example/oauth/authorize/consent", {
            headers: { origin: "https://attacker.example" },
            method: "POST",
          }),
          true,
        ),
        false,
      );
      assert.equal(
        oauthConsentOriginAllowed(
          new Request("https://attacker.example/oauth/authorize/consent", {
            headers: { origin: "https://issuer.example.test" },
            method: "POST",
          }),
          true,
        ),
        true,
      );
    } finally {
      restoreEnv("VRDEX_OAUTH_ISSUER_URL", previousIssuer);
    }
  });

  it("hashes opaque consent transactions and rejects missing, expired, or cross-user records", () => {
    const first = createOAuthConsentTransactionValue();
    const second = createOAuthConsentTransactionValue();
    const userA = "user-a" as Id<"users">;
    const userB = "user-b" as Id<"users">;
    const transaction = {
      _id: "transaction-a" as Id<"oauthConsentTransactions">,
      userId: userA,
      expiresAt: 2_000,
    };

    assert.notEqual(first, second);
    assert.match(first, /^vrdx_consent_[A-Za-z0-9_-]{43}$/);
    assert.match(hashOAuthConsentTransactionValue(first), /^[0-9a-f]{64}$/);
    assert.notEqual(hashOAuthConsentTransactionValue(first), first);
    assert.equal(oauthConsentTransactionDisposition(transaction, userA, 1_000), "accepted");
    assert.equal(oauthConsentTransactionDisposition(transaction, userB, 1_000), "cross_user");
    assert.equal(oauthConsentTransactionDisposition(transaction, userA, 2_000), "expired");
    assert.equal(oauthConsentTransactionDisposition(null, userA, 1_000), "missing");
  });

  it("guards every OAuth route and keeps raw authorization fields out of consent POST", () => {
    const authorize = readFileSync("apps/web/src/app/oauth/authorize/route.ts", "utf8");
    const consent = readFileSync("apps/web/src/app/oauth/authorize/consent/route.ts", "utf8");
    const review = readFileSync("apps/web/src/app/oauth/authorize/review/page.tsx", "utf8");
    const token = readFileSync("apps/web/src/app/oauth/token/route.ts", "utf8");
    const revoke = readFileSync("apps/web/src/app/oauth/revoke/route.ts", "utf8");
    const oauthApps = readFileSync("convex/oauthApps.ts", "utf8");

    assert.match(authorize, /oauthRateLimitResponse\(request, "oauth_authorize"\)/);
    assert.ok(
      authorize.indexOf('const rateLimited = await oauthRateLimitResponse(request, "oauth_authorize")') <
        authorize.indexOf("authorization = normalizeOAuthAuthorizationRequest"),
    );
    assert.match(consent, /oauthRateLimitResponse\(request, "oauth_authorize"\)/);
    assert.ok(
      consent.indexOf('const rateLimited = await oauthRateLimitResponse(request, "oauth_authorize")') <
        consent.indexOf("form = await request.formData"),
    );
    assert.match(token, /oauthRateLimitResponse\(request, "oauth_token"\)/);
    assert.match(revoke, /oauthRateLimitResponse\(request, "oauth_token"\)/);
    assert.match(consent, /internal\.oauthApps\.completeAuthorizationConsent/);
    const completion = oauthApps.slice(oauthApps.indexOf("export const completeAuthorizationConsent"));
    assert.ok(completion.indexOf("resolvePublicAuthorizationClient") < completion.indexOf('args.decision === "deny"'));
    assert.ok(completion.indexOf("ctx.db.delete(transaction._id)") < completion.indexOf('args.decision === "deny"'));

    const consentFormFields = [...consent.matchAll(/form\.get\("([^"]+)"\)/g)].map((match) => match[1]);
    assert.deepEqual(consentFormFields.sort(), ["decision", "transaction"]);
    assert.match(review, /<input name="transaction" type="hidden"/);
    assert.doesNotMatch(review, /name="(?:client_id|redirect_uri|resource|scope|code_challenge|state)"/);
  });
});
