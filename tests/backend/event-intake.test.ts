import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { getPublicCommunityHostedEvents, getPublicPersonUpcomingEvents } from "../../convex/_eventPublic";
import { eventContributionFingerprint } from "../../convex/_eventContributionPreflight";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const save = makeFunctionReference<"mutation">("eventIntake:saveEventIntakeDraft");
const get = makeFunctionReference<"query">("eventIntake:getEventIntakeDraft");
const publish = makeFunctionReference<"action">("eventIntake:publishEventIntake");
it("keeps symbol-only event titles distinct in duplicate fingerprints", () => {
  assert.notEqual(eventContributionFingerprint("club", "2027-10-15", "🎉🎉"), eventContributionFingerprint("club", "2027-10-15", "!!"));
});
async function fixture() {
  process.env.EVENT_DATE_ONLY_ENABLED = "true";
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
    "../../convex/events.ts": () => import("../../convex/events"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const communityId = await t.run(async ctx => {
    await ctx.db.insert("users", { clerkUserId: "intake-user", name: "Contributor" });
    await ctx.db.insert("users", { clerkUserId: "other-user", name: "Other" });
    return ctx.db.insert("profiles", { slug: "public-club", displayName: "Public Club", sortName: "public club", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() });
  });
  const actor = t.withIdentity({ subject: "intake-user", issuer: "test", tokenIdentifier: "test|intake-user", emailVerified: false });
  return { t, actor, communityId };
}
const complete = { communitySlug: "public-club", title: "Night Flight", eventDate: "2027-10-15", timeTba: true };

it("returns an unavailable draft for a malformed browser draft link", async () => {
  const { actor, t } = await fixture();
  assert.equal(await actor.query(get, { draftId: "not-a-convex-id" }), null);
  const saved = await actor.mutation(save, { patch: complete });
  await t.run(ctx => ctx.db.delete(saved.draftId));
  assert.equal(await actor.query(get, { draftId: saved.draftId }), null);
});

it("saves a private poster-only draft and refuses wholly empty durable drafts", async () => {
  const { t, actor } = await fixture();
  const result = await actor.mutation(save, { patch: { posterSourceId: "source-1" } });
  assert.equal(result.version, 1);
  assert.equal((await actor.query(get, { draftId: result.draftId })).fields.posterSourceId, "source-1");
  await assert.rejects(actor.mutation(save, { patch: { title: " " } }), /meaningful/i);
  await assert.rejects(t.query(get, { draftId: result.draftId }));
  assert.equal(await t.withIdentity({ subject: "other-user" }).query(get, { draftId: result.draftId }), null);
});
it("merges omitted fields, clears null and empty strings and rejects stale versions", async () => {
  const { actor } = await fixture();
  const draft = await actor.mutation(save, { patch: { title: "Night", summary: "Hello", venueLabel: "Club" } });
  const next = await actor.mutation(save, { draftId: draft.draftId, expectedVersion: 1, patch: { summary: null, venueLabel: "" } });
  assert.equal(next.version, 2);
  assert.deepEqual((await actor.query(get, { draftId: draft.draftId })).fields, { title: "Night" });
  await assert.rejects(actor.mutation(save, { draftId: draft.draftId, expectedVersion: 1, patch: { title: "Stale" } }), /VERSION_CONFLICT/);
});
it("publishes for any public community without verified email, source URL or staff and indexes public reads", async () => {
  const { t, actor, communityId } = await fixture();
  const draft = await actor.mutation(save, { patch: { ...complete, venueLabel: "The Hall", lineup: [{ clientKey: "a", position: 0, performerLabel: "Unmatched DJ" }] } });
  const result = await actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "pub1" });
  const event = await t.run(ctx => ctx.db.get(result.eventId));
  const visible = await t.query(api.events.getPublicBySlug, { slug: event!.slug! });
  assert.equal(visible?.scheduleKind, "date_only");
  assert.equal(visible?.startAt, undefined);
  assert.equal(visible?.venueLabel, "The Hall");
  assert.equal(visible?.source.sourceType, "contributor");
  assert.equal(visible?.lineup[0]?.displayLabel, "Unmatched DJ");
  assert.ok(result.eventPath.includes(event!.slug!));
  assert.equal((await t.run(ctx => getPublicCommunityHostedEvents(ctx.db, communityId, Date.now()))).length, 1);
  assert.equal((await t.query(api.search.listDiscovery, {})).upcomingEvents.length, 1);
  const audit = await t.run(ctx => ctx.db.query("eventAuditEvents").collect());
  assert.equal(audit.length, 1);
  assert.deepEqual({ action: audit[0].action, actorSurface: audit[0].actorSurface, eventId: audit[0].eventId },
    { action: "created", actorSurface: "browser", eventId: result.eventId });
});
it("refuses unknown dates, private targets and disabled date-only publication", async () => {
  const { t, actor, communityId } = await fixture();
  const draft = await actor.mutation(save, { patch: { title: "Unknown", communitySlug: "public-club" } });
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "x" }), /date/i);
  await actor.mutation(save, { draftId: draft.draftId, expectedVersion: 1, patch: complete });
  process.env.EVENT_DATE_ONLY_ENABLED = "false";
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 2, idempotencyKey: "x" }), /not enabled/i);
  process.env.EVENT_DATE_ONLY_ENABLED = "true";
  await t.run(ctx => ctx.db.patch(communityId, { publicationState: "draft_private" }));
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 2, idempotencyKey: "x" }), /public community/i);
});
it("deduplicates concurrent publication and exact replay and rejects changed idempotency input", async () => {
  const { t, actor } = await fixture();
  const draft = await actor.mutation(save, { patch: complete });
  const args = { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "once" };
  const results = await Promise.all([actor.action(publish, args), actor.action(publish, args)]);
  assert.deepEqual(results[0], results[1]);
  const duplicate = await actor.mutation(save, { patch: complete });
  assert.equal((await actor.action(publish, { ...args, draftId: duplicate.draftId, idempotencyKey: "duplicate" })).eventId, results[0].eventId);
  await assert.rejects(actor.action(publish, { ...args, draftId: duplicate.draftId }), /IDEMPOTENCY_CONFLICT/);
  const counts = await t.run(async ctx => [(await ctx.db.query("events").collect()).length, (await ctx.db.query("eventContributionReceipts").collect()).length]);
  assert.deepEqual(counts, [1, 1]);
});
it("returns near-match choices and requires a versioned acknowledgement", async () => {
  const { actor } = await fixture();
  const a = await actor.mutation(save, { patch: complete });
  const first = await actor.action(publish, { draftId: a.draftId, expectedVersion: 1, idempotencyKey: "first" });
  const b = await actor.mutation(save, { patch: { ...complete, title: "Night Flight Special" } });
  await assert.rejects(actor.action(publish, { draftId: b.draftId, expectedVersion: 1, idempotencyKey: "second" }), /NEAR_DUPLICATE/);
  await actor.mutation(save, { draftId: b.draftId, expectedVersion: 1, patch: { duplicateAcknowledgements: [first.eventId] } });
  const second = await actor.action(publish, { draftId: b.draftId, expectedVersion: 2, idempotencyKey: "second" });
  assert.notEqual(second.eventId, first.eventId);
});

