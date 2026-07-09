import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  geminiProviderQuotaMessage,
  geminiSpawnForPlatform,
  removeGeminiProjectDir,
  runGemini,
} from "../../scripts/smoke-gemini-cli-mcp-client";

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

  it("retries and downgrades transient Windows cleanup locks", async () => {
    const warnings: string[] = [];
    let options;

    await removeGeminiProjectDir("C:\\tmp\\vrdex-gemini-cli-mcp-test", {
      remove: async (_path, removeOptions) => {
        options = removeOptions;
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      },
      warn: (message) => warnings.push(message),
    });

    assert.deepEqual(options, { force: true, maxRetries: 5, recursive: true, retryDelay: 250 });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /transient EBUSY lock/);
  });

  it("keeps non-cleanup failures visible", async () => {
    await assert.rejects(
      removeGeminiProjectDir("C:\\tmp\\vrdex-gemini-cli-mcp-test", {
        remove: async () => {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        },
        warn: () => {
          throw new Error("warn should not be called");
        },
      }),
      /permission denied/,
    );
  });

  it("reports timed out Gemini subprocesses", async () => {
    await assert.rejects(
      runGemini(
        {
          geminiCommand: process.execPath,
          hostedDataPublicReads: false,
          hostedSearch: {
            limit: 1,
            query: "",
            type: "all",
          },
          mode: "local-stdio",
          timeoutMs: 50,
        },
        ["-e", "setTimeout(()=>{},1000)"],
        process.cwd(),
      ),
      /timed out after 50ms/,
    );
  });

  it("summarizes Gemini provider quota failures", () => {
    const message = geminiProviderQuotaMessage(
      [
        "TerminalQuotaError: You have exhausted your daily quota on this model.",
        "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests.",
        "Please retry in 58.10974781s.",
      ].join("\n"),
    );

    assert.equal(
      message,
      "Gemini CLI reached the Gemini API quota before any MCP smoke evidence could be recorded. Please retry in 58.10974781s.",
    );
  });

  it("ignores non-quota Gemini failures", () => {
    assert.equal(geminiProviderQuotaMessage("Error: MCP tool failed"), undefined);
  });
});
