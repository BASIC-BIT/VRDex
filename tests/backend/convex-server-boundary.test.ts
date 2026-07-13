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

function expectGuardedMutation(path: string, name: string, guard: string) {
  const file = source(path);
  const start = file.indexOf(`export const ${name} = mutation(`);
  const end = file.indexOf("\nexport const ", start + 1);

  assert.notEqual(start, -1, `${name} must remain a public mutation`);
  assert.match(file.slice(start, end === -1 ? undefined : end), new RegExp(`${guard}\\(args\\.bridgeSecret\\)`));
}

describe("server-only Convex boundary", () => {
  it("keeps broad trusted operations internal and gates the narrow preview wrappers", () => {
    expectInternalExport("convex/apiTokens.ts", "validateBearerTokenHash", "internalMutation");
    for (const name of ["createDynamicMcpClient", "upsertClientMetadataDocumentMcpClient", "completeAuthorizationConsent", "issueClientCredentialsAccessToken", "consumeAuthorizationCode", "rotateRefreshToken", "revokeClientAccessToken", "revokeClientRefreshToken", "validateAccessToken"]) {
      expectInternalExport("convex/oauthApps.ts", name, "internalMutation");
    }
    expectInternalExport("convex/oauthApps.ts", "resolveAuthorizationClient", "internalQuery");
    for (const name of ["createPreviewDynamicMcpClient", "upsertPreviewClientMetadataDocumentMcpClient"]) {
      expectGuardedMutation("convex/oauthApps.ts", name, "requirePreviewPersistenceBridge");
    }
    expectGuardedMutation(
      "convex/oauthApps.ts",
      "issuePreviewClientCredentialsAccessToken",
      "requirePreviewClientCredentialsBridge",
    );
    expectGuardedMutation(
      "convex/oauthApps.ts",
      "validatePreviewAccessToken",
      "requirePreviewClientCredentialsBridge",
    );
    expectInternalExport("convex/hostedSmokeFixtures.ts", "ensurePublicSearchFixture", "internalMutation");
    assert.match(source("convex/hostedSmokeFixtures.ts"), /requireHostedSmokeFixture\(\)/);
    assert.doesNotMatch(source("convex/oauthApps.ts"), /export const issueAuthorizationCode = mutation\(/);
    assert.doesNotMatch(source("convex/oauthConsentTransactions.ts"), /export const consume = mutation\(/);
  });

  it("uses the admin/internal boundary from every trusted-server call site", () => {
    const expectedReferences = new Map([
      ["apps/web/src/app/oauth/token/route.ts", ["convexAdminHttpClient", "internal.oauthApps.consumeAuthorizationCode", "issueClientCredentialsAccessToken", "internal.oauthApps.rotateRefreshToken"]],
      ["apps/web/src/app/oauth/revoke/route.ts", ["convexAdminHttpClient", "internal.oauthApps.revokeClientAccessToken", "internal.oauthApps.revokeClientRefreshToken"]],
      ["apps/web/src/app/oauth/authorize/route.ts", ["convexAdminHttpClient", "upsertClientMetadataDocumentMcpClient", "internal.oauthApps.resolveAuthorizationClient"]],
      ["apps/web/src/app/oauth/authorize/review/page.tsx", ["convexAdminHttpClient", "internal.oauthApps.resolveAuthorizationClient"]],
      ["apps/web/src/app/oauth/authorize/consent/route.ts", ["convexAdminHttpClient", "internal.oauthApps.completeAuthorizationConsent"]],
      ["apps/web/src/lib/server/oauth-dynamic-client-registration.ts", ["createDynamicMcpClient"]],
      ["apps/web/src/lib/server/oauth-dynamic-client-persistence.ts", ["convexAdminHttpClient", "internal.oauthApps.createDynamicMcpClient", "internal.oauthApps.upsertClientMetadataDocumentMcpClient", "internal.oauthApps.issueClientCredentialsAccessToken", "internal.oauthApps.validateAccessToken", "api.oauthApps.createPreviewDynamicMcpClient", "api.oauthApps.upsertPreviewClientMetadataDocumentMcpClient", "api.oauthApps.issuePreviewClientCredentialsAccessToken", "api.oauthApps.validatePreviewAccessToken"]],
      ["apps/web/src/lib/server/api-v0.ts", ["convexAdminHttpClient", "internal.apiTokens.validateBearerTokenHash", "validateOAuthAccessTokenRecord"]],
      ["apps/web/src/lib/server/vrdex-mcp.ts", ["convexAdminHttpClient", "validateOAuthAccessTokenRecord"]],
    ]);
    for (const [path, references] of expectedReferences) {
      const file = source(path);
      for (const reference of references) {
        assert.match(file, new RegExp(reference.replaceAll(".", "\\.")));
      }
    }

    assert.doesNotMatch(
      source("apps/web/src/app/oauth/token/route.ts"),
      /internal\.oauthApps\.issueClientCredentialsAccessToken/,
    );
  });
});
