import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { internal } from "../../convex/_generated/api";
import { publishIntakeDraft, saveIntakeDraft } from "../../convex/_eventIntake";
import type { Id } from "../../convex/_generated/dataModel";
import { connectorFixture } from "./_eventConnectorFixture";

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const fields = (title: string) => ({ communitySlug: "club", title, eventDate: "2027-04-01", timeTba: true });
async function fillReceipts(f: Awaited<ReturnType<typeof connectorFixture>>, count: number, by: "actor" | "community") {
  const { eventId } = await f.createEvent({ title: "Seed" });
  await f.t.run(async ctx => {
    const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: f.users.owner, version: 1, fields: {}, provenance: [], createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
    for (let i = 0; i < count; i++) await ctx.db.insert("eventContributionReceipts", { actorUserId: by === "actor" ? f.users.integrator : f.users.owner, draftId, draftVersion: 1, eventId, eventPath: "/club/events/x", communityProfileId: f.communityProfileId, fingerprint: `f${i}`, createdAt: Date.now() });
  });
}

it("connector publish skips the per-account cap but keeps the per-community cap", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  await fillReceipts(f, 10, "actor");
  const personal = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Personal") }));
  await assert.rejects(f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: personal.draftId, expectedVersion: personal.version, idempotencyKey: "personal" })), /ACCOUNT_QUOTA/);
  const viaConnector = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Synced") }, Date.now(), { connectorId }));
  const published = await f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: viaConnector.draftId, expectedVersion: viaConnector.version, idempotencyKey: "synced" }, Date.now(), "system", { connectorId }));
  const event = (await f.t.run(ctx => ctx.db.get(published.eventId)))!;
  assert.equal(event.sourceType, "community");
  assert.equal(event.contributorUserId, undefined);
  await fillReceipts(f, 100, "community");
  const capped = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Capped") }, Date.now(), { connectorId }));
  await assert.rejects(f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: capped.draftId, expectedVersion: capped.version, idempotencyKey: "capped" }, Date.now(), "system", { connectorId })), /TARGET_QUOTA/);
});

it("the 21st connector-driven draft is allowed and the 21st web draft is not", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  for (let i = 0; i < 20; i++) await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields(`Draft ${i}`) }));
  await assert.rejects(f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Web 21") })), /DRAFT_QUOTA/);
  await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Connector 21") }, Date.now(), { connectorDriven: true }));
  const saved = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Connector 22") }, Date.now(), { connectorId }));
  assert.equal((await f.t.run(ctx => ctx.db.get(saved.draftId)))!.connectorId, connectorId);
});

it("connector writes do not use up the authority's own caps", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const titles = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet"];
  for (let i = 0; i < 20; i++) {
    const draft = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields(titles[i % 10]!) }, Date.now(), { connectorId }));
    if (i < 10) await f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: draft.draftId, expectedVersion: draft.version, idempotencyKey: `synced-${i}` }, Date.now(), "system", { connectorId }));
  }
  const rows = await f.t.run(async ctx => ({ receipts: await ctx.db.query("eventContributionReceipts").collect(), requests: await ctx.db.query("eventIntakePublishRequests").collect() }));
  assert.equal(rows.receipts.filter(row => row.connectorId === connectorId).length, 10);
  assert.equal(rows.requests.filter(row => row.connectorId === connectorId).length, 10);
  const personal = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Personal") }));
  const published = await f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: personal.draftId, expectedVersion: personal.version, idempotencyKey: "personal" }));
  assert.equal(published.createdEvent, true);
  // Legacy rows without connectorId still count: one personal receipt plus nine legacy ones reach the cap.
  await fillReceipts(f, 9, "actor");
  const blocked = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Kilo") }));
  await assert.rejects(f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: blocked.draftId, expectedVersion: blocked.version, idempotencyKey: "blocked" })), /ACCOUNT_QUOTA/);
});

it("connector publish requires the draft's own active connector", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const other = await f.insertConnector({ target: { calendarId: "other@example.com" } });
  const paused = await f.insertConnector({ target: { calendarId: "paused@example.com" }, state: "paused" });
  const publish = (draft: { draftId: Id<"eventIntakeDrafts">; version: number }, id: Id<"eventConnectors">) =>
    f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: draft.draftId, expectedVersion: draft.version, idempotencyKey: `k-${draft.draftId}-${id}` }, Date.now(), "system", { connectorId: id }));
  const personal = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Personal") }));
  await assert.rejects(publish(personal, connectorId), /CONNECTOR_DRAFT_MISMATCH/);
  const owned = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Owned") }, Date.now(), { connectorId }));
  await assert.rejects(publish(owned, other), /CONNECTOR_DRAFT_MISMATCH/);
  const held = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Held") }, Date.now(), { connectorId: paused }));
  await assert.rejects(publish(held, paused), /CONNECTOR_DRAFT_MISMATCH/);
  await assert.rejects(f.t.mutation(internal.eventIntakeSources.authorizeExtraction, { actorUserId: f.users.integrator, draftId: held.draftId, connectorId: paused }), /CONNECTOR_DRAFT_MISMATCH/);
  assert.equal((await publish(owned, connectorId)).createdEvent, true);
});

it("connector publish refuses a held draft moved to another community", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  await f.t.run(ctx => ctx.db.insert("profiles", { slug: "other-club", displayName: "Other", sortName: "other", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() }));
  const held = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Held") }, Date.now(), { connectorId }));
  const moved = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { draftId: held.draftId, expectedVersion: held.version, patch: { communitySlug: "other-club" } }));
  await assert.rejects(f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: moved.draftId, expectedVersion: moved.version, idempotencyKey: "moved" }, Date.now(), "system", { connectorId })), /CONNECTOR_DRAFT_MISMATCH/);
  assert.equal((await f.t.run(ctx => ctx.db.query("events").collect())).length, 0);
});

it("connector extraction skips the 20 per day reservation only for its own drafts", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const personal = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Personal") }));
  const owned = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Owned") }, Date.now(), { connectorId }));
  for (let i = 0; i < 20; i++) await f.t.mutation(internal.eventIntakeSources.authorizeExtraction, { actorUserId: f.users.integrator, draftId: personal.draftId });
  await assert.rejects(f.t.mutation(internal.eventIntakeSources.authorizeExtraction, { actorUserId: f.users.integrator, draftId: personal.draftId }), /EXTRACTION_QUOTA/);
  await f.t.mutation(internal.eventIntakeSources.authorizeExtraction, { actorUserId: f.users.integrator, draftId: owned.draftId, connectorId });
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeModelAttempts").collect())).length, 20);
  await assert.rejects(f.t.mutation(internal.eventIntakeSources.authorizeExtraction, { actorUserId: f.users.integrator, draftId: personal.draftId, connectorId }), /CONNECTOR_DRAFT_MISMATCH/);
});
