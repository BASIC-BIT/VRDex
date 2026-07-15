import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { oauthConsentSummary, oauthScopeLabel } from "../../apps/web/src/lib/oauth-consent-copy";

describe("OAuth consent copy", () => {
  it("describes account and write access without presenting it as public read-only access", () => {
    assert.equal(oauthConsentSummary, "This app is requesting access to your VRDex account.");
    assert.equal(oauthScopeLabel("profile:write"), "Edit your profiles");
    assert.equal(oauthScopeLabel("community:write"), "Manage your communities");
    assert.equal(oauthScopeLabel("events:write"), "Create and edit your events");
    assert.equal(oauthScopeLabel("assets:write"), "Upload and manage profile assets");
    assert.equal(
      oauthScopeLabel("developer:write"),
      "Create, update, and revoke developer credentials and OAuth apps",
    );
    assert.equal(oauthScopeLabel("future:scope"), "future:scope");
  });
});
