import assert from "node:assert/strict";
import { beforeEach, it, type TestContext } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import {
  createApiEvent,
  insertSeries,
  loadEventSeriesWithNotifier,
  NOW,
  occurrence,
  occurrenceOrNull,
  occurrences,
  seedSeriesCommunity,
  seriesModules,
} from "./_eventSeriesFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "true";
});

async function setup(test: TestContext, now: number, fields: Partial<Doc<"eventSeries">> = {}) {
  test.mock.timers.enable({ apis: ["Date"], now });
  const t = convexTest({ schema, modules: seriesModules });
  const owner = await seedSeriesCommunity(t);
  const seriesId = await insertSeries(t, owner, fields);
  return { t, owner, seriesId };
}

async function programFor(t: T, event: Doc<"events">) {
  return t.run(async (ctx) => {
    const program = await ctx.db
      .query("eventMediaPrograms")
      .withIndex("by_eventId_updatedAt", (q) => q.eq("eventId", event._id))
      .order("desc")
      .first();
    if (program === null) throw new Error("No programme.");
    const outputs = await ctx.db.query("eventMediaOutputs").withIndex("by_programId_key", (q) => q.eq("programId", program._id)).collect();
    const sources = await ctx.db.query("eventMediaSources").withIndex("by_eventId_state", (q) => q.eq("eventId", event._id)).collect();
    return { program, outputs, sources };
  });
}

it("creates Fridays to the 60 day horizon with rule times and series fields", async (test) => {
  const { t, seriesId } = await setup(test, NOW, {
    rule: { frequency: "weekly", weekday: 5, startTime: "22:00", doorsTime: "21:30", endTime: "02:00" },
    summary: "Weekly",
    venueLabel: "Harbor",
    sourceUrl: "https://example.com/harbor",
  });
  const result = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.equal(result.created.length, 8); // 2026-11-06 .. 2026-12-25
  const first = await occurrence(t, seriesId, "2026-11-06");
  assert.equal(first.startAt, Date.parse("2026-11-07T03:00:00Z"));
  assert.equal(first.doorsOpenAt, Date.parse("2026-11-07T02:30:00Z"));
  assert.equal(first.endAt, Date.parse("2026-11-07T07:00:00Z")); // ends next local day
  assert.deepEqual([first.summary, first.venueLabel, first.sourceUrl, first.publicationState], ["Weekly", "Harbor", "https://example.com/harbor", "published"]);
  assert.deepEqual([first.posterImageUrl, first.notes, first.overrides], [undefined, undefined, []]);
  assert.ok(first.slug); // short link and slug created by insertCommunityEventRecord
  assert.equal(first.submitter?.tokenIdentifier, `series:${seriesId}`);
});

it("is idempotent on seriesId plus occurrenceDate", async (test) => {
  const { t, seriesId } = await setup(test, NOW);
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  const again = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual([again.created.length, again.adopted.length], [0, 0]);
  assert.equal((await occurrences(t, seriesId)).length, 8);
});

it("never creates a night that has already started", async (test) => {
  // Friday 2026-11-06 21:00 New York, an hour after the 20:00 start.
  const { t, seriesId } = await setup(test, Date.parse("2026-11-07T02:00:00Z"));
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.equal(await occurrenceOrNull(t, seriesId, "2026-11-06"), null);
  assert.ok(await occurrenceOrNull(t, seriesId, "2026-11-13"));
});

it("skips and reports a nonexistent local start", async (test) => {
  const { t, seriesId } = await setup(test, Date.parse("2027-03-01T12:00:00Z"), {
    rule: { frequency: "weekly", weekday: 0, startTime: "02:30" },
    startsOn: "2027-03-07",
  });
  const result = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual(result.skipped, ["2027-03-14"]);
  assert.equal(result.created.length, 7);
  assert.equal(await occurrenceOrNull(t, seriesId, "2027-03-14"), null);
});

it("takes the earlier instant for an ambiguous local start", async (test) => {
  const { t, seriesId } = await setup(test, Date.parse("2027-11-01T12:00:00Z"), {
    rule: { frequency: "weekly", weekday: 0, startTime: "01:30" },
    startsOn: "2027-11-07",
  });
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.equal((await occurrence(t, seriesId, "2027-11-07")).startAt, Date.parse("2027-11-07T05:30:00Z"));
});

