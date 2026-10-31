import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { ConnectorSummary } from "./connectorCache";
import { failureDetail, fetchConnectors, logRejections, relay, relayBulkDelete, relayConnected, sendHeartbeat, toMessagePayload } from "./relay";
import { flyer, message, notes } from "./testMessages";

const guildId = "100000000000000001";
const channelId = "100000000000000002";
const connector = (over: Partial<ConnectorSummary> = {}): ConnectorSummary => ({
  connectorId: "c1", kind: "discord_announcements", direction: "import", mode: "hold", state: "active", guildId, channelId, ...over,
});

describe("toMessagePayload", () => {
  it("drops bots, system messages, and posts with neither text nor image", () => {
    assert.equal(toMessagePayload(message({ author: { id: "200000000000000001", bot: true, username: "b" } })), null);
    assert.equal(toMessagePayload(message({ system: true })), null);
    assert.equal(toMessagePayload(message({ content: "  ", attachments: new Map([["2", notes]]) })), null);
    assert.notEqual(toMessagePayload(message({ content: "" })), null);
  });

  it("builds the relay payload with image attachments only", () => {
    assert.deepEqual(toMessagePayload(message()), {
      messageId: "300000000000000001", authorId: "200000000000000001", authorDisplayName: "Ari B", isBot: false,
      content: "Friday 9pm", createdAt: 1_700_000_000_000,
      attachments: [{ url: flyer.url, contentType: "image/png", byteLength: 1234 }],
    });
  });

  it("falls back through the display names and carries the edit time only when edited", () => {
    assert.equal(toMessagePayload(message({ member: null }))?.authorDisplayName, "Ari");
    assert.equal(toMessagePayload(message({ member: null, author: { id: "200000000000000001", bot: false, username: "ari", globalName: null } }))?.authorDisplayName, "ari");
    assert.equal(toMessagePayload(message({ editedTimestamp: 1_700_000_000_001 }))?.editedAt, 1_700_000_000_001);
  });
});

describe("failureDetail", () => {
  it("keeps numeric status and Discord code, and nothing else an error carries", () => {
    const discordError = Object.assign(new Error("Missing Access"), {
      status: 403, code: 50001, url: "https://discord.com/api/v10/channels/1/messages?token=secret", requestBody: { json: { content: "Friday 9pm" } },
    });
    assert.deepEqual(failureDetail(discordError), { status: 403, code: 50001 });
    assert.deepEqual(failureDetail(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })), {});
    assert.deepEqual(failureDetail("nope"), {});
    assert.deepEqual(failureDetail(null), {});
  });
});

describe("logRejections", () => {
  it("logs one JSON line when an async listener rejects", async (t) => {
    const lines: string[] = [];
    t.mock.method(console, "error", (line: string) => { lines.push(line); });
    logRejections("discord_gateway_interaction_failed", async (_interaction: string) => { throw Object.assign(new Error("Unknown interaction"), { code: 10062 }); })("interaction");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(lines.map(line => JSON.parse(line) as unknown), [{ event: "discord_gateway_interaction_failed", code: 10062 }]);
  });
});

