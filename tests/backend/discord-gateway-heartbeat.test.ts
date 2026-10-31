import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { discordIntakeAlertKey } from "../../convex/_eventSync";
import schemaModule from "../../convex/schema";
import { AUTHOR_A, M1, M2, message, modules, record, seedDiscordIntake } from "./helpers/discord-intake";

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

const LEASE_MS = 15 * 60_000;
const M3 = "300000000000000003";
const runs = (t: T) => t.run(ctx => ctx.db.query("discordIntakeRuns").collect());
const seedRunning = (t: T, connectorId: Id<"eventConnectors">, ageMs: number, stalledRetry?: boolean) => t.run(ctx => ctx.db.insert("discordIntakeRuns", {
  connectorId, authorId: AUTHOR_A, triggerMessageIds: [M1, M2], state: "running", startedAt: Date.now() - ageMs, createdAt: Date.now() - ageMs, stalledRetry,
}));
const assertClosedAndAlerted = async (t: T, runId: Id<"discordIntakeRuns">, connectorId: Id<"eventConnectors">) => {
  const closed = await t.run(ctx => ctx.db.get(runId));
  assert.equal(closed?.state, "failed");
  assert.equal(closed?.reason, "stalled");
  assert.deepEqual((await opsAlerts(t)).map(a => a.key), [discordIntakeAlertKey(connectorId)]);
};

it("closes a run past its lease, alerts, and requeues its posts once", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const runId = await seedRunning(t, connectorId, LEASE_MS);
  assert.deepEqual(await t.mutation(internal.discordIntake.sweepStalledRuns, {}), { closed: 1, retried: 1 });
  await assertClosedAndAlerted(t, runId, connectorId);
  const pending = (await runs(t)).filter(run => run.state === "pending");
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].triggerMessageIds, [M1, M2]);
  assert.equal(pending[0].stalledRetry, true);
  assert.equal(typeof pending[0].scheduledFunctionId, "string");
});

it("leaves a run inside its lease alone", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const runId = await seedRunning(t, connectorId, LEASE_MS - 60_000);
  assert.deepEqual(await t.mutation(internal.discordIntake.sweepStalledRuns, {}), { closed: 0, retried: 0 });
  assert.equal((await t.run(ctx => ctx.db.get(runId)))?.state, "running");
  assert.equal((await runs(t)).length, 1);
  assert.equal((await opsAlerts(t)).length, 0);
});

it("does not requeue a run that was already a retry", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const runId = await seedRunning(t, connectorId, LEASE_MS, true);
  assert.deepEqual(await t.mutation(internal.discordIntake.sweepStalledRuns, {}), { closed: 1, retried: 0 });
  await assertClosedAndAlerted(t, runId, connectorId);
  assert.equal((await runs(t)).length, 1);
});

for (const [label, patch] of [["paused", { state: "paused" as const }], ["switched off", { direction: "off" as const }]] as const) {
  it(`does not requeue a run when the connector is ${label}`, async () => {
    const { t, connectorId } = await seedDiscordIntake();
    await t.run(ctx => ctx.db.patch(connectorId, patch));
    const runId = await seedRunning(t, connectorId, LEASE_MS);
    assert.deepEqual(await t.mutation(internal.discordIntake.sweepStalledRuns, {}), { closed: 1, retried: 0 });
    await assertClosedAndAlerted(t, runId, connectorId);
    assert.equal((await runs(t)).length, 1);
  });
}

it("joins the stalled posts to a pending run the author already has", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  await record(t, "create", message(M3));
  await seedRunning(t, connectorId, LEASE_MS);
  assert.deepEqual(await t.mutation(internal.discordIntake.sweepStalledRuns, {}), { closed: 1, retried: 1 });
  const pending = (await runs(t)).filter(run => run.state === "pending");
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].triggerMessageIds, [M3, M1, M2]);
  assert.equal(pending[0].stalledRetry, true);
});
