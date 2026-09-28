import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { getPublicCommunityHostedEvents, getPublicPersonUpcomingEvents } from "../../convex/_eventPublic";
import { getPublicWorldEventContext } from "../../convex/_worldEvents";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const command = (name: string) => makeFunctionReference<"mutation">(`eventCorrections:${name}`);
const reports = makeFunctionReference<"query">("eventCorrections:listEventReports");
const save = makeFunctionReference<"mutation">("eventIntake:saveEventIntakeDraft");
const publish = makeFunctionReference<"action">("eventIntake:publishEventIntake");
const complete = { communitySlug: "club", title: "Night Flight", eventDate: "2027-10-15", timeTba: true };

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
    "../../convex/eventCorrections.ts": () => import("../../convex/eventCorrections"),
    "../../convex/events.ts": () => import("../../convex/events"),
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
  const audit = (await t.run(ctx => ctx.db.query("eventAuditEvents").collect())).at(-1)!;
  assert.equal(audit.actorUserId, users[0]);
  assert.equal(audit.actorSurface, "api");
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
  assert.equal((await t.run(ctx => getPublicPersonUpcomingEvents(ctx.db, personId, Date.now()))).length, 1);
  const before = await t.run(ctx => getPublicWorldEventContext(ctx.db, worldId, Date.now()));
  assert.equal(before.upcoming.length, 1);
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
