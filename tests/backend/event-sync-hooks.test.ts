import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { api, internal } from "../../convex/_generated/api";
import { connectorFixture, START } from "./_eventConnectorFixture";

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
async function setup() {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector({ direction: "export" });
  const pending = async (eventId: string) => (await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect()))
    .filter(row => row.eventId === eventId && row.state === "pending").map(row => row.kind);
  const link = (eventId: any) => f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: `g-${eventId}`, state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  return { ...f, connectorId, pending, link };
}

it("browser create, update, cancel, and unpublish each leave one pending job of the right kind", async () => {
  const f = await setup();
  const { eventId, slug } = await f.createEvent();
  assert.deepEqual(await f.pending(eventId), ["export_upsert"]);
  await f.as("owner").mutation(api.events.updateCommunityEvent, { currentSlug: slug, communitySlug: "club", title: "Renamed" });
  assert.deepEqual(await f.pending(eventId), ["export_upsert"]);
  await f.as("owner").mutation(api.events.setCommunityEventCancelled, { currentSlug: slug, cancelled: true, reason: "Storm" });
  assert.deepEqual(await f.pending(eventId), ["export_upsert"]);
  await f.link(eventId);
  await f.as("owner").mutation(api.events.setCommunityEventPublished, { currentSlug: slug, published: false });
  assert.deepEqual(await f.pending(eventId), ["export_delete"]);
});

it("an unpublished browser create enqueues nothing", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent({ published: false });
  assert.deepEqual(await f.pending(eventId), []);
});

it("API owner create and update enqueue through the shared record helpers", async () => {
  const f = await setup();
  const created = await f.t.mutation(internal.events.createCommunityEventForApiOwner, { actorKind: "personal_api_token", ownerUserId: f.users.owner, title: "API Night", startAt: START, timezone: "UTC", communitySlug: "club" });
  assert.deepEqual(await f.pending(created.eventId), ["export_upsert"]);
  await f.t.mutation(internal.events.updateCommunityEventForApiOwner, { actorKind: "personal_api_token", ownerUserId: f.users.owner, currentSlug: created.slug, summary: "Updated" });
  assert.deepEqual(await f.pending(created.eventId), ["export_upsert"]);
});

it("contributor publish, update, retraction, and moderation removal enqueue", async () => {
  const f = await setup();
  const contributor = f.as("outsider");
  const draft = await contributor.mutation(api.eventIntake.saveEventIntakeDraft, { patch: { communitySlug: "club", title: "Guest Night", eventDate: "2027-03-01", timeTba: true } });
  const published = await f.t.mutation(internal.eventIntake.commitPublishIntake, { actorUserId: f.users.outsider, actorSurface: "api", draftId: draft.draftId, expectedVersion: draft.version, idempotencyKey: "guest-night" });
  assert.deepEqual(await f.pending(published.eventId), ["export_upsert"]);
  const event = (await f.t.run(ctx => ctx.db.get(published.eventId)))!;
  await f.t.mutation(internal.eventCorrections.updateActorContributedEvent, { actorUserId: f.users.outsider, eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { summary: "More" } });
  assert.deepEqual(await f.pending(event._id), ["export_upsert"]);
  await f.link(event._id);
  await f.t.mutation(internal.eventCorrections.retractActorContributedEvent, { actorUserId: f.users.outsider, eventId: event._id });
  assert.deepEqual(await f.pending(event._id), ["export_delete"]);
  const second = await contributor.mutation(api.eventIntake.saveEventIntakeDraft, { patch: { communitySlug: "club", title: "Second Night", eventDate: "2027-03-02", timeTba: true } });
  const other = await f.t.mutation(internal.eventIntake.commitPublishIntake, { actorUserId: f.users.outsider, actorSurface: "api", draftId: second.draftId, expectedVersion: second.version, idempotencyKey: "second-night" });
  await f.link(other.eventId);
  await f.as("admin").mutation(api.eventCorrections.removeContributedEvent, { eventId: other.eventId, reason: "Spam listing" });
  assert.deepEqual(await f.pending(other.eventId), ["export_delete"]);
});
