import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { getPublicCommunityHostedEvents, getPublicPersonUpcomingEvents } from "../../convex/_eventPublic";
import { getPublicWorldEventContext } from "../../convex/_worldEvents";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const command = (name: string) => makeFunctionReference<"mutation">(`eventCorrections:${name}`);
const reports = makeFunctionReference<"query">("eventCorrections:listEventReports");
const save = makeFunctionReference<"mutation">("eventIntake:saveEventIntakeDraft");
const publish = makeFunctionReference<"action">("eventIntake:publishEventIntake");
const complete = { communitySlug: "club", title: "Night Flight", eventDate: "2027-10-15", timeTba: true };

it("staff browser and API corrections preserve date-only events and canonical lineup", async () => {
  for (const surface of ["browser", "api"] as const) {
    const { t, staff, event, users } = await fixture();
    await staff.mutation(command("takeOverContributedEvent"), { eventId: event._id });
    const update = (patch: Record<string, unknown>) => surface === "browser"
      ? staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, communitySlug: "club", ...patch } as never)
      : t.mutation(internal.events.updateCommunityEventForApiOwner, { actorKind: "personal_api_token", currentSlug: event.slug!, ownerUserId: users[1], ...patch } as never);
    await update({ title: "Corrected", venueLabel: "New venue" });
    let visible = (await t.query(api.events.getPublicBySlug, { slug: event.slug! }))!;
    assert.equal(visible.scheduleKind, "date_only");
    assert.equal(visible.eventDate, "2027-10-15");
    assert.equal(visible.startAt, undefined);
    assert.equal(visible.venueLabel, "New venue");
    assert.equal(visible.lineup[0].displayLabel, "DJ");
    await update({ lineup: [{ clientKey: "dj", position: 0, performerLabel: "Corrected guest" }] });
    visible = (await t.query(api.events.getPublicBySlug, { slug: event.slug! }))!;
    assert.deepEqual(visible.lineup.map(row => row.displayLabel), ["Corrected guest"]);
    await update({ lineup: [] });
    assert.deepEqual((await t.query(api.events.getPublicBySlug, { slug: event.slug! }))!.lineup, []);
    await update({ startAt: Date.parse("2027-10-15T19:00:00Z"), timezone: "UTC" });
    assert.equal((await t.query(api.events.getPublicBySlug, { slug: event.slug! }))!.scheduleKind, "timed");
  }
});

it("owner corrections refresh duplicate identity after title, date and community changes", async () => {
  const { t, contributor, event, users, communityId } = await fixture();
  const elsewhere = await t.run(async ({ db }) => {
    const { _id, _creationTime, ...fields } = (await db.get(communityId))!;
    const id = await db.insert("profiles", { ...fields, slug: "elsewhere" });
    await db.insert("profileOwners", { profileId: id, userId: users[1], roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
    return id;
  });
  await t.mutation(internal.events.updateCommunityEventForApiOwner, { actorKind: "personal_api_token", ownerUserId: users[1], currentSlug: event.slug!, title: "Morning Dance", eventDate: "2027-10-16", communitySlug: "elsewhere" } as never);
  assert.equal((await t.run(ctx => ctx.db.get(event._id)))!.contributionFingerprint, JSON.stringify([elsewhere, "2027-10-16", "morning dance"]));
  const draft = await contributor.mutation(save, { patch: complete });
  const result = await contributor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "new-original" });
  assert.notEqual(result.eventId, event._id);
});

it("owner browser and API edits preserve selected server artwork but reject arbitrary relative URLs", async () => {
  const { t, staff, contributor, users } = await fixture();
  const draft = await contributor.mutation(save, { patch: { ...complete, title: "Artwork night", eventDate: "2027-10-16" } });
  const actorUserId = users[0];
  const source = await t.mutation(internal.eventIntakeSources.beginPosterUpload, { actorUserId, draftId: draft.draftId, contentType: "image/png", byteLength: 100, sha256: "a".repeat(64) });
  await t.mutation(internal.eventIntakeSources.completePosterUpload, { actorUserId, posterAssetId: source.posterAssetId, sha256: "a".repeat(64) });
  const artwork = await t.mutation(internal.eventIntakeSources.selectPosterArtwork, { actorUserId, draftId: draft.draftId, posterAssetId: source.posterAssetId, expectedVersion: 1 });
  await t.mutation(internal.eventIntakeSources.completeArtwork, { actorUserId, artworkAssetId: artwork.artworkAssetId, expectedVersion: 1, sha256: "b".repeat(64), byteLength: 90 });
  const receipt = await contributor.action(publish, { draftId: draft.draftId, expectedVersion: 2, idempotencyKey: "artwork" });
  const event = (await t.run(ctx => ctx.db.get(receipt.eventId)))!;
  const posterImageUrl = `/api/v0/events/${event._id}/artwork/${artwork.artworkAssetId}`;
  assert.equal(event.posterImageUrl, posterImageUrl);
  await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: "Artwork correction", communitySlug: "club", posterImageUrl } as never);
  await t.mutation(internal.events.updateCommunityEventForApiOwner, { actorKind: "personal_api_token", currentSlug: event.slug!, ownerUserId: users[1], title: "Another correction" });
  assert.equal((await t.run(ctx => ctx.db.get(event._id)))!.posterImageUrl, posterImageUrl);
  await assert.rejects(staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, posterImageUrl: "/arbitrary.png" } as never), /Poster image URL/);
});

