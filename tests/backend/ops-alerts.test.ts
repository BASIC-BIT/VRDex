import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { makeFunctionReference } from "convex/server";
import { notifyOps } from "../../convex/_opsAlerts";
import { opsAlertEmailInput } from "../../convex/opsAlertEmail";
import { enqueueSyncJob } from "../../convex/_eventSync";
import { connectorFixture } from "./_eventConnectorFixture";

const NOW = Date.UTC(2027, 0, 10, 12);
beforeEach(test => test.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW }));
const claim = makeFunctionReference<"mutation">("eventSync:claimJob");
const fail = makeFunctionReference<"mutation">("eventSync:failJob");
const recover = makeFunctionReference<"mutation">("eventSync:recoverExpiredJobs");
const reserve = makeFunctionReference<"mutation">("opsAlerts:reserve");
const sends = (f: Awaited<ReturnType<typeof connectorFixture>>) => f.t.run(async ctx =>
  (await ctx.db.system.query("_scheduled_functions").collect()).filter(fn => fn.name.includes("opsAlertEmail")));

it("sends one email per key per six hours with the ops prefix", async t => {
  const f = await connectorFixture();
  const alert = { key: "k1", subject: "Gateway stale", body: "No heartbeat" };
  await f.t.run(ctx => notifyOps(ctx, alert));
  await f.t.run(ctx => notifyOps(ctx, alert));
  await f.t.run(ctx => notifyOps(ctx, { ...alert, key: "k2" }));
  assert.equal((await sends(f)).length, 2);
  const [first] = await sends(f);
  assert.deepEqual(first!.args[0], { to: "basic@basicbit.net", subject: "[VRDex ops] Gateway stale", body: "No heartbeat" });
  // Ticking would run the queued sends, which need SES; the rows stay as canceled.
  await f.t.run(async ctx => { for (const fn of await ctx.db.system.query("_scheduled_functions").collect()) await ctx.scheduler.cancel(fn._id); });
  t.mock.timers.tick(6 * 3_600_000);
  await f.t.run(ctx => notifyOps(ctx, alert));
  assert.equal((await sends(f)).length, 3);
});

it("the action-side reservation dedupes like the mutation path", async () => {
  const f = await connectorFixture();
  assert.equal(await f.t.mutation(reserve, { key: "k1" }), true);
  assert.equal(await f.t.mutation(reserve, { key: "k1" }), false);
});

// deliverOpsAlert itself needs @aws-sdk/client-ses, which this runner cannot load; it sends exactly this input.
it("builds the SES send input", () => {
  assert.deepEqual(opsAlertEmailInput({ to: "ops@example.com", subject: "[VRDex ops] X", body: "Y" }, "noreply@vrdex.example"),
    { Source: "noreply@vrdex.example", Destination: { ToAddresses: ["ops@example.com"] }, Message: { Subject: { Data: "[VRDex ops] X", Charset: "UTF-8" }, Body: { Text: { Data: "Y", Charset: "UTF-8" } } } });
});

it("alerts on a connector's fifth consecutive failed job only", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector({ consecutiveFailures: 3 });
  const failJobToEnd = async () => {
    const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
    await f.t.run(ctx => ctx.db.patch(jobId, { attempts: 4 }));
    await f.t.mutation(claim, { jobId });
    await f.t.mutation(fail, { jobId, error: "provider refused", durationMs: 1 });
  };
  await failJobToEnd();
  assert.equal((await sends(f)).length, 0);
  await failJobToEnd();
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.consecutiveFailures, 5);
  assert.equal((await sends(f)).length, 1);
});

it("an expired lease's final failure counts toward the alarm", async t => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector({ consecutiveFailures: 4 });
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile", dueAt: NOW + 86_400_000 }));
  await f.t.run(ctx => ctx.db.patch(jobId, { attempts: 4 }));
  await f.t.mutation(claim, { jobId });
  t.mock.timers.tick(600_000 + 300_001);
  await f.t.mutation(recover, {});
  assert.equal((await f.t.run(ctx => ctx.db.get(jobId)))!.state, "failed");
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.consecutiveFailures, 5);
  const [email] = await sends(f);
  assert.match((email!.args[0] as { body: string }).body, /lease_expired/);
});

it("a retry does not count", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector({ consecutiveFailures: 4 });
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  await f.t.mutation(claim, { jobId });
  await f.t.mutation(fail, { jobId, error: "provider refused", durationMs: 1 });
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.consecutiveFailures, 4);
  assert.equal((await sends(f)).length, 0);
});

it("a success after the alert sends exactly one resolved email; a success with no alert sends none", async () => {
  const f = await connectorFixture();
  const complete = makeFunctionReference<"mutation">("eventSync:completeJob");
  const succeed = async (connectorId: Awaited<ReturnType<typeof f.insertConnector>>) => {
    const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
    await f.t.mutation(claim, { jobId });
    await f.t.mutation(complete, { jobId, durationMs: 1 });
  };
  const quiet = await f.insertConnector({ target: { calendarId: "quiet" } });
  await succeed(quiet);
  assert.equal((await sends(f)).length, 0);
  const noisy = await f.insertConnector({ consecutiveFailures: 5 });
  await f.t.run(ctx => notifyOps(ctx, { key: `connector-failures:${noisy}`, subject: "Event connector failing", body: "x" }));
  await succeed(noisy);
  await succeed(noisy);
  assert.equal((await f.t.run(ctx => ctx.db.get(noisy)))!.consecutiveFailures, 0);
  const subjects = (await sends(f)).map(fn => (fn.args[0] as { subject: string }).subject);
  assert.deepEqual(subjects, ["[VRDex ops] Event connector failing", `[VRDex ops] Resolved: connector-failures:${noisy}`]);
});
