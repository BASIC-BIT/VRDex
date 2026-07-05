import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ApiEventCreateRequestSchema,
  ApiEventWriteResponseSchema,
  createBearerTokenQueryProblem,
  createPublicNotFoundProblem,
  ApiMeCommunitiesResponseSchema,
  ApiMeEventsResponseSchema,
  ApiMeProfilesResponseSchema,
  ApiMeResponseSchema,
  ApiRateLimitUsageResponseSchema,
  DeveloperOAuthAppCreateRequestSchema,
  DeveloperOAuthAppCreateResponseSchema,
  DeveloperOAuthAppSecretCreateRequestSchema,
  DeveloperOAuthAppSecretCreateResponseSchema,
  DeveloperOAuthAppUpdateRequestSchema,
  DeveloperTokenCreateRequestSchema,
  DeveloperTokenCreateResponseSchema,
  getBearerTokenFromAuthorizationHeader,
  getOpenApiDocument,
  hasBearerTokenInUrl,
  PublicActiveWorldSchema,
  PublicEventSchema,
  PublicProfileSchema,
  PublicSearchResponseSchema,
  PublicWorldSchema,
  createApiTokenValue,
  createOAuthClientId,
  createOAuthClientSecretValue,
  hashApiTokenValue,
  hashOAuthClientSecretValue,
  normalizeApiTokenLabel,
  normalizeApiTokenScopes,
  normalizeDynamicMcpClientRegistration,
  normalizeOAuthApplicationDescription,
  normalizeOAuthApplicationName,
  normalizeOAuthClientId,
  normalizeOAuthClientType,
  normalizeOAuthGrantTypes,
  normalizeOAuthOptionalUrl,
  normalizeOAuthRedirectUris,
  normalizeOAuthScopes,
  parseApiTokenValue,
  parseOAuthClientSecretValue,
  timingSafeEqualString,
} from "../src";

