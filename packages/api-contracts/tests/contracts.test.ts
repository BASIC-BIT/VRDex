import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ApiEventCreateRequestSchema,
  ApiEventUpdateRequestSchema,
  ApiEventWriteResponseSchema,
  createBearerTokenQueryProblem,
  createPublicNotFoundProblem,
  ApiMeCommunitiesResponseSchema,
  ApiMeEventsResponseSchema,
  ApiMeProfilesResponseSchema,
  ApiMeResponseSchema,
  ApiProfileAssetUploadErrorResponseSchema,
  ApiProfileAssetUploadIntentCompleteResponseSchema,
  ApiProfileAssetUploadIntentCreateRequestSchema,
  ApiProfileAssetUploadIntentCreateResponseSchema,
  ApiProfileUpdateRequestSchema,
  ApiProfileWriteResponseSchema,
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
  McpDocumentFetchResponseSchema,
  McpDocumentSearchResponseSchema,
  mcpOutputJsonSchemaForZodSchema,
  PublicActiveWorldSchema,
  PublicEventSchema,
  PublicProfileSchema,
  PublicSearchResponseSchema,
  PublicWorldEventsResponseSchema,
  PublicWorldSchema,
  z,
  createApiTokenValue,
  createOAuthClientId,
  createOAuthClientSecretValue,
  hashApiTokenValue,
  hashOAuthClientSecretValue,
  isOAuthClientMetadataDocumentUrl,
  normalizeApiTokenLabel,
  normalizeApiTokenScopes,
  normalizeDynamicMcpClientRegistration,
  normalizeOAuthApplicationDescription,
  normalizeOAuthApplicationName,
  normalizeOAuthClientId,
  normalizeOAuthClientMetadataDocumentUrl,
  normalizeOAuthClientType,
  normalizeOAuthGrantTypes,
  normalizeOAuthOptionalUrl,
  normalizeOAuthRedirectUris,
  normalizeOAuthScopes,
  parseApiTokenValue,
  parseOAuthClientSecretValue,
  parseApiMeInventoryQueryParams,
  parseDeveloperCredentialListQueryParams,
  parsePublicActiveWorldsQueryParams,
  parsePublicEventsListQueryParams,
  parseSearchQueryParams,
  timingSafeEqualString,
  TemporalParseCompletedResponseSchema,
  TemporalParsePendingResponseSchema,
  TemporalParseRequestSchema,
} from "../src";

const namedSchemaMapKeys = new Set(["$defs", "definitions", "dependentSchemas", "patternProperties", "properties"]);

type OpenApiOperation = {
  description?: string;
  parameters?: Array<{ in?: string; name?: string; schema?: { maximum?: number } }>;
  requestBody?: {
    content?: Record<
      string,
      {
        schema?: {
          properties?: Record<string, { format?: string; type?: string }>;
          required?: string[];
          type?: string;
        };
      }
    >;
    required?: boolean;
  };
  responses?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
};

type OpenApiPathItem = Record<string, OpenApiOperation>;

function hasLegacySchemaId(value: unknown, insideNamedSchemaMap = false): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasLegacySchemaId(item));
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.entries(value).some(
    ([key, child]) =>
      (key === "id" && !insideNamedSchemaMap) || hasLegacySchemaId(child, namedSchemaMapKeys.has(key)),
  );
}

