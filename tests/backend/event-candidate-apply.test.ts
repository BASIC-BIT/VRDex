import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { applyEventCandidate } from "../../convex/_eventCandidateApply";
import { carriedFieldsHash } from "../../convex/_eventConnectors";
import { correctionFields } from "../../convex/eventCorrections";
import type { EventIntakeCandidate } from "../../packages/api-contracts/src/event-intake";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { connectorFixture } from "./_eventConnectorFixture";

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const night = { title: "Night Flight", eventDate: "2027-02-12", start: "20:00", startDate: "2027-02-12", timezone: "UTC" };
function candidate(event: Partial<EventIntakeCandidate["event"]>, explicit: string[], extra: Partial<EventIntakeCandidate> = {}): EventIntakeCandidate {
  return { event: { title: null, communitySlug: null, eventDate: null, start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null, ...event },
    lineup: [], questions: [], decision: { kind: "new" },
    evidence: explicit.map(fieldPath => ({ fieldPath, origin: "connector" as const, excerpt: null, assessment: "explicit" as const })), ...extra };
}
async function setup(connector: Partial<Doc<"eventConnectors">> = {}) {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector(connector);
  const apply = (args: { candidate: EventIntakeCandidate; externalId?: string; externalUpdatedAt?: number; expectedUpdatedAt?: number; idempotencyKey?: string }) => f.t.run(async ctx => {
    const doc = (await ctx.db.get(connectorId))!;
    return applyEventCandidate(ctx, { connector: doc, actorUserId: doc.authorityUserId, idempotencyKey: args.idempotencyKey ?? "key-1", candidate: args.candidate, externalId: args.externalId, externalUpdatedAt: args.externalUpdatedAt, expectedUpdatedAt: args.expectedUpdatedAt });
  });
  const linkTo = (eventId: Id<"events">, extra: Partial<Doc<"eventSyncLinks">> = {}) => f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now(), ...extra }));
  const get = <T extends "events" | "eventIntakeDrafts">(id: Id<T>) => f.t.run(ctx => ctx.db.get(id));
  return { ...f, connectorId, apply, linkTo, get };
}

it("not_event writes nothing but analytics", async () => {
  const f = await setup();
  const result = await f.apply({ candidate: candidate(night, [], { decision: { kind: "not_event", reason: "chatter" } }), externalId: "g-1" });
  assert.equal(result.outcome, "not_event");
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
  assert.equal((await f.t.run(ctx => ctx.db.query("productAnalyticsOutbox").collect())).filter(row => row.event === "event_sync_apply").length, 1);
});

it("hold files one draft owned by the authority and a later poll does not file a second", async () => {
  const f = await setup({ mode: "hold" });
  const first = await f.apply({ candidate: candidate(night, ["event.title"]), externalId: "g-1" });
  assert.equal(first.outcome, "draft");
  const draft = (await f.get(first.draftId!))!;
  assert.equal(draft.actorUserId, f.users.integrator);
  assert.equal(draft.connectorId, f.connectorId);
  const second = await f.apply({ candidate: candidate(night, ["event.title"]), externalId: "g-1" });
  assert.equal(second.outcome, "skipped_pending_draft");
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeDrafts").collect())).length, 1);
});

it("autopublish publishes a community listing, links it, and replays on retry", async () => {
  const f = await setup();
  const first = await f.apply({ candidate: candidate(night, ["event.title", "event.start"]), externalId: "g-1", idempotencyKey: "job-1" });
  assert.equal(first.outcome, "published");
  assert.equal((await f.get(first.eventId!))!.sourceType, "community");
  const link = await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", f.connectorId).eq("externalId", "g-1")).unique());
  assert.equal(link!.eventId, first.eventId);
  const retry = await f.apply({ candidate: candidate(night, ["event.title", "event.start"]), externalId: "g-1", idempotencyKey: "job-1" });
  assert.equal(retry.eventId, first.eventId);
  assert.equal((await f.t.run(ctx => ctx.db.query("events").collect())).length, 1);
});

