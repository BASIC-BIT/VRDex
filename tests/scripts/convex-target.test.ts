import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveConvexTarget } from "../../scripts/convex-target";

describe("convex target resolution", () => {
  const configured = {
    CONVEX_DEPLOYMENT_DEV: "dev:scrupulous-corgi-247",
    CONVEX_DEPLOY_KEY_DEV: "dev-key",
    CONVEX_DEPLOYMENT_PROD: "prod:superb-pig-954",
    CONVEX_DEPLOY_KEY_PROD: "prod-key",
  };

  it("resolves each target to its own deployment and key", () => {
    const dev = resolveConvexTarget("dev", configured);
    const prod = resolveConvexTarget("prod", configured);

    assert.equal(dev.ok && dev.deployment, "dev:scrupulous-corgi-247");
    assert.equal(dev.ok && dev.key, "dev-key");
    assert.equal(prod.ok && prod.deployment, "prod:superb-pig-954");
    assert.equal(prod.ok && prod.key, "prod-key");
  });

  it("never falls back to another target's credentials", () => {
    // The whole point of the wrapper: a missing dev key must fail loudly rather
    // than inherit the production one that happens to be in the same file.
    const result = resolveConvexTarget("dev", {
      CONVEX_DEPLOYMENT_PROD: configured.CONVEX_DEPLOYMENT_PROD,
      CONVEX_DEPLOY_KEY_PROD: configured.CONVEX_DEPLOY_KEY_PROD,
    });

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /CONVEX_DEPLOYMENT_DEV and CONVEX_DEPLOY_KEY_DEV/);
  });

  it("rejects an unknown target instead of guessing one", () => {
    const result = resolveConvexTarget("production", configured);

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /Unknown target "production"/);
  });
});
