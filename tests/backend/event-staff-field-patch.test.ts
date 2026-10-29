import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { internal } from "../../convex/_generated/api";
import { connectorFixture } from "./_eventConnectorFixture";

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const patchRef = internal.events.patchCommunityEventFieldsAsStaff;
async function setup() {
  const f = await connectorFixture();
  const created = await f.createEvent({ venueLabel: "Main room", lineup: [{ clientKey: "a", position: 0, performerLabel: "DJ A" }, { clientKey: "b", position: 1, performerLabel: "DJ B" }] });
  const event = async () => (await f.t.run(ctx => ctx.db.get(created.eventId)))!;
  const lineup = () => f.t.run(ctx => ctx.db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", created.eventId)).collect());
  return { ...f, created, event, lineup };
}

it("admits manage_events, manage_integrations, and super admin; refuses others", async () => {
  const f = await setup();
  for (const actorUserId of [f.users.eventStaff, f.users.integrator, f.users.admin]) {
    const current = await f.event();
    await f.t.mutation(patchRef, { actorUserId, slug: f.created.slug, expectedUpdatedAt: current.updatedAt, patch: { summary: `by ${actorUserId}` } });
  }
  const current = await f.event();
  await assert.rejects(f.t.mutation(patchRef, { actorUserId: f.users.outsider, slug: f.created.slug, expectedUpdatedAt: current.updatedAt, patch: { summary: "no" } }), /EVENT_STAFF_REQUIRED/);
});

it("throws VERSION_CONFLICT before writing on a stale expectedUpdatedAt", async () => {
  const f = await setup();
  const before = await f.event();
  await assert.rejects(f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt - 1, patch: { title: "Stale" } }), /VERSION_CONFLICT/);
  assert.deepEqual(await f.event(), before);
});

it("throws EVENT_NOT_FOUND for an unknown slug", async () => {
  const f = await setup();
  await assert.rejects(f.t.mutation(patchRef, { actorUserId: f.users.admin, slug: "missing-event", expectedUpdatedAt: 0, patch: { title: "Nope" } }), /EVENT_NOT_FOUND/);
});

it("writes only patched fields: a start change keeps venue and lineup", async () => {
  const f = await setup();
  const before = await f.event();
  const result = await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { start: { time: "21:00" } } });
  const after = await f.event();
  assert.equal(result.changed, true);
  assert.equal(result.updatedAt, after.updatedAt);
  assert.equal(after.startAt, before.startAt! + 3_600_000);
  assert.equal(after.venueLabel, "Main room");
  assert.equal(after.title, before.title);
  assert.deepEqual((await f.lineup()).map(row => row.performerLabel), ["DJ A", "DJ B"]);
  const audit = await f.t.run(ctx => ctx.db.query("eventAuditEvents").filter(q => q.eq(q.field("action"), "updated")).collect());
  assert.deepEqual(audit.map(row => [row.actorUserId, row.actorSurface]), [[f.users.integrator, "system"]]);
});

it("replaces the lineup as one whole field", async () => {
  const f = await setup();
  const before = await f.event();
  await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { lineup: [{ clientKey: "a", position: 0, performerLabel: "DJ A" }, { clientKey: "c", position: 1, performerLabel: "DJ C" }] } });
  assert.deepEqual((await f.lineup()).map(row => row.performerLabel), ["DJ A", "DJ C"]);
});

it("patches a non-lineup field on an event with an unlabeled lineup slot and clears a blank venue", async () => {
  const f = await setup();
  await f.t.run(async ctx => {
    const [first] = await ctx.db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", f.created.eventId)).collect();
    await ctx.db.patch(first._id, { performerLabel: "" });
  });
  const before = await f.event();
  const result = await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { summary: "Updated", venueLabel: null } });
  const after = await f.event();
  assert.equal(result.changed, true);
  assert.equal(after.summary, "Updated");
  assert.equal(after.venueLabel, undefined);
  assert.deepEqual((await f.lineup()).map(row => row.performerLabel), ["", "DJ B"]);
});

it("an equal patch changes nothing and enqueues nothing", async () => {
  const f = await setup();
  await f.insertConnector({ direction: "export" });
  const before = await f.event();
  const result = await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { venueLabel: "Main room", start: { time: "20:00", dayOffset: 0 } } });
  assert.deepEqual(result, { eventId: f.created.eventId, updatedAt: before.updatedAt, changed: false });
  assert.equal((await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).length, 0);
});

it("a null timeTba on a timed event is equal and changes nothing", async () => {
  const f = await setup();
  await f.insertConnector({ direction: "export" });
  const before = await f.event();
  const result = await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { timeTba: null } });
  assert.deepEqual(result, { eventId: f.created.eventId, updatedAt: before.updatedAt, changed: false });
  assert.equal((await f.event()).updatedAt, before.updatedAt);
  assert.equal((await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).length, 0);
});

it("a real change enqueues the export", async () => {
  const f = await setup();
  await f.insertConnector({ direction: "export" });
  const before = await f.event();
  await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { title: "Renamed" } });
  const jobs = await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect());
  assert.deepEqual(jobs.map(row => [row.kind, row.state]), [["export_upsert", "pending"]]);
});