it("echo guard: an inbound copy of VRDex's own export changes nothing", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent();
  // The hash the runner stores after exporting this event.
  const exported = await f.t.run(async ctx => carriedFieldsHash("google_calendar", await correctionFields(ctx.db, (await ctx.db.get(eventId))!)));
  await f.linkTo(eventId, { lastExportedHash: exported });
  const before = (await f.get(eventId))!;
  const result = await f.apply({ candidate: candidate(night, ["event.title", "event.start"]), externalId: "g-1", externalUpdatedAt: before.updatedAt + 60_000 });
  assert.equal(result.outcome, "skipped_echo");
  assert.deepEqual(await f.get(eventId), before);
});

it("refuses an actor other than the stored connector's authority", async () => {
  const f = await setup();
  const call = (mutate: (doc: Doc<"eventConnectors">) => { connector: Doc<"eventConnectors">; actorUserId: Id<"users"> }) => f.t.run(async ctx => {
    const doc = (await ctx.db.get(f.connectorId))!;
    return applyEventCandidate(ctx, { ...mutate(doc), idempotencyKey: "k", candidate: candidate(night, ["event.title"]), externalId: "g-1" });
  });
  await assert.rejects(call(doc => ({ connector: doc, actorUserId: f.users.outsider })), /CONNECTOR_FORBIDDEN/);
  // A stale Doc claiming the outsider as authority does not help: the stored row decides.
  await assert.rejects(call(doc => ({ connector: { ...doc, authorityUserId: f.users.outsider }, actorUserId: f.users.outsider })), /CONNECTOR_FORBIDDEN/);
  await f.t.run(ctx => ctx.db.patch(f.connectorId, { state: "paused" }));
  await assert.rejects(call(doc => ({ connector: { ...doc, state: "active" }, actorUserId: doc.authorityUserId })), /CONNECTOR_FORBIDDEN/);
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
});

it("refuses a connector whose direction is off", async () => {
  const f = await setup({ direction: "off" });
  await assert.rejects(f.apply({ candidate: candidate(night, ["event.title"]), externalId: "g-1" }), /CONNECTOR_FORBIDDEN/);
});

it("a retry with the same key and no external ID replays the publish", async () => {
  const f = await setup();
  const first = await f.apply({ candidate: candidate(night, ["event.title", "event.start"]), idempotencyKey: "job-7" });
  assert.equal(first.outcome, "published");
  const retry = await f.apply({ candidate: candidate(night, ["event.title", "event.start"]), idempotencyKey: "job-7" });
  assert.deepEqual([retry.outcome, retry.eventId], ["published", first.eventId]);
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeDrafts").collect())).length, 1);
});

it("carried-fields rule: a kind that does not carry venue never touches it", async () => {
  const f = await setup({ kind: "vrchat_calendar", target: { groupId: "grp_1", calendarId: "cal" } });
  const { eventId } = await f.createEvent({ venueLabel: "Main room" });
  await f.linkTo(eventId);
  const before = (await f.get(eventId))!;
  await f.apply({ candidate: candidate({ ...night, title: "Renamed", venueLabel: "Elsewhere" }, ["event.title", "event.venueLabel"]), externalId: "g-1", externalUpdatedAt: before.updatedAt + 60_000 });
  const after = (await f.get(eventId))!;
  assert.equal(after.title, "Renamed");
  assert.equal(after.venueLabel, "Main room");
});