it("replays immutable receipts after expired drafts have been swept", async () => {
  const { t, actor } = await fixture();
  const draft = await actor.mutation(save, { patch: complete });
  const args = { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "durable" };
  const first = await actor.action(publish, args);
  await t.run(ctx => ctx.db.delete(draft.draftId));
  assert.deepEqual(await actor.action(publish, args), first);
});
it("replay uses the current community route after a slug change", async () => {
  const { t, actor, communityId } = await fixture();
  const draft = await actor.mutation(save, { patch: complete });
  const args = { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "moved-route" };
  const first = await actor.action(publish, args);
  await t.run(({ db }) => db.patch(communityId, { slug: "new-club" }));
  const replay = await actor.action(publish, args);
  assert.equal(replay.eventId, first.eventId);
  assert.equal(replay.receiptId, first.receiptId);
  assert.equal(replay.eventPath, `/new-club/events/${first.eventPath.split("/").at(-1)}`);
});
it("bounds drafts, rejects authority and unsafe URLs, and preserves tentative values privately", async () => {
  const { actor } = await fixture();
  for (const patch of [{ watchMode: "event_stream" }, { sourceUrl: "javascript:alert(1)" }, { sourceUrl: "not a URL" }, { sourceType: "community" }, { title: "x".repeat(121) }])
    await assert.rejects(actor.mutation(save, { patch }));
  await assert.rejects(actor.mutation(save, { patch: { sourceUrl: "not a URL" } }), /Source URL must be a safe HTTPS URL/);
  const draft = await actor.mutation(save, { patch: { sourceText: "Night poster", tentative: complete } });
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "tentative" }));
  const read = await actor.query(get, { draftId: draft.draftId });
  assert.equal(read.fields.title, undefined);
  assert.equal(read.provenance.find((entry: {field: string}) => entry.field === "tentative").kind, "tentative");
  for (let i = 1; i < 20; i++) await actor.mutation(save, { patch: { title: `Draft ${i}` } });
  await assert.rejects(actor.mutation(save, { patch: { title: "Over quota" } }), /DRAFT_QUOTA/);
});
it("requires explicit DST selection and cross-midnight day offsets for timed events and lineup", async () => {
  const { t, actor } = await fixture();
  const draft = await actor.mutation(save, { patch: { ...complete, eventDate: "2027-11-07", timeTba: false, timezone: "America/New_York", start: { time: "01:30" } } });
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "dst" }), /Ambiguous/);
  await actor.mutation(save, { draftId: draft.draftId, expectedVersion: 1, patch: { start: { time: "01:30", occurrence: "later" }, end: { time: "00:30" } } });
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 2, idempotencyKey: "dst" }), /next day/);
  await actor.mutation(save, { draftId: draft.draftId, expectedVersion: 2, patch: { end: { time: "00:30", dayOffset: 1 }, lineup: [{ clientKey: "dj", position: 0, performerLabel: "DJ", start: { time: "23:30" }, end: { time: "00:15", dayOffset: 1 } }] } });
  const result = await actor.action(publish, { draftId: draft.draftId, expectedVersion: 3, idempotencyKey: "dst" });
  const event = await t.run(ctx => ctx.db.get(result.eventId));
  assert.equal(event!.startAt, Date.parse("2027-11-07T06:30:00Z"));
  assert.equal(event!.endAt, Date.parse("2027-11-08T05:30:00Z"));
  const slots = await t.run(ctx => ctx.db.query("eventSlots").collect());
  assert.equal(slots[0].endAt, Date.parse("2027-11-08T05:15:00Z"));
});
it("does not create an event or receipt when lineup validation fails", async () => {
  const { t, actor } = await fixture();
  const draft = await actor.mutation(save, { patch: { ...complete, lineup: [{ clientKey: "x", position: 0, performerLabel: "Missing", personSlug: "not-public" }] } });
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "bad-lineup" }), /public person/);
  assert.deepEqual(await t.run(async ctx => [(await ctx.db.query("events").collect()).length, (await ctx.db.query("eventContributionReceipts").collect()).length, (await ctx.db.query("searchDocuments").collect()).length]), [0, 0, 0]);
});

