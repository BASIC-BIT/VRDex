import assert from "node:assert/strict";
import { it } from "node:test";

import { relayScheduledEventPacket, type ScheduledEventRelayDeps } from "./scheduledEvents";

const GUILD = "876543210987654321";
const BOT = "444444444444444444";
const event = (creator: string | null = "333333333333333333") => ({ id: "111111111111111111", guild_id: GUILD, creator_id: creator, name: "Afterglow Harbor Sessions", status: 1, entity_type: 3 });
const summary = (overrides = {}) => ({ connectorId: "c1", kind: "discord_scheduled_events", direction: "bidirectional", mode: "hold", state: "active", guildId: GUILD, ...overrides });
function deps(rows = [summary()]) {
  const sent: unknown[][] = [];
  const value: ScheduledEventRelayDeps = { botUserId: BOT, getConnectors: async ({ guildId }) => rows.filter((row) => row.guildId === guildId), relay: async (...args) => { sent.push(args); } };
  return { sent, value };
}

it("relays create, update, and delete with the raw payload", async () => {
  const { sent, value } = deps();
  for (const t of ["GUILD_SCHEDULED_EVENT_CREATE", "GUILD_SCHEDULED_EVENT_UPDATE", "GUILD_SCHEDULED_EVENT_DELETE"]) {
    assert.equal(await relayScheduledEventPacket({ t, d: event() }, value), true);
  }
  assert.deepEqual(sent.map((args) => args.slice(0, 4)), [
    ["scheduled_event", "create", GUILD, undefined],
    ["scheduled_event", "update", GUILD, undefined],
    ["scheduled_event", "delete", GUILD, undefined],
  ]);
  assert.deepEqual(sent[0][4], event());
});

it("ignores other packets, missing guilds, and guilds without an importing connector", async () => {
  const { sent, value } = deps();
  assert.equal(await relayScheduledEventPacket({ t: "MESSAGE_CREATE", d: event() }, value), false);
  assert.equal(await relayScheduledEventPacket({ t: null, d: null }, value), false);
  assert.equal(await relayScheduledEventPacket({ t: "constructor", d: event() }, value), false);
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_UPDATE", d: { ...event(), guild_id: undefined } }, value), false);
  const none = deps([summary({ direction: "export" }), summary({ state: "paused" }), summary({ kind: "discord_board", channelId: "123456789012345678" })]);
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_UPDATE", d: event() }, none.value), false);
  assert.deepEqual([...sent, ...none.sent], []);
});

it("relays for an import connector", async () => {
  const { sent, value } = deps([summary({ direction: "import" })]);
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_UPDATE", d: event() }, value), true);
  assert.equal(sent.length, 1);
});

it("drops creates authored by the bot but relays its updates", async () => {
  const { sent, value } = deps();
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_CREATE", d: event(BOT) }, value), false);
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_UPDATE", d: event(BOT) }, value), true);
  assert.equal(sent.length, 1);
});

it("does not read a null creator as the bot before the client has a user", async () => {
  const { sent, value } = deps();
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_CREATE", d: event(null) }, { ...value, botUserId: null }), true);
  assert.equal(sent.length, 1);
});