it("copies the latest occurrence's stream programme and authorized outputs, not its sources", async (test) => {
  const { t, owner, seriesId } = await setup(test, NOW);
  // 2026-11-06 20:00 New York, made an occurrence directly.
  const template = await createApiEvent(t, owner, { title: "Harbor Night", startAt: Date.parse("2026-11-07T01:00:00Z"), timezone: "America/New_York" });
  const link = { platform: "browser" as const, label: "Watch", url: "https://example.com/watch" };
  await t.run(async (ctx) => {
    await ctx.db.patch(template.eventId, { seriesId, occurrenceDate: "2026-11-06", overrides: [] });
    const programId = await ctx.db.insert("eventMediaPrograms", {
      eventId: template.eventId,
      communityProfileId: owner.profileId,
      state: "ready",
      publicLinks: [link],
      directFallbackLinks: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    const output = (key: string, secretRef: string) => ctx.db.insert("eventMediaOutputs", {
      programId,
      eventId: template.eventId,
      key,
      type: "vrcdn",
      accountModel: "operator_owned",
      state: "active", // live on the template night; the copy starts ready
      label: key === "main" ? "Main" : "Other",
      credential: { storage: "operator_secret_store", secretRef },
      playbackLinks: [link],
      createdAt: NOW,
      updatedAt: NOW,
    });
    const mainId = await output("main", "vrcdn/main");
    await output("other", "vrcdn/not-bound"); // not authorized for this community
    await ctx.db.patch(programId, { currentOutputId: mainId });
    await ctx.db.insert("eventMediaSources", {
      programId,
      eventId: template.eventId,
      key: "source_a",
      position: 0,
      type: "vrcdn_link",
      purpose: "program",
      state: "ready",
      label: "A",
      publicUrl: "https://stream.vrcdn.live/live/source_a.live.ts",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  const copy = await programFor(t, await occurrence(t, seriesId, "2026-11-13"));
  assert.equal(copy.program.state, "ready");
  assert.deepEqual(copy.program.publicLinks, [link]);
  assert.deepEqual(copy.outputs.map((o) => [o.key, o.label]), [["main", "Main"]]);
  assert.equal(copy.outputs[0]!.state, "ready");
  assert.equal(copy.program.currentOutputId, copy.outputs[0]!._id);
  assert.equal(copy.sources.length, 0);
});

it("the cron alerts ops on a failed series, still materialises the others, and resolves on recovery", async (test) => {
  test.mock.timers.enable({ apis: ["Date"], now: NOW });
  const sent: Array<{ key: string; subject: string; body: string }> = [];
  const resolved: string[] = [];
  const t = convexTest({
    schema,
    modules: { ...seriesModules, "../../convex/eventSeries.ts": () => loadEventSeriesWithNotifier(sent, resolved) },
  });
  const owner = await seedSeriesCommunity(t);
  const good = await insertSeries(t, owner);
  const broken = await insertSeries(t, owner, { timezone: "Not/AZone" }); // eventDateForInstant throws a RangeError
  await t.action(internal.eventSeries.materializeAll, {});
  assert.deepEqual(sent.map((alert) => alert.key), [`series_materialize_failed:${broken}`]);
  assert.match(sent[0]!.body, new RegExp(broken));
  assert.equal((await occurrences(t, good)).length, 8);
  assert.equal((await occurrences(t, broken)).length, 0);
  assert.ok(resolved.includes(`series_materialize_failed:${good}`));
  assert.ok(!resolved.includes(`series_materialize_failed:${broken}`));
  await t.run((ctx) => ctx.db.patch(broken, { timezone: "America/New_York" }));
  await t.action(internal.eventSeries.materializeAll, {});
  assert.equal(sent.length, 1);
  assert.ok(resolved.includes(`series_materialize_failed:${broken}`));
  assert.equal((await occurrences(t, broken)).length, 8);
});

it("does nothing when the flag is off", async (test) => {
  const { t, seriesId } = await setup(test, NOW);
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "false";
  assert.equal((await t.mutation(internal.eventSeries.materialize, { seriesId })).created.length, 0);
  assert.equal((await occurrences(t, seriesId)).length, 0);
});
