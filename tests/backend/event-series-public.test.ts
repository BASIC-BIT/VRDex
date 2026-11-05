import assert from "node:assert/strict";
import { beforeEach, it, type TestContext } from "node:test";

import { convexTest } from "convex-test";

import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { NOW, occurrence, seedSeriesCommunity, seriesModules } from "./_eventSeriesFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

beforeEach(() => {
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "true";
  delete process.env.VRDEX_EVENT_CONNECTORS_ENABLED;
});

// Fridays from 2026-11-06 at 20:00 New York, converted from a published event.
async function setup(test: TestContext) {
  test.mock.timers.enable({ apis: ["Date"], now: NOW });
  const t = convexTest({ schema, modules: seriesModules });
  const owner = await seedSeriesCommunity(t);
  const event = await t.withIdentity(owner.identity).mutation(api.events.createCommunityEvent, {
    title: "Harbor Night",
    timezone: "America/New_York",
    communitySlug: "faceless",
    published: true,
    startAt: Date.parse("2026-11-07T01:00:00Z"),
  } as never);
  const { seriesId } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } });
  return { t, owner, seriesId, n06: await occurrence(t, seriesId, "2026-11-06"), n13: await occurrence(t, seriesId, "2026-11-13") };
}

it("an occurrence links its series and the series lists upcoming nights", async (test) => {
  const { t, seriesId, n06, n13 } = await setup(test);
  const night = await t.query(api.events.getPublicBySlug, { slug: n13.slug! });
  assert.equal(night!.seriesId, seriesId);
  const page = await t.query(api.eventSeries.getPublic, { seriesId });
  assert.equal(page!.title, "Harbor Night");
  assert.deepEqual([page!.communitySlug, page!.communityName], ["faceless", "The Faceless"]);
  assert.deepEqual(page!.nights.map(n => n.slug).slice(0, 2), [n06.slug, n13.slug]);
  assert.equal(page!.nights[0]!.id, n06._id);
});

it("a removed series hides its page and its link", async (test) => {
  const { t, seriesId, n13 } = await setup(test);
  await t.run(ctx => ctx.db.patch(seriesId, { state: "removed" })); // the projection rule alone; Task 5 owns the retire behaviour
  assert.equal(await t.query(api.eventSeries.getPublic, { seriesId }), null);
  assert.equal((await t.query(api.events.getPublicBySlug, { slug: n13.slug! }))!.seriesId, undefined);
});

it("an ended series keeps its page and its link", async (test) => {
  const { t, seriesId, n13 } = await setup(test);
  await t.run(ctx => ctx.db.patch(seriesId, { state: "ended" }));
  assert.equal((await t.query(api.eventSeries.getPublic, { seriesId }))!.id, seriesId);
  assert.equal((await t.query(api.events.getPublicBySlug, { slug: n13.slug! }))!.seriesId, seriesId);
});

it("an invalid ID or a non-public community reads as no series", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  assert.equal(await t.query(api.eventSeries.getPublic, { seriesId: "not-a-series" }), null);
  await t.run(ctx => ctx.db.patch(owner.profileId, { publicationState: "draft_private" }));
  assert.equal(await t.query(api.eventSeries.getPublic, { seriesId }), null);
});

it("lists only published scheduled nights that have not finished", async (test) => {
  const { t, seriesId, n06, n13 } = await setup(test);
  const n20 = await occurrence(t, seriesId, "2026-11-20");
  const n27 = await occurrence(t, seriesId, "2026-11-27");
  await t.run(async ctx => {
    await ctx.db.patch(n13._id, { publicationState: "draft_private" });
    await ctx.db.patch(n20._id, { eventStatus: "cancelled" });
  });
  test.mock.timers.setTime(Date.parse("2026-11-08T12:00:00Z"));
  const slugs = (await t.query(api.eventSeries.getPublic, { seriesId }))!.nights.map(n => n.slug);
  assert.equal(slugs[0], n27.slug);
  assert.equal(slugs.includes(n06.slug!), false);
  assert.equal(slugs.includes(n13.slug!), false);
  assert.equal(slugs.includes(n20.slug!), false);
});
