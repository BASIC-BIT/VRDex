import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";

import { buildCommandRequest, handleVrdexInteraction, vrdexCommand } from "./commands";

describe("/vrdex command", () => {
  it("registers /vrdex for Manage Server holders only", () => {
    const json = vrdexCommand.toJSON();
    assert.equal(json.name, "vrdex");
    assert.equal(json.default_member_permissions, "32");
    assert.deepEqual(json.options!.map(option => option.name), ["connect", "disconnect", "status"]);
    const connect = json.options![0] as unknown as { options: Array<Record<string, unknown>> };
    assert.deepEqual(connect.options.map(option => [option.name, option.required ?? false]), [["community", true], ["mode", true], ["quiet_window", false]]);
    assert.equal(connect.options[0].autocomplete, true);
    assert.deepEqual(JSON.parse(JSON.stringify(connect.options[1].choices)), [{ name: "Hold for review", value: "hold" }, { name: "Publish automatically", value: "autopublish" }]);
    assert.deepEqual([connect.options[2].min_value, connect.options[2].max_value], [30, 600]);
  });

  it("carries the listed descriptions", () => {
    const json = vrdexCommand.toJSON();
    const connect = json.options![0] as unknown as { options: Array<{ description: string }> };
    assert.deepEqual(
      [json.description, ...json.options!.map(option => option.description), ...connect.options.map(option => option.description)],
      ["VRDex", "Connect this channel", "Disconnect this channel", "Show this channel's connection", "Community", "Mode", "Seconds to wait for edits"],
    );
  });

  it("reports the invoker's Manage Server permission to Convex", () => {
    const base = { subcommand: "connect" as const, guildId: "100000000000000001", guildName: "Night Server", channelId: "100000000000000002", channelName: "announcements", userId: "200000000000000001", options: { community: "night-club", mode: "hold" } };
    assert.equal(buildCommandRequest({ ...base, memberPermissions: "32" }).invokerHasManageGuild, true);
    assert.equal(buildCommandRequest({ ...base, memberPermissions: "2048" }).invokerHasManageGuild, false);
    assert.deepEqual(buildCommandRequest({ ...base, memberPermissions: "8" }), {
      command: "connect", guildId: base.guildId, channelId: base.channelId, invokerDiscordUserId: base.userId, invokerHasManageGuild: true,
      options: { community: "night-club", mode: "hold", channelName: "announcements", guildName: "Night Server" },
    });
  });
});

