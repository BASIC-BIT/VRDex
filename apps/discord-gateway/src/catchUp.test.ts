import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { catchUpMissedMessages } from "./catchUp";
import type { MessagePayload } from "./relay";
import { message } from "./testMessages";

const base = { kind: "discord_announcements", direction: "import", mode: "hold", state: "active", guildId: "100000000000000001" };

describe("startup catch-up", () => {
  it("relays posts made while the gateway was down, oldest first, through the normal path", async () => {
    const connectors = [
      { ...base, connectorId: "c1", channelId: "100000000000000002", lastMessageId: "300000000000000001" },
      { ...base, connectorId: "c2", channelId: "100000000000000003" },
      { ...base, connectorId: "c3", kind: "discord_board", channelId: "100000000000000004", lastMessageId: "300000000000000009" },
    ];
    const reads: string[] = [];
    const relayed: unknown[][] = [];
    const count = await catchUpMissedMessages({
      fetchConnectors: async () => connectors,
      fetchMessagesAfter: async (channelId, afterId) => {
        reads.push(`${channelId}:${afterId}`);
        return [message({ id: "300000000000000003" }), message({ id: "300000000000000002" }), message({ id: "300000000000000004", author: { id: "200000000000000009", bot: true, username: "b" } })];
      },
      relay: async (...args) => { relayed.push(args); },
    });
    assert.deepEqual(reads, ["100000000000000002:300000000000000001"]);
    assert.equal(count, 2);
    assert.deepEqual(relayed.map(([kind, action, guildId, channelId, payload]) => [kind, action, guildId, channelId, (payload as MessagePayload).messageId]), [
      ["message", "create", "100000000000000001", "100000000000000002", "300000000000000002"],
      ["message", "create", "100000000000000001", "100000000000000002", "300000000000000003"],
    ]);
  });

  it("logs one JSON line for a failed connector and moves on", async (t) => {
    const lines: string[] = [];
    t.mock.method(console, "error", (line: string) => { lines.push(line); });
    const connectors = [
      { ...base, connectorId: "c1", channelId: "100000000000000002", lastMessageId: "300000000000000001" },
      { ...base, connectorId: "c2", channelId: "100000000000000003", lastMessageId: "300000000000000001" },
    ];
    const count = await catchUpMissedMessages({
      fetchConnectors: async () => connectors,
      fetchMessagesAfter: async (channelId) => {
        if (channelId === "100000000000000002") throw new Error("Missing Access");
        return [message({ id: "300000000000000002" })];
      },
      relay: async () => {},
    });
    assert.equal(count, 1);
    assert.deepEqual(lines.map(line => JSON.parse(line) as unknown), [{ event: "discord_gateway_catch_up_failed" }]);
  });
});
