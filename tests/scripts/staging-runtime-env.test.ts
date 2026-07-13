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
  const auditStep = steps[auditIndex];

  assert.ok(auditIndex >= 0);
  assert.ok(convexDeployIndex > auditIndex);
  assert.equal(auditStep?.env?.VERCEL_TOKEN, "${{ secrets.VERCEL_TOKEN }}");
  assert.match(auditStep?.run ?? "", /env ls staging --format=json/);
  assert.match(auditStep?.run ?? "", /--require-developer-credentials/);
  assert.match(workflow, /VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS/);
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