it("shows contributor lineup matches without claiming a performer's profile before staff review", async () => {
  const { t, actor } = await fixture();
  const personId = await t.run(ctx => ctx.db.insert("profiles", { slug: "public-dj", displayName: "Public DJ", sortName: "public dj", profileType: "person", person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() }));
  const draft = await actor.mutation(save, { patch: { ...complete, sourceText: "Private source evidence", posterSourceId: "private-poster", lineup: [{ clientKey: "a", position: 0, performerLabel: "Public DJ", personSlug: "public-dj" }] } });
  const result = await actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "matched" });
  const event = await t.run(ctx => ctx.db.get(result.eventId));
  const publicEvent = await t.query(api.events.getPublicBySlug, { slug: event!.slug! });
  assert.equal(publicEvent?.lineup[0].displayLabel, "Public DJ");
  assert.equal(publicEvent?.participants.length, 0);
  for (const key of ["contributorUserId", "sourceText", "posterSourceId", "ownerConfirmed", "submitter"]) assert.equal(Object.hasOwn(publicEvent!, key), false);
  assert.equal(publicEvent?.posterImageUrl, undefined);
  assert.equal((await t.run(ctx => ctx.db.query("eventParticipants").first()))?.confirmationState, "unconfirmed");
  assert.equal((await t.run(ctx => getPublicPersonUpcomingEvents(ctx.db, personId, Date.now()))).length, 0);
});
it("keeps contributed timed slots visible while person links remain unconfirmed", async () => {
  const { t, actor } = await fixture();
  const personId = await t.run(ctx => ctx.db.insert("profiles", { slug: "timed-dj", displayName: "Timed DJ", sortName: "timed dj", profileType: "person", person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() }));
  const draft = await actor.mutation(save, { patch: { ...complete, timeTba: null, timezone: "UTC", start: { time: "19:00" }, lineup: [{ clientKey: "set", position: 0, performerLabel: "Timed DJ", personSlug: "timed-dj", start: { time: "20:00" } }] } });
  const result = await actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "timed-match" });
  const event = (await t.run(ctx => ctx.db.get(result.eventId)))!;
  const publicEvent = await t.query(api.events.getPublicBySlug, { slug: event.slug! });
  assert.equal(publicEvent?.lineup[0]?.displayLabel, "Timed DJ");
  assert.equal(publicEvent?.lineup[0]?.startAt, Date.parse("2027-10-15T20:00:00Z"));
  assert.equal((await t.run(ctx => ctx.db.query("eventParticipants").first()))?.confirmationState, "unconfirmed");
  assert.equal((await t.run(ctx => getPublicPersonUpcomingEvents(ctx.db, personId, Date.now()))).length, 0);
});
it("keeps a selected public world and contributor attribution in the atomic publication", async () => {
  const { t, actor } = await fixture();
  await t.run(ctx => ctx.db.insert("worlds", { slug: "public-world", displayName: "Public World", sortName: "public world", tags: [], publicationState: "published", visibilityStatus: "public", platformCompatibility: [], media: [], creatorAttributions: [], outboundLinks: [], creationSource: "community", updatedAt: Date.now() }));
  const draft = await actor.mutation(save, { patch: { ...complete, worldSlug: "public-world" } });
  const result = await actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "world" });
  const event = await t.run(ctx => ctx.db.get(result.eventId));
  const publicEvent = await t.query(api.events.getPublicBySlug, { slug: event!.slug! });
  assert.equal(publicEvent?.worlds[0]?.slug, "public-world");
  assert.equal(publicEvent?.worlds[0]?.association.sourceType, "contributor");
  assert.equal(publicEvent?.worlds[0]?.association.confirmationState, "unconfirmed");
  const association = await t.run(ctx => ctx.db.query("eventWorlds").first());
  assert.equal(association?.confirmedAt, undefined);
  await t.run(ctx => ctx.db.patch(association!._id, { sourceType: "manual" }));
  assert.equal((await t.query(api.events.getPublicBySlug, { slug: event!.slug! }))?.worlds.length, 0);
  await t.run(ctx => ctx.db.patch(association!._id, { sourceType: "contributor" }));
  await t.run(ctx => ctx.db.patch(result.eventId, { sourceType: "manual" }));
  assert.equal((await t.query(api.events.getPublicBySlug, { slug: event!.slug! }))?.worlds.length, 0);
});
it("enforces account publication quota and leaves the over-quota draft resumable", async () => {
  const { actor } = await fixture();
  for (let i = 1; i <= 10; i++) {
    const draft = await actor.mutation(save, { patch: { ...complete, eventDate: `2027-10-${String(i).padStart(2, "0")}` } });
    await actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: `quota-${i}` });
  }
  const draft = await actor.mutation(save, { patch: complete });
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "quota-over" }), /ACCOUNT_QUOTA/);
  assert.equal((await actor.query(get, { draftId: draft.draftId })).version, 1);
});
it("allows unrelated same-day events without a duplicate warning", async () => {
  const { actor } = await fixture();
  const first = await actor.mutation(save, { patch: complete });
  await actor.action(publish, { draftId: first.draftId, expectedVersion: 1, idempotencyKey: "night" });
  const second = await actor.mutation(save, { patch: { ...complete, title: "Morning Yoga" } });
  assert.ok((await actor.action(publish, { draftId: second.draftId, expectedVersion: 1, idempotencyKey: "morning" })).eventId);
});
it("rejects structural-only draft content and leaves no durable row", async () => {
  const { t, actor } = await fixture();
  await assert.rejects(actor.mutation(save, { patch: { lineup: [{ clientKey: "empty", position: 0 }] } }), /meaningful/);
  assert.equal((await t.run(ctx => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
});
it("caps fresh replay keys without preventing the original retry", async () => {
  const { actor } = await fixture();
  const draft = await actor.mutation(save, { patch: complete });
  const args = { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "key-0" };
  const first = await actor.action(publish, args);
  for (let i = 1; i < 100; i++) await actor.action(publish, { ...args, idempotencyKey: `key-${i}` });
  await assert.rejects(actor.action(publish, { ...args, idempotencyKey: "over-quota" }), /REQUEST_QUOTA/);
  assert.deepEqual(await actor.action(publish, args), first);
});
it("detects exact legacy timed events before schedule migration and refuses removed reposts", async () => {
  const { t, actor, communityId } = await fixture();
  const existingId = await t.run(ctx => ctx.db.insert("events", { slug: "legacy-event", title: complete.title, sortTitle: complete.title.toLowerCase(), startAt: Date.parse("2027-10-15T18:00:00Z"), timezone: "UTC", communityProfileId: communityId, sourceType: "community", sourceLabel: "Community", publicationState: "published", eventStatus: "scheduled", updatedAt: Date.now() }));
  const draft = await actor.mutation(save, { patch: complete });
  const result = await actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "legacy" });
  assert.equal(result.eventId, existingId);
  await t.run(ctx => ctx.db.patch(existingId, { publicationState: "draft_private" }));
  const repost = await actor.mutation(save, { patch: complete });
  await assert.rejects(actor.action(publish, { draftId: repost.draftId, expectedVersion: 1, idempotencyKey: "repost" }), /REPOST_BLOCKED/);
});
it("expires drafts in bounded sweeps and retains publish receipts", async () => {
  const { t, actor } = await fixture();
  const draft = await actor.mutation(save, { patch: complete });
  const result = await actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "cleanup" });
  await t.run(async ctx => {
    await ctx.db.patch(draft.draftId, { expiresAt: 1 });
    const original = (await ctx.db.get(draft.draftId))!;
    const { _id, _creationTime, ...fields } = original;
    for (let i = 0; i < 100; i++) await ctx.db.insert("eventIntakeDrafts", fields);
  });
  const sweep = makeFunctionReference<"mutation">("eventIntake:expireDrafts");
  assert.equal(await t.mutation(sweep, {}), 100);
  assert.equal(await t.mutation(sweep, {}), 1);
  assert.ok(await t.run(ctx => ctx.db.get(result.receiptId)));
});
it("repairs a slugless legacy exact match before storing a routable replay receipt", async () => {
  const { t, actor, communityId } = await fixture();
  const existingId = await t.run(ctx => ctx.db.insert("events", {
    title: complete.title, sortTitle: complete.title.toLowerCase(),
    startAt: Date.parse("2027-10-15T18:00:00Z"), timezone: "UTC",
    communityProfileId: communityId, summary: "Original event summary",
    sourceType: "community", sourceLabel: "Community", publicationState: "published",
    eventStatus: "scheduled", updatedAt: Date.now(),
  }));
  const draft = await actor.mutation(save, { patch: { ...complete, summary: "Duplicate draft summary" } });
  const args = { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "slugless-legacy" };
  const result = await actor.action(publish, args);
  assert.equal(result.eventId, existingId);
  assert.doesNotMatch(result.eventPath, /undefined/);
  const repaired = await t.run(ctx => ctx.db.get(existingId));
  assert.ok(repaired?.slug);
  assert.equal(result.eventPath, `/public-club/events/${repaired.slug}`);
  const publicEvent = await t.query(api.events.getPublicBySlug, { slug: repaired.slug });
  assert.equal(publicEvent?.summary, "Original event summary");
  assert.equal(publicEvent?.source.sourceType, "community");
  const indexed = await t.run(ctx => ctx.db.query("searchDocuments").withIndex("by_eventId", q => q.eq("eventId", existingId)).unique());
  assert.equal(indexed?.publicState, "public");
  assert.equal(indexed?.routePath, result.eventPath);
  assert.equal(indexed?.summary, "Original event summary");
  const shortLink = await t.run(ctx => ctx.db.query("shortLinks").withIndex("by_targetEventId", q => q.eq("targetEventId", existingId)).unique());
  assert.equal(shortLink?.code, repaired.slug);
  assert.deepEqual(await actor.action(publish, args), result);
  assert.deepEqual(await t.run(async ctx => [(await ctx.db.query("events").collect()).length, (await ctx.db.query("eventContributionReceipts").collect()).length]), [1, 1]);
});
it("enforces the shared target quota across independent contributor accounts", async () => {
  const { t, actor } = await fixture();
  for (let user = 0; user < 10; user++) {
    const subject = `quota-user-${user}`;
    await t.run(ctx => ctx.db.insert("users", { clerkUserId: subject }));
    const contributor = t.withIdentity({ subject });
    for (let item = 0; item < 10; item++) {
      const date = new Date(Date.parse("2028-01-01T00:00:00Z") + (user * 10 + item) * 86_400_000).toISOString().slice(0, 10);
      const draft = await contributor.mutation(save, { patch: { ...complete, eventDate: date } });
      await contributor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: `target-${item}` });
    }
  }
  const draft = await actor.mutation(save, { patch: complete });
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "target-over" }), /TARGET_QUOTA/);
});