it("explicit-only patch: inferred title stays, explicit start moves, lineup is whole-field and only when explicit", async () => {
  const f = await setup({ kind: "discord_announcements", direction: "import", target: { guildId: "123456789012345678", channelId: "223456789012345678" } });
  const created = await f.createEvent({ venueLabel: "Main room", lineup: [{ clientKey: "a", position: 0, performerLabel: "DJ A" }, { clientKey: "b", position: 1, performerLabel: "DJ B" }] });
  const update = { kind: "update" as const, slug: created.slug };
  const before = (await f.get(created.eventId))!;
  const swapped = candidate({ ...night, title: "Different", start: "21:00" }, ["event.start", "lineup.1.performerLabel"], {
    decision: update, lineup: [{ performerLabel: "DJ A", personSlug: null, roleLabel: null, start: null, end: null, startDate: null, endDate: null }, { performerLabel: "DJ C", personSlug: null, roleLabel: null, start: null, end: null, startDate: null, endDate: null }],
  });
  swapped.evidence.push({ fieldPath: "event.title", origin: "connector", excerpt: null, assessment: "inferred" });
  assert.equal((await f.apply({ candidate: swapped, externalId: "m-1", externalUpdatedAt: before.updatedAt + 60_000 })).outcome, "updated");
  const after = (await f.get(created.eventId))!;
  assert.equal(after.title, "Night Flight");
  assert.equal(after.startAt, before.startAt! + 3_600_000);
  assert.equal(after.venueLabel, "Main room");
  const lineup = () => f.t.run(ctx => ctx.db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", created.eventId)).collect());
  assert.deepEqual((await lineup()).map(row => row.performerLabel), ["DJ A", "DJ C"]);
  const inferredOnly = candidate({ ...night, start: "21:00" }, ["event.start"], { decision: update, lineup: [{ performerLabel: "DJ X", personSlug: null, roleLabel: null, start: null, end: null, startDate: null, endDate: null }] });
  await f.apply({ candidate: inferredOnly, externalId: "m-2", externalUpdatedAt: after.updatedAt + 60_000, idempotencyKey: "key-2" });
  assert.deepEqual((await lineup()).map(row => row.performerLabel), ["DJ A", "DJ C"]);
});

it("stale: on a bidirectional connector a source older than the VRDex edit is skipped with no draft", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent();
  await f.linkTo(eventId);
  const before = (await f.get(eventId))!;
  const result = await f.apply({ candidate: candidate({ ...night, title: "Older" }, ["event.title"]), externalId: "g-1", externalUpdatedAt: before.updatedAt - 1 });
  assert.equal(result.outcome, "skipped_stale");
  assert.deepEqual(await f.get(eventId), before);
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
});

it("conflict: a write-time version mismatch files a hold draft and leaves the event alone", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent();
  await f.linkTo(eventId);
  const before = (await f.get(eventId))!;
  const raced = { candidate: candidate({ ...night, title: "Raced" }, ["event.title"]), externalId: "g-1", externalUpdatedAt: before.updatedAt + 60_000, expectedUpdatedAt: before.updatedAt - 1 };
  const result = await f.apply(raced);
  assert.equal(result.outcome, "conflict");
  assert.deepEqual(await f.get(eventId), before);
  const link = await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).unique());
  assert.equal(link!.draftId, result.draftId);
  assert.equal((await f.apply(raced)).outcome, "skipped_pending_draft");
});

it("foreign update slug publishes into the connector community instead", async () => {
  const f = await setup();
  const foreign = await f.t.run(async ctx => {
    const profileId = await ctx.db.insert("profiles", { slug: "other-club", displayName: "Other", sortName: "other", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() });
    const eventId = await ctx.db.insert("events", { title: "Theirs", sortTitle: "theirs", slug: "zzzz9999", communityProfileId: profileId, sourceType: "community", sourceLabel: "x", eventStatus: "scheduled", publicationState: "published", scheduleKind: "date_only", eventDate: "2027-02-12", updatedAt: Date.now() });
    return eventId;
  });
  const before = (await f.get(foreign))!;
  const result = await f.apply({ candidate: candidate({ ...night, title: "Mine" }, ["event.title"], { decision: { kind: "update", slug: "zzzz9999" } }), externalId: "g-9" });
  assert.equal(result.outcome, "published");
  assert.notEqual(result.eventId, foreign);
  assert.deepEqual(await f.get(foreign), before);
});