it("staff canonical lineup changes retain the slot and authorized stream on unrelated edits", async () => {
  const { t, staff, event } = await fixture();
  const startAt = Date.parse("2027-10-15T19:00:00Z");
  const personId = await t.run(ctx => ctx.db.insert("profiles", { slug: "performer", displayName: "Performer", sortName: "performer", profileType: "person", person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() }));
  await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, startAt, timezone: "UTC", communitySlug: "club", lineup: [{ clientKey: "set", position: 0, performerLabel: "DJ", personSlug: "performer", startAt }] });
  const slot = await t.run(async ({ db }) => {
    const slot = (await db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).first())!;
    await db.patch(slot._id, { selectedStreamId: "previously-authorized" });
    return slot;
  });
  await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: "Corrected", communitySlug: "club", startAt, timezone: "UTC", lineup: [{ clientKey: "set", position: 0, performerLabel: "Renamed", personSlug: "performer", startAt, selectedStreamId: "previously-authorized" }, { clientKey: "guest", position: 1, performerLabel: "Guest" }] });
  const preserved = (await t.run(ctx => ctx.db.get(slot._id)))!;
  assert.equal(preserved.personProfileId, personId);
  assert.equal(preserved.selectedStreamId, "previously-authorized");
  const editable = (await staff.query(api.events.getEditableBySlug, { slug: event.slug! }))!;
  assert.equal(editable.usesCanonicalLineup, true);
  assert.equal(editable.slots[0].clientKey, "set");
  assert.equal(editable.lineup[1].key, "guest");
  await assert.rejects(staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, communitySlug: "club", startAt, timezone: "UTC", lineup: [{ clientKey: "set", position: 0, performerLabel: "DJ", personSlug: "performer", startAt, selectedStreamId: "unrelated-stream" }] }), /Selected stream/);
});

it("owner conversion to Time TBA respects the date-only rollout switch", async () => {
  const { staff, event } = await fixture();
  await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, communitySlug: "club", startAt: Date.parse("2027-10-15T19:00:00Z") });
  process.env.EVENT_DATE_ONLY_ENABLED = "false";
  try {
    await assert.rejects(staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, communitySlug: "club", scheduleKind: "date_only", eventDate: "2027-10-15", lineup: [] }), /not enabled/);
  } finally { process.env.EVENT_DATE_ONLY_ENABLED = "true"; }
});
it("owner Time TBA conversion settles queued media", async () => {
  const { t, staff, event } = await fixture();
  const startAt = Date.parse("2027-10-15T19:00:00Z");
  await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, communitySlug: "club", startAt, timezone: "UTC" });
  const output = await staff.mutation(api.events.configureVrcdnOutput, { currentSlug: event.slug!, key: "main", label: "Main output", credentialRef: "vrcdn/main", sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true, playbackLinks: [{ platform: "browser", label: "Watch", url: "https://example.com/watch" }] });
  const scheduled = await staff.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug! });
  await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, communitySlug: "club", scheduleKind: "date_only", eventDate: "2027-10-15" });
  const state = await t.run(async ctx => ({ program: await ctx.db.get(output.programId), session: await ctx.db.get(scheduled.sessionId), start: scheduled.startCommandId ? await ctx.db.get(scheduled.startCommandId) : null }));
  assert.equal(state.program?.state, "ended");
  assert.equal(state.session?.status, "ended");
  assert.equal(state.start?.status, "cancelled");
});

it("browser readback saves preserve private canonical performer links but allow replacement and removal", async () => {
  for (const becomesPrivateAfterRead of [false, true]) {
    const { t, staff, event } = await fixture();
    const startAt = Date.parse("2027-10-15T19:00:00Z");
    const people = await t.run(async ({ db }) => Promise.all(["timed", "untimed", "replacement"].map(slug => db.insert("profiles", { slug, displayName: slug, sortName: slug, profileType: "person", person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() }))));
    await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, communitySlug: "club", startAt, timezone: "UTC", lineup: [
      { clientKey: "timed", position: 0, performerLabel: "Timed name", personSlug: "timed", startAt },
      { clientKey: "untimed", position: 1, performerLabel: "Untimed name", personSlug: "untimed" },
    ] });
    await t.run(async ({ db }) => {
      const slot = (await db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).first())!;
      await db.patch(slot._id, { selectedStreamId: "previously-authorized" });
    });
    const makePrivate = () => t.run(async ({ db }) => { for (const id of people.slice(0, 2)) await db.patch(id, { publicationState: "draft_private" }); });
    if (!becomesPrivateAfterRead) await makePrivate();
    const editable = (await staff.query(api.events.getEditableBySlug, { slug: event.slug! }))!;
    if (!becomesPrivateAfterRead) assert.ok(editable.lineup.every(row => row.performer === undefined));
    if (becomesPrivateAfterRead) await makePrivate();
    const lineup = [
      ...editable.slots.map(slot => ({ clientKey: slot.clientKey!, position: slot.position, performerLabel: slot.displayLabel, roleLabel: slot.roleLabel, personSlug: slot.performer?.slug, startAt: slot.startAt, endAt: slot.endAt, selectedStreamId: slot.selectedStreamId })),
      ...editable.lineup.filter(row => row.startAt === undefined).map(row => ({ clientKey: row.key, position: row.position, performerLabel: row.displayLabel, roleLabel: row.roleLabel, personSlug: row.performer?.slug })),
    ];
    const updated = await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: "Title correction", communitySlug: "club", startAt, timezone: "UTC", lineup,
      preservedSlotAssociationIds: editable.preservedSlotAssociationIds, preservedParticipantAssociationIds: editable.preservedParticipantAssociationIds });
    const rows = await t.run(async ({ db }) => ({ slots: await db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(), untimed: await db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", event._id)).collect(), participants: await db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect() }));
    assert.equal(rows.slots[0].personProfileId, people[0]);
    assert.equal(rows.slots[0].selectedStreamId, "previously-authorized");
    assert.equal(rows.untimed[0].personProfileId, people[1]);
    assert.deepEqual(rows.participants.map(row => row.personProfileId).sort(), people.slice(0, 2).sort());
    assert.ok((await t.query(api.events.getPublicBySlug, { slug: event.slug! }))!.lineup.every(row => row.performer === undefined));
    await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: "Changed performer", communitySlug: "club", startAt, timezone: "UTC", lineup: [{ ...lineup[0], personSlug: "replacement", selectedStreamId: undefined }],
      preservedSlotAssociationIds: updated.preservedSlotAssociationIds, preservedParticipantAssociationIds: updated.preservedParticipantAssociationIds });
    const remaining = await t.run(async ({ db }) => ({ slot: await db.query("eventSlots").first(), untimed: await db.query("eventLineupEntries").collect(), people: await db.query("eventParticipants").collect() }));
    assert.equal(remaining.slot?.personProfileId, people[2]);
    assert.equal(remaining.slot?.selectedStreamId, undefined);
    assert.equal(remaining.untimed.length, 0);
    assert.deepEqual(remaining.people.map(row => row.personProfileId), [people[2]]);
  }
});

