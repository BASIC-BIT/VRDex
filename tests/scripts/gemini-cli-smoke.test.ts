import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { geminiSpawnForPlatform } from "../../scripts/smoke-gemini-cli-mcp-client";

describe("Gemini CLI MCP smoke harness", () => {
  it("runs disposable package launches through cmd.exe on Windows", () => {
    const spawn = geminiSpawnForPlatform({
      comSpec: "C:\\Windows\\System32\\cmd.exe",
      geminiCommand: "gemini.cmd",
      geminiPackage: "@google/gemini-cli@0.49.0",
      platform: "win32",
      promptArgs: ["--version"],
    });

    assert.equal(spawn.command, "C:\\Windows\\System32\\cmd.exe");
    assert.deepEqual(spawn.args, [
      "/d",
      "/s",
      "/c",
      "npx.cmd",
      "--yes",
      "@google/gemini-cli@0.49.0",
      "--version",
    ]);
  });

  it("keeps package launches direct on non-Windows platforms", () => {
    const spawn = geminiSpawnForPlatform({
      geminiCommand: "gemini",
      geminiPackage: "@google/gemini-cli@0.49.0",
      platform: "linux",
      promptArgs: ["--version"],
    });

    assert.equal(spawn.command, "npx");
    assert.deepEqual(spawn.args, ["--yes", "@google/gemini-cli@0.49.0", "--version"]);
  });

  it("routes installed Windows command launches through cmd.exe too", () => {
    const spawn = geminiSpawnForPlatform({
      geminiCommand: "gemini.cmd",
      platform: "win32",
      promptArgs: ["--version"],
    });

    assert.equal(spawn.command, "cmd.exe");
    assert.deepEqual(spawn.args, ["/d", "/s", "/c", "gemini.cmd", "--version"]);
  });
});