it("publishing a given working draft carries its poster through to the event artwork", async () => {
  const f = await setup({ kind: "discord_announcements", direction: "import", target: { guildId: "123456789012345678", channelId: "223456789012345678" } });
  const { draftId, artworkId } = await f.t.run(async ctx => {
    const now = Date.now();
    const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: f.users.integrator, version: 1, fields: { sourceText: "Night Flight Friday 20:00 UTC" }, provenance: [], createdAt: now, updatedAt: now, expiresAt: now + 86_400_000 });
    const sourceId = await ctx.db.insert("eventPosterSources", { purpose: "event_poster", actorUserId: f.users.integrator, draftId, contentType: "image/png", byteLength: 10, sha256: "a".repeat(64), reservedBytes: 20, state: "ready", uploadedAt: now, expiresAt: now + 86_400_000, uploadExpiresAt: now, lastActivityAt: now });
    const artworkId = await ctx.db.insert("eventPosterArtwork", { actorUserId: f.users.integrator, draftId, sourceId, state: "ready", createdAt: now, expiresAt: now + 86_400_000 });
    await ctx.db.patch(draftId, { artworkAssetId: artworkId, fields: { sourceText: "Night Flight Friday 20:00 UTC", posterSourceId: sourceId } });
    return { draftId, artworkId };
  });
  const result = await f.t.run(async ctx => {
    const connector = (await ctx.db.get(f.connectorId))!;
    return applyEventCandidate(ctx, { connector, actorUserId: f.users.integrator, draftId, idempotencyKey: "run-1", externalId: "m-1", candidate: candidate(night, ["event.title", "event.start"]) });
  });
  assert.equal(result.outcome, "published");
  assert.equal(result.draftId, draftId);
  assert.equal((await f.get(result.eventId!))!.posterImageUrl, `/api/v0/events/${result.eventId}/artwork/${artworkId}`);
  assert.equal((await f.t.run(ctx => ctx.db.get(artworkId)))!.state, "published");
});

it("with date-only publishing off, a date-only candidate is held and a cleared start leaves the event alone", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent();
  await f.linkTo(eventId);
  delete process.env.EVENT_DATE_ONLY_ENABLED;
  try {
    const fresh = await f.apply({ candidate: candidate({ title: "All Day", eventDate: "2027-05-01" }, ["event.title", "event.eventDate"]), externalId: "g-2" });
    assert.equal(fresh.outcome, "draft");
    assert.equal((await f.t.run(ctx => ctx.db.query("events").collect())).length, 1);
    // The held shape rule 7 writes, in the one draft rule 9 saved: nothing reads as a staff value.
    const drafts = await f.t.run(ctx => ctx.db.query("eventIntakeDrafts").collect());
    assert.deepEqual(drafts.map(draft => [draft._id, draft.fields.title, draft.fields.eventDate, draft.fields.timeTba, draft.fields.tentative?.title]), [[fresh.draftId, undefined, undefined, undefined, "All Day"]]);
    const before = (await f.get(eventId))!;
    const cleared = await f.apply({ candidate: candidate({ ...night, start: null }, ["event.start"]), externalId: "g-1", externalUpdatedAt: before.updatedAt + 60_000, idempotencyKey: "key-2" });
    assert.equal(cleared.outcome, "draft");
    assert.deepEqual(await f.get(eventId), before);
  } finally {
    process.env.EVENT_DATE_ONLY_ENABLED = "true";
  }
});

it("date-only candidate publishes as time TBA", async () => {
  const f = await setup();
  const result = await f.apply({ candidate: candidate({ title: "All Day", eventDate: "2027-05-01" }, ["event.title", "event.eventDate"]), externalId: "g-2" });
  assert.equal(result.outcome, "published");
  assert.equal((await f.get(result.eventId!))!.scheduleKind, "date_only");
});

it("an update the event cannot take (start before VRDex-only doors) is held as a draft and leaves the event alone", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent();
  await f.t.run(ctx => ctx.db.patch(eventId, { doorsOpenAt: Date.UTC(2027, 1, 12, 19, 30) }));
  await f.linkTo(eventId);
  const before = (await f.get(eventId))!;
  const result = await f.apply({ candidate: candidate({ ...night, start: "19:00" }, ["event.start"]), externalId: "g-1", externalUpdatedAt: before.updatedAt + 60_000 });
  assert.equal(result.outcome, "draft");
  assert.deepEqual(await f.get(eventId), before);
  const link = await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).unique());
  assert.equal(link!.draftId, result.draftId);
  assert.equal((await f.get(result.draftId!))!.connectorId, f.connectorId);
});
