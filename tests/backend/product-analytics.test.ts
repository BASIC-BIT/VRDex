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
it("backs off on failure, recovers an abandoned lease, and stops after five attempts", async () => {
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
