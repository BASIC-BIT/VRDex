import assert from "node:assert/strict";
import { beforeEach, it, type TestContext } from "node:test";

import { convexTest } from "convex-test";

import { seriesOverridesFor } from "../../convex/_eventSeries";
import { internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import {
  createApiEvent,
  insertSeries,
  NOW,
  occurrenceOrNull,
  occurrences,
  seedSeriesCommunity,
  seriesModules,
} from "./_eventSeriesFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

beforeEach(() => {
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "true";
});

async function setup(test: TestContext, now = NOW) {
  test.mock.timers.enable({ apis: ["Date"], now });
  const t = convexTest({ schema, modules: seriesModules });
  const owner = await seedSeriesCommunity(t);
  return { t, owner };
}

it("adopts a same-day same-title event and records differing fields as overrides", async (test) => {
  const { t, owner } = await setup(test);
  const standalone = await createApiEvent(t, owner, { title: "harbor night", startAt: Date.parse("2026-11-07T02:00:00Z"), timezone: "America/New_York", summary: "Special edition" });
  const other = await createApiEvent(t, owner, { title: "Other Night", startAt: Date.parse("2026-11-07T01:00:00Z"), timezone: "America/New_York" });
  const claimed = await createApiEvent(t, owner, { title: "Harbor Night", startAt: Date.parse("2026-11-14T01:00:00Z"), timezone: "America/New_York" });
  const otherSeries = await insertSeries(t, owner);
  await t.run((ctx) => ctx.db.patch(claimed.eventId, { seriesId: otherSeries, occurrenceDate: "2026-11-13", overrides: [] }));
  const seriesId = await insertSeries(t, owner, { summary: "Weekly" }); // title "Harbor Night", Fridays 20:00
  const result = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual(result.adopted, [standalone.eventId]);
  const adopted = await t.run((ctx) => ctx.db.get(standalone.eventId));
  assert.deepEqual([adopted!.seriesId, adopted!.occurrenceDate, adopted!.overrides], [seriesId, "2026-11-06", ["startAt", "summary", "title"]]);
  assert.equal((await t.run((ctx) => ctx.db.get(other.eventId)))!.seriesId, undefined);
  assert.equal((await t.run((ctx) => ctx.db.get(claimed.eventId)))!.seriesId, otherSeries);
  assert.equal((await occurrences(t, seriesId)).length, 8); // 11-13 gets a fresh occurrence beside the other series' event
});

it("never adopts a night that has already started", async (test) => {
  const { t, owner } = await setup(test);
  // Friday 2026-10-30 20:00 EDT, created while still upcoming.
  const tonight = await createApiEvent(t, owner, { title: "Harbor Night", startAt: Date.parse("2026-10-31T00:00:00Z"), timezone: "America/New_York" });
  test.mock.timers.setTime(Date.parse("2026-10-31T01:00:00Z"));
  const seriesId = await insertSeries(t, owner, { startsOn: "2026-10-30" });
  const result = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual(result.adopted, []);
  assert.equal((await t.run((ctx) => ctx.db.get(tonight.eventId)))!.seriesId, undefined);
  assert.equal(await occurrenceOrNull(t, seriesId, "2026-10-30"), null);
});

it("adopts a future date-only event instead of creating a second night beside it", async (test) => {
  const { t, owner } = await setup(test);
  const dateOnly = await createApiEvent(t, owner, { title: "Harbor Night", startAt: Date.parse("2026-11-07T01:00:00Z"), timezone: "America/New_York" });
  await t.run((ctx) => ctx.db.patch(dateOnly.eventId, { startAt: undefined, scheduleKind: "date_only", eventDate: "2026-11-06" }));
  const seriesId = await insertSeries(t, owner);
  const result = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual(result.adopted, [dateOnly.eventId]);
  assert.equal((await occurrenceOrNull(t, seriesId, "2026-11-06"))!._id, dateOnly.eventId);
  assert.equal((await occurrences(t, seriesId)).length, 8);
});

it("skips unpublished, removed, cancelled and differently titled candidates", async (test) => {
  const { t, owner } = await setup(test);
  const fridays = ["2026-11-07T01:00:00Z", "2026-11-14T01:00:00Z", "2026-11-21T01:00:00Z"];
  const candidates = [];
  for (const at of fridays) {
    candidates.push(await createApiEvent(t, owner, { title: "Harbor Night", startAt: Date.parse(at), timezone: "America/New_York" }));
  }
  const [draft, removed, cancelled] = candidates;
  await createApiEvent(t, owner, { title: "Harbor Nights", startAt: Date.parse("2026-11-28T01:00:00Z"), timezone: "America/New_York" });
  await t.run(async (ctx) => {
    await ctx.db.patch(draft.eventId, { publicationState: "draft_private" });
    await ctx.db.patch(removed.eventId, { moderationRemovedAt: NOW });
    await ctx.db.patch(cancelled.eventId, { eventStatus: "cancelled" });
  });
  const seriesId = await insertSeries(t, owner);
  const result = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual(result.adopted, []);
  assert.equal(result.created.length, 8);
});

it("seriesOverridesFor treats missing values as their defaults", async (test) => {
  const { t, owner } = await setup(test);
  const seriesId = await insertSeries(t, owner, { summary: "", mediaLinks: [], watchMode: "event_stream", watchSurfaceEnabled: false });
  const { eventId } = await createApiEvent(t, owner, { title: "Harbor Night", startAt: Date.parse("2026-11-07T01:00:00Z"), timezone: "America/New_York" });
  const overrides = await t.run(async (ctx) => {
    const series = (await ctx.db.get(seriesId)) as Doc<"eventSeries">;
    const event = (await ctx.db.get(eventId)) as Doc<"events">;
    const bare = { ...event, summary: undefined, mediaLinks: undefined, watchMode: undefined, watchSurfaceEnabled: undefined };
    return [
      await seriesOverridesFor(ctx.db, series, bare, "2026-11-06"),
      await seriesOverridesFor(ctx.db, series, { ...bare, watchMode: "performer_sequence", venueLabel: "Dock" }, "2026-11-06"),
    ];
  });
  assert.deepEqual(overrides, [[], ["venueLabel", "watchMode"]]);
});
