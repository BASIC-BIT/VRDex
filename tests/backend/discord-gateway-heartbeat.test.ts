import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { modules } from "./helpers/discord-intake";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
type T = TestConvex<typeof schema>;

const previousFlag = process.env.VRDEX_DISCORD_INTAKE_ENABLED;
let t: T;
// Mocked so the queued alert emails, which need SES, never fire.
beforeEach(test => { test.mock.timers.enable({ apis: ["setTimeout"] }); t = convexTest({ schema, modules }); });
afterEach(() => {
  if (previousFlag === undefined) delete process.env.VRDEX_DISCORD_INTAKE_ENABLED;
  else process.env.VRDEX_DISCORD_INTAKE_ENABLED = previousFlag;
});

const seedHeartbeat = (t: T, receivedAt: number) => t.run(ctx => ctx.db.insert("discordGatewayHeartbeats", { instanceId: crypto.randomUUID(), at: receivedAt, receivedAt }));
const opsAlerts = (t: T) => t.run(ctx => ctx.db.query("opsAlerts").collect());

it("alerts when the newest heartbeat is older than 300 s", async () => {
  process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  await seedHeartbeat(t, Date.now() - 301_000);
  const result = await t.mutation(internal.discordIntake.checkHeartbeat, {});
  assert.equal(result.checked && result.stale, true);
  assert.deepEqual((await opsAlerts(t)).map(a => a.key), ["discord_gateway_heartbeat_stale"]);
});

it("stays quiet when a heartbeat arrived within 300 s", async () => {
  process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  await seedHeartbeat(t, Date.now() - 301_000);
  await seedHeartbeat(t, Date.now() - 299_000); // newest wins
  const result = await t.mutation(internal.discordIntake.checkHeartbeat, {});
  assert.equal(result.checked && result.stale, false);
  assert.equal((await opsAlerts(t)).length, 0);
});

it("resolves once when a fresh heartbeat follows a stale alert", async () => {
  process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  await seedHeartbeat(t, Date.now() - 301_000);
  await t.mutation(internal.discordIntake.checkHeartbeat, {}); // stale: alert
  await seedHeartbeat(t, Date.now());
  await t.mutation(internal.discordIntake.checkHeartbeat, {}); // fresh: resolve
  const [first] = await opsAlerts(t);
  assert.equal(typeof first.resolvedAt, "number");
  await t.mutation(internal.discordIntake.checkHeartbeat, {}); // still fresh: no second resolved email
  const [second] = await opsAlerts(t);
  assert.equal(second.resolvedAt, first.resolvedAt);
});

it("alerts when no heartbeat was ever recorded", async () => {
  process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  const result = await t.mutation(internal.discordIntake.checkHeartbeat, {});
  assert.deepEqual(result, { checked: true, stale: true, newestAt: null });
  assert.equal((await opsAlerts(t)).length, 1);
});

it("skips while intake is disabled", async () => {
  delete process.env.VRDEX_DISCORD_INTAKE_ENABLED;
  const result = await t.mutation(internal.discordIntake.checkHeartbeat, {});
  assert.deepEqual(result, { checked: false });
  assert.equal((await opsAlerts(t)).length, 0);
});
