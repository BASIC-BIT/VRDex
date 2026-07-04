import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBearerTokenQueryProblem,
  createPublicNotFoundProblem,
  getBearerTokenFromAuthorizationHeader,
  getOpenApiDocument,
  hasBearerTokenInUrl,
  PublicActiveWorldSchema,
  PublicEventSchema,
  PublicProfileSchema,
  PublicSearchResponseSchema,
  PublicWorldSchema,
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

  it("includes the first public API paths in the generated OpenAPI document", () => {
    const document = getOpenApiDocument();

    assert.equal(document.openapi, "3.1.0");
    assert.ok(document.paths?.["/api/v0/openapi.json"]);
    assert.ok(document.paths?.["/api/v0/search"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/assets"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/logos"]);
    assert.ok(document.paths?.["/api/v0/people/{slug}"]);
    assert.ok(document.paths?.["/api/v0/people/{slug}/events"]);
    assert.ok(document.paths?.["/api/v0/communities/{slug}"]);
    assert.ok(document.paths?.["/api/v0/communities/{slug}/events"]);
    assert.ok(document.paths?.["/api/v0/events/{slug}"]);
    assert.ok(document.paths?.["/api/v0/events/upcoming"]);
    assert.ok(document.paths?.["/api/v0/worlds/{slug}"]);
    assert.ok(document.paths?.["/api/v0/worlds/active"]);
    assert.ok(document.paths?.["/api/v0/claims/{slug}/status"]);
  });
});
