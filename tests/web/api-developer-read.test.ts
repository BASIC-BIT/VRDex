import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runDeveloperReadProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      VRDEX_RATE_LIMIT_STORE: "memory",
    },
  });
}

describe("developer read API authority", () => {
  it("maps user-owned personal tokens and user-delegated OAuth tokens to a developer owner", () => {
    const output = runDeveloperReadProbe(`
      import assert from "node:assert/strict";
      import { developerReadAuthorityForCredential } from "./apps/web/src/lib/server/api-developer-read.ts";

      assert.deepEqual(
        developerReadAuthorityForCredential({
          kind: "api_token",
          ownerKind: "user",
          ownerUserId: "user_123",
          scopes: ["developer:read"],
          tokenId: "token_123",
          trustTier: "personal",
        }),
        { ok: true, ownerUserId: "user_123", source: "personal_api_token" },
      );

      assert.deepEqual(
        developerReadAuthorityForCredential({
          kind: "oauth",
          clientId: "vrdx_app_000000000000000000000000",
          scopes: ["developer:read"],
          subjectType: "user",
          trustTier: "standard",
          userId: "user_456",
        }),
        { ok: true, ownerUserId: "user_456", source: "user_delegated_oauth" },
      );

      console.log("ok");
    `);

    assert.match(output, /ok/);
  });

  it("does not treat anonymous, community-owned, or app-only credentials as user authority", () => {
    const output = runDeveloperReadProbe(`
      import assert from "node:assert/strict";
      import { developerReadAuthorityForCredential } from "./apps/web/src/lib/server/api-developer-read.ts";

      assert.deepEqual(
        developerReadAuthorityForCredential({ kind: "anonymous" }),
        { ok: false, reason: "anonymous" },
      );

      assert.deepEqual(
        developerReadAuthorityForCredential({
          kind: "api_token",
          ownerCommunityProfileId: "profile_123",
          ownerKind: "community",
          ownerUserId: "user_123",
          scopes: ["developer:read"],
          tokenId: "token_123",
          trustTier: "personal",
        }),
        { ok: false, reason: "non_user_authority" },
      );

      assert.deepEqual(
        developerReadAuthorityForCredential({
          kind: "oauth",
          applicationId: "application_123",
          clientId: "vrdx_app_000000000000000000000000",
          ownerKind: "user",
          ownerUserId: "user_123",
          scopes: ["developer:read"],
          subjectType: "client",
          trustTier: "standard",
        }),
        { ok: false, reason: "non_user_authority" },
      );

      console.log("ok");
    `);

    assert.match(output, /ok/);
  });

  it("requires a bearer credential on developer token lists", () => {
    const output = runDeveloperReadProbe(`
      import { GET } from "./apps/web/src/app/api/v0/developer/tokens/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/developer/tokens"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^401/m);
    assert.match(output, /"title":"Bearer token required"/);
  });

  it("rejects bearer-token query parameters on developer OAuth app lists", () => {
    const output = runDeveloperReadProbe(`
      import { GET } from "./apps/web/src/app/api/v0/developer/oauth-apps/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/developer/oauth-apps?api_token=secret"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });

  it("requires a bearer credential on developer token creation", () => {
    const output = runDeveloperReadProbe(`
      import { POST } from "./apps/web/src/app/api/v0/developer/tokens/route.ts";

      const response = await POST(new Request("https://app.example.test/api/v0/developer/tokens", {
        method: "POST",
        body: JSON.stringify({ label: "Local MCP" }),
      }));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^401/m);
    assert.match(output, /"title":"Bearer token required"/);
  });

  it("requires a bearer credential on developer token revocation", () => {
    const output = runDeveloperReadProbe(`
      import { DELETE } from "./apps/web/src/app/api/v0/developer/tokens/[tokenId]/route.ts";

      const response = await DELETE(
        new Request("https://app.example.test/api/v0/developer/tokens/token_123", { method: "DELETE" }),
        { params: Promise.resolve({ tokenId: "token_123" }) },
      );
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^401/m);
    assert.match(output, /"title":"Bearer token required"/);
  });

  it("rejects bearer-token query parameters on developer OAuth app revocation", () => {
    const output = runDeveloperReadProbe(`
      import { DELETE } from "./apps/web/src/app/api/v0/developer/oauth-apps/[clientId]/route.ts";

      const response = await DELETE(
        new Request("https://app.example.test/api/v0/developer/oauth-apps/vrdx_app_000000000000000000000000?token=secret", { method: "DELETE" }),
        { params: Promise.resolve({ clientId: "vrdx_app_000000000000000000000000" }) },
      );
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });
});
