import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createPublicNotFoundProblem,
  getBearerTokenFromAuthorizationHeader,
  getOpenApiDocument,
  hasBearerTokenInUrl,
  PublicProfileSchema,
} from "../src";

describe("@vrdex/api-contracts", () => {
  it("parses public profiles while preserving future response fields", () => {
    const profile = PublicProfileSchema.parse({
      displayName: "VRDex",
      futureField: "kept",
      profileType: "community",
      slug: "vrdex",
      trustLabel: "verified",
    });

    assert.equal((profile as { futureField?: string }).futureField, "kept");
  });

  it("creates RFC 9457-compatible problem details", () => {
    assert.deepEqual(createPublicNotFoundProblem("Profile"), {
      type: "about:blank",
      title: "Profile not found",
      status: 404,
      detail: "The requested public resource was not found.",
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
    assert.ok(document.paths?.["/api/v0/profiles/{slug}"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/assets"]);
    assert.ok(document.paths?.["/api/v0/profiles/{slug}/logos"]);
  });
});
