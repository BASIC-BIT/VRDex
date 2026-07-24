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
  assert.match(webPackage.scripts?.["test:e2e:hosted:smoke"] ?? "", /--grep-invert.*@flow/);
  assert.match(webPackage.scripts?.["test:e2e:hosted:smoke"] ?? "", /--grep-invert.*@fixture/);
});