it("owner API conversion to Time TBA clears inherited event and set times while retaining the lineup", async () => {
  for (const timezone of [undefined, null]) {
    const { t, staff, event, users } = await fixture();
    const startAt = Date.parse("2027-10-15T19:00:00Z");
    await staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: event.title, communitySlug: "club", startAt, doorsOpenAt: startAt - 60000, endAt: startAt + 7200000, timezone: "UTC", lineup: [{ clientKey: "timed", position: 0, performerLabel: "Timed guest", startAt, endAt: startAt + 3600000 }, { clientKey: "untimed", position: 1, performerLabel: "Untimed guest" }] });
    const update = { actorKind: "personal_api_token" as const, ownerUserId: users[1], currentSlug: event.slug!, scheduleKind: "date_only" as const, eventDate: "2027-10-16" };
    for (const field of ["startAt", "doorsOpenAt", "endAt"]) {
      await assert.rejects(t.mutation(internal.events.updateCommunityEventForApiOwner, { ...update, [field]: startAt }), /Time TBA cannot include event times/);
    }
    await t.mutation(internal.events.updateCommunityEventForApiOwner, { ...update, timezone });
    const stored = (await t.run(ctx => ctx.db.get(event._id)))!;
    assert.equal(stored.scheduleKind, "date_only");
    assert.equal(stored.eventDate, "2027-10-16");
    for (const field of ["startAt", "doorsOpenAt", "endAt", "timezone"] as const) assert.equal(stored[field], undefined);
    assert.equal((await t.run(ctx => ctx.db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect())).length, 0);
    const visible = (await t.query(api.events.getPublicBySlug, { slug: event.slug! }))!;
    assert.deepEqual(visible.lineup.map(row => row.displayLabel), ["Timed guest", "Untimed guest"]);
    assert.ok(visible.lineup.every(row => row.startAt === undefined && row.endAt === undefined));
  }
});

it("browser controls expose own editing, scoped staff takeover, and post-takeover suggestion", async () => {
  const { contributor, staff, other, moderator, event } = await fixture();
  const access = makeFunctionReference<"query">("eventCorrections:getEventContributionAccess");
  assert.equal((await contributor.query(access, { eventId: event._id })).canCorrect, true);
  assert.equal((await other.query(access, { eventId: event._id })).canCorrect, false);
  assert.equal((await staff.query(access, { eventId: event._id })).canTakeOver, true);
  assert.equal((await staff.query(access, { eventId: event._id })).canRemove, false);
  assert.equal((await moderator.query(access, { eventId: event._id })).canRemove, true);
  await staff.mutation(command("takeOverContributedEvent"), { eventId: event._id });
  const closed = await contributor.query(access, { eventId: event._id });
  assert.equal(closed.canCorrect, false);
  assert.equal(closed.canSuggest, true);
});
async function fixture() {
  process.env.EVENT_DATE_ONLY_ENABLED = "true";
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
    "../../convex/eventIntakeSources.ts": () => import("../../convex/eventIntakeSources"),
    "../../convex/eventCorrections.ts": () => import("../../convex/eventCorrections"),
    "../../convex/events.ts": () => import("../../convex/events"),
    "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const ids = await t.run(async ctx => {
    const users = await Promise.all(["contributor", "staff", "moderator", "other"].map(clerkUserId => ctx.db.insert("users", { clerkUserId })));
    const communityId = await ctx.db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() });
    await ctx.db.insert("profileOwners", { profileId: communityId, userId: users[1], roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.insert("accountFeatureGrants", { userId: users[2], feature: "super_admin", state: "active", grantedBy: { tokenIdentifier: "test|moderator", subject: "moderator", issuer: "test" }, grantedAt: Date.now(), updatedAt: Date.now() });
    return { communityId, users };
  });
  const actor = (subject: string) => t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true });
  const contributor = actor("contributor");
  const draft = await contributor.mutation(save, { patch: { ...complete, lineup: [{ clientKey: "dj", position: 0, performerLabel: "DJ" }] } });
  const result = await contributor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "first" });
  const event = (await t.run(ctx => ctx.db.get(result.eventId)))!;
  return { t, contributor, staff: actor("staff"), moderator: actor("moderator"), other: actor("other"), event, ...ids };
}

