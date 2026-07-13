import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  assertGeminiHostedDataBackedOutput,
  assertGeminiMcpListOutput,
  geminiProviderQuotaMessage,
  geminiSpawnForPlatform,
  removeGeminiProjectDir,
  runGemini,
  terminateGeminiProcessTree,
} from "../../scripts/smoke-gemini-cli-mcp-client";

function fakeChild(pid: number) {
  const child = new EventEmitter() as ChildProcess;
  const signals: Array<NodeJS.Signals | number | undefined> = [];

  Object.assign(child, {
    exitCode: null,
    signalCode: null,
    pid,
    kill: (signal?: NodeJS.Signals | number) => {
      signals.push(signal);
      return true;
    },
  });

  return { child, signals };
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
  }
}

async function waitForProcessExit(pid: number) {
  const deadline = Date.now() + 2_000;

  while (processIsAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.equal(processIsAlive(pid), false, `Expected process ${pid} to terminate.`);
}

describe("Gemini CLI MCP smoke harness", () => {
  it("requires non-empty hosted data-backed search output", () => {
    const search = { limit: 1, query: "club", type: "all" as const };
    const event = (results: unknown[]) => [
      { tool: "vrdex_search", input: search },
      { content: JSON.stringify({ query: "club", results, type: "all" }) },
      { result: "hosted-ok" },
    ];

    assert.doesNotThrow(() => assertGeminiHostedDataBackedOutput(event([{ slug: "club-night" }]), search));
    assert.throws(
      () => assertGeminiHostedDataBackedOutput(event([]), search),
      /returned no public results/,
    );
  });

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

  it("requires the real Gemini MCP preflight to report VRDex connected", () => {
    assert.doesNotThrow(() =>
      assertGeminiMcpListOutput({
        code: 0,
        stderr: "",
        stdout: "Configured MCP servers:\n\n✓ vrdex: https://staging.vrdex.net/mcp (http) - Connected\n",
      }),
    );
    assert.throws(
      () =>
        assertGeminiMcpListOutput({
          code: 0,
          stderr: "",
          stdout: "○ vrdex: https://staging.vrdex.net/mcp (http) - Disabled\n",
        }),
      /did not connect/,
    );
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

  it("surfaces synchronous Windows taskkill launch failures", async () => {
    const { child, signals } = fakeChild(42);

    await assert.rejects(
      terminateGeminiProcessTree(child, {
        platform: "win32",
        spawnProcess: (() => {
          throw new Error("spawn failed");
        }) as never,
      }),
      /Failed to start taskkill/,
    );
    assert.deepEqual(signals, ["SIGBREAK"]);
  });

  it("surfaces nonzero Windows taskkill exits", async () => {
    const { child, signals } = fakeChild(42);
    const killer = new EventEmitter() as ChildProcess;
    const termination = terminateGeminiProcessTree(child, {
      platform: "win32",
      spawnProcess: (() => killer) as never,
    });

    setImmediate(() => killer.emit("close", 1));
    await assert.rejects(termination, /taskkill\.exe exited with code 1/);
    assert.deepEqual(signals, ["SIGBREAK"]);
  });

  it("terminates a POSIX process group gracefully and then forcefully", async () => {
    const { child } = fakeChild(42);
    const calls: Array<[number, NodeJS.Signals | 0]> = [];
    let forceKilled = false;

    await terminateGeminiProcessTree(child, {
      forceWaitMs: 100,
      graceMs: 10,
      platform: "linux",
      sendSignal: (pid, signal) => {
        calls.push([pid, signal]);
        if (signal === "SIGTERM") {
          setImmediate(() => child.emit("exit", null, "SIGTERM"));
        } else if (signal === "SIGKILL") {
          forceKilled = true;
        } else if (signal === 0 && forceKilled) {
          throw Object.assign(new Error("missing"), { code: "ESRCH" });
        }
      },
    });

    assert.deepEqual(calls, [
      [-42, "SIGTERM"],
      [-42, 0],
      [-42, "SIGKILL"],
      [-42, 0],
    ]);
  });

  it("reports timed out Gemini subprocesses", async () => {
    const startedAt = Date.now();

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
          timeoutMs: 1_000,
        },
        ["tests/scripts/fixtures/gemini-timeout-child.mjs"],
        process.cwd(),
      ),
      (error: unknown) => {
        assert.match(String(error), /timed out after 1000ms/);
        assert.match(String(error), /Buffered Gemini output:/);
        assert.match(String(error), /gemini timeout fixture stderr/);
        assert.match(String(error), /gemini timeout fixture stdout/);

        return true;
      },
    );

    const elapsedMs = Date.now() - startedAt;

    assert.ok(
      elapsedMs < 3_000,
      `Expected the timed-out process tree to terminate within 3 seconds, but it took ${elapsedMs}ms.`,
    );
  });

  it("terminates both the timed-out Gemini parent and its grandchild", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "vrdex-gemini-tree-"));
    const pidFile = join(projectDir, "pids.json");

    try {
      await assert.rejects(
        runGemini(
          {
            geminiCommand: process.execPath,
            hostedDataPublicReads: false,
            hostedSearch: { limit: 1, query: "", type: "all" },
            mode: "local-stdio",
            timeoutMs: 750,
          },
          ["tests/scripts/fixtures/gemini-timeout-child.mjs", pidFile],
          process.cwd(),
        ),
        /timed out after 750ms/,
      );

      const pids = JSON.parse(await readFile(pidFile, "utf8")) as {
        grandchild: number;
        parent: number;
      };

      await Promise.all([waitForProcessExit(pids.parent), waitForProcessExit(pids.grandchild)]);
    } finally {
      await rm(projectDir, { force: true, recursive: true });
    }
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
