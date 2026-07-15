import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { loadRepoEnvLocal } from "../../scripts/env-local";

describe("repo .env.local loader", () => {
  it("loads simple local env values without overriding existing process values", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "vrdex-env-local-test-"));

    try {
      writeFileSync(
        path.join(tempDir, ".env.local"),
        [
          "# local secrets",
          "OPENAI_API_KEY=from-file",
          "QUOTED=\"quoted value\"",
          "export EXPORTED=from-export",
        ].join("\n"),
        "utf8",
      );

      const env = {
        OPENAI_API_KEY: "already-set",
      } satisfies NodeJS.ProcessEnv;
      const result = loadRepoEnvLocal({ cwd: tempDir, env });

      assert.equal(result.loaded, true);
      assert.deepEqual(result.keys.sort(), ["EXPORTED", "QUOTED"]);
      assert.equal(env.OPENAI_API_KEY, "already-set");
      assert.equal(env.QUOTED, "quoted value");
      assert.equal(env.EXPORTED, "from-export");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("can be disabled for deterministic script tests", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "vrdex-env-local-test-"));

    try {
      writeFileSync(path.join(tempDir, ".env.local"), "OPENAI_API_KEY=from-file\n", "utf8");

      const env = {
        VRDEX_LOAD_ENV_LOCAL: "0",
      } satisfies NodeJS.ProcessEnv;
      const result = loadRepoEnvLocal({ cwd: tempDir, env });

      assert.equal(result.loaded, false);
      assert.equal(env.OPENAI_API_KEY, undefined);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