it("allows only original contributor scoped edits without manage_events and records changed fields", async () => {
  const { t, contributor, other, event } = await fixture();
  const args = { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { title: "Morning Dance", summary: "Updated" } };
  await assert.rejects(other.mutation(command("updateOwnContributedEvent"), args), /CONTRIBUTOR_REQUIRED/);
  await contributor.mutation(command("updateOwnContributedEvent"), args);
  const updated = (await t.run(ctx => ctx.db.get(event._id)))!;
  assert.equal(updated.title, "Morning Dance");
  assert.ok(updated.updatedAt > event.updatedAt);
  assert.equal(updated.contributionVersion, 2);
  const visible = await t.query(api.events.getPublicBySlug, { slug: event.slug! });
  assert.equal(visible?.lineup[0]?.displayLabel, "DJ");
  assert.equal(visible?.title, "Morning Dance");
  const audit = await t.run(ctx => ctx.db.query("eventAuditEvents").collect());
  assert.deepEqual(audit.at(-1)?.changedFields, ["title", "summary"]);
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), args), /VERSION_CONFLICT/);
});
it("unrelated corrections retain a performer match that became private", async () => {
  const { t, contributor, event } = await fixture();
  const personId = await t.run(({ db }) => db.insert("profiles", {
    slug: "guest", displayName: "Guest", sortName: "guest", profileType: "person",
    person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed",
    publicationState: "published", publicSurfacingState: "public",
    creationSource: "community", updatedAt: Date.now(),
  }));
  await contributor.mutation(command("updateOwnContributedEvent"), {
    eventId: event._id, expectedUpdatedAt: event.updatedAt,
    patch: { lineup: [{ clientKey: "dj", position: 0, performerLabel: "DJ", personSlug: "guest" }] },
  });
  await t.run(({ db }) => db.patch(personId, { publicationState: "draft_private" }));
  const own = await contributor.query(makeFunctionReference<"query">("eventCorrections:getOwnContributedEvent"), { eventId: event._id });
  assert.equal(own.fields.lineup[0]?.personSlug, undefined);
  const current = (await t.run(({ db }) => db.get(event._id)))!;
  await contributor.mutation(command("updateOwnContributedEvent"), {
    eventId: event._id, expectedUpdatedAt: current.updatedAt,
    patch: { summary: "Updated summary" },
  });
  const lineup = await t.run(({ db }) => db.query("eventLineupEntries")
    .withIndex("by_eventId_position", q => q.eq("eventId", event._id)).collect());
  assert.equal(lineup[0]?.personProfileId, personId);
  assert.equal((await t.query(api.events.getPublicBySlug, { slug: event.slug! }))?.lineup[0]?.performer, undefined);
});
it("contributor schedule corrections rebase then cancel event-relative club actions", async () => {
  const { t, contributor, event, communityId } = await fixture();
  const firstStart = Date.parse("2027-10-15T19:00:00Z");
  await contributor.mutation(command("updateOwnContributedEvent"), {
    eventId: event._id, expectedUpdatedAt: event.updatedAt,
    patch: { timeTba: null, timezone: "UTC", start: { time: "19:00", dayOffset: 0 } },
  });
  const operationId = await t.run(async ({ db }) => {
    const now = Date.now();
    const integrationId = await db.insert("communityVrchatIntegrations", {
      communityProfileId: communityId, vrchatGroupId: "grp_test", groupVisibility: "public",
      joinPolicy: "free", state: "active", killSwitchEnabled: false,
      requestsPerMinute: 10, leaseGeneration: 1, consecutiveFailures: 0,
      publicMetrics: { currentPopulation: false, populationHistory: false,
        groupMemberCount: false, groupMemberGrowth: false, eventRecaps: false },
      createdAt: now, updatedAt: now,
    });
    const actor = { subject: "staff", issuer: "test", tokenIdentifier: "test|staff" };
    return db.insert("clubOperations", {
      communityProfileId: communityId, integrationId, epochStartedAt: now,
      requestId: "correction", batchId: "correction",
      payload: { kind: "publish_post", title: "Post", text: "Body", visibility: "group", sendNotification: false },
      schedule: { kind: "event_relative", eventId: event._id, offsetMs: 0 }, eventId: event._id,
      dueAt: firstStart, readyAt: firstStart, actor, createdBy: actor,
      revision: 1, state: "pending", createdAt: now, updatedAt: now,
    });
  });
  let current = (await t.run(({ db }) => db.get(event._id)))!;
  await contributor.mutation(command("updateOwnContributedEvent"), {
    eventId: event._id, expectedUpdatedAt: current.updatedAt,
    patch: { start: { time: "20:00", dayOffset: 0 } },
  });
  assert.equal((await t.run(({ db }) => db.get(operationId)))?.dueAt, firstStart + 3_600_000);
  current = (await t.run(({ db }) => db.get(event._id)))!;
  await contributor.mutation(command("updateOwnContributedEvent"), {
    eventId: event._id, expectedUpdatedAt: current.updatedAt,
    patch: { timeTba: true, start: null, end: null, doors: null },
  });
  const cancelled = await t.run(({ db }) => db.get(operationId));
  assert.equal(cancelled?.state, "cancelled");
  assert.equal(cancelled?.code, "event_time_tba");
});
it("converting a contributed event to Time TBA cancels its queued media start", async () => {
  const { t, contributor, staff, event } = await fixture();
  await contributor.mutation(command("updateOwnContributedEvent"), {
    eventId: event._id, expectedUpdatedAt: event.updatedAt,
    patch: { timeTba: null, timezone: "UTC", start: { time: "19:00", dayOffset: 0 } },
  });
  const output = await staff.mutation(api.events.configureVrcdnOutput, {
    currentSlug: event.slug!, key: "main", label: "Main output", credentialRef: "vrcdn/main",
    sourceConsentAccepted: true, destinationAuthorityAccepted: true,
    providerRulesAccepted: true, rightsClearedMediaAccepted: true,
    playbackLinks: [{ platform: "browser", label: "Watch", url: "https://example.com/watch" }],
  });
  const scheduled = await staff.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug! });
  const current = (await t.run(ctx => ctx.db.get(event._id)))!;
  const movedStartAt = Date.parse("2027-10-15T20:00:00Z");
  await contributor.mutation(command("updateOwnContributedEvent"), {
    eventId: event._id, expectedUpdatedAt: current.updatedAt,
    patch: { start: { time: "20:00" } },
  });
  const moved = (await t.run(ctx => ctx.db.get(event._id)))!;
  const rebased = await t.run(async ctx => ({ session: await ctx.db.get(scheduled.sessionId), start: scheduled.startCommandId ? await ctx.db.get(scheduled.startCommandId) : null }));
  assert.equal(moved.startAt, movedStartAt);
  assert.equal(rebased.session?.scheduledStartAt, movedStartAt - (current.startAt! - scheduled.scheduledStartAt));
  assert.equal(rebased.session?.readyDeadlineAt, scheduled.readyDeadlineAt + (movedStartAt - current.startAt!));
  assert.equal(rebased.start?.availableAt, rebased.session?.scheduledStartAt);
  await contributor.mutation(command("updateOwnContributedEvent"), {
    eventId: event._id, expectedUpdatedAt: moved.updatedAt,
    patch: { timeTba: true, start: null, end: null, doors: null },
  });
  const state = await t.run(async ctx => ({
    program: await ctx.db.get(output.programId),
    session: await ctx.db.get(scheduled.sessionId),
    start: scheduled.startCommandId ? await ctx.db.get(scheduled.startCommandId) : null,
  }));
  assert.equal(state.program?.state, "ended");
  assert.equal(state.session?.status, "ended");
  assert.equal(state.start?.status, "cancelled");
});
it("contributor Time TBA correction invalidates an existing event recap", async () => {
  const { t, contributor, communityId, event } = await fixture();
  await contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { timeTba: null, timezone: "UTC", start: { time: "19:00" } } });
  const timed = (await t.run(ctx => ctx.db.get(event._id)))!;
  await t.run(async ctx => {
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", { communityProfileId: communityId, vrchatGroupId: "grp_test", groupVisibility: "public", joinPolicy: "free", state: "active", killSwitchEnabled: false, requestsPerMinute: 4, leaseGeneration: 0, publicMetrics: { currentPopulation: false, populationHistory: false, groupMemberCount: false, groupMemberGrowth: false, eventRecaps: false }, consecutiveFailures: 0, createdAt: Date.now(), updatedAt: Date.now() });
    const sessionId = await ctx.db.insert("instanceSessions", { integrationId, communityProfileId: communityId, providerInstanceId: "test", providerLocation: "wrld_test:test", vrchatWorldId: "wrld_test", source: "first_party", state: "closed", openedAt: timed.startAt!, lastObservedAt: timed.startAt!, consecutiveMisses: 2, updatedAt: Date.now() });
    await ctx.db.insert("eventInstanceAssociations", { eventId: event._id, sessionId, communityProfileId: communityId, source: "manual", confidence: 1, state: "confirmed", createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.insert("communityTelemetryRollups", { communityProfileId: communityId, eventId: event._id, grain: "event", bucketStartAt: timed.startAt!, bucketEndAt: timed.startAt! + 3600000, rollupVersion: "community-telemetry-v1", activeInstanceCount: 1, peakConcurrency: 1, playerMinutes: 1, coverageRatio: 1, worldDistribution: [], computedAt: Date.now() });
  });
  await contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: timed.updatedAt, patch: { timeTba: true, start: null } });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await t.finishInProgressScheduledFunctions();
  assert.equal(await t.run(ctx => ctx.db.query("communityTelemetryRollups").first()), null);
});
it("contributor end-time corrections recompute a confirmed event recap", async () => {
  const { t, contributor, communityId, event } = await fixture();
  await contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { timeTba: null, timezone: "UTC", start: { time: "19:00" }, end: { time: "21:00" } } });
  const timed = (await t.run(ctx => ctx.db.get(event._id)))!;
  await t.run(async ctx => {
    const sessionId = await ctx.db.insert("instanceSessions", { integrationId: await ctx.db.insert("communityVrchatIntegrations", { communityProfileId: communityId, vrchatGroupId: "grp_test_end", groupVisibility: "public", joinPolicy: "free", state: "active", killSwitchEnabled: false, requestsPerMinute: 4, leaseGeneration: 0, publicMetrics: { currentPopulation: false, populationHistory: false, groupMemberCount: false, groupMemberGrowth: false, eventRecaps: false }, consecutiveFailures: 0, createdAt: Date.now(), updatedAt: Date.now() }), communityProfileId: communityId, providerInstanceId: "test", providerLocation: "wrld_test:test", vrchatWorldId: "wrld_test", source: "first_party", state: "closed", openedAt: timed.startAt!, lastObservedAt: timed.startAt!, consecutiveMisses: 2, updatedAt: Date.now() });
    await ctx.db.insert("eventInstanceAssociations", { eventId: event._id, sessionId, communityProfileId: communityId, source: "manual", confidence: 1, state: "confirmed", createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.insert("communityTelemetryRollups", { communityProfileId: communityId, eventId: event._id, grain: "event", bucketStartAt: timed.startAt!, bucketEndAt: timed.endAt!, rollupVersion: "community-telemetry-v1", activeInstanceCount: 1, peakConcurrency: 1, playerMinutes: 1, coverageRatio: 1, worldDistribution: [], computedAt: Date.now() });
  });
  await contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: timed.updatedAt, patch: { end: { time: "22:00" } } });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await t.finishInProgressScheduledFunctions();
  const rollup = await t.run(ctx => ctx.db.query("communityTelemetryRollups").first());
  assert.equal(rollup?.bucketEndAt, Date.parse("2027-10-15T22:00:00Z"));
});
it("rejects attachment, provenance, trust, watch and private evidence changes", async () => {
  const { contributor, event } = await fixture();
  for (const patch of [{ communitySlug: "elsewhere" }, { sourceType: "community" }, { sourceLabel: "Owner" }, { watchMode: "event_stream" }, { notes: "private" }, { contributorEditsClosedAt: 0 }, { sourceText: "evidence" }]) {
    await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch }), /PATCH_FIELD/);
  }
});
it("reruns publication preflight and lineup validation without publication quotas", async () => {
  const { t, contributor, communityId, event } = await fixture();
  const args = { eventId: event._id, expectedUpdatedAt: event.updatedAt };
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { ...args, patch: { sourceUrl: "javascript:alert(1)" } }));
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { ...args, patch: { lineup: [{ clientKey: "x", position: 0, performerLabel: "DJ", personSlug: "missing" }] } }), /published public person/);
  await t.run(ctx => ctx.db.patch(communityId, { publicationState: "draft_private" }));
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { ...args, patch: { summary: "No" } }), /public community/);
  assert.equal((await t.run(ctx => ctx.db.get(event._id)))?.updatedAt, event.updatedAt);
});
it("staff takeover closes contributor editing and retraction even with a freshly read revision", async () => {
  const { t, staff, contributor, event } = await fixture();
  await staff.mutation(command("takeOverContributedEvent"), { eventId: event._id });
  const current = (await t.run(ctx => ctx.db.get(event._id)))!;
  assert.ok(current.contributorEditsClosedAt);
  assert.equal(current.contributorLockRevision, 1);
  for (const expectedUpdatedAt of [event.updatedAt, current.updatedAt]) await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt, patch: { title: "Stale" } }), /CONTRIBUTOR_EDIT_CLOSED/);
  await assert.rejects(contributor.mutation(command("retractOwnContributedEvent"), { eventId: event._id }), /CONTRIBUTOR_EDIT_CLOSED/);
});
it("contributor retraction is audited, hidden and can be republished by staff", async () => {
  const { t, contributor, staff, event } = await fixture();
  await contributor.mutation(command("retractOwnContributedEvent"), { eventId: event._id });
  assert.equal(await t.query(api.events.getPublicBySlug, { slug: event.slug! }), null);
  assert.ok((await t.run(ctx => ctx.db.query("eventAuditEvents").collect())).some(row => row.action === "retracted"));
  await staff.mutation(api.events.setCommunityEventPublished, { currentSlug: event.slug!, published: true });
  assert.ok(await t.query(api.events.getPublicBySlug, { slug: event.slug! }));
});
it("legacy unlocked retraction and moderator removal settle queued event media", async () => {
  for (const removal of [false, true]) {
    const { t, contributor, staff, moderator, event } = await fixture();
    await staff.mutation(api.events.updateCommunityEvent, {
      currentSlug: event.slug!, title: event.title, communitySlug: "club",
      startAt: Date.parse("2027-10-15T19:00:00Z"), timezone: "UTC",
    });
    const output = await staff.mutation(api.events.configureVrcdnOutput, {
      currentSlug: event.slug!, key: "main", label: "Main output",
      credentialRef: "vrcdn/main", sourceConsentAccepted: true,
      destinationAuthorityAccepted: true, providerRulesAccepted: true,
      rightsClearedMediaAccepted: true,
      playbackLinks: [{ platform: "browser", label: "Watch", url: "https://example.com/watch" }],
    });
    const scheduled = await staff.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug! });
    if (!removal) await t.run(({ db }) => db.patch(event._id, { contributorEditsClosedAt: undefined }));
    if (removal) await moderator.mutation(command("removeContributedEvent"), { eventId: event._id, reason: "Removed by moderator" });
    else await contributor.mutation(command("retractOwnContributedEvent"), { eventId: event._id });
    const state = await t.run(async ({ db }) => ({
      program: await db.get(output.programId),
      session: await db.get(scheduled.sessionId),
      start: scheduled.startCommandId ? await db.get(scheduled.startCommandId) : null,
    }));
    assert.equal(state.program?.state, "ended");
    assert.deepEqual(state.program?.publicLinks, []);
    assert.equal(state.session?.status, "ended");
    assert.equal(state.start?.status, "cancelled");
  }
});
it("staff cancel and unpublish both close direct editing", async () => {
  for (const cancel of [false, true]) {
    const { t, staff, contributor, event } = await fixture();
    if (cancel) await staff.mutation(api.events.setCommunityEventCancelled, { currentSlug: event.slug!, cancelled: true, reason: "Cancelled by host" });
    else await staff.mutation(api.events.setCommunityEventPublished, { currentSlug: event.slug!, published: false });
    assert.ok((await t.run(ctx => ctx.db.get(event._id)))?.contributorEditsClosedAt);
    await assert.rejects(contributor.mutation(command("retractOwnContributedEvent"), { eventId: event._id }), /CONTRIBUTOR_EDIT_CLOSED/);
  }
});
it("moderator removal checks separate grant, audits and removes every public projection", async () => {
  const { t, staff, contributor, moderator, communityId, event } = await fixture();
  const args = { eventId: event._id, reason: "False event reported by host" };
  await assert.rejects(staff.mutation(command("removeContributedEvent"), args), /SUPER_ADMIN_REQUIRED/);
  await assert.rejects(contributor.mutation(command("removeContributedEvent"), args), /SUPER_ADMIN_REQUIRED/);
  await moderator.mutation(command("removeContributedEvent"), args);
  assert.equal(await t.query(api.events.getPublicBySlug, { slug: event.slug! }), null);
  assert.deepEqual(await t.query(api.events.listPublicUpcoming, { now: Date.now() }), []);
  assert.equal((await t.query(api.search.listDiscovery, {})).upcomingEvents.length, 0);
  assert.equal((await t.run(ctx => getPublicCommunityHostedEvents(ctx.db, communityId, Date.now()))).length, 0);
  const audit = await t.run(ctx => ctx.db.query("eventAuditEvents").collect());
  assert.equal(audit.at(-1)?.action, "suppressed");
  assert.equal(audit.at(-1)?.actor?.subject, "moderator");
  assert.equal(audit.at(-1)?.reason, args.reason);
  await assert.rejects(staff.mutation(api.events.setCommunityEventPublished, { currentSlug: event.slug!, published: true }), /REMOVED_EVENT/);
});
it("staff content edits close contributor authority and survive a concurrent contributor write", async () => {
  const { t, contributor, staff, event } = await fixture();
  const results = await Promise.allSettled([
    staff.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, title: "Staff correction", communitySlug: "club", startAt: Date.parse("2027-10-15T19:00:00Z"), timezone: "UTC" }),
    contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { title: "Contributor correction" } }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  const final = (await t.run(ctx => ctx.db.get(event._id)))!;
  assert.equal(final.title, "Staff correction");
  assert.ok(final.contributorLockRevision);
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: final.updatedAt, patch: { title: "Overwrite" } }), /CONTRIBUTOR_EDIT_CLOSED/);
});
it("expired and revoked moderator grants cannot remove events", async () => {
  for (const state of ["revoked", "expired"] as const) {
    const { t, moderator, event } = await fixture();
    await t.run(async ctx => {
      const grant = (await ctx.db.query("accountFeatureGrants").collect())[0];
      await ctx.db.patch(grant._id, state === "revoked" ? { state: "revoked" } : { expiresAt: Date.now() - 1 });
    });
    await assert.rejects(moderator.mutation(command("removeContributedEvent"), { eventId: event._id, reason: "False event" }), /SUPER_ADMIN_REQUIRED/);
  }
});
it("staff cannot see another community's reports or classifier outage flags", async () => {
  const { t, staff, moderator, event } = await fixture();
  await t.run(async ctx => {
    const own = (await ctx.db.get(event.communityProfileId!))!;
    const { _id, _creationTime, ...fields } = own;
    const elsewhere = await ctx.db.insert("profiles", { ...fields, slug: "elsewhere" });
    await ctx.db.insert("eventReports", { eventId: event._id, communityProfileId: elsewhere, kind: "classifier_outage", reason: "Provider timeout", createdAt: Date.now() });
  });
  assert.equal((await staff.query(reports, { cursor: null, limit: 20 })).page.length, 0);
  assert.equal((await moderator.query(reports, { cursor: null, limit: 20 })).page[0].kind, "classifier_outage");
});
it("preserves exact ambiguous local instants and lineup when updating only a summary", async () => {
  const { t, contributor } = await fixture();
  const draft = await contributor.mutation(save, { patch: { ...complete, eventDate: "2027-11-07", timeTba: false, timezone: "America/New_York", start: { time: "01:30", occurrence: "later" }, lineup: [{ clientKey: "dj", position: 0, performerLabel: "DJ", start: { time: "01:45", occurrence: "later" } }] } });
  const result = await contributor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "timed" });
  const event = (await t.run(ctx => ctx.db.get(result.eventId)))!;
  await contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { summary: "New summary" } });
  const updated = (await t.run(ctx => ctx.db.get(event._id)))!;
  assert.equal(updated.startAt, event.startAt);
  const slot = await t.run(ctx => ctx.db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).first());
  assert.equal(slot?.startAt, Date.parse("2027-11-07T06:45:00Z"));
});
it("clears optional text fields with empty or null values", async () => {
  const { t, contributor, event } = await fixture();
  await t.run(ctx => ctx.db.patch(event._id, { summary: "Old summary", venueLabel: "Old venue" }));
  await contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { summary: "", venueLabel: null } });
  const updated = (await t.run(ctx => ctx.db.get(event._id)))!;
  assert.equal(updated.summary, undefined);
  assert.equal(updated.venueLabel, undefined);
});
it("signed-out reports are bounded, never auto-remove and are private to staff/moderators", async () => {
  const { t, staff, moderator, contributor, other, event } = await fixture();
  const args = { eventId: event._id, reason: "This date is incorrect" };
  await t.mutation(command("reportEvent"), args);
  await contributor.mutation(command("reportEvent"), args);
  assert.ok(await t.query(api.events.getPublicBySlug, { slug: event.slug! }));
  for (const actor of [t, contributor, other]) await assert.rejects(actor.query(reports, { cursor: null, limit: 20 }));
  const rows = await staff.query(reports, { cursor: null, limit: 20 });
  assert.equal(rows.page.length, 2);
  assert.ok(rows.page.some((row: { actorUserId?: string }) => row.actorUserId));
  assert.equal((await moderator.query(reports, { cursor: null, limit: 20 })).page.length, 2);
  for (let i = 0; i < 18; i++) await t.mutation(command("reportEvent"), { ...args, reason: `Other report ${i}` });
  await assert.rejects(t.mutation(command("reportEvent"), { ...args, reason: "Exceeds limit" }), /REPORT_QUOTA/);
});
it("classifier flags do not consume visitor report quotas", async () => {
  const { t, contributor, event, users } = await fixture();
  await t.run(async ({ db }) => {
    for (let i = 0; i < 500; i++) await db.insert("eventReports", {
      eventId: event._id, communityProfileId: event.communityProfileId,
      actorUserId: users[0], kind: i % 2 ? "classifier_outage" : "classifier_sample",
      reason: "Classifier check", createdAt: Date.now(),
    });
  });
  assert.deepEqual(await contributor.mutation(command("reportEvent"), {
    eventId: event._id, reason: "Incorrect listing",
  }), { accepted: true });
});
it("suppresses immediate recreation with expiring fingerprint even after canonical deletion", async () => {
  const { t, moderator, contributor, event } = await fixture();
  await moderator.mutation(command("removeContributedEvent"), { eventId: event._id, reason: "False event" });
  const rows = await t.run(ctx => ctx.db.query("eventContributionSuppressions").collect());
  assert.equal(rows.length, 1);
  assert.ok(rows[0].expiresAt > rows[0].createdAt);
  assert.ok(rows[0].expiresAt - rows[0].createdAt <= 30 * 86400000);
  await t.run(ctx => ctx.db.delete(event._id));
  const draft = await contributor.mutation(save, { patch: complete });
  await assert.rejects(contributor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "repost" }), /REPOST_BLOCKED/);
  await t.run(ctx => ctx.db.patch(rows[0]._id, { expiresAt: Date.now() - 1 }));
  assert.ok((await contributor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "repost" })).eventId);
});
it("suppresses the current listing after staff correction and moderator removal", async () => {
  const { staff, moderator, contributor, event } = await fixture();
  await staff.mutation(api.events.updateCommunityEvent, {
    currentSlug: event.slug!, title: "Morning Dance", communitySlug: "club",
    startAt: Date.parse("2027-10-16T19:00:00Z"), timezone: "UTC",
  });
  await moderator.mutation(command("removeContributedEvent"), { eventId: event._id, reason: "False event" });
  const draft = await contributor.mutation(save, { patch: {
    communitySlug: "club", title: "Morning Dance", eventDate: "2027-10-16",
    timeTba: false, start: { time: "19:00" }, timezone: "UTC",
  } });
  await assert.rejects(contributor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "staff-corrected-repost" }), /REPOST_BLOCKED/);
});
it("corrects an acknowledged near duplicate with explicit confirmation outside the content patch", async () => {
  const { t, contributor, event } = await fixture();
  const draft = await contributor.mutation(save, { patch: { ...complete, title: "Night Flight Afterparty", duplicateAcknowledgements: [event._id] } });
  const result = await contributor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "near-duplicate" });
  assert.notEqual(result.eventId, event._id);
  const published = (await t.run(ctx => ctx.db.get(result.eventId)))!;
  const args = { eventId: published._id, expectedUpdatedAt: published.updatedAt, patch: { summary: "Updated afterparty details" } };
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), args), /NEAR_DUPLICATE/);
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { ...args, patch: { ...args.patch, duplicateAcknowledgements: [event._id] } }), /PATCH_FIELD/);
  await contributor.mutation(command("updateOwnContributedEvent"), { ...args, duplicateAcknowledgements: [event._id] });
  const updated = (await t.run(ctx => ctx.db.get(result.eventId)))!;
  assert.equal(updated.summary, args.patch.summary);
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { ...args, expectedUpdatedAt: updated.updatedAt, patch: { title: event.title }, duplicateAcknowledgements: [event._id] }), /DUPLICATE_EVENT/);
});
it("internal correction adapters bind audit identity to the authenticated transport actor", async () => {
  const { t, event, users } = await fixture();
  await t.mutation(makeFunctionReference<"mutation">("eventCorrections:updateActorContributedEvent"), { actorUserId: users[0], eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { summary: "Via API" } });
  let audit = (await t.run(ctx => ctx.db.query("eventAuditEvents").collect())).at(-1)!;
  assert.equal(audit.actorUserId, users[0]);
  assert.equal(audit.actorSurface, "api");
  const updated = (await t.run(ctx => ctx.db.get(event._id)))!;
  await t.mutation(makeFunctionReference<"mutation">("eventCorrections:updateActorContributedEvent"), { actorUserId: users[0], actorSurface: "mcp", eventId: event._id, expectedUpdatedAt: updated.updatedAt, patch: { summary: "Via MCP" } });
  await t.mutation(makeFunctionReference<"mutation">("eventCorrections:retractActorContributedEvent"), { actorUserId: users[0], actorSurface: "mcp", eventId: event._id });
  const audits = await t.run(ctx => ctx.db.query("eventAuditEvents").collect());
  assert.deepEqual(audits.slice(-2).map(row => [row.action, row.actorSurface]), [["updated", "mcp"], ["retracted", "mcp"]]);
});
it("enforces global and account report quotas independently of supplied identity", async () => {
  for (const mode of ["global", "actor"] as const) {
    const { t, contributor, event, users } = await fixture();
    await t.run(async ctx => {
      const { _id, _creationTime, ...eventFields } = event;
      const otherEventId = await ctx.db.insert("events", { ...eventFields, slug: "other-event" });
      for (let i = 0; i < (mode === "global" ? 500 : 10); i++) await ctx.db.insert("eventReports", {
        eventId: otherEventId, actorUserId: mode === "actor" ? users[0] : undefined,
        reason: "Quota fixture", kind: "report", createdAt: Date.now(),
      });
    });
    await assert.rejects((mode === "global" ? t : contributor).mutation(command("reportEvent"), { eventId: event._id, reason: "Incorrect details" }), /REPORT_QUOTA/);
  }
});
it("updates participant and world feeds atomically on correction and removal", async () => {
  const { t, contributor, moderator, event } = await fixture();
  const { personId, worldId } = await t.run(async ctx => {
    const personId = await ctx.db.insert("profiles", { slug: "dj", displayName: "DJ", sortName: "dj", profileType: "person", person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() });
    const worldId = await ctx.db.insert("worlds", { slug: "world", displayName: "World", sortName: "world", tags: [], publicationState: "published", visibilityStatus: "public", platformCompatibility: [], media: [], creatorAttributions: [], outboundLinks: [], creationSource: "community", updatedAt: Date.now() });
    return { personId, worldId };
  });
  await contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { worldSlug: "world", lineup: [{ clientKey: "dj", position: 0, performerLabel: "DJ", personSlug: "dj" }] } });
  assert.equal((await t.run(ctx => getPublicPersonUpcomingEvents(ctx.db, personId, Date.now()))).length, 0);
  const before = await t.run(ctx => getPublicWorldEventContext(ctx.db, worldId, Date.now()));
  assert.equal(before.upcoming.length, 0);
  const publicEvent = await t.query(api.events.getPublicBySlug, { slug: event.slug! });
  assert.equal(publicEvent?.worlds[0]?.association.confirmationState, "unconfirmed");
  const current = (await t.run(ctx => ctx.db.get(event._id)))!;
  await contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: current.updatedAt, patch: { summary: "Updated details" } });
  assert.equal((await t.query(api.events.getPublicBySlug, { slug: event.slug! }))?.worlds[0]?.slug, "world");
  await moderator.mutation(command("removeContributedEvent"), { eventId: event._id, reason: "Incorrect listing" });
  assert.equal((await t.run(ctx => getPublicPersonUpcomingEvents(ctx.db, personId, Date.now()))).length, 0);
  assert.equal((await t.run(ctx => getPublicWorldEventContext(ctx.db, worldId, Date.now()))).upcoming.length, 0);
  const associations = await t.run(async ctx => [...await ctx.db.query("eventParticipants").collect(), ...await ctx.db.query("eventWorlds").collect()]);
  assert.ok(associations.every(row => row.eventPublicationState === "draft_private"));
});
it("corrections bypass publication quota but reject a collision with another canonical event", async () => {
  const { t, contributor, event } = await fixture();
  await t.run(async ctx => {
    const receipt = (await ctx.db.query("eventContributionReceipts").collect())[0];
    const { _id, _creationTime, ...fields } = receipt;
    for (let i = 0; i < 10; i++) await ctx.db.insert("eventContributionReceipts", fields);
  });
  const corrected = await contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { title: "Morning Yoga" } });
  await t.run(async ctx => {
    const { _id, _creationTime, ...fields } = event;
    await ctx.db.insert("events", { ...fields, title: "Elsewhere", contributionFingerprint: undefined, slug: "elsewhere" });
  });
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: corrected.updatedAt, patch: { title: "Elsewhere" } }), /DUPLICATE_EVENT/);
});
it("provides canonical own-event read and actor-bound retract adapters without private evidence", async () => {
  const { t, contributor, other, event, users } = await fixture();
  const getOwn = makeFunctionReference<"query">("eventCorrections:getOwnContributedEvent");
  const read = await contributor.query(getOwn, { eventId: event._id });
  assert.equal(read.fields.title, event.title);
  assert.equal(read.fields.sourceText, undefined);
  await assert.rejects(other.query(getOwn, { eventId: event._id }), /CONTRIBUTOR_REQUIRED/);
  await t.mutation(makeFunctionReference<"mutation">("eventCorrections:retractActorContributedEvent"), { actorUserId: users[0], eventId: event._id });
  assert.equal(await t.query(api.events.getPublicBySlug, { slug: event.slug! }), null);
  const audit = (await t.run(ctx => ctx.db.query("eventAuditEvents").collect())).at(-1)!;
  assert.equal(audit.actorUserId, users[0]);
});
it("bounds suppression cleanup and preserves active fingerprints", async () => {
  const { t, event } = await fixture();
  await t.run(async ctx => {
    for (let i = 0; i < 205; i++) await ctx.db.insert("eventContributionSuppressions", { eventId: event._id, fingerprint: String(i), createdAt: 0, expiresAt: 1 });
    await ctx.db.insert("eventContributionSuppressions", { eventId: event._id, fingerprint: "active", createdAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
  });
  assert.equal(await t.mutation(makeFunctionReference<"mutation">("eventCorrections:expireEventSuppressions"), {}), 200);
  assert.equal((await t.run(ctx => ctx.db.query("eventContributionSuppressions").collect())).length, 6);
});
it("fails closed when removed rows fill the bounded same-day duplicate scan", async () => {
  const { t, contributor, event } = await fixture();
  await t.run(async ctx => {
    const { _id, _creationTime, ...fields } = event;
    for (let i = 0; i < 102; i++) await ctx.db.insert("events", { ...fields, title: `Removed ${i}`, contributionFingerprint: undefined, moderationRemovedAt: Date.now(), publicationState: "draft_private" });
  });
  await assert.rejects(contributor.mutation(command("updateOwnContributedEvent"), { eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { title: "New title" } }), /TARGET_QUOTA/);
});