it("bounds and expires declared poster-only drafts without making them public", async () => {
  const { t, actor } = await fixture();
  const declaration = { contentType: "image/png", byteLength: 100, sha256: "a".repeat(64) };
  const draft = await actor.mutation(save, { patch: { posterDeclaration: declaration } });
  const loaded = await actor.query(get, { draftId: draft.draftId });
  assert.deepEqual(loaded.fields, { posterDeclaration: declaration });
  await assert.rejects(actor.action(publish, { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "poster-incomplete" }));
  assert.equal(await t.withIdentity({ subject: "other-user" }).query(get, { draftId: draft.draftId }), null);
  await assert.rejects(actor.mutation(save, { patch: { posterDeclaration: { ...declaration, byteLength: 13 * 1024 * 1024 } } }));
  assert.equal((await t.run(ctx => ctx.db.query("events").collect())).length, 0);
  for (let i = 1; i < 20; i++) await actor.mutation(save, { patch: { posterDeclaration: declaration } });
  await assert.rejects(actor.mutation(save, { patch: { posterDeclaration: declaration } }), /DRAFT_QUOTA/);
  await t.run(ctx => ctx.db.patch(draft.draftId, { expiresAt: Date.now() - 1 }));
  await t.mutation(makeFunctionReference<"mutation">("eventIntake:expireDrafts"), {});
  assert.equal(await t.run(ctx => ctx.db.get(draft.draftId)), null);
});
