import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveConvexTarget,
  resolveTargetName,
  targetSelectorFlagError,
} from "../../scripts/convex-target";

describe("target name parsing", () => {
  it("accepts both the separate and equals forms", () => {
    // The equals form used to fall through to the local default, so an
    // explicit-looking --target=prod publication completed against local.
    assert.deepEqual(resolveTargetName(["--target", "prod"]), { name: "prod" });
    assert.deepEqual(resolveTargetName(["--apply", "--target=prod"]), { name: "prod" });
  });

  it("defaults to local only when no target is given at all", () => {
    assert.deepEqual(resolveTargetName(["--apply"]), { name: "local" });
  });

  it("treats an empty target as an error rather than a default", () => {
    assert.match(
      (resolveTargetName(["--target", "--apply"]) as { error: string }).error,
      /--target needs a value/,
    );
    assert.match(
      (resolveTargetName(["--target="]) as { error: string }).error,
      /--target needs a value/,
    );
  });
});

describe("target selector flags", () => {
  const help = "Use --target.";

  it("rejects every flag that could point the command elsewhere", () => {
    // --target defaults to local, so ignoring a leftover --prod would publish
    // locally and report success; forwarding one through cx would override the
    // target after the banner had already named it.
    for (const flag of [
      "--prod",
      "--deployment",
      "--preview-name",
      "--url",
      "--admin-key",
      // How dev:backend:local selects the anonymous backend, so forwarding it
      // would pair production credentials with a local deployment.
      "--local",
    ]) {
      assert.match(targetSelectorFlagError(["--apply", flag], help) ?? "", /is not accepted here/);
    }

    assert.match(
      targetSelectorFlagError(["--prod", "--deployment", "x"], help) ?? "",
      /--prod and --deployment are not accepted here/,
    );
  });

  it("catches the --flag=value form too", () => {
    assert.match(
      targetSelectorFlagError(["--deployment=prod:superb-pig-954"], help) ?? "",
      /--deployment is not accepted here/,
    );
  });

  it("passes a modern invocation through", () => {
    assert.equal(targetSelectorFlagError(["--target", "prod", "--apply"], help), undefined);
  });
});

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

  it("rejects a deploy key issued for a different deployment", () => {
    // CONVEX_DEPLOY_KEY alone is enough for the CLI to pick a deployment, so a
    // correctly named dev deployment with a production key would authenticate
    // to production while the banner read "development".
    const result = resolveConvexTarget("dev", {
      ...configured,
      CONVEX_DEPLOY_KEY_DEV: "prod:superb-pig-954|secret",
    });

    assert.equal(result.ok, false);
    assert.match(error(result), /key for "prod:superb-pig-954", but CONVEX_DEPLOYMENT_DEV/);
    assert.doesNotMatch(error(result), /secret/);
  });

  it("accepts a deploy key naming the selected deployment", () => {
    const result = resolveConvexTarget("prod", {
      ...configured,
      CONVEX_DEPLOY_KEY_PROD: "prod:superb-pig-954|secret",
    });

    assert.equal(result.ok, true);
  });

  it("leaves a key in an unrecognized shape alone", () => {
    // Older keys carry no deployment, and guessing at one would break them.
    assert.equal(resolveConvexTarget("prod", configured).ok, true);
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
