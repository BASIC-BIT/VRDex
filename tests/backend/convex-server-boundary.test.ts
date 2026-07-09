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
  it("does not expose trusted HTTP operations through the public Convex API", () => {
    expectInternalExport("convex/apiTokens.ts", "validateBearerTokenHash", "internalMutation");
    for (const name of ["createDynamicMcpClient", "upsertClientMetadataDocumentMcpClient", "issueClientCredentialsAccessToken", "consumeAuthorizationCode", "rotateRefreshToken", "revokeClientAccessToken", "revokeClientRefreshToken", "validateAccessToken"]) {
      expectInternalExport("convex/oauthApps.ts", name, "internalMutation");
    }
    expectInternalExport("convex/oauthApps.ts", "resolveAuthorizationClient", "internalQuery");
    assert.match(source("convex/oauthApps.ts"), /export const issueAuthorizationCode = mutation\(/);
  });

  it("uses the admin/internal boundary from every trusted-server call site", () => {
    const expectedReferences = new Map([
      ["apps/web/src/app/oauth/token/route.ts", ["convexAdminHttpClient", "internal.oauthApps.consumeAuthorizationCode", "internal.oauthApps.issueClientCredentialsAccessToken", "internal.oauthApps.rotateRefreshToken"]],
      ["apps/web/src/app/oauth/revoke/route.ts", ["convexAdminHttpClient", "internal.oauthApps.revokeClientAccessToken", "internal.oauthApps.revokeClientRefreshToken"]],
      ["apps/web/src/app/oauth/authorize/page.tsx", ["convexAdminHttpClient", "internal.oauthApps.upsertClientMetadataDocumentMcpClient", "internal.oauthApps.resolveAuthorizationClient"]],
      ["apps/web/src/lib/server/oauth-dynamic-client-registration.ts", ["convexAdminHttpClient", "internal.oauthApps.createDynamicMcpClient"]],
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