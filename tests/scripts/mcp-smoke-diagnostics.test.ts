import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isExpectedOAuthAuthorizationRedirect,
  summarizeMcpToolFailure,
} from "../../scripts/lib/mcp-smoke-diagnostics";

describe("MCP smoke diagnostics", () => {
  it("accepts Clerk's hosted handshake only when it returns to this issuer's authorization endpoint", () => {
    const issuer = "https://preview.example";
    const authorized = new URL("https://example.clerk.accounts.dev/v1/client/handshake");
    authorized.searchParams.set("redirect_url", `${issuer}/oauth/authorize?client_id=metadata-url`);
    const wrongIssuer = new URL(authorized);
    wrongIssuer.searchParams.set("redirect_url", "https://attacker.example/oauth/authorize");
    const relativeReturn = new URL(authorized);
    relativeReturn.searchParams.set("redirect_url", "/oauth/authorize");
    const duplicateReturn = new URL(authorized);
    duplicateReturn.searchParams.append("redirect_url", `${issuer}/oauth/authorize`);
    const insecureIssuer = new URL(authorized);
    insecureIssuer.searchParams.set("redirect_url", "http://preview.example/oauth/authorize");

    assert.equal(isExpectedOAuthAuthorizationRedirect(authorized.toString(), issuer), true);
    assert.equal(isExpectedOAuthAuthorizationRedirect(wrongIssuer.toString(), issuer), false);
    assert.equal(isExpectedOAuthAuthorizationRedirect(relativeReturn.toString(), issuer), false);
    assert.equal(isExpectedOAuthAuthorizationRedirect(duplicateReturn.toString(), issuer), false);
    assert.equal(
      isExpectedOAuthAuthorizationRedirect(insecureIssuer.toString(), "http://preview.example"),
      false,
    );
    assert.equal(
      isExpectedOAuthAuthorizationRedirect(
        `https://attacker.example/v1/client/handshake?redirect_url=${encodeURIComponent(`${issuer}/oauth/authorize`)}`,
        issuer,
      ),
      false,
    );
  });

  it("continues to accept the same-origin sign-in redirect", () => {
    assert.equal(
      isExpectedOAuthAuthorizationRedirect(
        "https://preview.example/sign-in?returnTo=%2Foauth%2Fauthorize%3Fclient_id%3Dmetadata-url",
        "https://preview.example",
      ),
      true,
    );
  });

  it("summarizes tool-error content and structured content", () => {
    const summary = summarizeMcpToolFailure({
      result: {
        content: [
          {
            text: "Search backend unavailable for q=club",
            type: "text",
          },
        ],
        isError: true,
        structuredContent: {
          code: "backend_unavailable",
          query: "club",
        },
      },
    });

    assert.match(summary, /isError=true/);
    assert.match(summary, /Search backend unavailable/);
    assert.match(summary, /backend_unavailable/);
  });

  it("redacts common credential shapes", () => {
    const summary = summarizeMcpToolFailure({
      error: {
        data: {
          access_token: "vrdx_access_secret",
          authorization: "Bearer secret-token",
          client_secret: "vrdx_client_secret",
          refresh_token: "vrdx_refresh_secret",
        },
        message: "Bearer another-secret-token failed",
      },
    });

    assert.doesNotMatch(summary, /secret-token/);
    assert.doesNotMatch(summary, /vrdx_access_secret/);
    assert.doesNotMatch(summary, /vrdx_client_secret/);
    assert.doesNotMatch(summary, /vrdx_refresh_secret/);
    assert.match(summary, /Bearer <redacted>/);
    assert.match(summary, /"access_token":"<redacted>"/);
    assert.match(summary, /"client_secret":"<redacted>"/);
    assert.match(summary, /"refresh_token":"<redacted>"/);
  });

  it("reports empty tool-error text instead of hiding the response shape", () => {
    const summary = summarizeMcpToolFailure({
      id: 4,
      jsonrpc: "2.0",
      result: {
        content: [{ text: "", type: "text" }],
        isError: true,
      },
    });

    assert.match(summary, /isError=true/);
    assert.match(summary, /<empty text content>/);
  });
});
