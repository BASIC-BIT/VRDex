import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { AUTHOR_A, CHANNEL, GUILD, M1, M2, SECRET, message, record, seedDiscordIntake } from "./helpers/discord-intake";

type T = Awaited<ReturnType<typeof seedDiscordIntake>>["t"];
type Route = readonly [string, string, Record<string, unknown> | undefined];

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));

const auth = (secret = SECRET): Record<string, string> => ({ authorization: `Bearer ${secret}`, "content-type": "application/json" });
const routes = [
  ["GET", `/discord-intake/connectors?guildId=${GUILD}&channelId=${CHANNEL}`, undefined],
  ["POST", "/discord-intake/relay", { kind: "message", action: "create", guildId: GUILD, channelId: CHANNEL, payload: message(M1) }],
  ["POST", "/discord-intake/command", { command: "status", guildId: GUILD, channelId: CHANNEL, invokerDiscordUserId: AUTHOR_A, invokerHasManageGuild: true, options: { channelName: "announcements" } }],
  ["POST", "/discord-intake/heartbeat", { instanceId: "gw-1", at: 1 }],
] as const satisfies readonly Route[];
const call = (t: T, [method, path, body]: Route, headers = auth()) => t.fetch(path, { method, headers, body: body && JSON.stringify(body) });
const enable = () => { process.env.DISCORD_INTAKE_SECRET = SECRET; process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true"; };

it("answers 503 on every route while the flag is off", async () => {
  const { t } = await seedDiscordIntake();
  process.env.DISCORD_INTAKE_SECRET = SECRET; process.env.VRDEX_DISCORD_INTAKE_ENABLED = "false";
  for (const route of routes) assert.equal((await call(t, route)).status, 503);
});

it("answers 401 to a wrong or missing bearer", async () => {
  const { t } = await seedDiscordIntake();
  enable();
  for (const route of routes) {
    assert.equal((await call(t, route, auth("x".repeat(40)))).status, 401);
    assert.equal((await call(t, route, { "content-type": "application/json" })).status, 401);
  }
});

it("returns the channel's connectors", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  enable();
  const response = await call(t, routes[0]);
  assert.deepEqual(await response.json(), { connectors: [{ connectorId, kind: "discord_announcements", direction: "import", mode: "hold", state: "active", guildId: GUILD, channelId: CHANNEL }] });
});

it("lists a guild's connectors when only guildId is given", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  enable();
  const response = await call(t, ["GET", `/discord-intake/connectors?guildId=${GUILD}`, undefined]);
  const { connectors } = await response.json() as { connectors: Array<{ connectorId: string; guildId: string; channelId?: string }> };
  assert.deepEqual(connectors.map(row => [row.connectorId, row.guildId, row.channelId]), [[connectorId, GUILD, CHANNEL]]);
  assert.equal((await call(t, ["GET", `/discord-intake/connectors?channelId=${CHANNEL}`, undefined])).status, 400);
});

it("lists every active connector with its newest message ID when called without a query", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  enable();
  await record(t, "create", message(M1));
  await record(t, "create", message(M2));
  const response = await call(t, ["GET", "/discord-intake/connectors", undefined]);
  assert.deepEqual(await response.json(), { connectors: [{ connectorId, kind: "discord_announcements", direction: "import", mode: "hold", state: "active", guildId: GUILD, channelId: CHANNEL, lastMessageId: M2 }] });
});

it("relays a message into recordMessage and rejects malformed IDs", async () => {
  const { t } = await seedDiscordIntake();
  enable();
  assert.equal((await call(t, routes[1])).status, 200);
  assert.equal((await t.run(ctx => ctx.db.query("discordIntakeMessages").collect())).length, 1);
  const body = routes[1][2];
  assert.equal((await call(t, ["POST", "/discord-intake/relay", { ...body, channelId: "12" }])).status, 400);
  assert.equal((await call(t, ["POST", "/discord-intake/relay", { ...body, payload: message("12") }])).status, 400);
  assert.equal((await call(t, ["POST", "/discord-intake/relay", { ...body, payload: message(M2, { authorId: "12" }) }])).status, 400);
  assert.equal((await t.run(ctx => ctx.db.query("discordIntakeMessages").collect())).length, 1);
});

it("upserts one heartbeat row per instance", async () => {
  const { t } = await seedDiscordIntake();
  enable();
  await call(t, routes[3]);
  await call(t, ["POST", "/discord-intake/heartbeat", { instanceId: "gw-1", at: 2 }]);
  const rows = await t.run(ctx => ctx.db.query("discordGatewayHeartbeats").collect());
  assert.equal(rows.length, 1); assert.equal(rows[0].at, 2);
});
