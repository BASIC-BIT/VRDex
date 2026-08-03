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

// Carries the Clerk live pair because production now requires it — this test is
// about the rate-limit contract, so it has to satisfy every other production
// requirement to reach the accepted state.
const productionClerkKeys = {
  CLERK_SECRET_KEY: "sk_live_test",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_test",
};

test("production Vercel builds accept the Terraform-managed rate-limit contract", () => {
  const result = checkVercelEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "production",
    ...productionClerkKeys,
    VRDEX_RATE_LIMIT_REDIS_REST_TOKEN: "test-token",
    VRDEX_RATE_LIMIT_REDIS_REST_URL: "https://redis.example.test",
    VRDEX_RATE_LIMIT_STORE: "upstash",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Vercel production environment accepted/);
});

test("production Vercel builds require both Clerk keys", () => {
  const missing = checkVercelEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "production",
    VRDEX_RATE_LIMIT_REDIS_REST_TOKEN: "test-token",
    VRDEX_RATE_LIMIT_REDIS_REST_URL: "https://redis.example.test",
    VRDEX_RATE_LIMIT_STORE: "upstash",
  });

  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required for production/);
  assert.match(missing.stderr, /CLERK_SECRET_KEY is required for production/);

  // One key alone is the dangerous state: it mounts ClerkProvider and selects
  // clerkMiddleware with no server-side credential, so it fails at runtime
  // rather than falling back to unconfigured auth.
  const halfConfigured = checkVercelEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_only",
  });

  assert.equal(halfConfigured.status, 1);
  assert.match(halfConfigured.stderr, /CLERK_SECRET_KEY is required because/);
});

test("Vercel builds reject Clerk keys from the wrong instance tier", () => {
  const productionWithTestKeys = checkVercelEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "production",
    CLERK_SECRET_KEY: "sk_test_wrong",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_wrong",
    VRDEX_RATE_LIMIT_REDIS_REST_TOKEN: "test-token",
    VRDEX_RATE_LIMIT_REDIS_REST_URL: "https://redis.example.test",
    VRDEX_RATE_LIMIT_STORE: "upstash",
  });

  assert.equal(productionWithTestKeys.status, 1);
  assert.match(productionWithTestKeys.stderr, /must be a live Clerk publishable key/);

  // The quieter direction: a preview on the live tenant authenticates real
  // users from an unreviewed deployment.
  const previewWithLiveKeys = checkVercelEnvironment({
    VERCEL: "1",
    VERCEL_ENV: "preview",
    ...productionClerkKeys,
  });

  assert.equal(previewWithLiveKeys.status, 1);
  assert.match(previewWithLiveKeys.stderr, /must be a test Clerk publishable key/);
  assert.match(previewWithLiveKeys.stderr, /must be a test Clerk secret key/);
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

/**
 * Replaces the old three-browser auth-session matrix assertions. That lane
 * tested Convex Auth's refresh-token machinery through persistent browser
 * profiles; Clerk owns sessions now, so the config, its teardown, and the
 * `if: false` CI job it fed were removed with #226 rather than rewired.
 *
 * What is worth pinning instead is that the auth specs are actually wired to
 * Clerk and cannot silently go back to reporting a pass over nothing.
 */
test("hosted auth E2E is wired to Clerk testing tokens rather than skipped", async () => {
  const baseConfig = await readFile("apps/web/playwright.config.mjs", "utf8");
  const harness = await readFile("apps/web/e2e/clerk-auth.ts", "utf8");
  const authSession = await readFile(
    "apps/web/e2e/auth-session.flow.spec.ts",
    "utf8",
  );
  const authClaim = await readFile("apps/web/e2e/auth-claim.flow.spec.ts", "utf8");
  const developerCredentials = await readFile(
    "apps/web/e2e/developer-credentials.flow.spec.ts",
    "utf8",
  );
  const webPackage = JSON.parse(
    await readFile("apps/web/package.json", "utf8"),
  ) as { devDependencies?: Record<string, string>; scripts?: Record<string, string> };

  assert.ok(webPackage.devDependencies?.["@clerk/testing"]);
  assert.match(harness, /from "@clerk\/testing\/playwright"/);
  assert.match(harness, /setupClerkTestingToken/);
  assert.match(harness, /clerk\.signIn/);
  assert.match(baseConfig, /trace: "on-first-retry"/);

  // The blanket file-level skip the Clerk cutover left behind. A skipped
  // Playwright file exits 0, so its return would be invisible in CI.
  for (const spec of [authSession, authClaim, developerCredentials]) {
    assert.doesNotMatch(spec, /test\.skip\(\s*true\s*,/);
    assert.match(spec, /clerkTestAuthAvailability\(\)/);
  }

  // Fail-closed rather than skip when a hosted target asked for auth coverage
  // and has no keys to run it with.
  assert.match(harness, /Hosted auth E2E is enabled for this target but/);
  assert.match(harness, /throw new Error\(/);

  assert.match(authSession, /@auth-session-staging/);
  assert.match(
    webPackage.scripts?.["test:e2e:hosted:auth-session"] ?? "",
    /auth-session\.flow\.spec\.ts --grep @auth-session-staging/,
  );
});

test("deployed auth checks separate recurring staging from manual production", async () => {
  const source = await readFile(
    ".github/workflows/deployed-health.yml",
    "utf8",
  );
  const workflow = parseYaml(source) as {
    on?: {
      workflow_dispatch?: {
        inputs?: Record<string, { default?: boolean; type?: string }>;
      };
    };
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

  const stagingStep = workflow.jobs?.["hosted-data-flow"]?.steps?.find(
    (step) => step.name === "Run recurring staging auth session contract",
  );
  assert.ok(stagingStep);
  assert.equal(stagingStep.run, "pnpm test:e2e:hosted:auth-session");

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
