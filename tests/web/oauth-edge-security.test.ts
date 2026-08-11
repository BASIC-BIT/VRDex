import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { OAUTH_CONSENT_TRANSACTION_TTL_MS } from "../../packages/api-contracts/src/oauth";
import type { Id } from "../../convex/_generated/dataModel";
import { oauthConsentTransactionDisposition } from "../../convex/_oauthConsentTransactions";
import {
  oauthAuthorizeProblemDetail,
  oauthAuthorizeProblemRedirect,
} from "../../apps/web/src/lib/server/oauth-authorize-problem";
import {
  createOAuthConsentTransactionValue,
  hashOAuthConsentTransactionValue,
  oauthConsentCompletionErrorDescription,
  oauthConsentOriginAllowed,
} from "../../apps/web/src/lib/server/oauth-consent-transaction";
import { hostedMcpScopesAllowedForDynamicClient } from "../../apps/web/src/lib/server/hosted-mcp-policy";
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

  it("keeps OAuth authorization failures on a constrained browser problem surface", async () => {
    assert.match(oauthAuthorizeProblemDetail("invalid_request") ?? "", /response_type/);
    assert.match(oauthAuthorizeProblemDetail("invalid_client") ?? "", /redirect URI/);
    assert.match(oauthAuthorizeProblemDetail("invalid_client_metadata") ?? "", /metadata document/);
    assert.match(oauthAuthorizeProblemDetail("server_error") ?? "", /consent transaction/);
    assert.equal(oauthAuthorizeProblemDetail("attacker-controlled"), undefined);
    assert.equal(oauthAuthorizeProblemDetail(undefined), undefined);

    const previousIssuer = process.env.VRDEX_OAUTH_ISSUER_URL;
    process.env.VRDEX_OAUTH_ISSUER_URL = "https://issuer.example.test";

    try {
      const response = oauthAuthorizeProblemRedirect(
        new Request("https://internal-host.example/oauth/authorize"),
        "invalid_request",
      );
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "https://issuer.example.test/oauth/authorize/review?problem=invalid_request");
    } finally {
      restoreEnv("VRDEX_OAUTH_ISSUER_URL", previousIssuer);
    }
  });

  it("offers every hosted MCP scope to dynamic clients, with no deployment switch in front", () => {
    assert.deepEqual(hostedMcpScopesAllowedForDynamicClient(), [
      "mcp:read",
      "mcp:write",
      "events:write",
      "profile:write",
    ]);

    // The gate is gone, not merely defaulted on: a reintroduced env read here
    // would silently strand every write client on deployments that never set it.
    const policy = readFileSync("apps/web/src/lib/server/hosted-mcp-policy.ts", "utf8");
    assert.doesNotMatch(policy, /process\.env/);
  });

  it("keeps opaque consent transactions valid for 30 minutes, then rejects expiry and cross-user use", async () => {
    const first = createOAuthConsentTransactionValue();
    const second = createOAuthConsentTransactionValue();
    const userA = "user-a" as Id<"users">;
    const userB = "user-b" as Id<"users">;
    const createdAt = 1_000;
    const transaction = {
      _id: "transaction-a" as Id<"oauthConsentTransactions">,
      userId: userA,
      expiresAt: createdAt + OAUTH_CONSENT_TRANSACTION_TTL_MS,
    };

    assert.equal(OAUTH_CONSENT_TRANSACTION_TTL_MS, 30 * 60 * 1000);
    assert.notEqual(first, second);
    assert.match(first, /^vrdx_consent_[A-Za-z0-9_-]{43}$/);
    assert.match(await hashOAuthConsentTransactionValue(first), /^[0-9a-f]{64}$/);
    assert.notEqual(await hashOAuthConsentTransactionValue(first), first);
    assert.equal(
      oauthConsentTransactionDisposition(transaction, userA, transaction.expiresAt - 1),
      "accepted",
    );
    assert.equal(oauthConsentTransactionDisposition(transaction, userB, createdAt), "cross_user");
    assert.equal(
      oauthConsentTransactionDisposition(transaction, userA, transaction.expiresAt),
      "expired",
    );
    assert.equal(oauthConsentTransactionDisposition(null, userA, createdAt), "missing");
  });

  it("distinguishes an expired consent transaction from client binding failures", () => {
    assert.equal(
      oauthConsentCompletionErrorDescription("invalid_transaction"),
      "The OAuth consent transaction is invalid or expired. Restart authorization.",
    );
    assert.equal(
      oauthConsentCompletionErrorDescription("invalid_redirect_uri"),
      "The OAuth client cannot use the requested redirect URI, resource, or scopes.",
    );
    assert.equal(
      oauthConsentCompletionErrorDescription("wrong_resource"),
      "The OAuth client cannot use the requested redirect URI, resource, or scopes.",
    );
    assert.equal(
      oauthConsentCompletionErrorDescription("invalid_scope"),
      "The OAuth client cannot use the requested redirect URI, resource, or scopes.",
    );
  });

  it("guards every OAuth route and keeps raw authorization fields out of consent POST", () => {
    const authorize = readFileSync("apps/web/src/app/oauth/authorize/route.ts", "utf8");
    const consent = readFileSync("apps/web/src/app/oauth/authorize/consent/route.ts", "utf8");
    const review = readFileSync("apps/web/src/app/oauth/authorize/review/page.tsx", "utf8");
    const token = readFileSync("apps/web/src/app/oauth/token/route.ts", "utf8");
    const revoke = readFileSync("apps/web/src/app/oauth/revoke/route.ts", "utf8");
    const oauthApps = readFileSync("convex/oauthApps.ts", "utf8");

    assert.match(authorize, /oauthRateLimitResponse\(request, "oauth_authorize"\)/);
    assert.match(authorize, /client\.reason === "invalid_scope" \|\| client\.reason === "wrong_resource"/);
    assert.match(authorize, /redirectUriWithOAuthClientError/);
    assert.match(authorize, /recordAuthorizationClientRejection\(client\)/);
    const rejectionLog = authorize.slice(
      authorize.indexOf("function recordAuthorizationClientRejection"),
      authorize.indexOf("async function ensureClientMetadataDocumentClient"),
    );
    assert.doesNotMatch(rejectionLog, /clientId|redirectUri|requestedScopes|resource|state|codeChallenge/);
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
