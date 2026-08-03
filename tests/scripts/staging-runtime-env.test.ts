import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import {
  STAGING_BASE_ENVIRONMENT_NAMES,
  STAGING_DEVELOPER_PLATFORM_ENVIRONMENT_NAMES,
  configuredEnvironmentNames,
  missingStagingEnvironmentNames,
  parseVercelEnvironmentPayload,
} from "../../scripts/check-staging-runtime-env.mjs";

function runStagingEnvironmentCli(names: readonly string[], requireDeveloperCredentials = false) {
  const directory = mkdtempSync(join(tmpdir(), "vrdex-staging-runtime-env-"));
  const inputPath = join(directory, "vercel-env.json");
  const args = ["scripts/check-staging-runtime-env.mjs", "--input", inputPath, "--git-branch", "main"];

  if (requireDeveloperCredentials) {
    args.push("--require-developer-credentials");
  }

  writeFileSync(
    inputPath,
    JSON.stringify({
      env: names.map((key) => ({ key, value: "secret-sentinel-must-not-print" })),
    }),
  );

  try {
    return spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("configuredEnvironmentNames extracts names without depending on values", () => {
  const names = configuredEnvironmentNames([
    { key: "ALPHA", value: "must-not-be-used" },
    { key: " BETA ", value: "must-not-be-used" },
  ]);

  assert.deepEqual([...names].sort(), ["ALPHA", "BETA"]);
});

test("configuredEnvironmentNames accepts the pinned Vercel CLI wrapper", () => {
  const names = configuredEnvironmentNames({
    env: [{ key: "ALPHA" }, { name: "BETA" }],
  });

  assert.deepEqual([...names].sort(), ["ALPHA", "BETA"]);
});

test("configuredEnvironmentNames ignores records scoped to another branch", () => {
  const names = configuredEnvironmentNames(
    {
      envs: [
        { key: "GLOBAL", target: [] },
        { key: "MAIN_ONLY", gitBranch: "main" },
        { key: "OTHER_ONLY", gitBranch: "other" },
      ],
    },
    { gitBranch: "main" },
  );

  assert.deepEqual([...names].sort(), ["GLOBAL", "MAIN_ONLY"]);
});

test("configuredEnvironmentNames accepts legacy wrapper names", () => {
  const names = configuredEnvironmentNames({
    envs: [{ key: "ALPHA" }],
  });

  assert.deepEqual([...names], ["ALPHA"]);
});

test("parseVercelEnvironmentPayload tolerates a UTF-8 BOM", () => {
  assert.deepEqual(parseVercelEnvironmentPayload('\uFEFF{"env":[]}'), { env: [] });
});

test("configuredEnvironmentNames rejects unknown JSON shapes", () => {
  assert.throws(
    () => configuredEnvironmentNames({ environment: "staging" }),
    /must be an array or contain an environment-variable array/,
  );
});

test("base staging contract excludes optional settings and developer credentials", () => {
  const configured = new Set(STAGING_BASE_ENVIRONMENT_NAMES);

  assert.equal(STAGING_BASE_ENVIRONMENT_NAMES.includes("VRDEX_RATE_LIMIT_REDIS_PREFIX"), false);
  assert.equal(STAGING_BASE_ENVIRONMENT_NAMES.includes("VRDEX_REQUIRE_CONVEX_URL"), false);
  assert.deepEqual(missingStagingEnvironmentNames(configured), []);
  assert.deepEqual(
    missingStagingEnvironmentNames(configured, { requireDeveloperCredentials: true }),
    STAGING_DEVELOPER_PLATFORM_ENVIRONMENT_NAMES,
  );
});

test("developer credential gate requires auth helpers plus the API and OAuth contract", () => {
  assert.ok(
    STAGING_DEVELOPER_PLATFORM_ENVIRONMENT_NAMES.includes("VRDEX_ENABLE_E2E_AUTH_HELPERS"),
  );

  const configured = new Set([
    ...STAGING_BASE_ENVIRONMENT_NAMES,
    ...STAGING_DEVELOPER_PLATFORM_ENVIRONMENT_NAMES,
  ]);

  assert.deepEqual(
    missingStagingEnvironmentNames(configured, { requireDeveloperCredentials: true }),
    [],
  );
});

test("CLI accepts base and complete developer contracts without printing values", () => {
  const baseResult = runStagingEnvironmentCli(STAGING_BASE_ENVIRONMENT_NAMES);
  assert.equal(baseResult.status, 0, baseResult.stderr);
  assert.doesNotMatch(baseResult.stdout + baseResult.stderr, /secret-sentinel-must-not-print/);

  const developerResult = runStagingEnvironmentCli(
    [...STAGING_BASE_ENVIRONMENT_NAMES, ...STAGING_DEVELOPER_PLATFORM_ENVIRONMENT_NAMES],
    true,
  );
  assert.equal(developerResult.status, 0, developerResult.stderr);
  assert.doesNotMatch(
    developerResult.stdout + developerResult.stderr,
    /secret-sentinel-must-not-print/,
  );
});

test("CLI fails developer mode when a runtime prerequisite is missing", () => {
  const configured = [
    ...STAGING_BASE_ENVIRONMENT_NAMES,
    ...STAGING_DEVELOPER_PLATFORM_ENVIRONMENT_NAMES.filter(
      (name) => name !== "VRDEX_ENABLE_E2E_AUTH_HELPERS",
    ),
  ];
  const result = runStagingEnvironmentCli(configured, true);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /VRDEX_ENABLE_E2E_AUTH_HELPERS/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-sentinel-must-not-print/);
});

test("staging deploy parses and audits main before provider mutation", () => {
  const workflow = readFileSync(".github/workflows/staging-deploy.yml", "utf8");
  const parsed = parseYaml(workflow) as {
    jobs?: {
      "deploy-staging"?: {
        steps?: Array<{
          name?: string;
          env?: Record<string, string>;
          run?: string;
        }>;
      };
    };
  };
  const steps = parsed.jobs?.["deploy-staging"]?.steps;
  assert.ok(Array.isArray(steps));

  const auditIndex = steps.findIndex(
    (step) => step.name === "Audit Vercel staging runtime variable names",
  );
  const convexDeployIndex = steps.findIndex(
    (step) => step.name === "Deploy Convex development functions",
  );
  const fixtureIndex = steps.findIndex(
    (step) => step.name === "Ensure staging public smoke fixture",
  );
  const vercelDeployIndex = steps.findIndex(
    (step) => step.name === "Deploy Vercel staging",
  );
  const authConfigIndex = steps.findIndex(
    (step) => step.name === "Provision Convex auth configuration",
  );
  const auditStep = steps[auditIndex];

  assert.ok(auditIndex >= 0);
  assert.ok(convexDeployIndex > auditIndex);
  assert.ok(fixtureIndex > convexDeployIndex);
  assert.ok(vercelDeployIndex > fixtureIndex);

  // Strictly before the deploy, not merely present. `auth.config.ts` reads
  // CLERK_JWT_ISSUER_DOMAIN at push time and the CLI refuses to push while it is
  // unset, so provisioning it alongside the post-deploy fixture variables would
  // never get the chance to run. That ordering is the whole fix, so assert it
  // rather than trust it.
  assert.ok(authConfigIndex >= 0);
  assert.ok(authConfigIndex < convexDeployIndex);
  assert.match(steps[authConfigIndex]?.run ?? "", /convex env set CLERK_JWT_ISSUER_DOMAIN/);
  assert.equal(
    steps[authConfigIndex]?.env?.CLERK_JWT_ISSUER_DOMAIN,
    "${{ vars.VRDEX_STAGING_CLERK_JWT_ISSUER_DOMAIN }}",
  );
  // Absence fails the job. Adding it to `missing` instead would write
  // `enabled=false` and exit 0, turning a frozen staging environment into a
  // green workflow — a quieter version of the outage this check exists to stop.
  assert.doesNotMatch(workflow, /missing\+=\("VRDEX_STAGING_CLERK_JWT_ISSUER_DOMAIN"\)/);
  assert.match(
    workflow,
    /VRDEX_STAGING_CLERK_JWT_ISSUER_DOMAIN is not set[\s\S]*?exit 1/,
  );

  // Convex's issuer and Vercel's publishable key are configured independently,
  // so a mismatch deploys cleanly and then rejects every signed-in request.
  const preCheckIndex = steps.findIndex(
    (step) => step.name === "Verify the staging Clerk issuer before mutating Convex",
  );
  const keyCheckIndex = steps.findIndex(
    (step) => step.name === "Verify the staging Clerk key matches the Convex issuer",
  );

  // Before the `env set`, not merely present. A check that runs after the
  // deploys reports the mismatch only once staging is already broken, because
  // the issuer has been written to the shared Convex deployment by then.
  assert.ok(preCheckIndex >= 0);
  assert.ok(preCheckIndex < authConfigIndex);
  assert.match(steps[preCheckIndex]?.run ?? "", /check-clerk-issuer-match\.mjs/);
  // Inconclusive rather than fatal when the target serves no key at all: that is
  // the pre-Clerk-build outage this workflow has to remain able to fix.
  assert.match(steps[preCheckIndex]?.run ?? "", /--allow-missing-key/);

  // The authoritative pass, against what actually shipped, with no such escape.
  assert.ok(keyCheckIndex > vercelDeployIndex);
  assert.match(steps[keyCheckIndex]?.run ?? "", /check-clerk-issuer-match\.mjs/);
  assert.doesNotMatch(steps[keyCheckIndex]?.run ?? "", /--allow-missing-key/);
  assert.equal(auditStep?.env?.VERCEL_TOKEN, "${{ secrets.VERCEL_TOKEN }}");
  assert.match(auditStep?.run ?? "", /env ls staging --format=json/);
  assert.match(auditStep?.run ?? "", /--require-developer-credentials/);
  assert.match(workflow, /VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS/);
  assert.match(steps[fixtureIndex]?.run ?? "", /VRDEX_DEPLOYMENT_ENV/);
  assert.match(steps[fixtureIndex]?.run ?? "", /VRDEX_ENABLE_HOSTED_SMOKE_FIXTURE/);
  assert.match(steps[fixtureIndex]?.run ?? "", /hostedSmokeFixtures:ensurePublicSearchFixture/);
});

test("web environment example inventories every required staged variable", () => {
  const example = readFileSync("apps/web/.env.example", "utf8");

  for (const name of [
    ...STAGING_BASE_ENVIRONMENT_NAMES,
    ...STAGING_DEVELOPER_PLATFORM_ENVIRONMENT_NAMES,
  ]) {
    assert.match(example, new RegExp(`^${name}=`, "m"));
  }
});
