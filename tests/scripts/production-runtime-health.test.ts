import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse as parseYaml } from "yaml";

function checkVercelEnvironment(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["apps/web/scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      ...environment,
    },
  });
}

test("production Vercel builds require the shared rate-limit store", () => {
  const result = checkVercelEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "production",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /VRDEX_RATE_LIMIT_STORE is required/);
  assert.match(result.stderr, /VRDEX_RATE_LIMIT_REDIS_REST_URL is required/);
  assert.match(result.stderr, /VRDEX_RATE_LIMIT_REDIS_REST_TOKEN is required/);
});

test("production Vercel builds accept the Terraform-managed rate-limit contract", () => {
  const result = checkVercelEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "production",
    VRDEX_RATE_LIMIT_REDIS_REST_TOKEN: "test-token",
    VRDEX_RATE_LIMIT_REDIS_REST_URL: "https://redis.example.test",
    VRDEX_RATE_LIMIT_STORE: "upstash",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Vercel production environment accepted/);
});

test("production Vercel builds reject local rate-limit endpoints", () => {
  for (const endpoint of [
    "https://localhost",
    "https://localhost.",
    "https://cache.localhost",
    "https://cache.localhost.",
    "https://127.0.0.2",
    "https://[::1]",
    "https://[::ffff:127.0.0.2]",
  ]) {
    const result = checkVercelEnvironment({
      VERCEL: "1",
      VERCEL_ENV: "production",
      VRDEX_RATE_LIMIT_REDIS_REST_TOKEN: "test-token",
      VRDEX_RATE_LIMIT_REDIS_REST_URL: endpoint,
      VRDEX_RATE_LIMIT_STORE: "upstash",
    });

    assert.equal(result.status, 1, endpoint);
    assert.match(result.stderr, /must not point at a local backend in production/, endpoint);
  }
});

test("preview Vercel builds do not require the production rate-limit store", () => {
  const result = checkVercelEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "preview",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Vercel preview environment accepted/);
});

