import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { siteRelativeRedirectUrl } from "../../convex/_authRedirects";

describe("auth redirects", () => {
  it("expands relative redirects under SITE_URL", () => {
    assert.equal(siteRelativeRedirectUrl("/account", "https://staging.vrdex.net"), "https://staging.vrdex.net/account");
    assert.equal(siteRelativeRedirectUrl("/account", "https://staging.vrdex.net/"), "https://staging.vrdex.net/account");
  });

  it("rejects protocol-relative and absolute redirects", () => {
    assert.throws(() => siteRelativeRedirectUrl("//evil.example", "https://staging.vrdex.net"), /Only relative redirects/);
    assert.throws(() => siteRelativeRedirectUrl("https://evil.example", "https://staging.vrdex.net"), /Only relative redirects/);
  });

  it("requires SITE_URL for relative redirects", () => {
    assert.throws(() => siteRelativeRedirectUrl("/account", ""), /SITE_URL/);
  });
});
