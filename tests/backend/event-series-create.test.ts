import assert from "node:assert/strict";
import { beforeEach, it, type TestContext } from "node:test";

import { convexTest } from "convex-test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import {
  NOW,
  occurrence,
  occurrences,
  seedSeriesCommunity,
  seedUser,
  seriesModules,
  slotsFor,
  type SeriesOwner,
} from "./_eventSeriesFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "true";
  delete process.env.VRDEX_EVENT_CONNECTORS_ENABLED;
});

async function setup(test: TestContext) {
  test.mock.timers.enable({ apis: ["Date"], now: NOW });
  const t = convexTest({ schema, modules: seriesModules });
  const owner = await seedSeriesCommunity(t);
  return { t, owner };
}

async function createEvent(
  t: T,
  owner: SeriesOwner,
  fields: { startAt: number } & Record<string, unknown>,
): Promise<{ eventId: Id<"events">; slug: string }> {
  return t.withIdentity(owner.identity).mutation(api.events.createCommunityEvent, {
    title: "Harbor Night",
    timezone: "America/New_York",
    communitySlug: "faceless",
    published: true,
    ...fields,
  } as never);
}

it("turns an existing event into the first occurrence of a weekly series", async (test) => {
  const { t, owner } = await setup(test);
  const startAt = Date.parse("2026-11-07T01:00:00Z"); // Friday 2026-11-06 20:00 EST
  const event = await createEvent(t, owner, { startAt, summary: "Weekly", slotLinks: [{ displayLabel: "DJ Aurora", startAt }] });
  const { seriesId, created } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } });
  assert.equal(created, 7);
  const series = await t.run(ctx => ctx.db.get(seriesId));
  assert.deepEqual([series!.title, series!.rule, series!.startsOn, series!.horizonDays], ["Harbor Night", { frequency: "weekly", weekday: 5, startTime: "20:00" }, "2026-11-06", 60]);
  assert.deepEqual([series!.state, series!.authorityUserId, series!.summary], ["active", owner.userId, "Weekly"]);
  const first = await t.run(ctx => ctx.db.get(event.eventId));
  assert.deepEqual([first!.seriesId, first!.occurrenceDate, first!.overrides], [seriesId, "2026-11-06", []]);
  assert.equal((await slotsFor(t, event.eventId)).length, 1);
  const second = await occurrence(t, seriesId, "2026-11-13");
  assert.equal(second.startAt, Date.parse("2026-11-14T01:00:00Z"));
  assert.equal((await slotsFor(t, second._id)).length, 0);
});

it("reads a fifth weekday as the last weekday for Monthly", async (test) => {
  const { t, owner } = await setup(test);
  const event = await createEvent(t, owner, { startAt: Date.parse("2027-01-30T01:00:00Z") }); // Friday 2027-01-29 20:00 EST
  const { seriesId } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "monthly_weekday" } });
  assert.equal((await t.run(ctx => ctx.db.get(seriesId)))!.rule.ordinal, -1);
});

it("does not backfill before today when the source event is past", async (test) => {
  const { t, owner } = await setup(test);
  test.mock.timers.setTime(Date.parse("2026-10-20T12:00:00Z")); // create the source while it is upcoming
  const event = await createEvent(t, owner, { startAt: Date.parse("2026-10-24T00:00:00Z") }); // Friday 2026-10-23 20:00 EDT
  test.mock.timers.setTime(NOW);
  const { seriesId } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } });
  const dates = (await occurrences(t, seriesId)).map(e => e.occurrenceDate).sort();
  assert.deepEqual(dates.slice(0, 2), ["2026-10-23", "2026-10-30"]);
});

it("rejects a weekday or ordinal that does not select the event's start day", async (test) => {
  const { t, owner } = await setup(test);
  const event = await createEvent(t, owner, { startAt: Date.parse("2026-11-07T01:00:00Z") }); // first Friday of November
  const create = (repeat: Record<string, unknown>) =>
    t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat } as never);
  await assert.rejects(create({ frequency: "weekly", weekday: 4 }), /Repeat weekday must match the event's start day\./);
  await assert.rejects(create({ frequency: "monthly_weekday", ordinal: 2 }), /Repeat weekday must match the event's start day\./);
  const { seriesId } = await create({ frequency: "monthly_weekday", weekday: 5, ordinal: 1 });
  assert.deepEqual((await t.run(ctx => ctx.db.get(seriesId)))!.rule, { frequency: "monthly_weekday", weekday: 5, ordinal: 1, startTime: "20:00" });
});

it("rejects a non-manager and a draft event", async (test) => {
  const { t, owner } = await setup(test);
  const event = await createEvent(t, owner, { startAt: Date.parse("2026-11-07T01:00:00Z") });
  const stranger = await seedUser(t, "Stranger");
  const draft = await createEvent(t, owner, { startAt: Date.parse("2026-11-14T01:00:00Z"), published: false });

  await assert.rejects(t.withIdentity(stranger.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } }), /access/);
  await assert.rejects(t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: draft.slug, repeat: { frequency: "weekly" } }), /Only a published timed event can repeat/);
});

it("enqueues one export for the linked first night and one per materialised night", async (test) => {
  const { t, owner } = await setup(test);
  const event = await createEvent(t, owner, { startAt: Date.parse("2026-11-07T01:00:00Z") });
  process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  // Added after the event exists, so any job for it comes from series creation.
  await t.run(ctx => ctx.db.insert("eventConnectors", {
    communityProfileId: owner.profileId, kind: "google_calendar", direction: "export", mode: "autopublish",
    authorityUserId: owner.userId, target: { calendarId: "club@example.com" }, state: "active", createdAt: NOW, updatedAt: NOW,
  }));
  const { seriesId } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } });
  const jobs = await t.run(ctx => ctx.db.query("eventSyncJobs").collect());
  const nights = (await occurrences(t, seriesId)).map(night => night._id).sort();
  assert.deepEqual(jobs.map(job => job.eventId!).sort(), nights);
  assert.ok(jobs.every(job => job.kind === "export_upsert"));
  assert.ok(nights.includes(event.eventId));
});

it("rejects creation when the flag is off", async (test) => {
  const { t, owner } = await setup(test);
  const event = await createEvent(t, owner, { startAt: Date.parse("2026-11-07T01:00:00Z") });
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "false";
  await assert.rejects(t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } }), /Recurring events are not enabled\./);
});