test("an explicitly selected Terraform stack fails when provider settings are missing", async () => {
  const source = await readFile(".github/workflows/terraform.yml", "utf8");
  const workflow = parseYaml(source) as {
    jobs?: {
      "terraform-stack"?: {
        steps?: Array<{
          env?: Record<string, string>;
          name?: string;
          run?: string;
        }>;
      };
    };
  };
  const gate = workflow.jobs?.["terraform-stack"]?.steps?.find(
    (step) => step.name === "Check plan gate",
  );

  assert.ok(gate);
  assert.equal(
    gate.env?.SELECTED_STACK,
    "${{ github.event_name == 'workflow_dispatch' && inputs.stack || 'all' }}",
  );
  assert.match(gate.run ?? "", /\$SELECTED_STACK" = "\$\{\{ matrix\.stack\.name \}\}"/);
  assert.match(gate.run ?? "", /cannot plan because required repository settings are missing/);
});

test("production smoke probes a rate-limited anonymous API read", async () => {
  const smoke = await readFile("apps/web/e2e/public-routes.smoke.spec.ts", "utf8");

  assert.match(smoke, /anonymous public API search succeeds/);
  assert.match(smoke, /\/api\/v0\/search\?q=basicbit&limit=1/);
});

test("fixture-backed handoff coverage runs in the flow lane and stays out of production smoke", async () => {
  const handoff = await readFile("apps/web/e2e/handoff.flow.spec.ts", "utf8");
  const workflow = await readFile(".github/workflows/baseline-checks.yml", "utf8");
  const webPackage = JSON.parse(await readFile("apps/web/package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };

  const fixtureTags = handoff.match(/@fixture/g) ?? [];
  const flowTags = handoff.match(/@flow/g) ?? [];

  assert.equal(fixtureTags.length, 7);
  assert.equal(flowTags.length, 7);
  assert.match(workflow, /playwright test --grep @flow --project=desktop-chromium/);
  assert.match(webPackage.scripts?.["test:e2e:hosted"] ?? "", /--grep @flow/);
  assert.match(webPackage.scripts?.["test:e2e:hosted"] ?? "", /--grep-invert @fixture/);
  const productionSmokeScript =
    webPackage.scripts?.["test:e2e:hosted:smoke"] ?? "";
  assert.equal(
    productionSmokeScript,
    "playwright test public-routes.smoke.spec.ts --project=desktop-chromium --project=mobile-chromium",
  );
  assert.doesNotMatch(
    productionSmokeScript,
    /--grep-invert/,
  );
  const untaggedVisualFixture = await readFile(
    "apps/web/e2e/media-kit.visual.spec.ts",
    "utf8",
  );
  assert.match(
    untaggedVisualFixture,
    /test\("owner upload failure stays beside the publish control @fixture"/,
  );
  assert.doesNotMatch(productionSmokeScript, /media-kit\.visual\.spec\.ts/);
});

test("auth session browser coverage is bounded to its positive matrix", async () => {
  const baseConfig = await readFile(
    "apps/web/playwright.config.mjs",
    "utf8",
  );
  const authConfig = await readFile(
    "apps/web/playwright.auth.config.mjs",
    "utf8",
  );
  const authFlow = await readFile(
    "apps/web/e2e/auth-session.flow.spec.ts",
    "utf8",
  );
  const workflow = await readFile(
    ".github/workflows/baseline-checks.yml",
    "utf8",
  );
  const webPackage = JSON.parse(
    await readFile("apps/web/package.json", "utf8"),
  ) as { scripts?: Record<string, string> };

  assert.match(authConfig, /auth-chromium/);
  assert.match(authConfig, /auth-firefox/);
  assert.match(authConfig, /auth-webkit/);
  assert.match(authConfig, /testMatch: "auth-session\.flow\.spec\.ts"/);
  assert.match(authConfig, /grep: \/@auth-session-matrix\//);
  assert.match(authConfig, /serviceWorkers: "block"/);
  assert.match(
    authConfig,
    /globalTeardown: "\.\/e2e\/auth-session-matrix\.global-teardown\.ts"/,
  );
  assert.match(authConfig, /failOnFlakyTests: true/);
  assert.match(authConfig, /retries: 1/);
  assert.match(authConfig, /workers: 1/);
  assert.match(authConfig, /dependencies/);
  assert.match(baseConfig, /trace: "on-first-retry"/);
  assert.match(authFlow, /launchPersistentContext\(userDataDir/);
  assert.match(authFlow, /@auth-session-matrix/);
  assert.match(
    webPackage.scripts?.["test:e2e:auth-session-matrix"] ?? "",
    /playwright test --config playwright\.auth\.config\.mjs/,
  );
  assert.match(
    workflow,
    /playwright install --with-deps chromium firefox webkit/,
  );
  assert.match(workflow, /pnpm test:e2e:auth-session-matrix/);
});

test("deployed auth checks separate recurring staging from manual production", async () => {
  const deployedHealthSource = await readFile(
    ".github/workflows/deployed-health.yml",
    "utf8",
  );
  const workflow = parseYaml(deployedHealthSource) as {
    on?: {
      workflow_dispatch?: {
        inputs?: Record<string, { default?: boolean; type?: string }>;
      };
    };
    jobs?: Record<
      string,
      {
        if?: string;
        steps?: Array<{
          env?: Record<string, string>;
          name?: string;
          run?: string;
        }>;
      }
    >;
  };
  const webPackage = JSON.parse(
    await readFile("apps/web/package.json", "utf8"),
  ) as { scripts?: Record<string, string> };

  assert.deepEqual(
    workflow.on?.workflow_dispatch?.inputs?.production_auth,
    {
      default: false,
      description:
        "Run the manual one-shot production authenticated account read",
      required: true,
      type: "boolean",
    },
  );

  const hostedDataFlow = workflow.jobs?.["hosted-data-flow"];
  assert.ok(hostedDataFlow);
  assert.doesNotMatch(hostedDataFlow.if ?? "", /event_name == 'push'/);

  const stagingStep = workflow.jobs?.["hosted-data-flow"]?.steps?.find(
    (step) => step.name === "Run recurring staging auth session contract",
  );
  assert.ok(stagingStep);
  assert.equal(stagingStep.run, "pnpm test:e2e:hosted:auth-session");

  const stagingDeploySource = await readFile(
    ".github/workflows/staging-deploy.yml",
    "utf8",
  );
  const stagingDeploy = parseYaml(stagingDeploySource) as {
    jobs?: Record<
      string,
      {
        steps?: Array<{
          env?: Record<string, string>;
          name?: string;
          run?: string;
        }>;
      }
    >;
  };
  const stagingDeploySteps = stagingDeploy.jobs?.["deploy-staging"]?.steps ?? [];
  const deployIndex = stagingDeploySteps.findIndex(
    (step) => step.name === "Deploy Vercel staging",
  );
  const postDeployAuthIndex = stagingDeploySteps.findIndex(
    (step) => step.name === "Run recurring staging auth session contract",
  );
  assert.ok(deployIndex >= 0);
  assert.ok(postDeployAuthIndex > deployIndex);
  assert.equal(
    stagingDeploySteps[postDeployAuthIndex]?.run,
    "pnpm test:e2e:hosted:auth-session",
  );
  assert.equal(
    stagingDeploySteps[postDeployAuthIndex]?.env?.PLAYWRIGHT_BASE_URL,
    "${{ steps.gate.outputs.hosted_base_url }}",
  );

  const productionConfigurationGate = workflow.jobs?.["production-smoke"]?.steps?.find(
    (step) => step.name === "Check production smoke configuration",
  );
  assert.ok(productionConfigurationGate);
  assert.equal(
    productionConfigurationGate.env?.PRODUCTION_AUTH_REQUESTED,
    "${{ inputs.production_auth || false }}",
  );
  assert.match(
    productionConfigurationGate.run ?? "",
    /production_auth was requested but no production base URL is configured/,
  );
  assert.match(productionConfigurationGate.run ?? "", /exit 1/);

  const productionGate = workflow.jobs?.["production-smoke"]?.steps?.find(
    (step) =>
      step.name === "Check production authenticated smoke configuration",
  );
  assert.ok(productionGate);
  assert.equal(productionGate.env?.EVENT_NAME, "${{ github.event_name }}");
  assert.equal(
    productionGate.env?.PRODUCTION_AUTH_REQUESTED,
    "${{ inputs.production_auth || false }}",
  );
  assert.match(productionGate.run ?? "", /manual one-shot checks/);
  assert.match(
    productionGate.run ?? "",
    /production_auth was requested but VRDEX_PRODUCTION_SMOKE_BASE_URL/,
  );

  const productionRun = workflow.jobs?.["production-smoke"]?.steps?.find(
    (step) => step.name === "Run production authenticated account smoke",
  );
  assert.equal(
    productionRun?.env?.VRDEX_PRODUCTION_AUTH_SMOKE_MODE,
    "manual-one-shot",
  );
  assert.match(
    webPackage.scripts?.["test:e2e:hosted:auth-session"] ?? "",
    /auth-session\.flow\.spec\.ts --grep @auth-session-staging/,
  );
  assert.match(
    webPackage.scripts?.["test:e2e:hosted:auth-smoke"] ?? "",
    /node scripts\/run-production-auth-smoke\.mjs/,
  );

  const productionAuthConfig = await readFile(
    "apps/web/playwright.production-auth.config.mjs",
    "utf8",
  );
  const productionAuthRunner = await readFile(
    "apps/web/scripts/run-production-auth-smoke.mjs",
    "utf8",
  );
  assert.match(
    productionAuthConfig,
    /testMatch: "production-auth\.smoke\.spec\.ts"/,
  );
  assert.match(productionAuthConfig, /grep: \/@production-auth-one-shot\//);
  assert.match(productionAuthConfig, /reporter: \[\["null"\]\]/);
  assert.match(productionAuthConfig, /retries: 0/);
  assert.match(productionAuthConfig, /trace: "off"/);
  assert.match(productionAuthConfig, /screenshot: "off"/);
  assert.match(productionAuthConfig, /video: "off"/);
  assert.doesNotMatch(productionAuthConfig, /playwright-report/);
  for (const classification of [
    "missing_state",
    "configuration_missing",
    "auth_state_rejected",
    "transport_failure",
    "server_failure",
    "passed",
  ]) {
    assert.match(productionAuthRunner, new RegExp(`"${classification}"`));
  }
  assert.doesNotMatch(productionAuthRunner, /console\.(log|error|warn)/);
});

test("production auth runner emits only a fixed missing-state classification", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/run-production-auth-smoke.mjs"],
    {
      cwd: "apps/web",
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
      },
    },
  );

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "missing_state\n");
  assert.equal(result.stderr, "");
});

test("production auth runner rejects incomplete one-shot configuration", () => {
  const state = Buffer.from(
    JSON.stringify({
      cookies: [
        {
          name: "__convexAuthJWT",
          value: "fixture",
          domain: "vrdex.net",
          path: "/",
          expires: 4_102_444_800,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
        {
          name: "__convexAuthRefreshToken",
          value: "fixture",
          domain: "vrdex.net",
          path: "/",
          expires: 4_102_444_800,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  ).toString("base64");
  const result = spawnSync(
    process.execPath,
    ["scripts/run-production-auth-smoke.mjs"],
    {
      cwd: "apps/web",
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64: state,
      },
    },
  );

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "configuration_missing\n");
  assert.equal(result.stderr, "");
});
