import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeApiPlatformEventRows } from "../../convex/_apiPlatformObservability";

type SummaryInput = Parameters<typeof summarizeApiPlatformEventRows>[0];

describe("API platform observability helpers", () => {
  it("summarizes sanitized API, OAuth, MCP, rate-limit, and write-audit signals", () => {
    const summary = summarizeApiPlatformEventRows({
      apiRateLimitEvents: [
        { identityKind: "ip", quotaTier: "standard", routeClass: "anonymous_public_read" },
        { identityKind: "api_token", quotaTier: "trusted_partner", routeClass: "public_write" },
        { identityKind: "api_token", quotaTier: "trusted_partner", routeClass: "public_write" },
      ],
      apiTokenEvents: [
        {
          eventType: "created",
          result: "accepted",
          routeClass: "developer_credential_management",
        },
        {
          eventType: "validation_accepted",
          result: "accepted",
          routeClass: "authenticated_public_read",
          statusCodeClass: "2xx",
        },
        {
          eventType: "validation_rejected",
          result: "revoked",
          routeClass: "public_write",
          statusCodeClass: "4xx",
        },
      ],
      apiWriteAuditEvents: [
        {
          action: "profile_updated",
          actorKind: "personal_api_token",
          resourceType: "profile",
          result: "accepted",
          routeClass: "public_write",
        },
        {
          action: "event_created",
          actorKind: "user_delegated_oauth",
          resourceType: "event",
          result: "accepted",
          routeClass: "public_write",
        },
        {
          action: "profile_asset_upload_completed",
          actorKind: "upload_token",
          resourceType: "profile_asset",
          result: "accepted",
          routeClass: "asset_upload_intent",
        },
      ],
      mcpToolEvents: [
        { routeClass: "anonymous_mcp_public_read", toolName: "search" },
        { routeClass: "anonymous_mcp_public_read", toolName: "fetch" },
        { routeClass: "anonymous_mcp_public_read", toolName: "vrdex_search" },
        { routeClass: "anonymous_mcp_public_read", toolName: "vrdex_search" },
        { routeClass: "authenticated_mcp", toolName: "vrdex_get_profile" },
      ],
      oauthClientEvents: [
        {
          eventType: "authorization_code_redeemed",
          result: "accepted",
          routeClass: "oauth_token",
        },
        {
          eventType: "authorization_code_redeemed",
          result: "rejected",
          routeClass: "oauth_token",
        },
        {
          eventType: "refresh_token_rotated",
          result: "accepted",
          routeClass: "oauth_token",
        },
        {
          eventType: "token_issued",
          result: "accepted",
          routeClass: "oauth_token",
        },
        {
          eventType: "client_credentials_rejected",
          result: "rejected",
          routeClass: "oauth_token",
        },
        {
          eventType: "validation_accepted",
          result: "accepted",
          routeClass: "authenticated_mcp",
          validationResult: "accepted",
        },
        {
          eventType: "validation_rejected",
          result: "rejected",
          routeClass: "authenticated_mcp",
          validationResult: "revoked",
        },
      ],
    } satisfies SummaryInput);

    assert.deepEqual(summary.apiRateLimitBlocks, [
      {
        count: 2,
        identityKind: "api_token",
        quotaTier: "trusted_partner",
        routeClass: "public_write",
      },
      {
        count: 1,
        identityKind: "ip",
        quotaTier: "standard",
        routeClass: "anonymous_public_read",
      },
    ]);
    assert.deepEqual(summary.apiTokenValidationEvents, [
      {
        count: 1,
        result: "accepted",
        routeClass: "authenticated_public_read",
        statusCodeClass: "2xx",
      },
      {
        count: 1,
        result: "revoked",
        routeClass: "public_write",
        statusCodeClass: "4xx",
      },
    ]);
    assert.deepEqual(summary.apiWriteAuditEvents, [
      {
        action: "event_created",
        actorKind: "user_delegated_oauth",
        count: 1,
        resourceType: "event",
        result: "accepted",
        routeClass: "public_write",
      },
      {
        action: "profile_asset_upload_completed",
        actorKind: "upload_token",
        count: 1,
        resourceType: "profile_asset",
        result: "accepted",
        routeClass: "asset_upload_intent",
      },
      {
        action: "profile_updated",
        actorKind: "personal_api_token",
        count: 1,
        resourceType: "profile",
        result: "accepted",
        routeClass: "public_write",
      },
    ]);
    assert.deepEqual(summary.mcpToolInvocations, [
      {
        count: 1,
        routeClass: "anonymous_mcp_public_read",
        toolName: "fetch",
      },
      {
        count: 1,
        routeClass: "anonymous_mcp_public_read",
        toolName: "search",
      },
      {
        count: 2,
        routeClass: "anonymous_mcp_public_read",
        toolName: "vrdex_search",
      },
      {
        count: 1,
        routeClass: "authenticated_mcp",
        toolName: "vrdex_get_profile",
      },
    ]);
    assert.deepEqual(summary.oauthGrantEvents, [
      {
        count: 1,
        grantType: "authorization_code",
        result: "accepted",
        routeClass: "oauth_token",
      },
      {
        count: 1,
        grantType: "authorization_code",
        result: "rejected",
        routeClass: "oauth_token",
      },
      {
        count: 1,
        grantType: "client_credentials",
        result: "accepted",
        routeClass: "oauth_token",
      },
      {
        count: 1,
        grantType: "client_credentials",
        result: "rejected",
        routeClass: "oauth_token",
      },
      {
        count: 1,
        grantType: "refresh_token",
        result: "accepted",
        routeClass: "oauth_token",
      },
    ]);
    assert.deepEqual(summary.oauthAccessTokenValidationEvents, [
      {
        count: 1,
        result: "accepted",
        routeClass: "authenticated_mcp",
      },
      {
        count: 1,
        result: "revoked",
        routeClass: "authenticated_mcp",
      },
    ]);
  });
});