describe("@vrdex/api-contracts", () => {
  it("parses public profiles while preserving future response fields", () => {
    const profile = PublicProfileSchema.parse({
      displayName: "VRDex",
      futureField: "kept",
      profileType: "community",
      slug: "vrdex",
      trustLabel: "claimed_verified",
    });

    assert.equal((profile as { futureField?: string }).futureField, "kept");
  });

  it("parses representative public read payloads", () => {
    PublicSearchResponseSchema.parse({
      query: "afterglow",
      type: "community",
      results: [
        {
          entityType: "profile",
          profileType: "community",
          slug: "afterglow",
          routePath: "/c/afterglow",
          title: "Afterglow",
          source: { sourceType: "community", label: "Community submitted" },
          score: 42,
        },
      ],
    });

    PublicEventSchema.parse({
      id: "event_123",
      slug: "afterglow-night",
      title: "Afterglow Night",
      startAt: 1770000000000,
      source: { sourceType: "manual", label: "Owner-authored" },
      watchSurfaceEnabled: false,
      mediaLinks: [],
    });

    PublicWorldSchema.parse({
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      tags: ["club"],
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      media: [],
      creatorAttributions: [],
      outboundLinks: [],
      eventContext: { upcoming: [], recent: [] },
    });

    PublicActiveWorldSchema.parse({
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      tags: ["club"],
      upcomingEventCount: 1,
      activityLabel: "Hosting upcoming events",
      nextEvent: {
        title: "Afterglow Night",
        startAt: 1770000000000,
        source: { sourceType: "manual", label: "Owner-authored" },
      },
    });
  });

  it("parses event creation contracts", () => {
    ApiEventCreateRequestSchema.parse({
      title: "Club Night",
      communitySlug: "club-name",
      startAt: 1770000000000,
      endAt: 1770003600000,
      timezone: "America/New_York",
      worldSlug: "afterglow-harbor",
      summary: "A public community event.",
      mediaLinks: [
        {
          type: "watch",
          label: "Watch",
          url: "https://example.test/watch",
        },
      ],
      participantLinks: [
        {
          personSlug: "artist-name",
          roleLabel: "DJ",
        },
      ],
      slotLinks: [
        {
          displayLabel: "Opening set",
          roleLabel: "DJ",
          startAt: 1770000000000,
          endAt: 1770003600000,
        },
      ],
    });

    ApiEventWriteResponseSchema.parse({
      eventId: "event123",
      slug: "club-night",
      eventPath: "/e/club-night",
      shortLinkCode: "abc123",
      shortLinkPath: "/s/abc123",
    });
  });

  it("parses rate-limit usage responses", () => {
    ApiRateLimitUsageResponseSchema.parse({
      caller: {
        authenticated: false,
        credentialKind: "anonymous",
        routeClass: "anonymous_public_read",
      },
      currentWindow: {
        limit: 120,
        remaining: 119,
        resetAt: 1770000000000,
        retryAfterSeconds: 60,
        routeClass: "anonymous_public_read",
        windowMs: 60_000,
      },
      policies: [
        {
          limit: 120,
          routeClass: "anonymous_public_read",
          windowMs: 60_000,
        },
      ],
    });
  });

  it("parses authenticated current-caller responses", () => {
    ApiMeResponseSchema.parse({
      credential: {
        kind: "api_token",
        ownerKind: "user",
        ownerUserId: "user123",
        scopes: ["public:read"],
        tokenId: "token123",
        trustTier: "personal",
      },
      rateLimit: {
        limit: 600,
        remaining: 599,
        resetAt: 1770000000000,
        retryAfterSeconds: 60,
        routeClass: "authenticated_public_read",
        windowMs: 60_000,
      },
    });

    ApiMeResponseSchema.parse({
      credential: {
        kind: "oauth",
        clientId: "vrdx_app_0123456789abcdef01234567",
        scopes: ["public:read"],
        subjectType: "client",
        trustTier: "standard",
      },
      rateLimit: {
        limit: 600,
        remaining: 599,
        resetAt: 1770000000000,
        retryAfterSeconds: 60,
        routeClass: "authenticated_public_read",
        windowMs: 60_000,
      },
    });
  });

  it("parses authenticated current-user inventory responses", () => {
    ApiMeProfilesResponseSchema.parse({
      profiles: [
        {
          id: "profile123",
          slug: "artist-name",
          profileType: "person",
          displayName: "Artist Name",
          headline: "DJ and world hopper",
          claimState: "claimed_verified",
          publicationState: "published",
          publicSurfacingState: "public",
          creationSource: "self",
          claimedAt: 1770000000000,
          publishedAt: 1770000000000,
          updatedAt: 1770000000000,
        },
      ],
    });

    ApiMeCommunitiesResponseSchema.parse({
      communities: [
        {
          id: "profile456",
          slug: "club-name",
          profileType: "community",
          displayName: "Club Name",
          claimState: "claimed_verified",
          publicationState: "published",
          publicSurfacingState: "public",
          creationSource: "self",
          updatedAt: 1770000000000,
        },
      ],
    });

    ApiMeEventsResponseSchema.parse({
      events: [
        {
          id: "event123",
          slug: "club-night",
          title: "Club Night",
          startAt: 1770000000000,
          endAt: 1770003600000,
          timezone: "America/New_York",
          communityProfileId: "profile456",
          communitySlug: "club-name",
          communityName: "Club Name",
          sourceType: "community",
          sourceLabel: "Owner",
          publicationState: "draft_private",
          watchSurfaceEnabled: false,
          createdAt: 1770000000000,
          updatedAt: 1770000000000,
        },
      ],
    });
  });

  it("parses developer token creation contracts", () => {
    DeveloperTokenCreateRequestSchema.parse({
      label: "Local MCP",
      scopes: ["public:read", "developer:read"],
      expiresAt: 1770000000000,
    });

    DeveloperTokenCreateResponseSchema.parse({
      tokenValue: "vrdx_lookup.verifier",
      token: {
        id: "token123",
        tokenPrefix: "vrdx_lookup",
        ownerKind: "user",
        ownerUserId: "user123",
        label: "Local MCP",
        scopes: ["public:read", "developer:read"],
        status: "active",
        trustTier: "personal",
        createdAt: 1770000000000,
        updatedAt: 1770000000000,
      },
    });
  });

  it("parses developer OAuth app creation contracts", () => {
    DeveloperOAuthAppCreateRequestSchema.parse({
      clientType: "confidential",
      displayName: "Local MCP client",
      description: "Local development client",
      docsUrl: "https://example.test/docs",
      privacyUrl: "https://example.test/privacy",
      redirectUris: ["https://example.test/oauth/callback"],
      allowedGrants: ["authorization_code", "refresh_token", "client_credentials"],
      allowedScopes: ["public:read", "mcp:read"],
    });

    DeveloperOAuthAppCreateResponseSchema.parse({
      clientSecretValue: "vrdx_secret_lookup.verifier",
      application: {
        id: "application123",
        clientId: "vrdx_app_0123456789abcdef01234567",
        ownerKind: "user",
        ownerUserId: "user123",
        clientType: "confidential",
        displayName: "Local MCP client",
        redirectUris: ["https://example.test/oauth/callback"],
        allowedGrants: ["authorization_code", "refresh_token", "client_credentials"],
        allowedScopes: ["public:read", "mcp:read"],
        status: "active",
        trustTier: "standard",
        createdAt: 1770000000000,
        updatedAt: 1770000000000,
        activeSecretPrefixes: ["vrdx_secret_lookup"],
      },
    });
  });

  it("parses developer OAuth app secret creation contracts", () => {
    DeveloperOAuthAppSecretCreateRequestSchema.parse({
      label: "Production rotation",
    });

    DeveloperOAuthAppSecretCreateResponseSchema.parse({
      clientSecretValue: "vrdx_secret_lookup.verifier",
      application: {
        id: "application123",
        clientId: "vrdx_app_0123456789abcdef01234567",
        ownerKind: "user",
        ownerUserId: "user123",
        clientType: "confidential",
        displayName: "Local MCP client",
        redirectUris: ["https://example.test/oauth/callback"],
        allowedGrants: ["authorization_code", "refresh_token", "client_credentials"],
        allowedScopes: ["public:read", "mcp:read"],
        status: "active",
        trustTier: "standard",
        createdAt: 1770000000000,
        updatedAt: 1770000000000,
        activeSecretPrefixes: ["vrdx_secret_lookup", "vrdx_secret_second"],
      },
    });
  });

  it("parses developer OAuth app update contracts", () => {
    DeveloperOAuthAppUpdateRequestSchema.parse({
      displayName: "Updated MCP client",
      description: null,
      docsUrl: "https://example.test/docs",
      redirectUris: ["http://127.0.0.1:3333/callback"],
      allowedGrants: ["authorization_code", "refresh_token"],
      allowedScopes: ["public:read", "mcp:read"],
    });
  });


  it("creates RFC 9457-compatible problem details", () => {
    assert.deepEqual(createPublicNotFoundProblem("Profile"), {
      type: "about:blank",
      title: "Profile not found",
      status: 404,
      detail: "The requested public resource was not found.",
    });

    assert.deepEqual(createBearerTokenQueryProblem(), {
      type: "about:blank",
      title: "Bearer token query parameters are not allowed",
      status: 400,
      detail: "Send bearer credentials with the Authorization header instead of URL query parameters.",
    });
  });

  it("parses bearer authorization headers conservatively", () => {
    assert.equal(getBearerTokenFromAuthorizationHeader("Bearer abc.def"), "abc.def");
    assert.equal(getBearerTokenFromAuthorizationHeader("bearer token"), "token");
    assert.equal(getBearerTokenFromAuthorizationHeader("Bearer"), null);
    assert.equal(getBearerTokenFromAuthorizationHeader("Basic token"), null);
    assert.equal(getBearerTokenFromAuthorizationHeader("Bearer token extra"), null);
  });

  it("detects bearer-token query parameters for rejection in public handlers", () => {
    assert.equal(hasBearerTokenInUrl("https://example.test/api?access_token=abc"), true);
    assert.equal(hasBearerTokenInUrl("https://example.test/api?api_token=abc"), true);
    assert.equal(hasBearerTokenInUrl("https://example.test/api?token=abc"), true);
    assert.equal(hasBearerTokenInUrl("https://example.test/api?query=abc"), false);
  });

  it("generates parseable opaque API token values and hashes them with a pepper", async () => {
    const token = createApiTokenValue();
    const parsed = parseApiTokenValue(token.tokenValue);

    assert.equal(parsed?.tokenPrefix, token.tokenPrefix);
    assert.equal(parsed?.verifier, token.verifier);
    assert.equal(parseApiTokenValue("vrdx_not-a-token"), null);
    assert.match(await hashApiTokenValue(token.tokenValue, "pepper"), /^[0-9a-f]{64}$/);
    assert.equal(timingSafeEqualString("abc", "abc"), true);
    assert.equal(timingSafeEqualString("abc", "abd"), false);
  });

  it("normalizes API token labels and scopes", () => {
    assert.equal(normalizeApiTokenLabel("  Local   MCP  "), "Local MCP");
    assert.deepEqual(normalizeApiTokenScopes(undefined), ["public:read"]);
    assert.deepEqual(normalizeApiTokenScopes(["public:read", "mcp:read", "public:read"]), [
      "public:read",
      "mcp:read",
    ]);
    assert.throws(() => normalizeApiTokenLabel(""), /label/);
    assert.throws(() => normalizeApiTokenScopes(["bad:scope"]), /Unsupported/);
  });

  it("generates and validates OAuth client credentials", async () => {
    const clientId = createOAuthClientId();
    const secret = createOAuthClientSecretValue();
    const parsedSecret = parseOAuthClientSecretValue(secret.secretValue);

    assert.equal(normalizeOAuthClientId(clientId), clientId);
    assert.equal(parsedSecret?.secretPrefix, secret.secretPrefix);
    assert.equal(parsedSecret?.verifier, secret.verifier);
    assert.match(await hashOAuthClientSecretValue(secret.secretValue, "pepper"), /^[0-9a-f]{64}$/);
    assert.throws(() => normalizeOAuthClientId("bad"), /client id/);
    assert.equal(parseOAuthClientSecretValue("bad"), null);
  });

  it("normalizes OAuth app metadata, redirects, scopes, and grants", () => {
    assert.equal(normalizeOAuthClientType("public"), "public");
    assert.equal(normalizeOAuthApplicationName("  Local   MCP  "), "Local MCP");
    assert.equal(normalizeOAuthApplicationDescription("  Agent   workflow  "), "Agent workflow");
    assert.equal(normalizeOAuthOptionalUrl("https://example.com/docs", "Docs URL"), "https://example.com/docs");
    assert.deepEqual(normalizeOAuthRedirectUris(["http://127.0.0.1:3333/callback"]), [
      "http://127.0.0.1:3333/callback",
    ]);
    assert.deepEqual(normalizeOAuthScopes(["public:read", "mcp:read", "public:read"]), [
      "public:read",
      "mcp:read",
    ]);
    assert.deepEqual(normalizeOAuthGrantTypes(undefined, "public"), [
      "authorization_code",
      "refresh_token",
    ]);
    assert.deepEqual(normalizeOAuthGrantTypes(undefined, "confidential"), [
      "authorization_code",
      "refresh_token",
      "client_credentials",
    ]);
    assert.throws(() => normalizeOAuthRedirectUris(["http://example.com/callback"]), /HTTPS/);
    assert.throws(() => normalizeOAuthRedirectUris(["https://example.com/callback#frag"]), /fragment/);
    assert.throws(() => normalizeOAuthGrantTypes(["client_credentials"], "public"), /Public OAuth clients/);
  });

  it("normalizes constrained dynamic MCP client registration metadata", () => {
    assert.deepEqual(
      normalizeDynamicMcpClientRegistration({
        client_name: "  Local   MCP  ",
        redirect_uris: ["http://localhost:3333/callback"],
        scope: "mcp:read public:read mcp:read",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        contacts: ["dev@example.test", "dev@example.test"],
        software_id: "com.example.agent",
        software_version: "1.0.0",
      }),
      {
        allowedScopes: ["mcp:read", "public:read"],
        clientName: "Local MCP",
        clientType: "public",
        contacts: ["dev@example.test"],
        grantTypes: ["authorization_code", "refresh_token"],
        redirectUris: ["http://localhost:3333/callback"],
        responseTypes: ["code"],
        softwareId: "com.example.agent",
        softwareVersion: "1.0.0",
        tokenEndpointAuthMethod: "none",
      },
    );

    assert.throws(
      () =>
        normalizeDynamicMcpClientRegistration({
          client_name: "Local MCP",
          redirect_uris: ["http://localhost:3333/callback"],
          scope: "public:read",
        }),
      /mcp:read/,
    );
    assert.throws(
      () =>
        normalizeDynamicMcpClientRegistration({
          client_name: "Local MCP",
          redirect_uris: ["http://localhost:3333/callback"],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      /token_endpoint_auth_method=none/,
    );
  });

  it("includes the first public API paths in the generated OpenAPI document", () => {
    const document = getOpenApiDocument();

    assert.equal(document.openapi, "3.1.0");
    assert.ok(document.paths?.["/api/v0/openapi.json"]);
    assert.ok(document.paths?.["/api/v0/me"]);
    assert.ok(document.paths?.["/api/v0/me/profiles"]);
    assert.ok(document.paths?.["/api/v0/me/communities"]);
    assert.ok(document.paths?.["/api/v0/me/events"]);
    assert.ok(document.paths?.["/api/v0/search"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/assets"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/logos"]);
    assert.ok(document.paths?.["/api/v0/people/{slug}"]);
    assert.ok(document.paths?.["/api/v0/people/{slug}/events"]);
    assert.ok(document.paths?.["/api/v0/communities/{slug}"]);
    assert.ok(document.paths?.["/api/v0/communities/{slug}/events"]);
    assert.ok(document.paths?.["/api/v0/events"]?.post);
    assert.ok(document.paths?.["/api/v0/events/{slug}"]);
    assert.ok(document.paths?.["/api/v0/events/upcoming"]);
    assert.ok(document.paths?.["/api/v0/worlds/{slug}"]);
    assert.ok(document.paths?.["/api/v0/worlds/active"]);
    assert.ok(document.paths?.["/api/v0/claims/{slug}/status"]);
    assert.ok(document.paths?.["/api/v0/usage/rate-limit"]);
    assert.ok(document.paths?.["/api/v0/developer/tokens"]);
    assert.ok(document.paths?.["/api/v0/developer/tokens"]?.post);
    assert.ok(document.paths?.["/api/v0/developer/tokens/{tokenId}"]);
    assert.ok(document.paths?.["/api/v0/developer/oauth-apps"]);
    assert.ok(document.paths?.["/api/v0/developer/oauth-apps"]?.post);
    assert.ok(document.paths?.["/api/v0/developer/oauth-apps/{clientId}"]);
    assert.ok(document.paths?.["/api/v0/developer/oauth-apps/{clientId}"]?.patch);
    assert.ok(document.paths?.["/api/v0/developer/oauth-apps/{clientId}/secrets"]?.post);
  });

  it("advertises the real OAuth route surface in security metadata", () => {
    const document = getOpenApiDocument();
    const securitySchemes = document.components?.securitySchemes;

    assert.ok(securitySchemes);
    const oauth2 = securitySchemes.oauth2 as {
      flows?: {
        authorizationCode?: {
          authorizationUrl?: string;
          tokenUrl?: string;
        };
      };
      type?: string;
    };

    assert.equal(oauth2?.type, "oauth2");
    assert.equal(oauth2.flows?.authorizationCode?.authorizationUrl, "/oauth/authorize");
    assert.equal(oauth2.flows?.authorizationCode?.tokenUrl, "/oauth/token");
  });
});
