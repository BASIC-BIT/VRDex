import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(path: string) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function expectInternalExport(path: string, name: string, kind: "internalMutation" | "internalQuery") {
  assert.match(source(path), new RegExp(`export const ${name} = ${kind}\\(`));
}

describe("server-only Convex boundary", () => {
  it("keeps broad trusted operations internal and gates the narrow preview wrappers", () => {
    expectInternalExport("convex/apiTokens.ts", "validateBearerTokenHash", "internalMutation");
    for (const name of ["createDynamicMcpClient", "upsertClientMetadataDocumentMcpClient", "completeAuthorizationConsent", "issueClientCredentialsAccessToken", "consumeAuthorizationCode", "rotateRefreshToken", "revokeClientAccessToken", "revokeClientRefreshToken", "validateAccessToken"]) {
      expectInternalExport("convex/oauthApps.ts", name, "internalMutation");
    }
    expectInternalExport("convex/oauthApps.ts", "resolveAuthorizationClient", "internalQuery");
    for (const name of ["createPreviewDynamicMcpClient", "upsertPreviewClientMetadataDocumentMcpClient"]) {
      assert.match(source("convex/oauthApps.ts"), new RegExp(`export const ${name} = mutation\\(`));
    }
    assert.match(source("convex/oauthApps.ts"), /requirePreviewPersistenceBridge\(args\.bridgeSecret\)/);
    expectInternalExport("convex/hostedSmokeFixtures.ts", "ensurePublicSearchFixture", "internalMutation");
    assert.match(source("convex/hostedSmokeFixtures.ts"), /requireHostedSmokeFixture\(\)/);
    assert.doesNotMatch(source("convex/oauthApps.ts"), /export const issueAuthorizationCode = mutation\(/);
    assert.doesNotMatch(source("convex/oauthConsentTransactions.ts"), /export const consume = mutation\(/);
  });

  it("uses the admin/internal boundary from every trusted-server call site", () => {
    const expectedReferences = new Map([
      ["apps/web/src/app/oauth/token/route.ts", ["convexAdminHttpClient", "internal.oauthApps.consumeAuthorizationCode", "internal.oauthApps.issueClientCredentialsAccessToken", "internal.oauthApps.rotateRefreshToken"]],
      ["apps/web/src/app/oauth/revoke/route.ts", ["convexAdminHttpClient", "internal.oauthApps.revokeClientAccessToken", "internal.oauthApps.revokeClientRefreshToken"]],
      ["apps/web/src/app/oauth/authorize/route.ts", ["convexAdminHttpClient", "upsertClientMetadataDocumentMcpClient", "internal.oauthApps.resolveAuthorizationClient"]],
      ["apps/web/src/app/oauth/authorize/review/page.tsx", ["convexAdminHttpClient", "internal.oauthApps.resolveAuthorizationClient"]],
      ["apps/web/src/app/oauth/authorize/consent/route.ts", ["convexAdminHttpClient", "internal.oauthApps.completeAuthorizationConsent"]],
      ["apps/web/src/lib/server/oauth-dynamic-client-registration.ts", ["createDynamicMcpClient"]],
      ["apps/web/src/lib/server/oauth-dynamic-client-persistence.ts", ["convexAdminHttpClient", "internal.oauthApps.createDynamicMcpClient", "internal.oauthApps.upsertClientMetadataDocumentMcpClient", "api.oauthApps.createPreviewDynamicMcpClient", "api.oauthApps.upsertPreviewClientMetadataDocumentMcpClient"]],
      ["apps/web/src/lib/server/api-v0.ts", ["convexAdminHttpClient", "internal.apiTokens.validateBearerTokenHash", "internal.oauthApps.validateAccessToken"]],
      ["apps/web/src/lib/server/vrdex-mcp.ts", ["convexAdminHttpClient", "internal.oauthApps.validateAccessToken"]],
    ]);
    for (const [path, references] of expectedReferences) {
      const file = source(path);
      for (const reference of references) {
        assert.match(file, new RegExp(reference.replaceAll(".", "\\.")));
      }
    }
  });
});
