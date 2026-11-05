import assert from "node:assert/strict";
import { it } from "node:test";
import { discordBotInviteUrl, readableTextChannels } from "../../convex/_discordIntake";
import { DISCORD_BOT_PERMISSIONS } from "../../convex/_discordRest";

const GUILD = "100000000000000001";
const ROLE = "500000000000000001";
const VIEW_AND_HISTORY = String(1024 + 65536);
const access = { guildId: GUILD, botUserId: "400000000000000001", botRoleIds: [ROLE], roles: [{ id: GUILD, permissions: VIEW_AND_HISTORY }, { id: ROLE, permissions: "0" }] };
const channel = (id: string, type: number, permission_overwrites: Array<{ id: string; type: number; allow: string; deny: string }> = [], position?: number) =>
  ({ id, name: `c${id.slice(-1)}`, type, permission_overwrites, position });
const channels = [
  channel("600000000000000001", 0),
  channel("600000000000000002", 0, [{ id: GUILD, type: 0, allow: "0", deny: "1024" }]),
  channel("600000000000000003", 5, [{ id: GUILD, type: 0, allow: "0", deny: "1024" }, { id: ROLE, type: 0, allow: "1024", deny: "0" }]),
  channel("600000000000000004", 2),
];

it("lists only text and announcement channels the bot can read", () => {
  assert.deepEqual(readableTextChannels(channels, access).map(row => row.channelId), ["600000000000000001", "600000000000000003"]);
  const admin = { ...access, roles: [{ id: GUILD, permissions: "0" }, { id: ROLE, permissions: "8" }] };
  assert.equal(readableTextChannels(channels, admin).length, 3);
});

it("needs Read Message History as well as View Channel, and a member overwrite decides last", () => {
  const viewOnly = { ...access, roles: [{ id: GUILD, permissions: "1024" }] };
  assert.deepEqual(readableTextChannels([channel("600000000000000001", 0)], viewOnly), []);
  const denied = channel("600000000000000001", 0, [
    { id: ROLE, type: 0, allow: VIEW_AND_HISTORY, deny: "0" },
    { id: access.botUserId, type: 1, allow: "0", deny: "1024" },
  ]);
  assert.deepEqual(readableTextChannels([denied], access), []);
});

it("returns the channels in Discord's position order", () => {
  const rows = [channel("600000000000000002", 0, [], 2), channel("600000000000000001", 5, [], 1)];
  assert.deepEqual(readableTextChannels(rows, access), [{ channelId: "600000000000000001", name: "c1" }, { channelId: "600000000000000002", name: "c2" }]);
});

it("builds the bot invite with the fixed scopes and permissions", () => {
  assert.equal(discordBotInviteUrl("700000000000000001", GUILD), `https://discord.com/oauth2/authorize?client_id=700000000000000001&scope=bot+applications.commands&permissions=17600776072192&guild_id=${GUILD}&disable_guild_select=true`);
  assert.equal(DISCORD_BOT_PERMISSIONS, 17600776072192);
});