describe("handleVrdexInteraction", () => {
  const context = {
    guildId: "100000000000000001", channelId: "100000000000000002", user: { id: "200000000000000001" },
    guild: { name: "Night Server" }, channel: { name: "announcements" }, memberPermissions: { bitfield: 32n },
  };
  let bodies: Array<Record<string, unknown>>;
  let response: () => Response;

  beforeEach(() => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site"; process.env.DISCORD_INTAKE_SECRET = "secret";
    bodies = [];
    response = () => new Response(JSON.stringify({ reply: "Connected" }));
    globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init!.body)) as Record<string, unknown>); return response(); };
  });

  const chatInput = (data: Array<{ name: string; value: string | number }> = []) => {
    const calls: unknown[][] = [];
    const interaction = {
      ...context,
      isAutocomplete: () => false,
      options: { getSubcommand: () => "connect", data: [{ name: "connect", options: data }] },
      deferReply: async (...args: unknown[]) => { calls.push(["deferReply", ...args]); },
      editReply: async (...args: unknown[]) => { calls.push(["editReply", ...args]); },
      deleteReply: async () => { calls.push(["deleteReply"]); },
    };
    return { calls, interaction: interaction as unknown as ChatInputCommandInteraction };
  };

  const autocomplete = () => {
    const responded: unknown[] = [];
    const interaction = {
      ...context,
      isAutocomplete: () => true,
      options: { getFocused: () => "ni" },
      respond: async (choices: unknown) => { responded.push(choices); },
    };
    return { responded, interaction: interaction as unknown as AutocompleteInteraction };
  };

  it("defers privately, forwards the given options, and replies without pinging anyone", async () => {
    const { calls, interaction } = chatInput([{ name: "community", value: "night-club" }, { name: "mode", value: "hold" }, { name: "quiet_window", value: 90 }]);
    await handleVrdexInteraction(interaction);
    assert.deepEqual(bodies[0], {
      command: "connect", guildId: context.guildId, channelId: context.channelId, invokerDiscordUserId: context.user.id, invokerHasManageGuild: true,
      options: { community: "night-club", mode: "hold", quiet_window: 90, channelName: "announcements", guildName: "Night Server" },
    });
    assert.deepEqual(calls, [["deferReply", { flags: 64 }], ["editReply", { content: "Connected", allowedMentions: { parse: [] } }]]);
  });

  it("omits quiet_window when it was not given and sends only documented option keys", async () => {
    await handleVrdexInteraction(chatInput([{ name: "community", value: "night-club" }, { name: "mode", value: "hold" }]).interaction);
    assert.deepEqual(Object.keys(bodies[0].options as object).sort(), ["channelName", "community", "guildName", "mode"]);
  });

  it("falls back to the IDs when Discord gives no names", async () => {
    const { interaction } = chatInput();
    Object.assign(interaction, { guild: null, channel: null, memberPermissions: null });
    await handleVrdexInteraction(interaction);
    assert.equal(bodies[0].invokerHasManageGuild, false);
    assert.deepEqual(bodies[0].options, { channelName: context.channelId, guildName: context.guildId });
  });

  it("deletes the deferred reply and logs one line when Convex fails", async (t) => {
    const lines: string[] = [];
    t.mock.method(console, "error", (line: string) => { lines.push(line); });
    response = () => new Response("{}", { status: 500 });
    const failed = chatInput();
    await handleVrdexInteraction(failed.interaction);
    assert.deepEqual(failed.calls.at(-1), ["deleteReply"]);
    globalThis.fetch = async () => { throw new Error("network down"); };
    const thrown = chatInput();
    await handleVrdexInteraction(thrown.interaction);
    assert.deepEqual(thrown.calls.at(-1), ["deleteReply"]);
    assert.deepEqual(lines.map(line => JSON.parse(line) as unknown), [{ event: "discord_gateway_command_failed", status: 500 }, { event: "discord_gateway_command_failed" }]);
  });

  it("never throws when Discord itself refuses", async (t) => {
    t.mock.method(console, "error", () => {});
    const { interaction } = chatInput();
    Object.assign(interaction, { deferReply: async () => { throw new Error("Unknown interaction"); } });
    await handleVrdexInteraction(interaction);
    assert.equal(bodies.length, 0);
  });

  it("answers autocomplete with the focused value, capped at 25 choices", async () => {
    const choices = Array.from({ length: 30 }, (_, index) => ({ name: `Club ${index}`, value: `club-${index}` }));
    response = () => new Response(JSON.stringify({ choices }));
    const { responded, interaction } = autocomplete();
    await handleVrdexInteraction(interaction);
    assert.equal(bodies[0].command, "autocomplete");
    assert.deepEqual(bodies[0].options, { query: "ni", channelName: "announcements", guildName: "Night Server" });
    assert.deepEqual(responded, [choices.slice(0, 25)]);
  });

  it("answers autocomplete with nothing on failure and logs the status", async (t) => {
    const lines: string[] = [];
    t.mock.method(console, "error", (line: string) => { lines.push(line); });
    response = () => new Response("{}", { status: 503 });
    const { responded, interaction } = autocomplete();
    await handleVrdexInteraction(interaction);
    assert.deepEqual(responded, [[]]);
    assert.deepEqual(lines.map(line => JSON.parse(line) as unknown), [{ event: "discord_gateway_command_failed", status: 503 }]);
  });
});
