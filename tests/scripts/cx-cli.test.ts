import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function invoke(args: string[], extraEnv: NodeJS.ProcessEnv = {}, failProviderSpawn = false) {
  const root = mkdtempSync(path.join(tmpdir(), "vrdex-cx-cli-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, "node_modules/convex/bin"), { recursive: true });
    for (const name of ["cx.ts", "convex-target.ts", "env-local.ts"]) {
      copyFileSync(path.join(repoRoot, "scripts", name), path.join(root, "scripts", name));
    }
    writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    writeFileSync(path.join(root, ".env.local"), [
      "CONVEX_DEPLOYMENT=anonymous:fixture-local",
      "CONVEX_URL=http://127.0.0.1:3210",
      "CONVEX_DEPLOYMENT_DEV=dev:fixture-dev",
      "CONVEX_DEPLOY_KEY_DEV=dev:fixture-dev|synthetic-dev",
      "CONVEX_DEPLOYMENT_PROD=prod:fixture-prod",
      "CONVEX_DEPLOY_KEY_PROD=prod:fixture-prod|synthetic-prod",
    ].join("\n"));
    // Only the external provider boundary is replaced. Parsing, env loading,
    // target validation and child-process argument forwarding remain real.
    writeFileSync(path.join(root, "node_modules/convex/bin/main.js"), `
      console.log(JSON.stringify({
        args: process.argv.slice(2),
        deployment: process.env.CONVEX_DEPLOYMENT,
        key: process.env.CONVEX_DEPLOY_KEY,
        url: process.env.CONVEX_URL,
        selfHosted: process.env.CONVEX_SELF_HOSTED_URL,
      }));
    `);
    const preload = path.join(root, "provider-spawn-failure.mjs");
    if (failProviderSpawn) {
      writeFileSync(preload, `
        import childProcess from "node:child_process";
        import { syncBuiltinESMExports } from "node:module";
        import path from "node:path";
        const original = childProcess.spawnSync;
        childProcess.spawnSync = (command, args, options) => {
          if (args?.[0]?.endsWith(path.join("convex", "bin", "main.js"))) {
            return { status: 0, error: Object.assign(new Error("fixture spawn blocked"), { code: "EPERM" }) };
          }
          return original(command, args, options);
        };
        syncBuiltinESMExports();
      `);
    }
    const imports = failProviderSpawn ? ["--import", pathToFileURL(preload).href] : [];
    const result = spawnSync(process.execPath, [...imports, "--import", loader, path.join(root, "scripts/cx.ts"), ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("cx command entry point", () => {
  for (const prefix of [[], ["--"]]) {
    for (const [target, deployment, key, url] of [
      ["local", "anonymous:fixture-local", "", "http://127.0.0.1:3210"],
      ["dev", "dev:fixture-dev", "dev:fixture-dev|synthetic-dev", ""],
      ["prod", "prod:fixture-prod", "prod:fixture-prod|synthetic-prod", ""],
    ]) {
      it(`forwards ${target} with ${prefix.length ? "a pnpm delimiter" : "no delimiter"}`, () => {
        const args = ["run", "health:status", '{"text":"a b","dryRun":true}'];
        const result = invoke([...prefix, target, ...args], {
          CONVEX_DEPLOYMENT: "prod:ambient",
          CONVEX_DEPLOY_KEY: "ambient-key",
          CONVEX_URL: "https://ambient.invalid",
          CONVEX_SELF_HOSTED_URL: "https://ambient.invalid",
        });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { args, deployment, key, url, selfHosted: "" });
        assert.doesNotMatch(result.stderr, /synthetic-|ambient-key/);
      });
    }
  }

  for (const args of [[], ["--"], ["--", "--"], ["production", "run", "health:status"], ["dev"]]) {
    it(`requires an explicit valid target and command: ${JSON.stringify(args)}`, () => {
      const result = invoke(args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "", "the provider must not run");
    });
  }

  for (const prefix of [[], ["--"]]) {
    it(`rejects a forwarded deployment override with ${prefix.length ? "a delimiter" : "no delimiter"}`, () => {
      const result = invoke([...prefix, "dev", "run", "health:status", "--prod"]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /--prod.*not accepted/);
      assert.equal(result.stdout, "");
    });
  }

  it("reports a provider spawn error even when the runtime supplies exit status zero", () => {
    const result = invoke(["--", "dev", "run", "health:status"], {}, true);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Failed to launch Convex CLI: fixture spawn blocked/);
    assert.equal(result.stdout, "");
  });

  it("handles help after a package-manager delimiter", () => {
    const result = invoke(["--", "--help"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: pnpm cx/);
    assert.doesNotMatch(result.stderr, /Unknown target/);
    assert.equal(result.stdout, "");
  });
});

