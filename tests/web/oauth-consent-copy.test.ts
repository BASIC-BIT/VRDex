import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { oauthApiScopes } from "../../packages/api-contracts/src/auth";
import { oauthConsentSummary, oauthScopeLabel } from "../../apps/web/src/lib/oauth-consent-copy";

describe("OAuth consent copy", () => {
  it("gives every grantable scope a sentence rather than its own identifier", () => {
    // The fallback returns the raw scope, so a scope added without a label fails
    // nowhere -- it just puts `profile:contribute` in front of a user being asked
    // to approve it. Adding a scope is exactly when this is easiest to forget,
    // which is why this enumerates instead of spot-checking.
    for (const scope of oauthApiScopes) {
      const label = oauthScopeLabel(scope);

      assert.notEqual(label, scope, `Scope ${scope} has no consent label.`);
      assert.match(label, /^[A-Z]/, `Scope ${scope} label should read as a sentence.`);
    }
  });

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
