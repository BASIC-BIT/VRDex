import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { enqueueProductAnalytics } from "../../convex/_productAnalytics";
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/productAnalytics.ts": () => import("../../convex/productAnalytics"),
  "../../convex/productAnalyticsDelivery.ts": () => import("../../convex/productAnalyticsDelivery"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const originalFetch = globalThis.fetch; const originalKey = process.env.POSTHOG_PROJECT_API_KEY;
afterEach(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.POSTHOG_PROJECT_API_KEY; else process.env.POSTHOG_PROJECT_API_KEY = originalKey; });
const setup = async () => { const t = convexTest({ schema, modules });
  const id = await t.run(ctx => enqueueProductAnalytics(ctx.db, { event: "event_intake_run", distinctId: "event_intake:draft", properties: { trigger: "web", turns: 2 } }));
  return { t, id }; };
it("enqueues a pending row", async () => {
  const { t, id } = await setup(); const row = await t.run(ctx => ctx.db.get(id));
  assert.equal(row?.attemptCount, 0); assert.equal(row?.deliveredAt, undefined); assert.ok(row!.nextAttemptAt <= Date.now());
});
it("delivers to the PostHog capture endpoint and marks the row delivered", async () => {
  const { t, id } = await setup(); process.env.POSTHOG_PROJECT_API_KEY = "phc_test"; const sent: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => { sent.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response("{}"); }) as typeof fetch;
  await t.action(internal.productAnalyticsDelivery.deliverPending, {});
  assert.equal(sent[0]!.url, "https://us.i.posthog.com/i/v0/e/");
  assert.equal(sent[0]!.body.api_key, "phc_test"); assert.equal(sent[0]!.body.event, "event_intake_run");
  assert.deepEqual(sent[0]!.body.properties, { distinct_id: "event_intake:draft", $insert_id: id, $process_person_profile: false, trigger: "web", turns: 2 });
  assert.ok((await t.run(ctx => ctx.db.get(id)))?.deliveredAt);
});
it("leaves rows untouched without a project key", async () => {
  const { t, id } = await setup(); delete process.env.POSTHOG_PROJECT_API_KEY; let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
  await t.action(internal.productAnalyticsDelivery.deliverPending, {});
  assert.equal(calls, 0); assert.equal((await t.run(ctx => ctx.db.get(id)))?.attemptCount, 0);
});
it("backs off on failure, recovers an abandoned lease, and stops after five attempts", async test => {
  test.mock.timers.enable({ apis: ["setTimeout"] }); // the dead letter queues an ops email
  const { t, id } = await setup(); process.env.POSTHOG_PROJECT_API_KEY = "phc_test";
  globalThis.fetch = (async () => new Response("no", { status: 503 })) as typeof fetch;
  await t.action(internal.productAnalyticsDelivery.deliverPending, {});
  let row = await t.run(ctx => ctx.db.get(id));
  assert.equal(row?.attemptCount, 1); assert.ok(row!.nextAttemptAt > Date.now()); assert.equal(row?.deliveredAt, undefined);
  await t.run(ctx => ctx.db.patch(id, { nextAttemptAt: Date.now() - 1 }));
  assert.equal((await t.mutation(internal.productAnalytics.claimNext, {}))?._id, id); // claimed, action "dies"
  await t.run(ctx => ctx.db.patch(id, { nextAttemptAt: Date.now() - 1 })); // lease elapsed
  assert.equal((await t.mutation(internal.productAnalytics.claimNext, {}))?.attemptCount, 3);
  await t.run(ctx => ctx.db.patch(id, { attemptCount: 4, nextAttemptAt: Date.now() - 1 }));
  await t.action(internal.productAnalyticsDelivery.deliverPending, {});
  row = await t.run(ctx => ctx.db.get(id));
  assert.equal(row?.attemptCount, 5); assert.equal(row?.nextAttemptAt, Number.MAX_SAFE_INTEGER);
  assert.equal(await t.mutation(internal.productAnalytics.claimNext, {}), null);
});
it("web enqueue accepts only event_intake_run", async () => {
  const t = convexTest({ schema, modules });
  await t.mutation(internal.productAnalytics.enqueue, { event: "event_intake_run", distinctId: "event_intake:draft", properties: { trigger: "mcp" } });
  await assert.rejects(t.mutation(internal.productAnalytics.enqueue, { event: "claim_resolved" as "event_intake_run", distinctId: "x", properties: {} }));
});
const opsSends = (t: ReturnType<typeof convexTest>) => t.run(async ctx =>
  (await ctx.db.system.query("_scheduled_functions").collect()).filter(fn => fn.name.includes("opsAlertEmail")).map(fn => (fn.args[0] as { subject: string; body: string })));
const deadLetter = async (t: ReturnType<typeof convexTest>) => {
  const id = await t.run(ctx => enqueueProductAnalytics(ctx.db, { event: "event_intake_run", distinctId: "user:secret", properties: { email: "a@b.example" } }));
  await t.run(ctx => ctx.db.patch(id, { attemptCount: 5 }));
  await t.mutation(internal.productAnalytics.recordFailure, { outboxId: id });
  return id;
};
it("alerts ops once per six hours on a dead letter and once on the next delivery", async test => {
  test.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.UTC(2027, 0, 10, 12) });
  const t = convexTest({ schema, modules });
  const id = await deadLetter(t);
  await deadLetter(t);
  const [alert, ...rest] = await opsSends(t);
  assert.equal(rest.length, 0);
  assert.equal(alert!.subject, "[VRDex ops] Product analytics delivery failing");
  assert.equal(alert!.body, `Outbox row ${id} (event_intake_run) stopped retrying after 5 attempts. Created 2027-01-10T12:00:00.000Z.`);
  const delivered = await t.run(ctx => enqueueProductAnalytics(ctx.db, { event: "event_intake_run", distinctId: "x", properties: {} }));
  await t.mutation(internal.productAnalytics.recordSuccess, { outboxId: delivered });
  await t.mutation(internal.productAnalytics.recordSuccess, { outboxId: delivered });
  assert.deepEqual((await opsSends(t)).map(send => send.subject), ["[VRDex ops] Product analytics delivery failing", "[VRDex ops] Resolved: product-analytics-delivery"]);
});