describe("Convex intake calls", () => {
  let calls: Array<{ url: string; init: RequestInit }>;
  let response: () => Response;

  beforeEach(() => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site"; process.env.DISCORD_INTAKE_SECRET = "secret";
    calls = [];
    response = () => new Response("{}");
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return response(); };
  });

  it("posts to the Convex relay with the intake secret", async () => {
    await relay("message", "create", guildId, channelId, { messageId: "300000000000000001" });
    assert.equal(calls[0].url, "https://example.convex.site/discord-intake/relay");
    assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer secret");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { kind: "message", action: "create", guildId, channelId, payload: { messageId: "300000000000000001" } });
  });

  it("rejects when the relay refuses, so the caller can log it", async () => {
    response = () => new Response("{}", { status: 500 });
    await assert.rejects(relay("message", "create", guildId, channelId, {}));
  });

  it("lists connectors for one channel, one guild, or all of them", async () => {
    response = () => new Response(JSON.stringify({ connectors: [connector()] }));
    assert.deepEqual(await fetchConnectors({ guildId, channelId }), [connector()]);
    await fetchConnectors({ guildId });
    await fetchConnectors();
    assert.deepEqual(calls.map(call => call.url), [
      `https://example.convex.site/discord-intake/connectors?guildId=${guildId}&channelId=${channelId}`,
      `https://example.convex.site/discord-intake/connectors?guildId=${guildId}`,
      "https://example.convex.site/discord-intake/connectors",
    ]);
    assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer secret");
  });

  it("rejects when the connector listing fails, so nothing is cached", async () => {
    response = () => new Response("{}", { status: 503 });
    await assert.rejects(fetchConnectors());
  });

  it("beats only while the client is ready", async () => {
    await sendHeartbeat({ isReady: () => false }, "instance");
    assert.equal(calls.length, 0);
    await sendHeartbeat({ isReady: () => true }, "instance");
    assert.equal(calls[0].url, "https://example.convex.site/discord-intake/heartbeat");
  });

  it("relays each message of a bulk delete through the connected-channel gate", async () => {
    const posts = ["300000000000000001", "300000000000000002"].map(id => ({ id, guildId, channelId }));
    await relayBulkDelete(async () => [], posts);
    assert.equal(calls.length, 0);
    await relayBulkDelete(async () => [connector()], posts);
    assert.deepEqual(calls.map(call => JSON.parse(String(call.init.body)) as unknown), posts.map(({ id }) => ({ kind: "message", action: "delete", guildId, channelId, payload: { messageId: id } })));
  });

  describe("relayConnected", () => {
    const post = { id: "300000000000000001", guildId, channelId };
    const relayedPayloads = () => calls.map(call => (JSON.parse(String(call.init.body)) as { payload: unknown }).payload);

    it("relays only from a channel with an active announcements connector", async () => {
      for (const connectors of [[], [connector({ state: "paused" })], [connector({ kind: "discord_board" })]]) {
        await relayConnected(async () => connectors, "create", post, () => ({ messageId: post.id }));
      }
      assert.equal(calls.length, 0);
      await relayConnected(async () => [connector()], "update", post, () => ({ messageId: post.id }));
      assert.deepEqual(relayedPayloads(), [{ messageId: post.id }]);
    });

    it("skips direct messages and posts with no payload", async () => {
      await relayConnected(async () => [connector()], "create", { ...post, guildId: null }, () => ({ messageId: post.id }));
      await relayConnected(async () => [connector()], "create", post, () => null);
      assert.equal(calls.length, 0);
    });

    it("logs one JSON line with the message ID and status, and never throws", async (t) => {
      const lines: string[] = [];
      t.mock.method(console, "error", (line: string) => { lines.push(line); });
      await relayConnected(async () => { throw new Error("lookup failed with https://cdn.discordapp.com/signed"); }, "create", post, () => null);
      for (const status of [401, 503, 500]) {
        response = () => new Response("{}", { status });
        await relayConnected(async () => [connector()], "create", post, () => ({ content: "Friday 9pm" }));
      }
      assert.deepEqual(lines.map(line => JSON.parse(line) as unknown), [
        { event: "discord_gateway_relay_failed", messageId: post.id },
        { event: "discord_gateway_relay_failed", messageId: post.id, status: 401 },
        { event: "discord_gateway_relay_failed", messageId: post.id, status: 503 },
        { event: "discord_gateway_relay_failed", messageId: post.id, status: 500 },
      ]);
    });

    it("rejects with the listing status so a failed lookup logs it", async (t) => {
      const lines: string[] = [];
      t.mock.method(console, "error", (line: string) => { lines.push(line); });
      response = () => new Response("{}", { status: 503 });
      await relayConnected(() => fetchConnectors({ guildId, channelId }), "create", post, () => null);
      assert.deepEqual(JSON.parse(lines[0]), { event: "discord_gateway_relay_failed", messageId: post.id, status: 503 });
    });
  });
});
