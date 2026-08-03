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
          if?: string;
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
  const authSessionIndex = steps.findIndex(
    (step) => step.name === "Run recurring staging auth session contract",
  );
  const authConfigIndex = steps.findIndex(
    (step) => step.name === "Provision Convex auth configuration",
  );
  const auditStep = steps[auditIndex];

  assert.ok(auditIndex >= 0);
  assert.ok(convexDeployIndex > auditIndex);
  assert.ok(fixtureIndex > convexDeployIndex);
  assert.ok(vercelDeployIndex > fixtureIndex);
  // After the deployment it tests, not before it.
  assert.ok(authSessionIndex > vercelDeployIndex);
  assert.equal(steps[authSessionIndex]?.run, "pnpm test:e2e:hosted:auth-session");
  // Gated, or it reports a passing contract over assertions that never ran.
  assert.match(steps[authSessionIndex]?.if ?? "", /VRDEX_HOSTED_E2E_CLERK_AUTH == 'true'/);
  // Distinct output locations, or it deletes the first run's evidence.
  assert.equal(steps[authSessionIndex]?.env?.PLAYWRIGHT_OUTPUT_DIR, "test-results-auth-session");
  assert.equal(
    steps[authSessionIndex]?.env?.PLAYWRIGHT_HTML_REPORT_DIR,
    "playwright-report-auth-session",
  );


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
  // Format validation is its own step and is never skipped, so a rotation that
  // legitimately bypasses the comparison cannot bypass it too.
  const formatIndex = steps.findIndex(
    (step) => step.name === "Validate the staging Clerk issuer format",
  );

  assert.ok(formatIndex >= 0);
  assert.ok(formatIndex < authConfigIndex);
  assert.match(steps[formatIndex]?.run ?? "", /--validate-issuer-only/);
  assert.doesNotMatch(steps[formatIndex]?.if ?? "", /rotation/);

  // The comparison reads the key the deployment serves, not Vercel's pending
  // configuration. Reading the pending config would have made a rotation an
  // ordinary run, but `vercel env pull` does not write the publishable key back
  // for this environment even though the audit confirms it is set — two staging
  // deploys failed before that premise was shown to be wrong.
  assert.match(steps[preCheckIndex]?.run ?? "", /--base-url/);
  assert.doesNotMatch(steps[preCheckIndex]?.run ?? "", /env pull/);
  assert.match(steps[preCheckIndex]?.run ?? "", /--allow-missing-key/);
  assert.match(steps[preCheckIndex]?.if ?? "", /clerk_instance_rotation/);

  // The authoritative pass, against what actually shipped, with no such escape.
  assert.ok(keyCheckIndex > vercelDeployIndex);
  assert.match(steps[keyCheckIndex]?.run ?? "", /check-clerk-issuer-match\.mjs/);
  assert.match(steps[keyCheckIndex]?.run ?? "", /--base-url/);

  // A run that changed the issuer and then failed must put it back, or Convex is
  // left trusting an instance the deployed app does not authenticate against and
  // every signed-in staging request is rejected. Last in the job so any later
  // failure still reaches it, and it re-pushes because `auth.config.ts` is read
  // at push time.
  const rollbackIndex = steps.findIndex(
    (step) => step.name === "Restore the previous Convex issuer",
  );

  assert.ok(rollbackIndex > keyCheckIndex);
  assert.ok(rollbackIndex > steps.findIndex((step) => step.name === "Run hosted staging data-flow health"));
  assert.match(steps[rollbackIndex]?.if ?? "", /failure\(\)/);
  // Not once Vercel has published. At that point it serves a key the pre-deploy
  // check already validated against this issuer, so the providers agree and a
  // later failure — including a transient fetch error in the post-deploy
  // verifier — is not evidence the pairing is wrong. Restoring Convex there
  // would create the mismatch this step exists to prevent.
  assert.match(
    steps[rollbackIndex]?.if ?? "",
    /steps\.vercel\.outcome != 'success'/,
  );
  assert.match(steps[rollbackIndex]?.run ?? "", /convex env set CLERK_JWT_ISSUER_DOMAIN/);
  // Re-pushes only when the Convex deploy that would have published the new
  // issuer actually succeeded. Otherwise nothing carrying it was published, so
  // restoring the variable is the whole repair — and re-pushing would publish
  // functions that just failed their typecheck.
  assert.match(steps[rollbackIndex]?.run ?? "", /CONVEX_DEPLOY_OUTCOME" = "success"/);
  assert.match(steps[rollbackIndex]?.run ?? "", /convex deploy --yes --typecheck=enable/);
  assert.doesNotMatch(steps[rollbackIndex]?.run ?? "", /--typecheck=disable/);

  // A retrieval failure must not read as "no previous value". That conflation
  // let the mutation proceed with nothing recorded, so a later failure found an
  // empty rollback value and declined to act — leaving Convex on the new issuer
  // with no way home.
  assert.match(steps[authConfigIndex]?.run ?? "", /if ! env_dump=/);
  assert.match(steps[authConfigIndex]?.run ?? "", /Refusing to change it without a rollback value/);
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
