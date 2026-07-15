import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCursorAgentToolEvidence,
  cursorAgentSpawnForPlatform,
  isCursorAgentCapabilityProbe,
  parseCursorAgentStream,
  redactCursorAgentOutput,
  selectCursorAgentCommand,
} from "../../scripts/smoke-cursor-agent-mcp-client";

const successfulHelp = {
  code: 0,
  stderr: "",
  stdout: "Usage: agent [options] [command]\n-p, --print\n--output-format <format> text json stream-json\nmcp Manage MCP servers",
};
const successfulMcpHelp = {
  code: 0,
  stderr: "",
  stdout: "Commands: login, list, list-tools <identifier>",
};

function probe(command: string, overrides: Partial<Parameters<typeof isCursorAgentCapabilityProbe>[0]> = {}) {
  return {
    command,
    help: successfulHelp,
    mcpHelp: successfulMcpHelp,
    ...overrides,
  };
}

function toolEvents(results: unknown[] = [{ slug: "club-night" }]) {
  return [
    {
      message: { content: [{ text: "Call vrdex_search exactly once" }] },
      type: "user",
    },
    {
      subtype: "completed",
      tool_call: {
        mcpToolCall: {
          args: { limit: 1, query: "club", type: "event" },
          name: "vrdex_search",
          result: { success: { content: JSON.stringify({ results }) } },
        },
      },
      type: "tool_call",
    },
    {
      is_error: false,
      result: "hosted-ok",
      subtype: "success",
      type: "result",
    },
  ];
}

describe("Cursor Agent MCP smoke harness", () => {
  it("recognizes the documented print, stream-json, and MCP capability signature", () => {
    assert.equal(isCursorAgentCapabilityProbe(probe("agent")), true);
    assert.equal(selectCursorAgentCommand([probe("agent"), probe("cursor-agent")]), "agent");
    assert.equal(
      selectCursorAgentCommand([
        probe("agent", { help: { code: 0, stderr: "", stdout: "unrelated generic agent" } }),
        probe("cursor-agent"),
      ]),
      "cursor-agent",
    );
  });

  it("rejects generic agent executables and incomplete MCP help", () => {
    assert.equal(
      isCursorAgentCapabilityProbe(
        probe("agent", { help: { code: 0, stderr: "", stdout: "Usage: agent --print --output-format stream-json" } }),
      ),
      false,
    );
    assert.equal(
      isCursorAgentCapabilityProbe(
        probe("agent", { mcpHelp: { code: 0, stderr: "", stdout: "MCP list only" } }),
      ),
      false,
    );
  });

  it("routes Windows command shims through cmd.exe", () => {
    assert.deepEqual(
      cursorAgentSpawnForPlatform({
        command: "agent.cmd",
        commandArgs: ["--version"],
        comSpec: "C:\\Windows\\System32\\cmd.exe",
        platform: "win32",
      }),
      {
        args: ["/d", "/s", "/c", "agent.cmd", "--version"],
        command: "C:\\Windows\\System32\\cmd.exe",
      },
    );
  });

  it("parses NDJSON and requires completed MCP evidence plus terminal success", () => {
    const events = toolEvents();
    const stdout = events.map((event) => JSON.stringify(event)).join("\n");

    assert.deepEqual(parseCursorAgentStream(stdout), events);
    assert.doesNotThrow(() =>
      assertCursorAgentToolEvidence(events, {
        expectedSearch: { limit: 1, query: "club", type: "event" },
        marker: "hosted-ok",
        requireNonEmptyResults: true,
      }),
    );
  });

  it("does not accept prompt-only mentions as tool evidence", () => {
    assert.throws(
      () =>
        assertCursorAgentToolEvidence(
          [
            { message: { content: [{ text: "Use vrdex_search" }] }, type: "user" },
            { result: "hosted-ok", subtype: "success", type: "result" },
          ],
          {
            expectedSearch: { limit: 1, query: "club", type: "event" },
            marker: "hosted-ok",
            requireNonEmptyResults: true,
          },
        ),
      /completed vrdex_search/,
    );
  });

  it("rejects empty results, malformed NDJSON, and missing terminal success", () => {
    assert.throws(
      () =>
        assertCursorAgentToolEvidence(toolEvents([]), {
          expectedSearch: { limit: 1, query: "club", type: "event" },
          marker: "hosted-ok",
          requireNonEmptyResults: true,
        }),
      /returned no public results/,
    );
    assert.throws(
      () =>
        assertCursorAgentToolEvidence(toolEvents(), {
          expectedSearch: { limit: 2, query: "different", type: "all" },
          marker: "hosted-ok",
          requireNonEmptyResults: true,
        }),
      /did not use the expected query, type, and limit/,
    );
    assert.throws(() => parseCursorAgentStream("{not-json}"), /JSON/);
    assert.throws(
      () =>
        assertCursorAgentToolEvidence(toolEvents().slice(0, -1), {
          expectedSearch: { limit: 1, query: "club", type: "event" },
          marker: "hosted-ok",
          requireNonEmptyResults: true,
        }),
      /terminal success/,
    );
  });

  it("redacts provider and bearer credentials from failures", () => {
    const previous = process.env.CURSOR_API_KEY;

    process.env.CURSOR_API_KEY = "cursor-secret-value";
    try {
      assert.equal(
        redactCursorAgentOutput("key=cursor-secret-value Authorization: Bearer mcp-secret-value"),
        "key=[REDACTED_CURSOR_API_KEY] Authorization: Bearer [REDACTED]",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.CURSOR_API_KEY;
      } else {
        process.env.CURSOR_API_KEY = previous;
      }
    }
  });
});