describe("@vrdex/api-contracts", () => {
  it("parses public profiles while preserving future response fields", () => {
    const profile = PublicProfileSchema.parse({
      avatarImageUrl: "/api/v0/profiles/vrdex/assets/avatar/file",
      displayName: "VRDex",
      futureField: "kept",
      mediaKit: {
        additionalLogos: [],
        assets: [],
        logoZipUrl: "/api/v0/profiles/vrdex/logos.zip",
        logos: [],
        profileImage: {
          downloadUrl: "/api/v0/profiles/vrdex/assets/avatar/file?download=1",
          imageUrl: "/api/v0/profiles/vrdex/assets/avatar/file",
        },
      },
      profileType: "community",
      slug: "vrdex",
      trustLabel: "claimed_verified",
    });

    assert.equal((profile as { futureField?: string }).futureField, "kept");
    assert.throws(() => PublicProfileSchema.parse({
      avatarImageUrl: "//cdn.example.test/avatar.png",
      displayName: "VRDex",
      profileType: "community",
      slug: "vrdex",
      trustLabel: "claimed_verified",
    }));
  });

  it("accepts safe root-relative media URLs in public search results", () => {
    const response = PublicSearchResponseSchema.parse({
      query: "vrdex",
      results: [{
        entityType: "profile",
        imageUrl: "/api/v0/profiles/vrdex/assets/avatar/file",
        logoImageUrl: "/api/v0/profiles/vrdex/assets/logo/file",
        profileImageUrl: "/api/v0/profiles/vrdex/assets/profile/file",
        routePath: "/vrdex",
        score: 1,
        slug: "vrdex",
        title: "VRDex",
      }],
    });

    assert.equal(response.results[0]?.imageUrl, "/api/v0/profiles/vrdex/assets/avatar/file");
    assert.throws(() => PublicSearchResponseSchema.parse({
      query: "vrdex",
      results: [{
        entityType: "profile",
        imageUrl: "//cdn.example.test/avatar.png",
        routePath: "/vrdex",
        score: 1,
        slug: "vrdex",
        title: "VRDex",
      }],
    }));
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

    PublicWorldEventsResponseSchema.parse({
      upcoming: [
        {
          title: "Afterglow Night",
          startAt: 1770000000000,
          mediaLinks: [],
          source: { sourceType: "manual", label: "Owner-authored" },
          worldAssociation: { confirmationState: "confirmed" },
        },
      ],
      recent: [],
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

    McpDocumentSearchResponseSchema.parse({
      results: [
        {
          id: "profile:community:afterglow",
          title: "Afterglow",
          url: "https://vrdex.example/c/afterglow",
        },
      ],
    });

    McpDocumentFetchResponseSchema.parse({
      id: "profile:community:afterglow",
      title: "Afterglow",
      text: "Afterglow public VRDex profile.",
      url: "https://vrdex.example/c/afterglow",
      metadata: {
        entityType: "profile",
        profileType: "community",
        slug: "afterglow",
      },
    });
  });

  it("generates MCP-safe JSON Schema from shared Zod contracts", () => {
    const jsonSchema = mcpOutputJsonSchemaForZodSchema(
      z
        .object({
          id: z.string(),
          nested: z
            .object({
              id: z.string(),
            })
            .meta({ id: "NestedSchemaWithIdField" }),
        })
        .meta({ id: "RootSchemaWithIdField" }),
    );

    assert.equal(hasLegacySchemaId(jsonSchema), false);
    assert.ok((jsonSchema.properties as Record<string, unknown>).id);
    assert.ok(
      (
        ((jsonSchema.$defs as Record<string, unknown>).NestedSchemaWithIdField as {
          properties?: Record<string, unknown>;
        }).properties ?? {}
      ).id,
    );
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

    ApiEventUpdateRequestSchema.parse({
      summary: "Updated public event details.",
    });

    assert.throws(() => ApiEventUpdateRequestSchema.parse({
      participantLinks: [],
    }), /participantLinks and slotLinks must be supplied together/);
  });

  it("parses profile update contracts", () => {
    ApiProfileUpdateRequestSchema.parse({
      displayName: "Artist Name",
      aliases: ["Artist"],
      tags: ["House", "VRDJ"],
      headline: "Late-night VRChat floors",
      bio: null,
      region: "NA",
      timezone: "America/New_York",
      person: {
        pronouns: "they/them",
        roleTags: ["DJ", "Producer"],
      },
    });

    ApiProfileUpdateRequestSchema.parse({
      community: {
        subtype: "Club night",
        categoryTags: ["Music", "Social"],
      },
    });

    ApiProfileWriteResponseSchema.parse({
      profileId: "profile123",
      slug: "artist-name",
      profileType: "person",
      profilePath: "/p/artist-name",
    });
  });

  it("parses profile asset upload-intent contracts", () => {
    ApiProfileAssetUploadIntentCreateRequestSchema.parse({
      originalFileName: "logo.png",
      mimeType: "image/png",
      byteSize: 1024,
      label: "Primary logo",
      placements: ["primary_logo"],
    });

    ApiProfileAssetUploadIntentCreateRequestSchema.parse({
      sourceUrl: "https://example.test/logo.webp",
      mimeType: "image/webp",
      caption: "Imported brand mark",
      placements: ["additional_logo"],
      position: 1,
    });

    ApiProfileAssetUploadIntentCreateResponseSchema.parse({
      profileId: "profile123",
      slug: "artist-name",
      profileType: "person",
      profilePath: "/p/artist-name",
      intentId: "intent123",
      uploadToken: "upload-token",
      uploadUrl: "/api/v0/profile-assets/upload-intents/intent123",
      uploadTokenHeader: "x-vrdex-upload-token",
      expiresAt: 1770000000000,
    });

    ApiProfileAssetUploadIntentCompleteResponseSchema.parse({
      intentId: "intent123",
      storageKey: "profile-assets/2026-07-05/token/logo.png",
      mimeType: "image/png",
      byteSize: 1024,
      assetIds: ["asset123"],
    });

    ApiProfileAssetUploadErrorResponseSchema.parse({
      error: "Upload token is required.",
    });
  });

  it("parses rate-limit usage responses", () => {
    ApiRateLimitUsageResponseSchema.parse({
      caller: {
        authenticated: false,
        credentialKind: "anonymous",
        quotaTier: "standard",
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

  it("parses public API query parameters through shared contract helpers", () => {
    assert.deepEqual(parseSearchQueryParams(new URLSearchParams("q=%20club%20&type=event&limit=999")), {
      limit: 50,
      q: "club",
      type: "event",
    });
    assert.deepEqual(parseSearchQueryParams(new URLSearchParams("type=unknown&limit=bad")), {
      limit: 24,
      q: "",
      type: "all",
    });

    assert.deepEqual(parsePublicEventsListQueryParams(new URLSearchParams("limit=999")), { limit: 24 });
    assert.deepEqual(parsePublicEventsListQueryParams(new URLSearchParams("limit=bad")), { limit: 8 });
    assert.deepEqual(parsePublicEventsListQueryParams(new URLSearchParams(), 6), { limit: 6 });

    assert.deepEqual(parsePublicActiveWorldsQueryParams(new URLSearchParams("limit=999")), { limit: 6 });
    assert.deepEqual(parsePublicActiveWorldsQueryParams(new URLSearchParams("limit=bad")), { limit: 3 });

    assert.deepEqual(parseApiMeInventoryQueryParams(new URLSearchParams("limit=999")), { limit: 100 });
    assert.deepEqual(parseApiMeInventoryQueryParams(new URLSearchParams("limit=bad")), { limit: 50 });

    assert.deepEqual(parseDeveloperCredentialListQueryParams(new URLSearchParams("includeRevoked=true&limit=999")), {
      includeRevoked: true,
      limit: 100,
    });
    assert.deepEqual(parseDeveloperCredentialListQueryParams(new URLSearchParams("includeRevoked=false&limit=bad")), {
      includeRevoked: false,
      limit: 50,
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

    DeveloperOAuthAppCreateRequestSchema.parse({
      clientType: "public",
      displayName: "Community MCP client",
      ownerCommunitySlug: "club-example",
      redirectUris: ["https://community.example.test/oauth/callback"],
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

    DeveloperOAuthAppCreateResponseSchema.parse({
      application: {
        id: "application456",
        clientId: "vrdx_app_fedcba9876543210fedcba98",
        ownerKind: "community",
        ownerUserId: "user123",
        ownerCommunityProfileId: "profile456",
        clientType: "public",
        displayName: "Community MCP client",
        redirectUris: ["https://community.example.test/oauth/callback"],
        allowedGrants: ["authorization_code", "refresh_token"],
        allowedScopes: ["public:read", "mcp:read"],
        status: "active",
        trustTier: "standard",
        createdAt: 1770000000000,
        updatedAt: 1770000000000,
        activeSecretPrefixes: [],
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

  it("rejects OAuth app updates that clear every allowed grant", () => {
    assert.throws(() => DeveloperOAuthAppUpdateRequestSchema.parse({ allowedGrants: [] }));
    assert.throws(() => DeveloperOAuthAppUpdateRequestSchema.parse({ allowedScopes: [] }));
  });

  it("leaves OAuth app update grant semantics to stored client type validation", () => {
    const update = DeveloperOAuthAppUpdateRequestSchema.parse({
      allowedGrants: ["client_credentials"],
    });

    assert.deepEqual(update.allowedGrants, ["client_credentials"]);
    assert.deepEqual(normalizeOAuthGrantTypes(update.allowedGrants, "confidential"), ["client_credentials"]);
    assert.throws(
      () => normalizeOAuthGrantTypes(update.allowedGrants, "public"),
      /Public OAuth clients cannot use client credentials/,
    );
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
    assert.equal(
      normalizeOAuthClientId("https://client.example.test/oauth/client.json?app=vrdex"),
      "https://client.example.test/oauth/client.json?app=vrdex",
    );
    assert.equal(
      normalizeOAuthClientMetadataDocumentUrl("https://client.example.test/oauth/client.json?app=vrdex"),
      "https://client.example.test/oauth/client.json?app=vrdex",
    );
    assert.equal(isOAuthClientMetadataDocumentUrl("https://client.example.test/oauth/client.json"), true);
    assert.equal(isOAuthClientMetadataDocumentUrl("vrdx_app_0123456789abcdef01234567"), false);
    assert.equal(parsedSecret?.secretPrefix, secret.secretPrefix);
    assert.equal(parsedSecret?.verifier, secret.verifier);
    assert.match(await hashOAuthClientSecretValue(secret.secretValue, "pepper"), /^[0-9a-f]{64}$/);
    assert.throws(() => normalizeOAuthClientId("bad"), /client id/);
    assert.throws(() => normalizeOAuthClientMetadataDocumentUrl("http://client.example.test/oauth/client.json"), /HTTPS/);
    assert.throws(() => normalizeOAuthClientMetadataDocumentUrl("https://client.example.test/../client.json"), /dot path/);
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
    assert.throws(() => normalizeOAuthScopes(["time:parse"]), /Unsupported OAuth scope/);
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
    assert.equal(document.servers?.[0]?.url, "https://vrdex.net");
    assert.ok(document.paths?.["/api/v0/openapi.json"]);
    assert.ok(document.paths?.["/api/v0/openapi.yaml"]);
    assert.ok(document.paths?.["/api/v0/me"]);
    assert.ok(document.paths?.["/api/v0/me/profiles"]);
    assert.ok(document.paths?.["/api/v0/me/communities"]);
    assert.ok(document.paths?.["/api/v0/me/events"]);
    assert.ok(document.paths?.["/api/v0/search"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}"]?.patch);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/assets"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/assets/{assetId}/file"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/assets/upload-intent"]?.post);
    assert.ok(document.paths?.["/api/v0/profile-assets/upload-intents/{intentId}"]?.post);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/logos"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/logos.zip"]);
    assert.ok(document.paths?.["/api/v0/people/{slug}"]);
    assert.ok(document.paths?.["/api/v0/people/{slug}/events"]);
    assert.ok(document.paths?.["/api/v0/communities/{slug}"]);
    assert.ok(document.paths?.["/api/v0/communities/{slug}/events"]);
    assert.ok(document.paths?.["/api/v0/events"]?.post);
    assert.ok(document.paths?.["/api/v0/events/{slug}"]);
    assert.ok(document.paths?.["/api/v0/events/{slug}"]?.patch);
    assert.ok(document.paths?.["/api/v0/events/upcoming"]);
    assert.ok(document.paths?.["/api/v0/worlds/{slug}"]);
    assert.ok(document.paths?.["/api/v0/worlds/{slug}/events"]);
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

  it("documents route-specific query limits from the shared contract schemas", () => {
    const document = getOpenApiDocument();
    const queryMaximum = (path: string, method: string, name: string) => {
      const pathItem = document.paths?.[path] as OpenApiPathItem | undefined;
      const parameter = pathItem?.[method]?.parameters?.find(
        (candidate) => candidate.in === "query" && candidate.name === name,
      );

      return parameter?.schema?.maximum;
    };

    assert.equal(queryMaximum("/api/v0/search", "get", "limit"), 50);
    assert.equal(queryMaximum("/api/v0/events/upcoming", "get", "limit"), 24);
    assert.equal(queryMaximum("/api/v0/communities/{slug}/events", "get", "limit"), 24);
    assert.equal(queryMaximum("/api/v0/worlds/active", "get", "limit"), 6);
    assert.equal(queryMaximum("/api/v0/me/profiles", "get", "limit"), 100);
    assert.equal(queryMaximum("/api/v0/developer/tokens", "get", "limit"), 100);
  });

  it("documents the profile asset upload transport and protected storage probe", () => {
    const document = getOpenApiDocument();
    const completionPath = document.paths?.[
      "/api/v0/profile-assets/upload-intents/{intentId}"
    ] as OpenApiPathItem | undefined;
    const completion = completionPath?.post;
    const multipartSchema = completion?.requestBody?.content?.["multipart/form-data"]?.schema;

    assert.equal(completion?.requestBody?.required, false);
    assert.equal(multipartSchema?.type, "object");
    assert.deepEqual(multipartSchema?.required, ["file"]);
    assert.equal(multipartSchema?.properties?.file?.type, "string");
    assert.equal(multipartSchema?.properties?.file?.format, "binary");
    assert.equal(
      completion?.parameters?.some(
        (parameter) => parameter.in === "header" && parameter.name === "x-vrdex-upload-token",
      ),
      true,
    );

    const probePath = document.paths?.[
      "/api/v0/profile-assets/upload-intents/probe"
    ] as OpenApiPathItem | undefined;
    const probe = probePath?.get;

    assert.ok(probe?.responses?.["400"]);
    assert.ok(probe?.responses?.["401"]);
    assert.ok(probe?.responses?.["403"]);
    assert.ok(probe?.responses?.["429"]);
    assert.ok(probe?.responses?.["500"]);
    assert.deepEqual(probe?.security, [
      { bearerAuth: [] },
      { oauth2: ["public:read"] },
      {},
    ]);
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
  it("validates temporal requests, canonical results, and continuation metadata", () => {
    assert.deepEqual(
      TemporalParseRequestSchema.parse({
        text: "next Friday at 8pm Eastern",
        timeZone: "America/Indianapolis",
        locale: "en-US",
        country: "us",
        subdivision: "in",
        retainInput: false,
      }),
      {
        text: "next Friday at 8pm Eastern",
        timeZone: "America/Indianapolis",
        locale: "en-US",
        country: "US",
        subdivision: "IN",
        retainInput: false,
      },
    );
    assert.throws(
      () => TemporalParseRequestSchema.parse({ text: "tomorrow", timeZone: "Eastern" }),
      /timeZone/,
    );
    assert.throws(
      () => TemporalParseRequestSchema.parse({ text: "tomorrow", timeZone: "+05:30" }),
      /timeZone/,
    );
    assert.throws(
      () => TemporalParseRequestSchema.parse({ text: "tomorrow", promptOverride: "unsafe" }),
    );

    const canonical = {
      isoInstant: "2026-07-25T00:00:00.000Z",
      zonedDateTime: "2026-07-24T20:00:00-04:00[America/New_York]",
      timeZone: "America/New_York",
      precision: "datetime" as const,
      weekday: "friday" as const,
    };
    assert.equal(TemporalParseCompletedResponseSchema.parse({
      requestId: "job-1",
      status: "resolved",
      kind: "instant",
      confidence: 0.95,
      method: "trained_plan",
      epoch: 1784937600,
      canonical,
      assumptions: [],
    }).status, "resolved");
    assert.throws(() => TemporalParseCompletedResponseSchema.parse({
      requestId: "job-invalid-instant",
      status: "resolved",
      kind: "instant",
      confidence: 0.95,
      method: "trained_plan",
      assumptions: [],
    }));
    assert.throws(() => TemporalParseCompletedResponseSchema.parse({
      requestId: "job-invalid-range",
      status: "resolved",
      kind: "time_range",
      confidence: 0.95,
      method: "trained_plan",
      assumptions: [],
    }));
    assert.equal(TemporalParsePendingResponseSchema.parse({
      requestId: "job-2",
      status: "pending",
      continuationToken: "a".repeat(43),
      retryAfterSeconds: 2,
      estimatedWaitSeconds: 30,
      expiresAt: "2026-07-22T16:15:00.000Z",
    }).status, "pending");

    const document = getOpenApiDocument();
    const submit = (document.paths?.["/api/v0/time/parse"] as OpenApiPathItem | undefined)?.post;
    const continuation = (
      document.paths?.["/api/v0/time/parse/{continuationToken}"] as OpenApiPathItem | undefined
    )?.get;
    assert.ok(submit?.responses?.["200"]);
    assert.ok(submit?.responses?.["202"]);
    assert.ok(
      submit?.parameters?.some((parameter) =>
        "in" in parameter && parameter.in === "header" && parameter.name === "idempotency-key",
      ),
    );
    assert.ok(continuation?.responses?.["410"]);
    assert.deepEqual(submit?.security, [{ bearerAuth: [] }]);
    assert.match(submit?.description ?? "", /time:parse/);
    const oauthScheme = document.components?.securitySchemes?.oauth2 as {
      flows?: { authorizationCode?: { scopes?: Record<string, string> } };
    } | undefined;
    const oauthScopes = oauthScheme?.flows?.authorizationCode?.scopes;
    assert.equal(oauthScopes?.["time:parse"], undefined);
    assert.equal(oauthScopes?.["public:read"], "public:read");
  });
});
