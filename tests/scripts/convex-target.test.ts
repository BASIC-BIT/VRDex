import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveConvexTarget } from "../../scripts/convex-target";

describe("convex target resolution", () => {
  const configured = {
    CONVEX_DEPLOYMENT: "anonymous:anonymous-agent",
    CONVEX_URL: "http://127.0.0.1:3210",
    CONVEX_DEPLOYMENT_DEV: "dev:scrupulous-corgi-247",
    CONVEX_DEPLOY_KEY_DEV: "dev-key",
    CONVEX_DEPLOYMENT_PROD: "prod:superb-pig-954",
    CONVEX_DEPLOY_KEY_PROD: "prod-key",
  };

  const error = (result: ReturnType<typeof resolveConvexTarget>) =>
    result.ok === false ? result.error : "";

  it("resolves each target to its own deployment and key", () => {
    const dev = resolveConvexTarget("dev", configured);
    const prod = resolveConvexTarget("prod", configured);

    assert.equal(dev.ok && dev.deployment, "dev:scrupulous-corgi-247");
    assert.equal(dev.ok && dev.key, "dev-key");
    assert.equal(prod.ok && prod.deployment, "prod:superb-pig-954");
    assert.equal(prod.ok && prod.key, "prod-key");
  });

  it("gives local the env file's deployment and url, and no deploy key", () => {
    // local is the default for the seed scripts, so it must be pinned to the
    // file rather than inheriting a shell that still holds production values.
    const local = resolveConvexTarget("local", configured);

    assert.equal(local.ok && local.deployment, "anonymous:anonymous-agent");
    assert.equal(local.ok && local.key, undefined);
    assert.deepEqual(local.ok && local.passthrough, { CONVEX_URL: "http://127.0.0.1:3210" });
  });

  it("rejects a deployment that contradicts the selected target", () => {
    // A production pair pasted under the _DEV names must not run as "dev".
    const result = resolveConvexTarget("dev", {
      ...configured,
      CONVEX_DEPLOYMENT_DEV: "prod:superb-pig-954",
    });

    assert.equal(result.ok, false);
    assert.match(error(result), /does not start with "dev:"/);
  });

  it("rejects a cloud deployment under the local variable", () => {
    const result = resolveConvexTarget("local", {
      ...configured,
      CONVEX_DEPLOYMENT: "prod:superb-pig-954",
    });

    assert.equal(result.ok, false);
    assert.match(error(result), /does not start with "anonymous:" or "local:"/);
  });

  it("never falls back to another target's credentials", () => {
    const result = resolveConvexTarget("dev", {
      CONVEX_DEPLOYMENT_PROD: configured.CONVEX_DEPLOYMENT_PROD,
      CONVEX_DEPLOY_KEY_PROD: configured.CONVEX_DEPLOY_KEY_PROD,
    });

    assert.equal(result.ok, false);
    assert.match(error(result), /CONVEX_DEPLOYMENT_DEV and CONVEX_DEPLOY_KEY_DEV/);
  });

  it("rejects an unknown target instead of guessing one", () => {
    const result = resolveConvexTarget("production", configured);

    assert.equal(result.ok, false);
    assert.match(error(result), /Unknown target "production"/);
  });
});
