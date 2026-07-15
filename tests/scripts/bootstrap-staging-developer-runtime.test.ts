import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGING_DEVELOPER_RUNTIME_VARIABLE_NAMES,
  createStagingDeveloperRuntimeValues,
  parseArguments,
  parseConvexDeploymentToken,
} from "../../scripts/bootstrap-staging-developer-runtime.mjs";

test("parseConvexDeploymentToken extracts the deployment token without accepting an unrelated file", () => {
  assert.equal(
    parseConvexDeploymentToken("# generated locally\nCONVEX_DEPLOY_KEY=preview:staging-token\n"),
    "preview:staging-token",
  );
  assert.throws(() => parseConvexDeploymentToken("CONVEX_URL=https://example.test\n"));
});

test("createStagingDeveloperRuntimeValues creates the complete non-Redis staging contract", () => {
  const values = createStagingDeveloperRuntimeValues({
    convexDeploymentToken: "deployment-token-sentinel",
    stagingOrigin: "https://staging.example.test/path-that-must-be-removed",
  });

  assert.deepEqual([...values.keys()], [...STAGING_DEVELOPER_RUNTIME_VARIABLE_NAMES]);
  assert.equal(values.get("CONVEX_ADMIN_TOKEN"), "deployment-token-sentinel");
  assert.equal(values.get("VRDEX_DEPLOYMENT_ENV"), "staging");
  assert.equal(values.get("VRDEX_OAUTH_ISSUER_URL"), "https://staging.example.test");
  assert.equal(values.get("VRDEX_PUBLIC_API_BASE_URL"), "https://staging.example.test");
  assert.equal(values.get("VRDEX_MCP_RESOURCE_URI"), "https://staging.example.test/mcp");
  assert.match(values.get("VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY") ?? "", /BEGIN PRIVATE KEY/);

  const peppers = [
    values.get("VRDEX_API_TOKEN_PEPPER"),
    values.get("VRDEX_OAUTH_CLIENT_SECRET_PEPPER"),
    values.get("VRDEX_OAUTH_REFRESH_TOKEN_PEPPER"),
  ];
  assert.equal(new Set(peppers).size, peppers.length);
  assert.ok(peppers.every((pepper) => /^[a-f0-9]{64}$/.test(pepper ?? "")));
  assert.equal([...values.keys()].some((name) => name.includes("REDIS")), false);
});

test("parseArguments requires an explicit mutating gate and both local input paths", () => {
  assert.throws(() => parseArguments([]), /--apply is required/);
  assert.throws(() => parseArguments(["--apply"]), /--convex-token-env-file/);
  assert.throws(
    () => parseArguments(["--apply", "--convex-token-env-file", "token.env"]),
    /--linked-vercel-directory/,
  );

  assert.deepEqual(
    parseArguments([
      "--apply",
      "--convex-token-env-file",
      "token.env",
      "--linked-vercel-directory",
      ".vercel-link",
      "--staging-origin",
      "https://staging.example.test/path",
    ]),
    {
      apply: true,
      convexTokenEnvFile: "token.env",
      linkedVercelDirectory: ".vercel-link",
      stagingOrigin: "https://staging.example.test",
    },
  );
});
